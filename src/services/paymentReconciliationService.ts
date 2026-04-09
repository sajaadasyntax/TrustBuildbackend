import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { getStripeInstance } from '../config/stripe';
import AppError from '../utils/appError';

interface ReconcileResult {
  jobId: string;
  contractorId: string;
  jobAccessId: string;
  paymentId: string;
  createdJobAccess: boolean;
  createdPayment: boolean;
}

function getLeadPriceFromMetadata(paymentIntent: Stripe.PaymentIntent): number {
  const rawLeadPrice = paymentIntent.metadata?.leadPrice;
  if (!rawLeadPrice) return Number(paymentIntent.amount) / 100;

  const parsed = Number(rawLeadPrice);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return Number(paymentIntent.amount) / 100;
  }
  return parsed;
}

export async function reconcileJobAccessFromPaymentIntent(
  paymentIntent: Stripe.PaymentIntent
): Promise<ReconcileResult> {
  if (paymentIntent.status !== 'succeeded') {
    throw new AppError('Payment intent is not completed', 400);
  }

  if (paymentIntent.metadata?.type !== 'job_access_purchase') {
    throw new AppError('Payment intent is not a job access purchase', 400);
  }

  const jobId = paymentIntent.metadata?.jobId;
  const contractorId = paymentIntent.metadata?.contractorId;
  if (!jobId || !contractorId) {
    throw new AppError('Missing payment metadata for reconciliation', 400);
  }

  const leadPrice = getLeadPriceFromMetadata(paymentIntent);

  return prisma.$transaction(async (tx) => {
    const [job, contractor] = await Promise.all([
      tx.job.findUnique({
        where: { id: jobId },
        select: { id: true, title: true },
      }),
      tx.contractor.findUnique({
        where: { id: contractorId },
        include: { user: true },
      }),
    ]);

    if (!job) {
      throw new AppError('Job not found for reconciliation', 404);
    }
    if (!contractor) {
      throw new AppError('Contractor not found for reconciliation', 404);
    }

    let jobAccess = await tx.jobAccess.findUnique({
      where: { jobId_contractorId: { jobId, contractorId } },
    });
    let createdJobAccess = false;
    if (!jobAccess) {
      try {
        jobAccess = await tx.jobAccess.create({
          data: {
            contractorId,
            jobId,
            accessMethod: 'PAYMENT',
            paidAmount: leadPrice,
            creditUsed: false,
          },
        });
        createdJobAccess = true;
      } catch (error) {
        // Another process may have created access concurrently.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          jobAccess = await tx.jobAccess.findUnique({
            where: { jobId_contractorId: { jobId, contractorId } },
          });
        } else {
          throw error;
        }
      }
    }

    if (!jobAccess) {
      throw new AppError('Failed to reconcile job access', 500);
    }

    let payment = await tx.payment.findFirst({
      where: { stripePaymentId: paymentIntent.id },
    });
    let createdPayment = false;
    if (!payment) {
      payment = await tx.payment.create({
        data: {
          contractorId,
          jobId,
          jobAccessId: jobAccess.id,
          amount: Number(paymentIntent.amount) / 100,
          type: 'LEAD_ACCESS',
          status: 'COMPLETED',
          stripePaymentId: paymentIntent.id,
          description: `Job access purchased for: ${job.title}`,
        },
      });
      createdPayment = true;
    } else if (!payment.jobAccessId) {
      payment = await tx.payment.update({
        where: { id: payment.id },
        data: { jobAccessId: jobAccess.id, jobId },
      });
    }

    return {
      jobId,
      contractorId,
      jobAccessId: jobAccess.id,
      paymentId: payment.id,
      createdJobAccess,
      createdPayment,
    };
  });
}

export async function reconcileJobAccessPaymentIntentById(
  paymentIntentId: string
): Promise<ReconcileResult> {
  const stripe = getStripeInstance();
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return reconcileJobAccessFromPaymentIntent(paymentIntent);
}

