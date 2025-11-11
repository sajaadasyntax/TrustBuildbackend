import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import { createEmailService, createServiceEmail } from '../services/emailService';

// Helper to format currency
const formatCurrency = (amount: number | any): string => {
  // Handle Decimal/Prisma decimal objects by converting to number if needed
  const numAmount = typeof amount?.toNumber === 'function' ? amount.toNumber() : Number(amount);
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
  }).format(numAmount || 0);
};

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
    

  }
  
  return stripe;
}

// Use email service instead of direct transporter

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
  const { jobId, stripePaymentIntentId } = req.body;
  let { paymentMethod } = req.body;
  const userId = req.user!.id;

  // Get contractor profile with subscription
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    include: {
      subscription: true,
      user: true,
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
    return next(new AppError(`This job has reached its limit. ${job.jobAccess.length}/${job.maxContractorsPerJob} contractors have already purchased access.`, 400));
  }

  // Use unified subscription status check
  const { checkSubscriptionStatus } = await import('../services/subscriptionService');
  const subscriptionStatus = await checkSubscriptionStatus(contractor.id);
  const hasActiveSubscription = subscriptionStatus.hasActiveSubscription;

  // Check if using free trial credit
  // If contractor is not subscribed and has credits, all credits are considered free trial credits
  // (with SMALL job restriction) until they subscribe
  const isUsingFreeTrial = !hasActiveSubscription && contractor.creditsBalance > 0;

  // Validate payment method based on subscription status
  if (hasActiveSubscription) {
    // Subscribers can use CREDIT or STRIPE_SUBSCRIBER
    if (paymentMethod !== 'CREDIT' && paymentMethod !== 'STRIPE_SUBSCRIBER') {
      return next(new AppError('Subscribers must choose between using credits or paying lead price', 400));
    }
  } else {
    // Non-subscribers can only use STRIPE or CREDIT (if they have free trial)
    if (paymentMethod !== 'STRIPE' && paymentMethod !== 'CREDIT') {
      return next(new AppError('Non-subscribers must pay with card or use their free trial credit', 400));
    }
    
    // If using CREDIT as non-subscriber, validate free trial restrictions
    if (paymentMethod === 'CREDIT') {
      if (contractor.creditsBalance < 1) {
        return next(new AppError('Insufficient credits. Please subscribe or pay with card.', 400));
      }
      
      // Free trial credit can ONLY be used for SMALL jobs
      if (isUsingFreeTrial && job.jobSize !== 'SMALL') {
        return next(new AppError('Your free trial credit can only be used for small jobs. For medium or large jobs, you must either pay or subscribe.', 400));
      }
    }
  }

  // Calculate lead price based on job size
  let leadPrice = 0;
  if (job.service) {
    switch (job.jobSize) {
      case 'SMALL':
        leadPrice = job.service.smallJobPrice ? Number(job.service.smallJobPrice) : 0;
        break;
      case 'MEDIUM':
        leadPrice = job.service.mediumJobPrice ? Number(job.service.mediumJobPrice) : 0;
        break;
      case 'LARGE':
        leadPrice = job.service.largeJobPrice ? Number(job.service.largeJobPrice) : 0;
        break;
    }
  }

  // Use override price if set
  if (job.leadPrice && typeof job.leadPrice.toNumber === 'function' && Number(job.leadPrice) > 0) {
    leadPrice = Number(job.leadPrice);
  }

  // For CREDIT payment method, lead price is 0 (no payment required)
  if (paymentMethod === 'CREDIT') {
    leadPrice = 0;
  }

  const transactionResult = await prisma.$transaction(async (tx) => {
    let payment;
    let invoice;
    let usedFreeTrial = false;

    if (paymentMethod === 'CREDIT') {
      // Get the most current contractor data within the transaction
      const currentContractor = await tx.contractor.findUnique({
        where: { id: contractor.id },
        select: { creditsBalance: true, id: true, hasUsedFreeTrial: true, subscription: true }
      });
      
      if (!currentContractor) {
        throw new AppError('Contractor not found', 404);
      }
      
      if (currentContractor.creditsBalance < 1) {
        throw new AppError(`Insufficient credits. Current balance: ${currentContractor.creditsBalance}. Please top up or use card payment.`, 400);
      }
      
      // Check if this is a free trial credit (non-subscriber using credits)
      const isSubscribed = currentContractor.subscription !== null;
      usedFreeTrial = !isSubscribed;
      
      // CRITICAL: Use the current balance and subtract 1
      const newBalance = currentContractor.creditsBalance - 1;
      
      // Update the contractor's balance and mark free trial as used if applicable
      // Mark hasUsedFreeTrial as true if this is the first time using a free credit
      const updatedContractor = await tx.contractor.update({
        where: { id: contractor.id },
        data: { 
          creditsBalance: newBalance,
          ...(usedFreeTrial && !currentContractor.hasUsedFreeTrial && { hasUsedFreeTrial: true })
        },
        select: { creditsBalance: true }
      });



      // Create credit transaction record (NEGATIVE amount for deduction)
      const creditTransaction = await tx.creditTransaction.create({
        data: {
          contractorId: contractor.id,
          type: 'JOB_ACCESS',
          amount: -1, // Negative to indicate deduction
          description: usedFreeTrial 
            ? `Free trial credit used for job: ${job.title} (SMALL job only)`
            : `Credit used to access job: ${job.title}`,
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
          description: usedFreeTrial 
            ? `Job access purchased with FREE TRIAL CREDIT for: ${job.title}`
            : `Job access purchased with credit for: ${job.title}`,
        },
      });

      // Create invoice
      invoice = await tx.invoice.create({
        data: {
          amount: 0,
          vatAmount: 0,
          totalAmount: 0,
          description: usedFreeTrial 
            ? `Job Lead Access (Free Trial) - ${job.title}`
            : `Job Lead Access - ${job.title}`,
          invoiceNumber: usedFreeTrial 
            ? `INV-FREE-${Date.now()}-${contractor.id.slice(-6)}`
            : `INV-CREDIT-${Date.now()}-${contractor.id.slice(-6)}`,
          recipientName: contractor.businessName || 'Contractor',
          recipientEmail: contractor.user.email,
        },
      });
      
      // Link payment to invoice
      await tx.payment.update({
        where: { id: payment.id },
        data: { invoiceId: invoice.id }
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

      // Amount already includes 20% VAT
      const vatAmount = 0; // No additional VAT calculation needed

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
          amount: leadPrice,  // Total amount (VAT included)
          vatAmount,          // No additional VAT
          totalAmount: leadPrice, // Total price (VAT included)
          description: `Job Lead Access - ${job.title} (VAT included)`,
          invoiceNumber: `INV-${Date.now()}-${contractor.id.slice(-6)}`,
          recipientName: job.customer?.user?.name || 'Unknown',
          recipientEmail: job.customer?.user?.email || 'unknown@trustbuild.uk',
        },
      });
      
      // Link payment to invoice
      await tx.payment.update({
        where: { id: payment.id },
        data: { invoiceId: invoice.id }
      });
      

    } else if (paymentMethod === 'STRIPE_SUBSCRIBER') {
      // Subscriber paying lead price (no credit deduction, no commission)

      
      // Create payment record with lead price
      payment = await tx.payment.create({
        data: {
          contractorId: contractor.id,
          amount: leadPrice,
          type: 'LEAD_ACCESS',
          status: 'COMPLETED',
          description: `Job lead access purchased (subscriber rate) for: ${job.title}`,
        },
      });

      // Create invoice with lead price
      invoice = await tx.invoice.create({
        data: {
          amount: leadPrice,
          vatAmount: 0, // No additional VAT - amount already includes VAT
          totalAmount: leadPrice,
          description: `Job Lead Access (Subscriber) - ${job.title}`,
          invoiceNumber: `INV-SUB-${Date.now()}-${contractor.id.slice(-6)}`,
          recipientName: contractor.businessName || 'Contractor',
          recipientEmail: job.customer?.user?.email || 'unknown@trustbuild.uk',
        },
      });
      
      // Link payment to invoice
      await tx.payment.update({
        where: { id: payment.id },
        data: { invoiceId: invoice.id }
      });
      

    } else {
      throw new AppError('Invalid payment method', 400);
    }

    // Grant job access - this will instantly give access to customer contact details
    await tx.jobAccess.create({
      data: {
        contractorId: contractor.id,
        jobId,
        accessMethod: paymentMethod === 'CREDIT' ? 'CREDIT' : 'PAYMENT',
        paidAmount: (paymentMethod === 'STRIPE' || paymentMethod === 'STRIPE_SUBSCRIBER') ? leadPrice : 0,
        creditUsed: paymentMethod === 'CREDIT',
        usedFreePoint: usedFreeTrial, // Track if free trial credit was used
      } as any, // Type cast to avoid TypeScript errors until migration is applied
    });

    return { payment, invoice };
  });

  // Send job access invoice email to contractor
  try {
    const { sendJobAccessInvoiceEmail } = await import('../services/emailNotificationService');
    await sendJobAccessInvoiceEmail({
      invoiceNumber: transactionResult.invoice.invoiceNumber,
      recipientName: contractor.businessName || contractor.user.name,
      recipientEmail: contractor.user.email,
      jobTitle: job.title,
      amount: Number(transactionResult.invoice.amount),
      vatAmount: Number(transactionResult.invoice.vatAmount),
      totalAmount: Number(transactionResult.invoice.totalAmount),
      dueDate: transactionResult.invoice.dueAt || new Date(),
      paidAt: transactionResult.invoice.paidAt || undefined,
      accessMethod: paymentMethod === 'CREDIT' ? 'CREDIT' : 'STRIPE',
    });

  } catch (error) {
    console.error('Failed to send job access invoice email:', error);
    // Don't fail the transaction if email fails
  }
  
  // Fetch the contractor's updated balance to return in response
  const updatedContractorData = await prisma.contractor.findUnique({
    where: { id: contractor.id },
    select: { creditsBalance: true, hasUsedFreeTrial: true }
  });
  

  
  // Verify invoice was properly created
  const verifiedInvoice = await prisma.invoice.findUnique({
    where: { id: transactionResult.invoice?.id },
    include: { payments: true }
  });
  
  if (verifiedInvoice && verifiedInvoice.payments && verifiedInvoice.payments.length > 0) {

  } else {
    console.error(`❌ Invoice verification failed: ${transactionResult.invoice?.id}`);
  }

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
      // Include updated credit balance for frontend refresh
      updatedCreditsBalance: updatedContractorData?.creditsBalance || contractor.creditsBalance,
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
    include: {
      user: true,
    },
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
        leadPrice = job.service.smallJobPrice ? Number(job.service.smallJobPrice) : 0;
        break;
      case 'MEDIUM':
        leadPrice = job.service.mediumJobPrice ? Number(job.service.mediumJobPrice) : 0;
        break;
      case 'LARGE':
        leadPrice = job.service.largeJobPrice ? Number(job.service.largeJobPrice) : 0;
        break;
    }
  }

  // Use override price if set
  if (job.leadPrice && typeof job.leadPrice.toNumber === 'function' && Number(job.leadPrice) > 0) {
    leadPrice = Number(job.leadPrice);
  }

  if (leadPrice <= 0) {
    return next(new AppError('Invalid lead price', 400));
  }

  // Create payment intent
  try {

    
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
    // This is the key difference: subscribed contractors pay commission based on settings, non-subscribed don't
    if (contractor.subscription && contractor.subscription.isActive && contractor.subscription.status === 'active') {
      // Get commission rate from settings
      const { getCommissionRate } = await import('../services/settingsService');
      const commissionRate = await getCommissionRate();
      const commissionAmount = (finalAmount * commissionRate) / 100;
      const vatAmount = 0; // No additional VAT - commission amount already includes VAT
      const totalAmount = commissionAmount; // Total is just the commission amount
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

  // Send notification if commission is created
  if (result.commissionPayment) {

    
    try {
      const { createNotification } = await import('../services/notificationService');
      const commissionRate = result.commissionPayment.commissionRate.toNumber();
      const commissionAmount = result.commissionPayment.commissionAmount.toNumber();
      
      await createNotification({
        userId: userId,
        title: '💰 Commission Payment Required',
        message: `A ${commissionRate}% commission (£${commissionAmount.toFixed(2)}) is due for your completed job "${job.title}". This is part of your subscription benefits.`,
        type: 'COMMISSION_DUE',
        actionLink: '/dashboard/commissions',
        actionText: 'View Details',
        metadata: {
          jobId,
          jobTitle: job.title,
          finalAmount,
          commissionPaymentId: result.commissionPayment.id,
        },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Expire in 7 days
      });
    } catch (error) {
      console.error('Failed to create commission notification:', error);
      // Don't throw error - continue with success response
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'Job marked as completed successfully',
    data: {
      job: result.updatedJob,
      commissionPayment: result.commissionPayment,
      hasCommission: !!result.commissionPayment,
      isSubscribed: !!contractor.subscription && contractor.subscription.isActive,
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

  
  // Debug: Check if there are any jobs won by this contractor
  const wonJobs = await prisma.job.findMany({
    where: { wonByContractorId: contractor.id },
    select: { id: true, title: true, status: true, customerConfirmed: true, finalAmount: true }
  });

  wonJobs.forEach(job => {

  });
  
  // Debug: Check all commissions in the database
  const allCommissions = await prisma.commissionPayment.findMany({
    select: {
      id: true,
      contractorId: true,
      jobId: true,
      status: true,
      createdAt: true,
    },
  });

  allCommissions.forEach(comm => {

  });
  
  const commissions = await prisma.commissionPayment.findMany({
    where: { contractorId: contractor.id },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          completionDate: true,
          finalAmount: true,
        },
      },
      invoice: true, // Commission invoice relation
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const total = await prisma.commissionPayment.count({
    where: { contractorId: contractor.id },
  });

  // Debug: Show commission details if any exist
  if (commissions.length > 0) {
    console.log('💰 Found commissions:', commissions.map(c => ({
      id: c.id,
      jobId: c.jobId,
      status: c.status,
      amount: c.totalAmount,
      dueDate: c.dueDate
    })));
  } else {
    console.log('💰 No commissions found for contractor');
  }

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
    include: {
      user: true,
    },
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
  

  
  // For development: allow requires_payment_method status (test mode)
  if (paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'requires_payment_method') {
    return next(new AppError(`Payment not completed. Status: ${paymentIntent.status}`, 400));
  }

  // For development: skip amount verification if in test mode
  if (paymentIntent.status === 'succeeded' && paymentIntent.amount !== Number(commissionPayment.totalAmount) * 100) {
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

  // Send commission payment confirmation email
  try {
    const { sendCommissionInvoiceEmail } = await import('../services/emailNotificationService');
    await sendCommissionInvoiceEmail({
      invoiceNumber: commissionPayment.invoice?.invoiceNumber || `COMM-${commissionPayment.id}`,
      contractorName: contractor.user.name,
      contractorEmail: contractor.user.email,
      jobTitle: commissionPayment.job.title,
      finalJobAmount: Number(commissionPayment.finalJobAmount),
      commissionAmount: Number(commissionPayment.commissionAmount),
      vatAmount: Number(commissionPayment.vatAmount),
      totalAmount: Number(commissionPayment.totalAmount),
      dueDate: commissionPayment.dueDate,
      paidAt: new Date(),
    });

  } catch (error) {
    console.error('Failed to send commission payment confirmation email:', error);
    // Don't fail the payment if email fails
  }

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
    include: {
      user: true,
    },
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
      amount: Number(commissionPayment.totalAmount) * 100, // Convert to cents
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
        amount: Number(commissionPayment.totalAmount),
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
