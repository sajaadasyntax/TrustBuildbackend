import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest, restrictTo } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import Stripe from 'stripe';
import { 
  checkSubscriptionStatusByUserId,
  getSubscriptionPricing,
  calculateSubscriptionEndDate,
  formatSubscriptionDetails
} from '../services/subscriptionService';

const router = Router();

// Initialize Stripe lazily when needed
let stripe: Stripe | null = null;

function getStripeInstance(): Stripe | null {
  if (!stripe) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    
    if (!stripeKey) {

      return null;
    }
    
    if (!stripeKey.startsWith('sk_test_') && !stripeKey.startsWith('sk_live_')) {

      return null;
    }
    
    try {
      stripe = new Stripe(stripeKey, {
        apiVersion: '2023-10-16',
      });
      

    } catch (error) {
      console.error('❌ Failed to initialize Stripe:', error);
      return null;
    }
  }
  
  return stripe;
}

// Note: Subscription pricing and status checking are now handled by subscriptionService.ts
// This ensures consistency across the entire application

// @desc    Get subscription plans
// @route   GET /api/subscriptions/plans
// @access  Private
export const getSubscriptionPlans = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const monthlyPricing = await getSubscriptionPricing('MONTHLY');
  const sixMonthPricing = await getSubscriptionPricing('SIX_MONTHS');
  const yearlyPricing = await getSubscriptionPricing('YEARLY');
  
  const plans = [
    {
      id: 'MONTHLY',
      name: 'Monthly',
      ...monthlyPricing,
      features: [
        'Access to all job listings',
        'No commission on completed jobs',
        'Unlimited job applications',
        'Profile visibility to customers',
        'Customer reviews',
      ],
    },
    {
      id: 'SIX_MONTHS',
      name: '6-Month',
      ...sixMonthPricing,
      features: [
        'All Monthly plan features',
        `${sixMonthPricing.discountPercentage}% discount`,
        'Priority in search results',
        'Featured profile badge',
        'Extended profile customization',
      ],
    },
    {
      id: 'YEARLY',
      name: 'Yearly',
      ...yearlyPricing,
      features: [
        'All 6-Month plan features',
        `${yearlyPricing.discountPercentage}% discount`,
        'Top placement in search results',
        'Premium profile badge',
        'Advanced analytics dashboard',
        'Dedicated support',
      ],
    },
  ];

  res.status(200).json({
    status: 'success',
    data: {
      plans,
    },
  });
});

// @desc    Get contractor's current subscription
// @route   GET /api/subscriptions/current
// @access  Private (Contractor only)
export const getCurrentSubscription = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Use unified subscription status check
  const subscriptionStatus = await checkSubscriptionStatusByUserId(userId);
  
  // Format subscription details if active
  let subscriptionDetails = null;
  if (subscriptionStatus.hasActiveSubscription && subscriptionStatus.subscription) {
    subscriptionDetails = await formatSubscriptionDetails(subscriptionStatus.subscription);
    
    // Get Stripe subscription if available
    if (subscriptionStatus.subscription.stripeSubscriptionId) {
      try {
        const stripe = getStripeInstance();
        if (stripe) {
          const stripeSubscription = await stripe.subscriptions.retrieve(
            subscriptionStatus.subscription.stripeSubscriptionId
          );
          // Add Stripe subscription details if needed
          if (subscriptionDetails) {
            (subscriptionDetails as any).stripeDetails = stripeSubscription;
          }
        }
      } catch (error) {
        console.error('Failed to retrieve Stripe subscription:', error);
      }
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      subscription: subscriptionDetails,
      hasSubscription: subscriptionStatus.hasActiveSubscription,
    },
  });
});

// @desc    Create subscription payment intent
// @route   POST /api/subscriptions/create-payment-intent
// @access  Private (Contractor only)
export const createSubscriptionPaymentIntent = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { plan } = req.body;
  const userId = req.user!.id;

  if (!plan || !['MONTHLY', 'SIX_MONTHS', 'YEARLY'].includes(plan)) {
    return next(new AppError('Valid subscription plan is required', 400));
  }

  // Get contractor profile with user data
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    include: { user: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get pricing for selected plan using unified service
    const pricing = await getSubscriptionPricing(plan);
    const amount = pricing.total;

  // Create payment intent
  try {
    const stripe = getStripeInstance();
    
    if (!stripe) {

      
      // Return simulated payment intent without actually hitting Stripe API
      res.status(200).json({
        status: 'success',
        data: {
          clientSecret: `mock_pi_${Date.now()}_secret_${Math.random().toString(36).substring(2, 15)}`,
          amount,
          plan,
          pricing,
          isMockStripe: true,
        },
      });
      return;
    }
    
    const paymentIntent = await stripe!.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'gbp',
      // Remove payment_method_types when using automatic_payment_methods
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      },
      metadata: {
        contractorId: contractor.id,
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
// @route   POST /api/subscriptions/confirm
// @access  Private (Contractor only)
export const confirmSubscription = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { stripePaymentIntentId, plan } = req.body;
  const userId = req.user!.id;

  if (!stripePaymentIntentId || !plan) {
    return next(new AppError('Payment intent ID and plan are required', 400));
  }

  // Get contractor profile with user data
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    include: { user: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Verify payment with Stripe (or handle mock payment)
  let paymentSucceeded = false;
  let paymentIntent;
  let stripeCustomerId = null;
  
  // Check if it's a mock payment intent ID (for environments without Stripe)
  if (stripePaymentIntentId.startsWith('mock_pi_')) {

    paymentSucceeded = true;
  } else {
    // It's a real Stripe payment intent - verify it
    const stripe = getStripeInstance();
    if (!stripe) {
      return next(new AppError('Stripe is not configured but received a Stripe payment intent ID', 400));
    }
    

    try {
      paymentIntent = await stripe!.paymentIntents.retrieve(stripePaymentIntentId);

      paymentSucceeded = paymentIntent.status === 'succeeded';
      
      // Get customer ID or create a Stripe customer if not exists
      if (paymentSucceeded) {
        // Try to get existing Stripe customer
        const existingCustomer = await prisma.stripeCustomer.findFirst({
          where: { contractorId: contractor.id }
        });
        
        if (existingCustomer) {

          stripeCustomerId = existingCustomer.stripeCustomerId;
        } else {
          // Create a new Stripe customer

          const customer = await stripe!.customers.create({
            email: contractor.user.email,
            name: contractor.businessName || contractor.user.name,
            metadata: {
              contractorId: contractor.id,
              userId: contractor.userId
            }
          });
          
          // Save the Stripe customer ID to the database
          await prisma.stripeCustomer.create({
            data: {
              contractorId: contractor.id,
              stripeCustomerId: customer.id,
            }
          });
          

          stripeCustomerId = customer.id;
        }
      }
    } catch (error) {
      console.error('❌ Error retrieving payment intent:', error);
      return next(new AppError(`Failed to verify payment: ${error instanceof Error ? error.message : 'Unknown error'}`, 400));
    }
  }
  
  if (!paymentSucceeded) {
    return next(new AppError('Payment not completed', 400));
  }

  // Calculate subscription period using unified function
  const now = new Date();
  const endDate = calculateSubscriptionEndDate(plan, now);

  // Check if contractor already has a subscription

  const existingSubscription = await prisma.subscription.findUnique({
    where: { contractorId: contractor.id },
  });


  let subscription;
  let stripeSubscriptionId = null;
  
  // If we have a real Stripe instance and customer ID, create a Stripe subscription
  if (!stripePaymentIntentId.startsWith('mock_pi_') && stripeCustomerId) {
    const stripe = getStripeInstance();
    if (stripe) {
      try {

        
        // Get the appropriate price ID based on plan
        // These should be created in your Stripe dashboard
        let priceId;
        switch (plan) {
          case 'MONTHLY':
            priceId = process.env.STRIPE_PRICE_MONTHLY;
            break;
          case 'SIX_MONTHS':
            priceId = process.env.STRIPE_PRICE_SIX_MONTHS;
            break;
          case 'YEARLY':
            priceId = process.env.STRIPE_PRICE_YEARLY;
            break;
        }
        
        if (!priceId) {
          console.warn(`⚠️ No Stripe price ID found for plan: ${plan}, using test price`);
          // Fallback to test price - replace with your actual test price ID
          priceId = 'price_test123'; // Replace with a real test price ID
        }
        
        // Create the subscription in Stripe
        const stripeSubscription = await stripe!.subscriptions.create({
          customer: stripeCustomerId,
          items: [{
            price: priceId,
          }],
          metadata: {
            contractorId: contractor.id,
            userId: contractor.userId,
            plan,
            type: 'contractor_subscription'
          },
          payment_behavior: 'default_incomplete',
          payment_settings: {
            save_default_payment_method: 'on_subscription',
          },
          expand: ['latest_invoice.payment_intent'],
        });
        

        stripeSubscriptionId = stripeSubscription.id;
      } catch (error) {
        console.error(`❌ Failed to create Stripe subscription: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue anyway to update our database
      }
    }
  }
  
  if (existingSubscription) {
    // Update existing subscription

    try {
      const pricing = await getSubscriptionPricing(plan);
      subscription = await prisma.subscription.update({
        where: { id: existingSubscription.id },
        data: {
          plan,
          status: 'active',
          isActive: true,
          currentPeriodStart: now,
          currentPeriodEnd: endDate,
          monthlyPrice: pricing.monthly,
          ...(stripeSubscriptionId && { stripeSubscriptionId }),
        },
      });

    } catch (err) {
      console.error(`❌ Error updating subscription: ${err instanceof Error ? err.message : 'Unknown error'}`);
      throw err;
    }
  } else {
    // Create new subscription

    try {
      const pricing = await getSubscriptionPricing(plan);
      subscription = await prisma.subscription.create({
        data: {
          contractorId: contractor.id,
          tier: contractor.tier,
          plan,
          status: 'active',
          isActive: true,
          currentPeriodStart: now,
          currentPeriodEnd: endDate,
          monthlyPrice: pricing.monthly,
          ...(stripeSubscriptionId && { stripeSubscriptionId }),
        },
      });

    } catch (err) {
      console.error(`❌ Error creating subscription: ${err instanceof Error ? err.message : 'Unknown error'}`);
      throw err;
    }
  }

  // Create payment record

  let payment;
  try {
    const pricing = await getSubscriptionPricing(plan);
    payment = await prisma.payment.create({
      data: {
        contractorId: contractor.id,
        amount: pricing.total,
        type: 'SUBSCRIPTION',
        status: 'COMPLETED',
        stripePaymentId: stripePaymentIntentId,
        description: `${plan} subscription payment`,
      },
    });

  } catch (err) {
    console.error(`❌ Error creating payment record: ${err instanceof Error ? err.message : 'Unknown error'}`);
    throw err;
  }

  // Subscribed contractors get 3 weekly credits
  const newWeeklyCreditsLimit = 3;

  // Allocate initial credits to the contractor
  try {
    // Update contractor with weekly credits limit and initial credits
    const updatedContractor = await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        weeklyCreditsLimit: newWeeklyCreditsLimit,
        creditsBalance: newWeeklyCreditsLimit > 0 ? newWeeklyCreditsLimit : contractor.creditsBalance,
        lastCreditReset: newWeeklyCreditsLimit > 0 ? now : contractor.lastCreditReset
      }
    });

    // Create credit transaction record only if credits were added
    if (newWeeklyCreditsLimit > 0 && newWeeklyCreditsLimit > contractor.creditsBalance) {
      await prisma.creditTransaction.create({
        data: {
          contractorId: contractor.id,
          type: 'WEEKLY_ALLOCATION',
          amount: newWeeklyCreditsLimit - contractor.creditsBalance,
          description: 'Initial credit allocation - subscription activated'
        }
      });
    }


  } catch (err) {
    console.error(`❌ Error allocating credits: ${err instanceof Error ? err.message : 'Unknown error'}`);
    // Don't throw error here as subscription is already created
  }

  // Create invoice

  let invoice;
  try {
    const pricing = await getSubscriptionPricingAsync(plan);
    invoice = await prisma.invoice.create({
      data: {
        payments: { connect: { id: payment.id } },
        invoiceNumber: `INV-SUB-${Date.now().toString().substring(0, 10)}`,
        recipientName: contractor.businessName || contractor.user.name,
        recipientEmail: contractor.user.email,
        description: `${plan === 'MONTHLY' ? 'Monthly' : plan === 'SIX_MONTHS' ? '6-Month' : 'Yearly'} Subscription (VAT Included)`,
        amount: pricing.basePrice,  // Base price without VAT
        vatAmount: pricing.vatAmount, // Pre-calculated VAT amount
        totalAmount: pricing.total,  // Total price with VAT included
        dueAt: now,
        paidAt: now,
      },
    });

  } catch (err) {
    console.error(`❌ Error creating invoice: ${err instanceof Error ? err.message : 'Unknown error'}`);
    throw err;
  }

  // Send subscription invoice email
  try {
    const { sendSubscriptionInvoiceEmail } = await import('../services/emailNotificationService');
    await sendSubscriptionInvoiceEmail({
      invoiceNumber: invoice.invoiceNumber,
      recipientName: contractor.businessName || contractor.user.name,
      recipientEmail: contractor.user.email,
      plan: plan,
      amount: Number(invoice.amount),
      vatAmount: Number(invoice.vatAmount),
      totalAmount: Number(invoice.totalAmount),
      dueDate: invoice.dueAt || new Date(),
      paidAt: invoice.paidAt || undefined,
    });
  } catch (error) {
    console.error('Failed to send subscription invoice email:', error);
    // Don't fail subscription if email fails
  }
  
  // Create in-app notification (non-blocking)
  try {
    import('../services/notificationService').then(({ createNotification }) => {
      createNotification({
        userId: contractor.userId,
        title: 'Subscription Activated',
        message: `Your ${plan} subscription has been successfully activated.`,
        type: 'SUCCESS',
        actionLink: '/dashboard/contractor/payments',
        actionText: 'View Subscription',
      }).catch(err => console.log('Failed to create notification (non-critical):', err));
    }).catch(err => console.log('Failed to import notification service:', err));
  } catch (err) {
    // Ignore notification errors - they should not block subscription activation

  }
  
  // Log important subscription data


  

  res.status(200).json({
    status: 'success',
    message: 'Subscription confirmed successfully',
    data: {
      subscription,
    },
  });
});

// @desc    Cancel subscription
// @route   POST /api/subscriptions/cancel
// @access  Private (Contractor only)
export const cancelSubscription = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;

  // Get contractor profile with subscription and user data
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

  if (!contractor.subscription) {
    return next(new AppError('No active subscription found', 404));
  }

  // Cancel Stripe subscription if exists
  if (contractor.subscription.stripeSubscriptionId) {
    try {
      const stripe = getStripeInstance();
      await stripe!.subscriptions.cancel(contractor.subscription.stripeSubscriptionId);
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

  // No email sending is needed - subscription status now only accessible in-app
  
  // Create in-app notification (non-blocking)
  try {
    import('../services/notificationService').then(({ createNotification }) => {
      createNotification({
        userId: contractor.userId,
        title: 'Subscription Cancelled',
        message: `Your subscription has been cancelled. You will have access until ${contractor.subscription?.currentPeriodEnd ? new Date(contractor.subscription.currentPeriodEnd).toLocaleDateString() : 'the end of your current period'}.`,
        type: 'INFO',
        actionLink: '/dashboard/contractor/payments',
        actionText: 'View Details',
      }).catch(err => console.log('Failed to create notification (non-critical):', err));
    }).catch(err => console.log('Failed to import notification service:', err));
  } catch (err) {
    // Ignore notification errors - they should not block subscription cancellation

  }

  res.status(200).json({
    status: 'success',
    message: 'Subscription cancelled successfully',
    data: {
      subscription: updatedSubscription,
    },
  });
});

// Email sending functions removed - all subscription information is now available in-app only

// Routes
router.use(protect);
router.use(restrictTo('CONTRACTOR'));

router.get('/plans', getSubscriptionPlans);
router.get('/current', getCurrentSubscription);
router.post('/create-payment-intent', createSubscriptionPaymentIntent);
router.post('/confirm', confirmSubscription);
router.post('/cancel', cancelSubscription);

export default router;
