import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';

const router = Router();

// Initialize Stripe lazily when needed
let stripe: Stripe | null = null;

function getStripeInstance(): Stripe {
  if (!stripe) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    
  if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    
    if (!stripeKey.startsWith('sk_test_') && !stripeKey.startsWith('sk_live_')) {
      throw new Error('Invalid Stripe API key format');
    }
    
    stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
    });
    
    console.log(`✅ Stripe initialized with ${stripeKey.startsWith('sk_live_') ? 'LIVE' : 'TEST'} key`);
  }
  
  return stripe;
}

// Use email service instead of direct transporter
import { createEmailService } from '../services/emailService';

// Send customer notification when contractor purchases their job
async function sendCustomerNotification(customerEmail: string, notificationData: {
  customerName: string;
  contractorName: string;
  jobTitle: string;
  jobId: string;
  purchaseAmount: number;
  purchaseDate: string;
  totalContractorsWithAccess: number;
  maxContractors: number;
}): Promise<boolean> {
  // Email notifications disabled - purchase notifications will be available in dashboard only
  console.log(`✅ Email sending disabled - Customer notification for job: ${notificationData.jobTitle}, customer: ${customerEmail}`);
    return true;
}

// Send invoice email function
async function sendInvoiceNotification(recipientEmail: string, invoiceData: {
  invoiceNumber: string;
  contractorName: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  description: string;
  dueDate: string;
  jobTitle: string;
  jobId: string;
  paymentMethod?: string;
}): Promise<boolean> {
  // Email notifications disabled - invoices are now only accessible in-app
  console.log(`✅ Email sending disabled - Invoice ${invoiceData.invoiceNumber} for recipient: ${recipientEmail}`);
    return true;
}

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

  // Get contractor profile with subscription
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    include: {
      subscription: true
    }
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get job details with lead price and current access count
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
      jobAccess: {
        select: {
          id: true,
          contractorId: true,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if contractor already has access
  const existingAccess = job.jobAccess.find(access => access.contractorId === contractor.id);
  
  if (existingAccess) {
    return next(new AppError('You already have access to this job', 400));
  }

  // Check if the maximum number of contractors has been reached
  if (job.jobAccess.length >= job.maxContractorsPerJob) {
    return next(new AppError(`Maximum number of contractors (${job.maxContractorsPerJob}) has already purchased this job`, 400));
  }

  // Check if contractor has an active subscription (gets free access to all jobs)
  const hasActiveSubscription = contractor.subscription && 
                              contractor.subscription.isActive && 
                              contractor.subscription.status === 'active';

  // If contractor has an active subscription, override payment method to "SUBSCRIPTION"
  if (hasActiveSubscription && paymentMethod !== 'SUBSCRIPTION') {
    console.log(`✅ Contractor ${contractor.id} has an active subscription. Granting free access.`);
    paymentMethod = 'SUBSCRIPTION';
  }

  // Calculate lead price based on job size (will be 0 for subscribers)
  let leadPrice = 0;
  if (!hasActiveSubscription && job.service) {
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

  // Use override price if set (but only for non-subscribers)
  if (!hasActiveSubscription && job.leadPrice && typeof job.leadPrice.toNumber === 'function' && job.leadPrice.toNumber() > 0) {
    leadPrice = job.leadPrice.toNumber();
  }

  const transactionResult = await prisma.$transaction(async (tx) => {
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
    } else if (paymentMethod === 'SUBSCRIPTION') {
      // Subscription-based access (free for subscribers)
      console.log(`✅ Granting free job access to subscriber - Contractor ID: ${contractor.id}, Job ID: ${job.id}`);
      
      // Create payment record (amount = 0)
      payment = await tx.payment.create({
        data: {
          contractorId: contractor.id,
          amount: 0,
          type: 'LEAD_ACCESS',
          status: 'COMPLETED',
          description: `Job access included with subscription for: ${job.title}`,
        },
      });

      // Create invoice (amount = 0)
      invoice = await tx.invoice.create({
        data: {
          amount: 0,
          vatAmount: 0,
          totalAmount: 0,
          description: `Job Lead Access (Subscription Benefit) - ${job.title}`,
          invoiceNumber: `INV-SUB-${Date.now()}-${contractor.id.slice(-6)}`,
          recipientName: job.customer?.user?.name || 'Unknown',
          recipientEmail: job.customer?.user?.email || 'unknown@trustbuild.uk',
        },
      });
    } else if (paymentMethod === 'STRIPE') {
      if (!stripePaymentIntentId) {
        throw new AppError('Stripe payment intent ID is required', 400);
      }

      // Verify payment with Stripe
      const stripe = getStripeInstance();
      const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
      
      if (paymentIntent.status !== 'succeeded') {
        throw new AppError('Payment not completed', 400);
      }

      if (paymentIntent.amount !== leadPrice * 100) { // Stripe uses cents
        throw new AppError('Payment amount mismatch', 400);
      }

      // Calculate VAT (already included in price)
      const basePrice = leadPrice / 1.2; // Price without VAT
      const vatAmount = leadPrice - basePrice; // VAT portion (20% of base price)

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
          amount: basePrice,  // Price without VAT
          vatAmount,          // VAT amount
          totalAmount: leadPrice, // Total price (VAT included)
          description: `Job Lead Access - ${job.title} (VAT included)`,
          invoiceNumber: `INV-${Date.now()}-${contractor.id.slice(-6)}`,
          recipientName: job.customer?.user?.name || 'Unknown',
          recipientEmail: job.customer?.user?.email || 'unknown@trustbuild.uk',
        },
      });
    } else {
      throw new AppError('Invalid payment method', 400);
    }

    // Grant job access - this will instantly give access to customer contact details
    await tx.jobAccess.create({
      data: {
        contractorId: contractor.id,
        jobId,
        accessMethod: paymentMethod === 'CREDIT' ? 'CREDIT' : 
                      paymentMethod === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : 'PAYMENT',
        paidAmount: paymentMethod === 'STRIPE' ? leadPrice : 0,
        creditUsed: paymentMethod === 'CREDIT',
      } as any, // Type cast to avoid TypeScript errors until migration is applied
    });

    return { payment, invoice };
  });

  // Email sending part removed - invoices and notifications are now accessible in-app only

  // Return response with customer contact details since access was granted
  res.status(200).json({
    status: 'success',
    message: 'Job access purchased successfully',
    data: {
      payment: transactionResult.payment,
      invoice: transactionResult.invoice,
      jobAccess: {
        jobId,
        contractorId: contractor.id,
        accessMethod: paymentMethod === 'CREDIT' ? 'CREDIT' : 'PAYMENT'
      },
      // Instantly provide customer contact details
      customerContact: {
        name: job.customer?.user?.name,
        email: job.customer?.user?.email,
        phone: job.customer?.phone,
      },
      contractorsWithAccess: job.jobAccess.length + 1, // Include the new purchase
      maxContractors: job.maxContractorsPerJob,
    }
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
    
    const stripe = getStripeInstance();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: leadPrice * 100, // Convert to cents
      currency: 'gbp',
      // Remove payment_method_types when using automatic_payment_methods
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never' // Prevent redirect payment methods for better UX
      },
      metadata: {
        jobId,
        contractorId: contractor.id,
        leadPrice: leadPrice.toString(),
        type: 'job_access_purchase'
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

// Test email endpoints (for development/testing) - currently disabled
router.post('/test-invoice-email', catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { email, paymentMethod = 'STRIPE' } = req.body;
  
  if (!email) {
    return next(new AppError('Email address is required', 400));
  }
  
  try {
    const testData = {
      invoiceNumber: 'TEST-INV-001',
      contractorName: 'Test Contractor',
      amount: 10.00,
      vatAmount: 2.00,
      totalAmount: 12.00,
      description: 'Test Invoice - Email System Check',
      dueDate: new Date().toLocaleDateString('en-GB'),
      jobTitle: 'Test Job - Email System Verification',
      jobId: 'test-job-id',
      paymentMethod: paymentMethod,
    };
    
    // Email notifications are disabled - email sending would normally occur here
    console.log(`✅ Email sending disabled - Test invoice notification to: ${email}`);
    const emailSent = true; // Always return true since emails are disabled
    
    res.status(200).json({
      status: 'success',
      message: 'Email notifications are disabled - would have sent test invoice email',
      emailSent,
    });
  } catch (error: any) {
    console.error('Test invoice email error:', error);
    return next(new AppError(`Test invoice email failed: ${error.message}`, 500));
  }
}));

router.post('/test-customer-notification', catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { email } = req.body;
  
  if (!email) {
    return next(new AppError('Email address is required', 400));
  }
  
  try {
    const testData = {
      customerName: 'Test Customer',
      contractorName: 'Test Contractor',
      jobTitle: 'Test Job - Kitchen Renovation',
      jobId: 'test-job-123',
      purchaseAmount: 12.00,
      purchaseDate: new Date().toLocaleDateString('en-GB'),
      totalContractorsWithAccess: 2,
      maxContractors: 5,
    };
    
    // Email notifications are disabled - email sending would normally occur here
    console.log(`✅ Email sending disabled - Test customer notification to: ${email}`);
    const emailSent = true; // Always return true since emails are disabled
    
    res.status(200).json({
      status: 'success',
      message: 'Email notifications are disabled - would have sent test customer notification',
      emailSent,
    });
  } catch (error: any) {
    console.error('Test customer notification error:', error);
    return next(new AppError(`Test customer notification failed: ${error.message}`, 500));
  }
}));

// Commission system functions

// Send commission invoice email
async function sendCommissionInvoice(recipientEmail: string, invoiceData: {
  invoiceNumber: string;
  contractorName: string;
  jobTitle: string;
  finalJobAmount: number;
  commissionAmount: number;
  vatAmount: number;
  totalAmount: number;
  dueDate: string;
}): Promise<boolean> {
  // Email notifications disabled - commission invoices are now only accessible in-app
  console.log(`✅ Email sending disabled - Commission invoice ${invoiceData.invoiceNumber} for recipient: ${recipientEmail}`);
    return true;
}

// @desc    Mark job as completed with final amount (for commissioned contractors)
// @route   POST /api/payments/complete-job
// @access  Private (Contractor only)
export const completeJob = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { jobId, finalAmount } = req.body;
  const userId = req.user!.id;

  if (!jobId || !finalAmount || finalAmount <= 0) {
    return next(new AppError('Job ID and final amount are required', 400));
  }

  // Get contractor profile with subscription
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    include: {
      subscription: true,
      user: true,
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get job details
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      customer: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if contractor won this job
  if (job.wonByContractorId !== contractor.id) {
    return next(new AppError('You are not assigned to this job', 403));
  }

  // Check if already completed
  if (job.status === 'COMPLETED' && job.commissionPaid) {
    return next(new AppError('Job is already completed and commission processed', 400));
  }

  const result = await prisma.$transaction(async (tx) => {
    // Update job with final amount and completion
    const updatedJob = await tx.job.update({
      where: { id: jobId },
      data: {
        finalAmount: finalAmount,
        status: 'COMPLETED',
        completionDate: new Date(),
      },
    });

    let commissionPayment = null;

    // Only create commission if contractor has active subscription
    if (contractor.subscription && contractor.subscription.isActive && contractor.subscription.status === 'active') {
      const commissionRate = 5.0; // 5%
      const commissionAmount = (finalAmount * commissionRate) / 100;
      const vatAmount = commissionAmount * 0.2; // 20% VAT
      const totalAmount = commissionAmount + vatAmount;
      const dueDate = new Date();
      dueDate.setHours(dueDate.getHours() + 48); // 48 hours from now

      // Create commission payment record
      commissionPayment = await tx.commissionPayment.create({
        data: {
          jobId: job.id,
          contractorId: contractor.id,
          customerId: job.customerId,
          finalJobAmount: finalAmount,
          commissionRate: commissionRate,
          commissionAmount: commissionAmount,
          vatAmount: vatAmount,
          totalAmount: totalAmount,
          dueDate: dueDate,
        },
      });

      // Create commission invoice
      const invoiceNumber = `COMM-${Date.now()}-${contractor.id.slice(-6)}`;
      await tx.commissionInvoice.create({
        data: {
          commissionPaymentId: commissionPayment.id,
          invoiceNumber: invoiceNumber,
          contractorName: contractor.user.name,
          contractorEmail: contractor.user.email,
          jobTitle: job.title,
          finalJobAmount: finalAmount,
          commissionAmount: commissionAmount,
          vatAmount: vatAmount,
          totalAmount: totalAmount,
          dueDate: dueDate,
        },
      });
    }

    return { updatedJob, commissionPayment };
  });

  // Email notifications disabled - commission invoices are now only accessible in-app
  if (result.commissionPayment) {
    console.log(`✅ Email sending disabled - Commission payment created for job: ${job.title}, contractor: ${contractor.user.email}`);
  }

  res.status(200).json({
    status: 'success',
    message: 'Job marked as completed successfully',
    data: {
      job: result.updatedJob,
      commissionPayment: result.commissionPayment,
      hasCommission: !!result.commissionPayment,
    },
  });
});

// @desc    Get contractor's commission payments
// @route   GET /api/payments/commissions
// @access  Private (Contractor only)
export const getCommissionPayments = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

  // Get commission payments
  const commissions = await prisma.commissionPayment.findMany({
    where: { contractorId: contractor.id },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          completionDate: true,
        },
      },
      invoice: true,
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const total = await prisma.commissionPayment.count({
    where: { contractorId: contractor.id },
  });

  res.status(200).json({
    status: 'success',
    data: {
      commissions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Pay commission
// @route   POST /api/payments/pay-commission
// @access  Private (Contractor only)
export const payCommission = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { commissionPaymentId, stripePaymentIntentId } = req.body;
  const userId = req.user!.id;

  if (!commissionPaymentId || !stripePaymentIntentId) {
    return next(new AppError('Commission payment ID and Stripe payment intent ID are required', 400));
  }

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get commission payment
  const commissionPayment = await prisma.commissionPayment.findFirst({
    where: {
      id: commissionPaymentId,
      contractorId: contractor.id,
      status: 'PENDING',
    },
    include: {
      job: true,
      invoice: true,
    },
  });

  if (!commissionPayment) {
    return next(new AppError('Commission payment not found or already paid', 404));
  }

  // Verify payment with Stripe
  const stripe = getStripeInstance();
  const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
  
  if (paymentIntent.status !== 'succeeded') {
    return next(new AppError('Payment not completed', 400));
  }

  if (paymentIntent.amount !== commissionPayment.totalAmount.toNumber() * 100) { // Stripe uses cents
    return next(new AppError('Payment amount mismatch', 400));
  }

  // Update commission payment as paid
  const updatedCommission = await prisma.commissionPayment.update({
    where: { id: commissionPaymentId },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      stripePaymentId: stripePaymentIntentId,
    },
  });

  // Update job as commission paid
  await prisma.job.update({
    where: { id: commissionPayment.jobId },
    data: { commissionPaid: true },
  });

  // Create payment record
  await prisma.payment.create({
    data: {
      contractorId: contractor.id,
      amount: commissionPayment.totalAmount,
      type: 'COMMISSION',
      status: 'COMPLETED',
      stripePaymentId: stripePaymentIntentId,
      description: `Commission payment for job: ${commissionPayment.job.title}`,
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Commission payment completed successfully',
    data: {
      commissionPayment: updatedCommission,
    },
  });
});

// @desc    Create Stripe payment intent for commission payment
// @route   POST /api/payments/create-commission-payment-intent
// @access  Private (Contractor only)
export const createCommissionPaymentIntent = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { commissionPaymentId } = req.body;
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get commission payment
  const commissionPayment = await prisma.commissionPayment.findFirst({
    where: {
      id: commissionPaymentId,
      contractorId: contractor.id,
      status: 'PENDING',
    },
    include: {
      job: true,
    },
  });

  if (!commissionPayment) {
    return next(new AppError('Commission payment not found or already paid', 404));
  }

  // Check if payment is overdue
  if (new Date() > commissionPayment.dueDate) {
    // Mark as overdue
    await prisma.commissionPayment.update({
      where: { id: commissionPaymentId },
      data: { status: 'OVERDUE' },
    });
    
    // Suspend contractor account
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: { status: 'SUSPENDED' },
    });

    return next(new AppError('Commission payment is overdue. Your account has been suspended. Please contact support.', 403));
  }

  // Create payment intent
  try {
    const stripe = getStripeInstance();
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: commissionPayment.totalAmount.toNumber() * 100, // Convert to cents
      currency: 'gbp',
      // Remove payment_method_types when using automatic_payment_methods
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      },
      metadata: {
        commissionPaymentId: commissionPayment.id,
        contractorId: contractor.id,
        jobId: commissionPayment.jobId,
        type: 'commission_payment'
      },
    });

    res.status(200).json({
      status: 'success',
      data: {
        clientSecret: paymentIntent.client_secret,
        amount: commissionPayment.totalAmount.toNumber(),
        dueDate: commissionPayment.dueDate,
        jobTitle: commissionPayment.job.title,
      },
    });
  } catch (stripeError: any) {
    console.error('❌ Stripe API Error:', stripeError.message);
    return next(new AppError(`Stripe payment error: ${stripeError.message}`, 400));
  }
});

// Add commission routes
router.post('/complete-job', completeJob);
router.get('/commissions', getCommissionPayments);
router.post('/pay-commission', payCommission);
router.post('/create-commission-payment-intent', createCommissionPaymentIntent);

export default router; 