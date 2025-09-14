import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError, catchAsync } from '../middleware/errorHandler';
import Stripe from 'stripe';
import { buffer } from 'micro';
import { createEmailService } from '../services/emailService';
import { SubscriptionPlan, CommissionStatus } from '@prisma/client';

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

// Special middleware to parse the raw body for Stripe webhooks
export const rawBodyMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.originalUrl.startsWith('/api/webhooks/stripe') && req.method === 'POST') {
      const rawBody = await buffer(req);
      // @ts-ignore: adding raw body to the request object
      req.rawBody = rawBody;
    }
    next();
  } catch (error) {
    next(new AppError('Error parsing webhook payload', 400));
  }
};

/**
 * Helper function to send email notifications for subscription events
 * (No emails should be sent after purchase/subscription)
 */
async function sendSubscriptionNotification(contractor: any, eventType: string, subscriptionDetails: any): Promise<boolean> {
  // Disabled email sending - subscription info will be available in dashboard only
  console.log(`✅ Email sending disabled - Subscription ${eventType} for: ${contractor?.user?.email || 'unknown'}`);
  // Create an in-app notification instead
  if (contractor?.userId) {
    try {
      // Don't await this to keep the process non-blocking
      const notificationType = eventType.includes('created') ? 'SUCCESS' : eventType.includes('updated') ? 'INFO' : 'WARNING';
      
      import('../services/notificationService').then(({ createNotification }) => {
        createNotification({
          userId: contractor.userId,
          title: `Subscription ${eventType}`,
          message: `Your subscription has been ${eventType}. Check your dashboard for details.`,
          type: notificationType as any,
          actionLink: '/dashboard/contractor/payments',
          actionText: 'View Subscription',
        }).catch(err => console.error('Failed to create notification:', err));
      }).catch(err => console.error('Failed to import notification service:', err));
    } catch (err) {
      console.error('Error creating subscription notification:', err);
      // Don't throw - this shouldn't block the subscription process
    }
  }
  return true;
}

/**
 * Helper function to send payment failed notifications
 * (No emails should be sent after purchase/subscription)
 */
async function sendPaymentFailedNotification(user: any, paymentDetails: any): Promise<boolean> {
  // Disabled email sending - payment failure info will be available in dashboard only
  console.log(`✅ Email sending disabled - Payment failed notification for: ${user?.email || 'unknown'}`);
  
  // Create an in-app notification instead
  if (user?.id) {
    try {
      // Don't await this to keep the process non-blocking
      import('../services/notificationService').then(({ createNotification }) => {
        createNotification({
          userId: user.id,
          title: 'Payment Failed',
          message: 'Your recent payment attempt failed. Please check your payment details and try again.',
          type: 'WARNING',
          actionLink: '/dashboard/contractor/payments',
          actionText: 'Update Payment',
        }).catch(err => console.error('Failed to create payment notification:', err));
      }).catch(err => console.error('Failed to import notification service:', err));
    } catch (err) {
      console.error('Error creating payment notification:', err);
      // Don't throw - this shouldn't block the process
    }
  }
  return true;
}

// @desc    Handle Stripe webhooks
// @route   POST /api/webhooks/stripe
// @access  Public
export const stripeWebhook = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  // Get the stripe signature from headers
  const signature = req.headers['stripe-signature'] as string;
  
  if (!signature) {
    return next(new AppError('Webhook Error: No Stripe signature found', 400));
  }
  
  // Get the webhook secret
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    return next(new AppError('Webhook Error: Webhook secret not configured', 500));
  }
  
  let event: Stripe.Event;
  
  try {
    // @ts-ignore: accessing rawBody property
    event = getStripeInstance().webhooks.constructEvent(req.rawBody, signature, webhookSecret);
    console.log(`✅ Webhook received: ${event.type}`);
  } catch (err: any) {
    console.error(`❌ Webhook signature verification failed: ${err.message}`);
    return next(new AppError(`Webhook Error: ${err.message}`, 400));
  }
  
  // Handle different event types
  switch (event.type) {
    // ==================== Invoice Events ====================
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      console.log('📧 Invoice payment succeeded:', invoice.id);
      
      // Only process if subscription related
      if (invoice.subscription) {
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id;
        
        // Get internal subscription record
        const dbSubscription = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: subscriptionId },
          include: { contractor: { include: { user: true } } },
        });
        
        if (dbSubscription) {
          // Update subscription status
          await prisma.subscription.update({
            where: { id: dbSubscription.id },
            data: {
              status: 'active',
              isActive: true,
              // Update the current period if needed
              currentPeriodEnd: new Date(invoice.lines.data[0]?.period?.end * 1000 || Date.now()),
            },
          });
          
          // Create invoice record in our database
          const createdInvoice = await prisma.invoice.create({
            data: {
              invoiceNumber: `INV-${invoice.id}`,
              recipientName: dbSubscription.contractor.businessName || dbSubscription.contractor.user.name,
              recipientEmail: dbSubscription.contractor.user.email,
              description: `Subscription Payment - ${dbSubscription.plan}`,
              amount: Number(invoice.subtotal) / 100,
              vatAmount: Number(invoice.tax || 0) / 100,
              totalAmount: Number(invoice.total) / 100,
              dueAt: new Date(invoice.created * 1000),
              paidAt: new Date(),
            },
          });

          // Send subscription invoice email
          try {
            const { sendSubscriptionInvoiceEmail } = await import('../services/emailNotificationService');
            await sendSubscriptionInvoiceEmail({
              invoiceNumber: createdInvoice.invoiceNumber,
              recipientName: dbSubscription.contractor.businessName || dbSubscription.contractor.user.name,
              recipientEmail: dbSubscription.contractor.user.email,
              plan: dbSubscription.plan,
              amount: createdInvoice.amount,
              vatAmount: createdInvoice.vatAmount,
              totalAmount: createdInvoice.totalAmount,
              dueDate: createdInvoice.dueAt,
              paidAt: createdInvoice.paidAt,
            });
            console.log(`📧 Subscription invoice email sent to: ${dbSubscription.contractor.user.email}`);
          } catch (error) {
            console.error('Failed to send subscription invoice email:', error);
            // Don't fail webhook processing if email fails
          }
          
          // Create payment record
          await prisma.payment.create({
            data: {
              contractorId: dbSubscription.contractorId,
              amount: Number(invoice.total) / 100,
              type: 'SUBSCRIPTION',
              status: 'COMPLETED',
              stripePaymentId: invoice.payment_intent as string,
              description: `Subscription payment for ${dbSubscription.plan}`,
            },
          });
        }
      }
      break;
    }
    
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      console.log('❌ Invoice payment failed:', invoice.id);
      
      // Only process if subscription related
      if (invoice.subscription) {
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id;
        
        // Get internal subscription record
        const dbSubscription = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: subscriptionId },
          include: { contractor: { include: { user: true } } },
        });
        
        if (dbSubscription) {
          // Update subscription status
          await prisma.subscription.update({
            where: { id: dbSubscription.id },
            data: {
              status: 'past_due',
              // Don't set isActive to false yet, as the user might still pay
            },
          });
          
          // Send notification to user
          await sendPaymentFailedNotification(
            dbSubscription.contractor.user, 
            { 
              amount: invoice.total,
              last_payment_error: { message: 'Your payment was declined. Please update your payment method.' }
            }
          );
        }
      }
      break;
    }
    
    // ==================== Subscription Events ====================
    case 'customer.subscription.created': {
      const subscription = event.data.object as Stripe.Subscription;
      console.log('🔔 Subscription created:', subscription.id);
      
      // Get the contractor ID from metadata if available
      const contractorId = subscription.metadata?.contractorId;
      
      if (contractorId) {
        // Get contractor details
        const contractor = await prisma.contractor.findUnique({
          where: { id: contractorId },
          include: { user: true },
        });
        
        if (contractor) {
          // Get the plan from metadata or default to MONTHLY
          // Cast it to SubscriptionPlan enum type to match Prisma schema
          const planString = subscription.metadata?.plan || 'MONTHLY';
          const plan = planString as any as SubscriptionPlan;
          
          // Calculate period dates
          const periodStart = new Date(subscription.current_period_start * 1000);
          const periodEnd = new Date(subscription.current_period_end * 1000);
          
          // Create or update subscription
          const dbSubscription = await prisma.subscription.upsert({
            where: { contractorId },
            update: {
              stripeSubscriptionId: subscription.id,
              plan,
              status: subscription.status,
              isActive: subscription.status === 'active',
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              monthlyPrice: Number(subscription.items.data[0]?.price.unit_amount) / 100,
            },
            create: {
              contractorId,
              stripeSubscriptionId: subscription.id,
              tier: contractor.tier,
              plan,
              status: subscription.status,
              isActive: subscription.status === 'active',
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              monthlyPrice: Number(subscription.items.data[0]?.price.unit_amount) / 100,
            },
          });
          
          // Email notifications disabled - subscription info will be available in dashboard
          // User can view invoice and subscription details in dashboard
          console.log(`✅ Subscription created for contractor: ${contractorId}, plan: ${plan}`);
        }
      }
      break;
    }
    
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      console.log('🔄 Subscription updated:', subscription.id);
      
      // Find the subscription in our database
      const dbSubscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: subscription.id },
        include: { contractor: { include: { user: true } } },
      });
      
      if (dbSubscription) {
        // Update subscription details
        await prisma.subscription.update({
          where: { id: dbSubscription.id },
          data: {
            status: subscription.status,
            isActive: ['active', 'trialing'].includes(subscription.status),
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            // Update plan if it's in metadata, casting to SubscriptionPlan enum
            ...(subscription.metadata?.plan ? { plan: subscription.metadata.plan as any as SubscriptionPlan } : {}),
          },
        });
        
        // Email notifications disabled - subscription status updates visible in dashboard
        console.log(`✅ Subscription status update - ${dbSubscription.contractor.user?.email || 'unknown'}, status: ${subscription.status}`);
      }
      break;
    }
    
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      console.log('🗑️ Subscription deleted:', subscription.id);
      
      // Find the subscription in our database
      const dbSubscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: subscription.id },
        include: { contractor: { include: { user: true } } },
      });
      
      if (dbSubscription) {
        // Update subscription status
        await prisma.subscription.update({
          where: { id: dbSubscription.id },
          data: {
            status: 'cancelled',
            isActive: false,
          },
        });
        
        // Email notifications disabled - subscription cancellation visible in dashboard
        console.log(`✅ Subscription cancelled - ${dbSubscription.contractor.user?.email || 'unknown'}`);
      }
      break;
    }
    
    // ==================== Payment Intent Events ====================
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      console.log('💰 Payment intent succeeded:', paymentIntent.id);
      
      // Check what type of payment this is from metadata
      const paymentType = paymentIntent.metadata?.type;
      
      if (paymentType === 'job_access_purchase') {
        const jobId = paymentIntent.metadata?.jobId;
        const contractorId = paymentIntent.metadata?.contractorId;
        
        if (jobId && contractorId) {
          // Check if we already have processed this payment
          const existingAccess = await prisma.jobAccess.findUnique({
            where: {
              jobId_contractorId: {
                jobId,
                contractorId,
              },
            },
          });
          
          if (!existingAccess) {
            // Get job and contractor details
            const job = await prisma.job.findUnique({
              where: { id: jobId },
              include: { customer: { include: { user: true } } },
            });
            
            const contractor = await prisma.contractor.findUnique({
              where: { id: contractorId },
              include: { user: true },
            });
            
            if (job && contractor) {
              // Create job access
              await prisma.jobAccess.create({
                data: {
                  contractorId,
                  jobId,
                  accessMethod: 'PAYMENT',
                  paidAmount: Number(paymentIntent.amount) / 100,
                  creditUsed: false,
                },
              });
              
              // Create payment record if it doesn't exist
              const existingPayment = await prisma.payment.findFirst({
                where: { stripePaymentId: paymentIntent.id },
              });
              
              if (!existingPayment) {
                await prisma.payment.create({
                  data: {
                    contractorId,
                    amount: Number(paymentIntent.amount) / 100,
                    type: 'LEAD_ACCESS',
                    status: 'COMPLETED',
                    stripePaymentId: paymentIntent.id,
                    description: `Job access purchased for: ${job.title}`,
                  },
                });
              }
            }
          }
        }
      } else if (paymentType === 'commission_payment') {
        const commissionPaymentId = paymentIntent.metadata?.commissionPaymentId;
        
        if (commissionPaymentId) {
          // Check if commission payment exists and isn't already marked paid
          const commissionPayment = await prisma.commissionPayment.findFirst({
            where: {
              id: commissionPaymentId,
              status: 'PENDING',
            },
          });
          
          if (commissionPayment) {
            // Mark commission as paid
            await prisma.commissionPayment.update({
              where: { id: commissionPaymentId },
              data: {
                status: 'PAID',
                paidAt: new Date(),
                stripePaymentId: paymentIntent.id,
              },
            });
            
            // Update job as commission paid
            await prisma.job.update({
              where: { id: commissionPayment.jobId },
              data: { commissionPaid: true },
            });
          }
        }
      }
      // Other payment types can be handled here
      
      break;
    }
    
    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      console.log('❌ Payment intent failed:', paymentIntent.id);
      
      // Check what type of payment this is from metadata
      const paymentType = paymentIntent.metadata?.type;
      const contractorId = paymentIntent.metadata?.contractorId;
      
      if (contractorId) {
        const contractor = await prisma.contractor.findUnique({
          where: { id: contractorId },
          include: { user: true },
        });
        
        if (contractor) {
          // Send notification
          await sendPaymentFailedNotification(
            contractor.user,
            paymentIntent
          );
          
          // If this was a commission payment, mark it as failed
          if (paymentType === 'commission_payment') {
            const commissionPaymentId = paymentIntent.metadata?.commissionPaymentId;
            
            if (commissionPaymentId) {
              await prisma.commissionPayment.update({
                where: { id: commissionPaymentId },
                data: { 
                  status: CommissionStatus.OVERDUE // Using OVERDUE instead of 'FAILED' as it's the closest enum value
                  // Note: failureReason field doesn't exist in the CommissionPayment model
                },
              });
            }
          }
        }
      }
      break;
    }
    
    // Add more event handlers as needed
    
    default:
      console.log(`⚠️ Unhandled event type: ${event.type}`);
  }
  
  // Return a 200 response to acknowledge receipt of the event
  res.status(200).json({ received: true });
});

// Route
router.post('/stripe', stripeWebhook);

export default router;
