import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import Stripe from 'stripe';

const router = Router();

// Ensure environment variables are loaded
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY not found in environment variables');
  throw new Error('Stripe configuration missing');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

// @desc    Check if contractor has access to a job
// @route   GET /api/payments/job-access/:jobId
// @access  Private (Contractor only)
export const checkJobAccess = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { jobId } = req.params;
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true, creditsBalance: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Check if contractor already has access to this job
  const existingAccess = await prisma.jobAccess.findUnique({
    where: {
      jobId_contractorId: {
        jobId,
        contractorId: contractor.id,
      },
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      hasAccess: !!existingAccess,
      creditsBalance: contractor.creditsBalance,
    },
  });
});

// @desc    Purchase job access using credits or Stripe payment
// @route   POST /api/payments/purchase-job-access
// @access  Private (Contractor only)
export const purchaseJobAccess = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { jobId, paymentMethod, stripePaymentIntentId } = req.body;
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get job details with lead price
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      service: {
        select: {
          smallJobPrice: true,
          mediumJobPrice: true,
          largeJobPrice: true,
        },
      },
      customer: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if contractor already has access
  const existingAccess = await prisma.jobAccess.findUnique({
    where: {
      jobId_contractorId: {
        jobId,
        contractorId: contractor.id,
      },
    },
  });

  if (existingAccess) {
    return next(new AppError('You already have access to this job', 400));
  }

  // Calculate lead price based on job size
  let leadPrice = 0;
  if (job.service) {
    switch (job.jobSize) {
      case 'SMALL':
        leadPrice = job.service.smallJobPrice ? job.service.smallJobPrice.toNumber() : 0;
        break;
      case 'MEDIUM':
        leadPrice = job.service.mediumJobPrice ? job.service.mediumJobPrice.toNumber() : 0;
        break;
      case 'LARGE':
        leadPrice = job.service.largeJobPrice ? job.service.largeJobPrice.toNumber() : 0;
        break;
    }
  }

  // Use override price if set
  if (job.leadPrice && typeof job.leadPrice.toNumber === 'function' && job.leadPrice.toNumber() > 0) {
    leadPrice = job.leadPrice.toNumber();
  }

  await prisma.$transaction(async (tx) => {
    let payment;
    let invoice;

    if (paymentMethod === 'CREDIT') {
      // Check if contractor has enough credits
      if (contractor.creditsBalance < 1) {
        throw new AppError('Insufficient credits. Please top up or pay directly.', 400);
      }

      // Deduct credit
      await tx.contractor.update({
        where: { id: contractor.id },
        data: { creditsBalance: { decrement: 1 } },
      });

      // Create credit transaction
      await tx.creditTransaction.create({
        data: {
          contractorId: contractor.id,
          type: 'DEDUCTION',
          amount: 1,
          description: `Job access purchased for: ${job.title}`,
          jobId,
        },
      });

      // Create payment record
      payment = await tx.payment.create({
        data: {
          contractorId: contractor.id,
          amount: 0,
          type: 'LEAD_ACCESS',
          status: 'COMPLETED',
          description: `Job access purchased with credit for: ${job.title}`,
        },
      });

      // Create invoice
      invoice = await tx.invoice.create({
        data: {
          amount: 0,
          vatAmount: 0,
          totalAmount: 0,
          description: `Job Lead Access - ${job.title}`,
          invoiceNumber: `INV-${Date.now()}-${contractor.id.slice(-6)}`,
          recipientName: job.customer?.user?.name || 'Unknown',
          recipientEmail: job.customer?.user?.email || 'unknown@trustbuild.uk',
        },
      });
    } else if (paymentMethod === 'STRIPE') {
      if (!stripePaymentIntentId) {
        throw new AppError('Stripe payment intent ID is required', 400);
      }

      // Verify payment with Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
      
      if (paymentIntent.status !== 'succeeded') {
        throw new AppError('Payment not completed', 400);
      }

      if (paymentIntent.amount !== leadPrice * 100) { // Stripe uses cents
        throw new AppError('Payment amount mismatch', 400);
      }

      const vatAmount = leadPrice * 0.2; // 20% VAT
      const totalAmount = leadPrice + vatAmount;

      // Create payment record
      payment = await tx.payment.create({
        data: {
          contractorId: contractor.id,
          amount: leadPrice,
          type: 'LEAD_ACCESS',
          status: 'COMPLETED',
          stripePaymentId: stripePaymentIntentId,
          description: `Job access purchased for: ${job.title}`,
        },
      });

      // Create invoice
      invoice = await tx.invoice.create({
        data: {
          amount: leadPrice,
          vatAmount,
          totalAmount,
          description: `Job Lead Access - ${job.title}`,
          invoiceNumber: `INV-${Date.now()}-${contractor.id.slice(-6)}`,
          recipientName: job.customer?.user?.name || 'Unknown',
          recipientEmail: job.customer?.user?.email || 'unknown@trustbuild.uk',
        },
      });
    } else {
      throw new AppError('Invalid payment method', 400);
    }

    // Grant job access
    await tx.jobAccess.create({
      data: {
        contractorId: contractor.id,
        jobId,
        accessMethod: paymentMethod === 'CREDIT' ? 'CREDIT' : 'PAYMENT',
      },
    });

    return { payment, invoice };
  });

  res.status(200).json({
    status: 'success',
    message: 'Job access purchased successfully',
  });
});

// @desc    Create Stripe payment intent for job access
// @route   POST /api/payments/create-payment-intent
// @access  Private (Contractor only)
export const createPaymentIntent = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { jobId } = req.body;
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get job details with lead price
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      service: {
        select: {
          smallJobPrice: true,
          mediumJobPrice: true,
          largeJobPrice: true,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Calculate lead price
  let leadPrice = 0;
  if (job.service) {
    switch (job.jobSize) {
      case 'SMALL':
        leadPrice = job.service.smallJobPrice ? job.service.smallJobPrice.toNumber() : 0;
        break;
      case 'MEDIUM':
        leadPrice = job.service.mediumJobPrice ? job.service.mediumJobPrice.toNumber() : 0;
        break;
      case 'LARGE':
        leadPrice = job.service.largeJobPrice ? job.service.largeJobPrice.toNumber() : 0;
        break;
    }
  }

  // Use override price if set
  if (job.leadPrice && typeof job.leadPrice.toNumber === 'function' && job.leadPrice.toNumber() > 0) {
    leadPrice = job.leadPrice.toNumber();
  }

  if (leadPrice <= 0) {
    return next(new AppError('Invalid lead price', 400));
  }

  // Create payment intent
  try {
    console.log('🔄 Creating Stripe payment intent for amount:', leadPrice * 100, 'pence');
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: leadPrice * 100, // Convert to cents
      currency: 'gbp',
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        jobId,
        contractorId: contractor.id,
        leadPrice: leadPrice.toString(),
      },
    });

    console.log('✅ Payment intent created successfully:', paymentIntent.id);
    
    res.status(200).json({
      status: 'success',
      data: {
        clientSecret: paymentIntent.client_secret,
        amount: leadPrice,
      },
    });
  } catch (stripeError: any) {
    console.error('❌ Stripe API Error:', stripeError.message);
    console.error('Stripe Error Type:', stripeError.type);
    console.error('Full Stripe Error:', stripeError);
         return next(new AppError(`Stripe payment error: ${stripeError.message}`, 400));
   }
});

// @desc    Get contractor's payment history
// @route   GET /api/payments/history
// @access  Private (Contractor only)
export const getPaymentHistory = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get payment history
  const payments = await prisma.payment.findMany({
    where: { contractorId: contractor.id },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          location: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const total = await prisma.payment.count({
    where: { contractorId: contractor.id },
  });

  res.status(200).json({
    status: 'success',
    data: {
      payments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get contractor's credit transactions
// @route   GET /api/payments/credit-history
// @access  Private (Contractor only)
export const getCreditHistory = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true, creditsBalance: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get credit transactions
  const transactions = await prisma.creditTransaction.findMany({
    where: { contractorId: contractor.id },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const total = await prisma.creditTransaction.count({
    where: { contractorId: contractor.id },
  });

  res.status(200).json({
    status: 'success',
    data: {
      transactions,
      currentBalance: contractor.creditsBalance,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// Routes
router.use(protect); // All routes require authentication

router.get('/job-access/:jobId', checkJobAccess);
router.post('/purchase-job-access', purchaseJobAccess);
router.post('/create-payment-intent', createPaymentIntent);
router.get('/history', getPaymentHistory);
router.get('/credit-history', getCreditHistory);

export default router; 