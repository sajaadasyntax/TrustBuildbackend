import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest, restrictTo } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { getSubscriptionPricing } from '../services/subscriptionService';
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
    const pricing = await getSubscriptionPricing(plan);
    
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

  // Calculate statistics using live DB queries instead of stale aggregate columns
  const [liveCompletedJobs, livePublishedReviewAgg, livePublishedReviewCount, liveVerifiedReviewCount] = await Promise.all([
    prisma.job.count({
      where: {
        status: 'COMPLETED',
        OR: [
          { wonByContractorId: contractor.id },
          { jobAccess: { some: { contractorId: contractor.id } } },
        ],
      },
    }),
    prisma.review.aggregate({
      where: { contractorId: contractor.id, flagReason: null },
      _avg: { rating: true },
    }),
    prisma.review.count({
      where: { contractorId: contractor.id, flagReason: null },
    }),
    prisma.review.count({
      where: { contractorId: contractor.id, isVerified: true, flagReason: null },
    }),
  ]);

  const statistics = {
    jobsCompleted: liveCompletedJobs,
    averageRating: livePublishedReviewAgg._avg.rating ?? 0,
    reviewCount: livePublishedReviewCount,
    verifiedReviews: liveVerifiedReviewCount,
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
    const pricing = await getSubscriptionPricing(plan);
    
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
  const monthlyPricing = await getSubscriptionPricing('MONTHLY');
  const sixMonthPricing = await getSubscriptionPricing('SIX_MONTHS');
  const yearlyPricing = await getSubscriptionPricing('YEARLY');
  
  const availablePlans = [
    {
      id: 'MONTHLY',
      name: 'Monthly',
      ...monthlyPricing,
    },
    {
      id: 'SIX_MONTHS',
      name: '6-Month',
      ...sixMonthPricing,
    },
    {
      id: 'YEARLY',
      name: 'Yearly',
      ...yearlyPricing,
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
  const pricing = await getSubscriptionPricing(plan);
  const amount = pricing.total;

  // Create payment intent
  try {
    const stripe = getStripeInstance();
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'gbp',
      // Enable automatic payment methods (supports Apple Pay, Google Pay, cards, etc.)
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

// Note: Subscription confirmation is now handled by /api/subscriptions/confirm
// This route has been removed to ensure unified subscription management

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

  // Update subscription status and remove weekly credits (non-subscribed contractors don't get weekly credits)
  await prisma.contractor.update({
    where: { id: contractor.id },
    data: {
      weeklyCreditsLimit: 0, // Remove weekly credits when subscription is cancelled
    },
  });

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

  // Get regular invoices (invoices linked to payments for this contractor)
  const regularInvoices = await prisma.invoice.findMany({
    where: {
      payments: {
        some: {
          contractorId: contractor.id,
        },
      },
    },
    include: {
      payments: {
        where: {
          contractorId: contractor.id,
        },
        select: {
          id: true,
          status: true,
          type: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Get commission invoices (linked to commission payments for this contractor)
  const commissionInvoices = await prisma.commissionInvoice.findMany({
    where: {
      commissionPayment: {
        contractorId: contractor.id,
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
  });

  // Get manual invoices created by admin for this contractor
  // Show all statuses except CANCELED (contractors should see DRAFT, ISSUED, OVERDUE, and PAID)
  const manualInvoices = await prisma.manualInvoice.findMany({
    where: {
      contractorId: contractor.id,
      status: { not: 'CANCELED' }, // Show all invoices except canceled ones
    },
    include: {
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Format invoices for consistent response
  const formattedRegularInvoices = regularInvoices.map((invoice: any) => ({
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

  const formattedCommissionInvoices = commissionInvoices.map((invoice: any) => ({
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

  // Format manual invoices (amounts are in pence, convert to pounds)
  const formattedManualInvoices = manualInvoices.map((invoice: any) => ({
    id: invoice.id,
    invoiceNumber: invoice.number,
    type: 'manual',
    description: invoice.reason || invoice.notes || 'Admin Invoice',
    amount: (invoice.subtotal || 0) / 100,
    vatAmount: (invoice.tax || 0) / 100,
    totalAmount: (invoice.total || 0) / 100,
    status: invoice.status,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt,
    issuedAt: invoice.issuedAt,
    items: invoice.items?.map((item: any) => ({
      description: item.description,
      amount: item.amount / 100,
      quantity: item.quantity,
    })),
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    // Add flag to indicate if manual invoice is payable by contractor
    // DRAFT invoices can also be paid (they're just not issued yet, but contractor can still pay)
    isPayable: invoice.status === 'DRAFT' || invoice.status === 'ISSUED' || invoice.status === 'OVERDUE',
  }));

  // Combine and sort all invoices by date
  const allInvoices = [...formattedRegularInvoices, ...formattedCommissionInvoices, ...formattedManualInvoices];
  allInvoices.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Count totals for pagination (using the same filters as queries)
  const totalRegularInvoices = await prisma.invoice.count({
    where: {
      payments: {
        some: {
          contractorId: contractor.id,
        },
      },
    },
  });
  
  const totalCommissionInvoices = await prisma.commissionInvoice.count({
    where: {
      commissionPayment: {
        contractorId: contractor.id,
      },
    },
  });

  const totalManualInvoices = await prisma.manualInvoice.count({
    where: {
      contractorId: contractor.id,
      status: { not: 'CANCELED' }, // Count all invoices except canceled ones
    },
  });
  
  const total = totalRegularInvoices + totalCommissionInvoices + totalManualInvoices;

  // Apply pagination after combining and sorting
  const paginatedInvoices = allInvoices.slice(skip, skip + limit);

  res.status(200).json({
    status: 'success',
    data: {
      invoices: paginatedInvoices,
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
// Note: confirm-subscription route removed - use /api/subscriptions/confirm instead
router.post('/cancel-subscription', cancelSubscription);
router.get('/invoices', getInvoices);

export default router;
