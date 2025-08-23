import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest, restrictTo } from '../middleware/auth';
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

// Email transporter configuration
const getEmailTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.mailersend.net',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Subscription pricing helper
export function getSubscriptionPricing(plan: string) {
  switch (plan) {
    case 'MONTHLY':
      return {
        monthly: 49.99,
        total: 49.99,
        discount: 0,
        discountPercentage: 0,
        duration: 1,
        durationUnit: 'month',
      };
    case 'SIX_MONTHS':
      return {
        monthly: 44.99,
        total: 269.94,
        discount: 30.00,
        discountPercentage: 10,
        duration: 6,
        durationUnit: 'months',
      };
    case 'YEARLY':
      return {
        monthly: 39.99,
        total: 479.88,
        discount: 119.88,
        discountPercentage: 20,
        duration: 12,
        durationUnit: 'months',
      };
    default:
      return {
        monthly: 49.99,
        total: 49.99,
        discount: 0,
        discountPercentage: 0,
        duration: 1,
        durationUnit: 'month',
      };
  }
}

// @desc    Get subscription plans
// @route   GET /api/subscriptions/plans
// @access  Private
export const getSubscriptionPlans = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const plans = [
    {
      id: 'MONTHLY',
      name: 'Monthly',
      ...getSubscriptionPricing('MONTHLY'),
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
      ...getSubscriptionPricing('SIX_MONTHS'),
      features: [
        'All Monthly plan features',
        '10% discount',
        'Priority in search results',
        'Featured profile badge',
        'Extended profile customization',
      ],
    },
    {
      id: 'YEARLY',
      name: 'Yearly',
      ...getSubscriptionPricing('YEARLY'),
      features: [
        'All 6-Month plan features',
        '20% discount',
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

  // Format subscription details
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
      id: contractor.subscription.id,
      plan: contractor.subscription.plan,
      planName: plan === 'MONTHLY' ? 'Monthly' : plan === 'SIX_MONTHS' ? '6-Month' : 'Yearly',
      status: contractor.subscription.status,
      isActive: contractor.subscription.isActive,
      startDate: contractor.subscription.currentPeriodStart.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
      endDate: formattedNextBillingDate,
      nextBillingDate: formattedNextBillingDate,
      pricing,
      daysRemaining: Math.max(0, Math.floor((contractor.subscription.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
      stripeSubscriptionId: contractor.subscription.stripeSubscriptionId,
    };
  }

  res.status(200).json({
    status: 'success',
    data: {
      subscription: subscriptionDetails,
      hasActiveSubscription: !!subscriptionDetails && subscriptionDetails.isActive,
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
  const existingSubscription = await prisma.subscription.findUnique({
    where: { contractorId: contractor.id },
  });

  let subscription;
  if (existingSubscription) {
    // Update existing subscription
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
  } else {
    // Create new subscription
    subscription = await prisma.subscription.create({
      data: {
        contractorId: contractor.id,
        tier: contractor.tier,
        plan,
        status: 'active',
        isActive: true,
        currentPeriodStart: now,
        currentPeriodEnd: endDate,
        monthlyPrice: getSubscriptionPricing(plan).monthly,
      },
    });
  }

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      contractorId: contractor.id,
      amount: getSubscriptionPricing(plan).total,
      type: 'SUBSCRIPTION',
      status: 'COMPLETED',
      stripePaymentId: stripePaymentIntentId,
      description: `${plan} subscription payment`,
    },
  });

  // Create invoice
  await prisma.invoice.create({
    data: {
      paymentId: payment.id,
      invoiceNumber: `INV-SUB-${Date.now().toString().substring(0, 10)}`,
      recipientName: contractor.businessName || contractor.user.name,
      recipientEmail: contractor.user.email,
      description: `${plan === 'MONTHLY' ? 'Monthly' : plan === 'SIX_MONTHS' ? '6-Month' : 'Yearly'} Subscription`,
      amount: getSubscriptionPricing(plan).total,
      vatAmount: getSubscriptionPricing(plan).total * 0.2,
      totalAmount: getSubscriptionPricing(plan).total * 1.2,
      dueDate: now,
      paidAt: now,
    },
  });

  // Send subscription confirmation email
  await sendSubscriptionConfirmationEmail(
    contractor.user.email,
    {
      contractorName: contractor.businessName || contractor.user.name,
      plan: plan === 'MONTHLY' ? 'Monthly' : plan === 'SIX_MONTHS' ? '6-Month' : 'Yearly',
      amount: getSubscriptionPricing(plan).total,
      vatAmount: getSubscriptionPricing(plan).total * 0.2,
      totalAmount: getSubscriptionPricing(plan).total * 1.2,
      startDate: now.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
      endDate: endDate.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
    }
  );

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

  // Send cancellation email
  await sendSubscriptionCancellationEmail(
    contractor.user.email,
    {
      contractorName: contractor.businessName || contractor.user.name,
      plan: contractor.subscription.plan === 'MONTHLY' ? 'Monthly' : 
            contractor.subscription.plan === 'SIX_MONTHS' ? '6-Month' : 'Yearly',
      endDate: contractor.subscription.currentPeriodEnd.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
    }
  );

  res.status(200).json({
    status: 'success',
    message: 'Subscription cancelled successfully',
    data: {
      subscription: updatedSubscription,
    },
  });
});

// @desc    Send subscription confirmation email
// @access  Private
async function sendSubscriptionConfirmationEmail(recipientEmail: string, subscriptionData: {
  contractorName: string;
  plan: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  startDate: string;
  endDate: string;
}): Promise<boolean> {
  try {
    const transporter = getEmailTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@trustbuild.uk',
      to: recipientEmail,
      subject: `TrustBuild: ${subscriptionData.plan} Subscription Confirmed`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .header { background-color: #0f766e; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .subscription-details { background-color: #f0fdfa; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #0f766e; }
            .footer { background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; }
            .amount { font-size: 1.2em; font-weight: bold; color: #0f766e; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Subscription Confirmed</h1>
          </div>
          
          <div class="content">
            <p>Dear ${subscriptionData.contractorName},</p>
            
            <p>Thank you for subscribing to TrustBuild. Your ${subscriptionData.plan} subscription has been successfully activated.</p>
            
            <div class="subscription-details">
              <h3>Subscription Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td><strong>Plan:</strong></td><td>${subscriptionData.plan}</td></tr>
                <tr><td><strong>Start Date:</strong></td><td>${subscriptionData.startDate}</td></tr>
                <tr><td><strong>End Date:</strong></td><td>${subscriptionData.endDate}</td></tr>
                <tr><td><strong>Amount:</strong></td><td>£${subscriptionData.amount.toFixed(2)}</td></tr>
                <tr><td><strong>VAT (20%):</strong></td><td>£${subscriptionData.vatAmount.toFixed(2)}</td></tr>
                <tr class="amount"><td><strong>Total Paid:</strong></td><td>£${subscriptionData.totalAmount.toFixed(2)}</td></tr>
              </table>
            </div>
            
            <p>Your subscription benefits are now active. You can access all premium features and services through your contractor dashboard.</p>
            
            <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
            
            <p>Thank you for choosing TrustBuild!</p>
            
            <p>Best regards,<br>The TrustBuild Team</p>
          </div>
          
          <div class="footer">
            <p>TrustBuild - Professional Contractor Platform</p>
            <p>Manage your subscription: <a href="https://trustbuild.uk/dashboard/subscription">https://trustbuild.uk/dashboard/subscription</a></p>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Failed to send subscription confirmation email:', error);
    return false;
  }
}

// @desc    Send subscription cancellation email
// @access  Private
async function sendSubscriptionCancellationEmail(recipientEmail: string, subscriptionData: {
  contractorName: string;
  plan: string;
  endDate: string;
}): Promise<boolean> {
  try {
    const transporter = getEmailTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@trustbuild.uk',
      to: recipientEmail,
      subject: `TrustBuild: ${subscriptionData.plan} Subscription Cancelled`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .header { background-color: #64748b; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .subscription-details { background-color: #f8fafc; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #64748b; }
            .footer { background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Subscription Cancelled</h1>
          </div>
          
          <div class="content">
            <p>Dear ${subscriptionData.contractorName},</p>
            
            <p>We're sorry to see you go. Your ${subscriptionData.plan} subscription has been cancelled.</p>
            
            <div class="subscription-details">
              <h3>Subscription Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td><strong>Plan:</strong></td><td>${subscriptionData.plan}</td></tr>
                <tr><td><strong>Access Until:</strong></td><td>${subscriptionData.endDate}</td></tr>
              </table>
            </div>
            
            <p>You will continue to have access to your subscription benefits until ${subscriptionData.endDate}. After this date, your account will revert to a non-subscribed contractor account.</p>
            
            <p>We'd love to have you back! You can resubscribe at any time through your contractor dashboard.</p>
            
            <p>If you have any questions or feedback, please don't hesitate to contact our support team.</p>
            
            <p>Thank you for your past support.</p>
            
            <p>Best regards,<br>The TrustBuild Team</p>
          </div>
          
          <div class="footer">
            <p>TrustBuild - Professional Contractor Platform</p>
            <p>Resubscribe anytime: <a href="https://trustbuild.uk/dashboard/subscription">https://trustbuild.uk/dashboard/subscription</a></p>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Failed to send subscription cancellation email:', error);
    return false;
  }
}

// Routes
router.use(protect);
router.use(restrictTo('CONTRACTOR'));

router.get('/plans', getSubscriptionPlans);
router.get('/current', getCurrentSubscription);
router.post('/create-payment-intent', createSubscriptionPaymentIntent);
router.post('/confirm', confirmSubscription);
router.post('/cancel', cancelSubscription);

export default router;
