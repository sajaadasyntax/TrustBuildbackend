import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest, restrictTo } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { getSubscriptionPricing } from '../services/commissionService';
import Stripe from 'stripe';

const router = Router();

// Initialize Stripe lazily when needed
let stripe: Stripe | null = null;

function getStripeInstance(): Stripe {
  if (!stripe) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    
    if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    
    stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
    });
  }
  
  return stripe;
}

// @desc    Get contractor dashboard summary
// @route   GET /api/contractor/dashboard
// @access  Private (Contractor only)
export const getDashboardSummary = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;

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

  // Get recent jobs won
  const recentJobs = await prisma.job.findMany({
    where: {
      wonByContractorId: contractor.id,
    },
    orderBy: {
      completionDate: 'desc',
    },
    take: 5,
    select: {
      id: true,
      title: true,
      status: true,
      completionDate: true,
      finalAmount: true,
      commissionPaid: true,
    },
  });

  // Get pending commission payments
  const pendingCommissions = await prisma.commissionPayment.findMany({
    where: {
      contractorId: contractor.id,
      status: 'PENDING',
    },
    include: {
      job: {
        select: {
          id: true,
          title: true,
        },
      },
      invoice: true,
    },
    orderBy: {
      dueDate: 'asc',
    },
  });

  // Get recent reviews
  const recentReviews = await prisma.review.findMany({
    where: {
      contractorId: contractor.id,
      isVerified: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 3,
    include: {
      job: {
        select: {
          id: true,
          title: true,
        },
      },
      customer: {
        include: {
          user: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  // Get unread notification count
  const unreadNotifications = await prisma.notification.count({
    where: {
      userId,
      isRead: false,
    },
  });

  // Get subscription details with pricing
  let subscriptionDetails = null;
  if (contractor.subscription) {
    const plan = contractor.subscription.plan;
    const pricing = getSubscriptionPricing(plan);
    
    // Format the next billing date
    const nextBillingDate = contractor.subscription.currentPeriodEnd;
    const formattedNextBillingDate = nextBillingDate.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    
    subscriptionDetails = {
      ...contractor.subscription,
      pricing,
      daysRemaining: Math.max(0, Math.floor((contractor.subscription.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
      nextBillingDate: formattedNextBillingDate,
      nextBillingTimestamp: nextBillingDate.getTime()
    };
  }

  // Get invoice count
  const invoiceCount = await prisma.invoice.count({
    where: {
      payments: {
      },
    },
  });

  // Get commission payment count
  const commissionCount = await prisma.commissionPayment.count({
    where: {
      contractorId: contractor.id,
    },
  });

  // Get job access count
  const jobAccessCount = await prisma.jobAccess.count({
    where: {
      contractorId: contractor.id,
    },
  });

  // Calculate statistics
  const statistics = {
    jobsCompleted: contractor.jobsCompleted,
    averageRating: contractor.averageRating,
    reviewCount: contractor.reviewCount,
    verifiedReviews: contractor.verifiedReviews,
    jobAccessCount,
    invoiceCount,
    commissionCount,
    creditsBalance: contractor.creditsBalance,
  };

  res.status(200).json({
    status: 'success',
    data: {
      contractor: {
        id: contractor.id,
        name: contractor.user.name,
        email: contractor.user.email,
        businessName: contractor.businessName,
        status: contractor.status,
        tier: contractor.tier,
        profileApproved: contractor.profileApproved,
      },
      subscription: subscriptionDetails,
      statistics,
      recentJobs,
      pendingCommissions,
      recentReviews,
      unreadNotifications,
    },
  });
});

// @desc    Get contractor subscription details
// @route   GET /api/contractor/subscription
// @access  Private (Contractor only)
export const getSubscriptionDetails = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;

  // Get contractor profile with subscription
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    include: {
      subscription: true,
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get subscription details with pricing
  let subscriptionDetails = null;
  if (contractor.subscription) {
    const plan = contractor.subscription.plan;
    const pricing = getSubscriptionPricing(plan);
    
    // Format the next billing date
    const nextBillingDate = contractor.subscription.currentPeriodEnd;
    const formattedNextBillingDate = nextBillingDate.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    
    // Get Stripe subscription if available
    let stripeSubscription = null;
    if (contractor.subscription.stripeSubscriptionId) {
      try {
        const stripe = getStripeInstance();
        stripeSubscription = await stripe.subscriptions.retrieve(
          contractor.subscription.stripeSubscriptionId
        );
      } catch (error) {
        console.error('Failed to retrieve Stripe subscription:', error);
      }
    }
    
    subscriptionDetails = {
      ...contractor.subscription,
      pricing,
      daysRemaining: Math.max(0, Math.floor((contractor.subscription.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
      nextBillingDate: formattedNextBillingDate,
      nextBillingTimestamp: nextBillingDate.getTime(),
      stripeDetails: stripeSubscription,
    };
  }

  // Get available plans and pricing
  const availablePlans = [
    {
      id: 'MONTHLY',
      name: 'Monthly',
      ...getSubscriptionPricing('MONTHLY'),
    },
    {
      id: 'SIX_MONTHS',
      name: '6-Month',
      ...getSubscriptionPricing('SIX_MONTHS'),
    },
    {
      id: 'YEARLY',
      name: 'Yearly',
      ...getSubscriptionPricing('YEARLY'),
    },
  ];

  res.status(200).json({
    status: 'success',
    data: {
      subscription: subscriptionDetails,
      availablePlans,
      hasActiveSubscription: !!subscriptionDetails && subscriptionDetails.isActive,
    },
  });
});

// @desc    Create subscription payment intent
// @route   POST /api/contractor/create-subscription-intent
// @access  Private (Contractor only)
export const createSubscriptionIntent = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { plan } = req.body;
  const userId = req.user!.id;

  if (!plan || !['MONTHLY', 'SIX_MONTHS', 'YEARLY'].includes(plan)) {
    return next(new AppError('Valid subscription plan is required', 400));
  }

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get pricing for selected plan
  const pricing = getSubscriptionPricing(plan);
  const amount = pricing.total;

  // Create payment intent
  try {
    const stripe = getStripeInstance();
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'gbp',
      payment_method_types: ['card'],
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      },
      metadata: {
        userId,
        plan,
        type: 'subscription_payment'
      },
    });

    res.status(200).json({
      status: 'success',
      data: {
        clientSecret: paymentIntent.client_secret,
        amount,
        plan,
        pricing,
      },
    });
  } catch (stripeError: any) {
    console.error('❌ Stripe API Error:', stripeError.message);
    return next(new AppError(`Stripe payment error: ${stripeError.message}`, 400));
  }
});

// @desc    Confirm subscription payment
// @route   POST /api/contractor/confirm-subscription
// @access  Private (Contractor only)
export const confirmSubscription = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { stripePaymentIntentId, plan } = req.body;
  const userId = req.user!.id;

  if (!stripePaymentIntentId || !plan) {
    return next(new AppError('Payment intent ID and plan are required', 400));
  }

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Verify payment with Stripe
  const stripe = getStripeInstance();
  const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
  
  if (paymentIntent.status !== 'succeeded') {
    return next(new AppError('Payment not completed', 400));
  }

  // Calculate subscription period
  const now = new Date();
  let endDate = new Date();
  
  switch (plan) {
    case 'MONTHLY':
      endDate.setMonth(endDate.getMonth() + 1);
      break;
    case 'SIX_MONTHS':
      endDate.setMonth(endDate.getMonth() + 6);
      break;
    case 'YEARLY':
      endDate.setFullYear(endDate.getFullYear() + 1);
      break;
    default:
      return next(new AppError('Invalid subscription plan', 400));
  }

  // Check if contractor already has a subscription
  console.log(`🔍 Checking for existing subscription for contractor: ${contractor.id}`);
  const existingSubscription = await prisma.subscription.findUnique({
    where: { contractorId: contractor.id },
  });
  console.log(`📊 Existing subscription: ${existingSubscription ? 'Found' : 'Not found'}`);

  let subscription;
  if (existingSubscription) {
    // Update existing subscription
    console.log(`🔄 Updating existing subscription ID: ${existingSubscription.id}`);
    try {
      subscription = await prisma.subscription.update({
        where: { id: existingSubscription.id },
        data: {
          plan,
          status: 'active',
          isActive: true,
          currentPeriodStart: now,
          currentPeriodEnd: endDate,
          monthlyPrice: getSubscriptionPricing(plan).monthly,
        },
      });
      console.log(`✅ Subscription updated successfully: ${subscription.id}`);
    } catch (err) {
      console.error(`❌ Error updating subscription: ${err instanceof Error ? err.message : 'Unknown error'}`);
      throw err;
    }
  } else {
    // Create new subscription
    console.log(`➕ Creating new subscription for contractor: ${contractor.id}`);
    try {
      subscription = await prisma.subscription.create({
        data: {
          contractor: {
            connect: { id: contractor.id }
          },
          tier: contractor.tier,
          plan,
          status: 'active',
          isActive: true,
          currentPeriodStart: now,
          currentPeriodEnd: endDate,
          monthlyPrice: getSubscriptionPricing(plan).monthly,
        },
      });
      console.log(`✅ New subscription created successfully: ${subscription.id}`);
    } catch (err) {
      console.error(`❌ Error creating subscription: ${err instanceof Error ? err.message : 'Unknown error'}`);
      throw err;
    }
  }

  // Create payment record
  console.log(`💰 Creating payment record for subscription`);
  try {
    const payment = await prisma.payment.create({
      data: {
        amount: getSubscriptionPricing(plan).total,
        type: 'SUBSCRIPTION',
        status: 'COMPLETED',
        stripePaymentId: stripePaymentIntentId,
        description: `${plan} subscription payment`,
      },
    });
    console.log(`✅ Payment record created: ${payment.id}`);
  } catch (err) {
    console.error(`❌ Error creating payment record: ${err instanceof Error ? err.message : 'Unknown error'}`);
    throw err;
  }

  res.status(200).json({
    status: 'success',
    message: 'Subscription confirmed successfully',
    data: {
      subscription,
    },
  });
});

// @desc    Cancel subscription
// @route   POST /api/contractor/cancel-subscription
// @access  Private (Contractor only)
export const cancelSubscription = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;

  // Get contractor profile with subscription
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    include: {
      subscription: true,
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  if (!contractor.subscription) {
    return next(new AppError('No active subscription found', 404));
  }

  // Cancel Stripe subscription if exists
  if (contractor.subscription.stripeSubscriptionId) {
    try {
      const stripe = getStripeInstance();
      await stripe.subscriptions.cancel(contractor.subscription.stripeSubscriptionId);
    } catch (error) {
      console.error('Failed to cancel Stripe subscription:', error);
      // Continue anyway to update our database
    }
  }

  // Update subscription status
  const updatedSubscription = await prisma.subscription.update({
    where: { id: contractor.subscription.id },
    data: {
      status: 'cancelled',
      isActive: false,
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Subscription cancelled successfully',
    data: {
      subscription: updatedSubscription,
    },
  });
});

// @desc    Get contractor invoices
// @route   GET /api/contractor/invoices
// @access  Private (Contractor only)
export const getInvoices = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

  // Get regular invoices
  const regularInvoices = await prisma.invoice.findMany({
    where: {
      payments: {
      },
    },
    include: {
      payments: {
        select: {
          id: true,
          status: true,
          type: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  // Get commission invoices
  const commissionInvoices = await prisma.commissionInvoice.findMany({
    where: {
      commissionPayment: {
      },
    },
    include: {
      commissionPayment: {
        select: {
          id: true,
          status: true,
          dueDate: true,
          paidAt: true,
          job: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  // Format invoices for consistent response
  const formattedRegularInvoices = regularInvoices.map(invoice => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    type: 'regular',
    description: invoice.description,
    amount: invoice.amount,
    vatAmount: invoice.vatAmount,
    totalAmount: invoice.totalAmount,
    status: 'PENDING',
    paymentType: 'UNKNOWN',
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  }));

  const formattedCommissionInvoices = commissionInvoices.map(invoice => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    type: 'commission',
    description: `Commission for ${invoice.jobTitle}`,
    amount: invoice.commissionAmount,
    vatAmount: invoice.vatAmount,
    totalAmount: invoice.totalAmount,
    status: invoice.commissionPayment?.status || 'PENDING',
    dueDate: invoice.commissionPayment?.dueDate,
    paidAt: invoice.commissionPayment?.paidAt,
    job: invoice.commissionPayment?.job,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  }));

  // Combine and sort all invoices by date
  const allInvoices = [...formattedRegularInvoices, ...formattedCommissionInvoices];
  allInvoices.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Count totals for pagination
  const totalRegularInvoices = await prisma.invoice.count({
    where: {
      payments: {
      },
    },
  });
  
  const totalCommissionInvoices = await prisma.commissionInvoice.count({
    where: {
      commissionPayment: {
      },
    },
  });
  
  const total = totalRegularInvoices + totalCommissionInvoices;

  res.status(200).json({
    status: 'success',
    data: {
      invoices: allInvoices,
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
router.use(protect);
router.use(restrictTo('CONTRACTOR'));

router.get('/dashboard', getDashboardSummary);
router.get('/subscription', getSubscriptionDetails);
router.post('/create-subscription-intent', createSubscriptionIntent);
router.post('/confirm-subscription', confirmSubscription);
router.post('/cancel-subscription', cancelSubscription);
router.get('/invoices', getInvoices);

export default router;
