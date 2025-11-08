import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protectAdmin, AdminAuthRequest } from '../middleware/adminAuth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import Stripe from 'stripe';
import { getSubscriptionPricing } from './subscriptions.js';

const router = Router();

// Initialize Stripe
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

// @desc    Get all subscriptions with filtering
// @route   GET /api/admin/subscriptions
// @access  Private (Admin only)
export const getAllSubscriptions = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  
  const status = req.query.status as string;
  const plan = req.query.plan as string;
  const search = req.query.search as string;

  // Build filter conditions
  const where: any = {};

  // Filter by status
  if (status && status !== 'all') {
    if (status === 'active') {
      where.isActive = true;
      where.status = 'active';
    } else if (status === 'cancelled') {
      where.status = 'cancelled';
    } else if (status === 'expired') {
      where.isActive = false;
      where.status = { not: 'cancelled' };
    }
  }

  // Filter by plan
  if (plan && plan !== 'all') {
    where.plan = plan;
  }

  // Get contractors for search
  let contractorIds: string[] = [];
  if (search) {
    const contractors = await prisma.contractor.findMany({
      where: {
        OR: [
          { businessName: { contains: search, mode: 'insensitive' } },
          { user: { name: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
        ],
      },
      select: { id: true },
    });
    
    contractorIds = contractors.map(c => c.id);
    
    if (contractorIds.length === 0) {
      // Return empty result if no contractors match the search
      return res.status(200).json({
        status: 'success',
        data: {
          subscriptions: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0,
          }
        }
      });
    }
    
    where.contractorId = { in: contractorIds };
  }

  // Query subscriptions with pagination
  const [subscriptions, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      include: {
        contractor: {
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
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.subscription.count({ where }),
  ]);

  return res.status(200).json({
    status: 'success',
    data: {
      subscriptions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      }
    }
  });
});

// @desc    Get subscription statistics
// @route   GET /api/admin/subscriptions/stats
// @access  Private (Admin only)
export const getSubscriptionStats = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const [
    activeSubscriptions,
    pendingSubscriptions,
    trialSubscriptions,
    cancelledSubscriptions,
    subscriptionRevenue,
    monthlyRevenue,
    subscriptionsByPlan,
    recentSubscriptions,
  ] = await Promise.all([
    // Active subscriptions
    prisma.subscription.count({
      where: { 
        isActive: true,
        status: 'active',
      },
    }),
    
    // Pending subscriptions
    prisma.subscription.count({
      where: { 
        status: 'pending',
      },
    }),
    
    // Trial subscriptions
    prisma.subscription.count({
      where: { 
        status: 'trialing',
      },
    }),
    
    // Cancelled subscriptions
    prisma.subscription.count({
      where: { 
        status: 'cancelled',
      },
    }),
    
    // Total subscription revenue
    prisma.payment.aggregate({
      where: { 
        type: 'SUBSCRIPTION',
        status: 'COMPLETED',
      },
      _sum: {
        amount: true,
      },
    }),
    
    // Monthly subscription revenue
    prisma.subscription.aggregate({
      where: { 
        isActive: true,
        status: 'active',
      },
      _sum: {
        monthlyPrice: true,
      },
    }),
    
    // Subscriptions by plan
    prisma.subscription.groupBy({
      by: ['plan'],
      where: {
        isActive: true,
      },
      _count: true,
      _sum: {
        monthlyPrice: true,
      },
    }),
    
    // Recent subscriptions
    prisma.subscription.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        contractor: {
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
    }),
  ]);
  
  // Calculate total active subscriptions
  const totalActiveSubscriptions = activeSubscriptions + pendingSubscriptions + trialSubscriptions;
  
  // Calculate average subscription value
  const averageSubscriptionValue = totalActiveSubscriptions > 0 
    ? Number(monthlyRevenue._sum.monthlyPrice || 0) / totalActiveSubscriptions 
    : 0;
  
  // Format subscription by plan
  const subscriptionByPlan = subscriptionsByPlan.map(item => ({
    plan: item.plan,
    count: item._count,
    revenue: Number(item._sum.monthlyPrice || 0),
  }));
  
  // Ensure we handle null values properly in statistics
  const stats = {
    activeSubscriptions: activeSubscriptions || 0,
    pendingSubscriptions: pendingSubscriptions || 0,
    trialSubscriptions: trialSubscriptions || 0,
    cancelledSubscriptions: cancelledSubscriptions || 0,
    totalRevenue: Number(subscriptionRevenue._sum?.amount || 0),
    monthlyRevenue: Number(monthlyRevenue._sum?.monthlyPrice || 0),
    averageSubscriptionValue: averageSubscriptionValue || 0,
    subscriptionByPlan: subscriptionByPlan || [],
    recentSubscriptions: recentSubscriptions || [],
  };
  
  // Log subscription stats for debugging
  console.log('📊 Subscription stats:', {
    activeCount: stats.activeSubscriptions,
    pendingCount: stats.pendingSubscriptions,
    cancelledCount: stats.cancelledSubscriptions,
    totalRevenue: stats.totalRevenue,
    monthlyRevenue: stats.monthlyRevenue,
  });

  res.status(200).json({
    status: 'success',
    data: stats,
  });
});

// @desc    Cancel contractor subscription (admin override)
// @route   POST /api/admin/subscriptions/:contractorId/cancel
// @access  Private (Admin only)
export const cancelContractorSubscription = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { contractorId } = req.params;

  // Get contractor with subscription
  const contractor = await prisma.contractor.findUnique({
    where: { id: contractorId },
    include: {
      subscription: true,
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  if (!contractor.subscription) {
    return next(new AppError('Contractor has no active subscription', 404));
  }

  // Cancel Stripe subscription if exists
  if (contractor.subscription.stripeSubscriptionId) {
    try {
      const stripe = getStripeInstance();
      // Cancel at period end to avoid prorating issues
      await stripe.subscriptions.update(contractor.subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
        cancellation_details: {
          comment: `Cancelled by admin: ${req.admin!.id}`,
        }
      });

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

  // Log admin action
  await prisma.adminAction.create({
    data: {
      action: 'CANCEL_SUBSCRIPTION',
      description: `Admin cancelled subscription for contractor ID: ${contractorId}`,
      performedBy: req.admin!.id,
      metadata: {
        contractorId,
        subscriptionId: updatedSubscription.id,
        adminId: req.admin!.id,
      },
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

// @desc    Reactivate contractor subscription (admin override)
// @route   POST /api/admin/subscriptions/:contractorId/reactivate
// @access  Private (Admin only)
export const reactivateContractorSubscription = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { contractorId } = req.params;

  // Get contractor with subscription
  const contractor = await prisma.contractor.findUnique({
    where: { id: contractorId },
    include: {
      subscription: true,
      user: true,
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  if (!contractor.subscription) {
    return next(new AppError('Contractor has no subscription to reactivate', 404));
  }

  // Calculate subscription period
  const now = new Date();
  let endDate = new Date();
  
  switch (contractor.subscription.plan) {
    case 'MONTHLY':
      endDate.setMonth(endDate.getMonth() + 1);
      break;
    case 'SIX_MONTHS':
      endDate.setMonth(endDate.getMonth() + 6);
      break;
    case 'YEARLY':
      endDate.setFullYear(endDate.getFullYear() + 1);
      break;
  }

  // Update subscription status
  let updatedSubscription;
  
  // If there's a Stripe subscription ID and it was just cancelled, attempt to reactivate
  if (contractor.subscription.stripeSubscriptionId && contractor.subscription.status === 'cancelled') {
    try {
      const stripe = getStripeInstance();
      
      // Retrieve the current subscription from Stripe
      const stripeSubscription = await stripe.subscriptions.retrieve(
        contractor.subscription.stripeSubscriptionId
      );
      
      if (stripeSubscription.cancel_at_period_end) {
        // Remove the cancel_at_period_end flag to reactivate the subscription
        await stripe.subscriptions.update(contractor.subscription.stripeSubscriptionId, {
          cancel_at_period_end: false,
        });
        

        
        // Update our database record with Stripe's data
        updatedSubscription = await prisma.subscription.update({
          where: { id: contractor.subscription.id },
          data: {
            status: 'active',
            isActive: true,
          },
        });
      } else {
        // If subscription is fully cancelled, create a new one
        updatedSubscription = await prisma.subscription.update({
          where: { id: contractor.subscription.id },
          data: {
            status: 'active',
            isActive: true,
            currentPeriodStart: now,
            currentPeriodEnd: endDate,
          },
        });
      }
    } catch (error) {
      console.error('Failed to reactivate Stripe subscription:', error);
      // Fall back to just updating our database
      updatedSubscription = await prisma.subscription.update({
        where: { id: contractor.subscription.id },
        data: {
          status: 'active',
          isActive: true,
          currentPeriodStart: now,
          currentPeriodEnd: endDate,
        },
      });
    }
  } else {
    // No Stripe integration or other status - just update our database
    updatedSubscription = await prisma.subscription.update({
      where: { id: contractor.subscription.id },
      data: {
        status: 'active',
        isActive: true,
        currentPeriodStart: now,
        currentPeriodEnd: endDate,
      },
    });
  }

  // Log admin action
  await prisma.adminAction.create({
    data: {
      action: 'REACTIVATE_SUBSCRIPTION',
      description: `Admin reactivated subscription for contractor ID: ${contractorId}`,
      performedBy: req.admin!.id,
      metadata: {
        contractorId,
        subscriptionId: updatedSubscription.id,
        adminId: req.admin!.id,
      },
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Subscription reactivated successfully',
    data: {
      subscription: updatedSubscription,
    },
  });
});

// @desc    Create subscription for contractor (admin)
// @route   POST /api/admin/subscriptions/create
// @access  Private (Admin only)
export const createSubscriptionForContractor = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { contractorId, plan } = req.body;

  if (!contractorId || !plan || !['MONTHLY', 'SIX_MONTHS', 'YEARLY'].includes(plan)) {
    return next(new AppError('Valid contractor ID and subscription plan are required', 400));
  }

  // Get contractor profile with user data
  const contractor = await prisma.contractor.findUnique({
    where: { id: contractorId },
    include: { 
      user: true,
      subscription: true,
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  // Check if contractor already has an active subscription
  if (contractor.subscription && contractor.subscription.isActive) {
    return next(new AppError('Contractor already has an active subscription', 400));
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
  }

  // Create or update subscription
  let subscription;
  let stripeSubscriptionId = contractor.subscription?.stripeSubscriptionId;
  
  // Try to create or update Stripe subscription if contractor has a Stripe customer ID
  if (contractor.stripeCustomerId) {
    try {
      const stripe = getStripeInstance();
      const pricing = getSubscriptionPricing(plan);
      
      if (stripeSubscriptionId) {
        // Update existing Stripe subscription
        await stripe.subscriptions.update(stripeSubscriptionId, {
          cancel_at_period_end: false,
          proration_behavior: 'none',
          items: [
            {
              id: (await stripe.subscriptions.retrieve(stripeSubscriptionId)).items.data[0].id,
              price_data: {
                currency: 'gbp',
                product: process.env.STRIPE_PRODUCT_ID || 'prod_contractor_subscription',
                unit_amount: Math.round(pricing.monthly * 100),
                recurring: {
                  interval: 'month',
                  interval_count: plan === 'MONTHLY' ? 1 : plan === 'SIX_MONTHS' ? 6 : 12,
                },
              },
            },
          ],
          metadata: {
            plan,
            updatedBy: `admin:${req.admin!.id}`,
          }
        });

      } else {
        // Create new Stripe subscription
        const newSubscription = await stripe.subscriptions.create({
          customer: contractor.stripeCustomerId,
          items: [
            {
              price_data: {
                currency: 'gbp',
                product: process.env.STRIPE_PRODUCT_ID || 'prod_contractor_subscription',
                unit_amount: Math.round(pricing.monthly * 100),
                recurring: {
                  interval: 'month',
                  interval_count: plan === 'MONTHLY' ? 1 : plan === 'SIX_MONTHS' ? 6 : 12,
                },
              },
            },
          ],
          payment_behavior: 'default_incomplete',
          payment_settings: { save_default_payment_method: 'on_subscription' },
          expand: ['latest_invoice.payment_intent'],
          metadata: {
            contractorId,
            plan,
            createdBy: `admin:${req.admin!.id}`,
          },
        });
        
        stripeSubscriptionId = newSubscription.id;

      }
    } catch (error) {
      console.error('Failed to create/update Stripe subscription:', error);
      // Continue anyway to update our database
    }
  }
  
  // Update or create subscription in our database
  if (contractor.subscription) {
    subscription = await prisma.subscription.update({
      where: { id: contractor.subscription.id },
      data: {
        plan,
        status: 'active',
        isActive: true,
        currentPeriodStart: now,
        currentPeriodEnd: endDate,
        monthlyPrice: getSubscriptionPricing(plan).monthly,
        ...(stripeSubscriptionId && { stripeSubscriptionId }),
      },
    });
  } else {
    subscription = await prisma.subscription.create({
      data: {
        contractorId,
        tier: contractor.tier,
        plan,
        status: 'active',
        isActive: true,
        currentPeriodStart: now,
        currentPeriodEnd: endDate,
        monthlyPrice: getSubscriptionPricing(plan).monthly,
        ...(stripeSubscriptionId && { stripeSubscriptionId }),
      },
    });
  }

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      contractorId,
      amount: getSubscriptionPricing(plan).total,
      type: 'SUBSCRIPTION',
      status: 'COMPLETED',
      description: `${plan} subscription payment (admin created)`,
    },
  });
  
  // Create invoice for the subscription
  const pricing = getSubscriptionPricing(plan);
  const invoice = await prisma.invoice.create({
    data: {
      payments: { connect: { id: payment.id } },
      invoiceNumber: `INV-SUB-${Date.now().toString().substring(0, 10)}`,
      recipientName: contractor.businessName || contractor.user.name,
      recipientEmail: contractor.user.email,
      description: `${plan === 'MONTHLY' ? 'Monthly' : plan === 'SIX_MONTHS' ? '6-Month' : 'Yearly'} Subscription (VAT Included)`,
      amount: pricing.basePrice,  // Price without VAT
      vatAmount: pricing.vatAmount, // Pre-calculated VAT amount
      totalAmount: pricing.total,  // Total price with VAT included
      dueAt: now,
      paidAt: now,
    },
  });

  // Log admin action
  await prisma.adminAction.create({
    data: {
      action: 'CREATE_SUBSCRIPTION',
      description: `Admin created ${plan} subscription for contractor ID: ${contractorId}`,
      performedBy: req.admin!.id,
      metadata: {
        contractorId,
        subscriptionId: subscription.id,
        adminId: req.admin!.id,
        plan,
      },
    },
  });

  res.status(201).json({
    status: 'success',
    message: 'Subscription created successfully',
    data: {
      subscription,
      payment,
      invoice,
    },
  });
});

// @desc    Get subscription by ID
// @route   GET /api/admin/subscriptions/:id
// @access  Private (Admin only)
export const getSubscriptionById = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const subscription = await prisma.subscription.findUnique({
    where: { id },
    include: {
      contractor: {
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

  if (!subscription) {
    return next(new AppError('Subscription not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      subscription,
    },
  });
});

// @desc    Update subscription details
// @route   PATCH /api/admin/subscriptions/:id
// @access  Private (Admin only)
export const updateSubscription = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { plan, status, isActive, currentPeriodEnd } = req.body;

  // Get subscription
  const subscription = await prisma.subscription.findUnique({
    where: { id },
  });

  if (!subscription) {
    return next(new AppError('Subscription not found', 404));
  }

  // Update subscription
  const updatedSubscription = await prisma.subscription.update({
    where: { id },
    data: {
      ...(plan && { 
        plan,
        monthlyPrice: getSubscriptionPricing(plan).monthly,
      }),
      ...(status !== undefined && { status }),
      ...(isActive !== undefined && { isActive }),
      ...(currentPeriodEnd && { currentPeriodEnd: new Date(currentPeriodEnd) }),
    },
  });

  // Log admin action
  await prisma.adminAction.create({
    data: {
      action: 'UPDATE_SUBSCRIPTION',
      description: `Admin updated subscription ID: ${id}`,
      performedBy: req.admin!.id,
      metadata: {
        subscriptionId: id,
        adminId: req.admin!.id,
        changes: req.body,
      },
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      subscription: updatedSubscription,
    },
  });
});

// Routes
router.use(protectAdmin);

router.get('/stats', getSubscriptionStats);
router.get('/', getAllSubscriptions);
router.get('/:id', getSubscriptionById);
router.patch('/:id', updateSubscription);
router.post('/create', createSubscriptionForContractor);
router.post('/:contractorId/cancel', cancelContractorSubscription);
router.post('/:contractorId/reactivate', reactivateContractorSubscription);

export default router;
