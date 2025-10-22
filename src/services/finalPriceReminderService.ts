import { prisma } from '../config/database';
import { createFinalPriceConfirmationReminderNotification } from './notificationService';
import { processCommissionForJob } from './commissionService';

/**
 * Process final price confirmation reminders
 * This should be run as a cron job every few hours
 */
export async function processFinalPriceReminders(): Promise<void> {

  
  const now = new Date();
  
  // Get all jobs awaiting final price confirmation
  const jobs = await prisma.job.findMany({
    where: {
      status: 'AWAITING_FINAL_PRICE_CONFIRMATION',
      finalPriceTimeoutAt: {
        not: null,
      },
    },
    include: {
      customer: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      wonByContractor: {
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

  for (const job of jobs) {
    if (!job.finalPriceTimeoutAt || !job.contractorProposedAmount) {
      continue;
    }

    const timeUntilTimeout = job.finalPriceTimeoutAt.getTime() - now.getTime();
    const hoursRemaining = Math.ceil(timeUntilTimeout / (1000 * 60 * 60));
    
    // Send reminders at 24h, 12h, 6h, 2h, and 1h before timeout
    const reminderHours = [24, 12, 6, 2, 1];
    
    for (const reminderHour of reminderHours) {
      if (hoursRemaining <= reminderHour && hoursRemaining > 0) {
        // Check if we've already sent a reminder for this hour
        const existingNotification = await prisma.notification.findFirst({
          where: {
            userId: job.customer.userId,
            type: 'FINAL_PRICE_CONFIRMATION_REMINDER',
            metadata: {
              path: ['jobId'],
              equals: job.id,
            },
            createdAt: {
              gte: new Date(now.getTime() - (reminderHour * 60 * 60 * 1000)),
            },
          },
        });

        if (!existingNotification) {
          try {
            await createFinalPriceConfirmationReminderNotification(
              job.customer.userId,
              job.id,
              job.title,
              Number(job.contractorProposedAmount),
              hoursRemaining
            );

          } catch (error) {
            console.error(`Failed to send final price reminder for job ${job.id}:`, error);
          }
        }
        break; // Only send one reminder per check
      }
    }
  }
  

}

/**
 * Process jobs that have timed out waiting for final price confirmation
 * This should be run as a cron job every hour
 */
export async function processFinalPriceTimeouts(): Promise<void> {

  
  const now = new Date();
  
  // Get all jobs that have timed out
  const timedOutJobs = await prisma.job.findMany({
    where: {
      status: 'AWAITING_FINAL_PRICE_CONFIRMATION',
      finalPriceTimeoutAt: {
        lte: now,
      },
    },
    include: {
      customer: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      wonByContractor: {
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

  for (const job of timedOutJobs) {
    if (!job.contractorProposedAmount) {
      continue;
    }

    // Auto-confirm the final price and mark job as completed
    await prisma.job.update({
      where: { id: job.id },
      data: {
        finalAmount: job.contractorProposedAmount,
        finalPriceConfirmedAt: now,
        status: 'COMPLETED',
        completionDate: now,
        customerConfirmed: true,
        adminOverrideAt: now,
        adminOverrideBy: 'system',
      },
    });

    // Process commission if applicable
    try {
      const { processCommissionForJob } = await import('./commissionService');
      await processCommissionForJob(job.id, Number(job.contractorProposedAmount));
    } catch (error) {
      console.error(`Failed to process commission for job ${job.id}:`, error);
    }

    // Send notifications about auto-confirmation
    try {
      const { createServiceEmail } = await import('./emailService');
      const emailService = (await import('./emailService')).createEmailService();
      
      // Email to customer
      const customerMailOptions = createServiceEmail({
        to: job.customer.user.email,
        subject: `Final Price Auto-Confirmed - Job: ${job.title}`,
        heading: 'Final Price Auto-Confirmed',
        body: `
          <p>Your job's final price has been automatically confirmed due to the 7-day response period expiring.</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Job Details</h3>
            <p><strong>Job Title:</strong> ${job.title}</p>
            <p><strong>Contractor:</strong> ${job.wonByContractor?.user?.name || 'Contractor'}</p>
            <p><strong>Confirmed Final Price:</strong> £${job.contractorProposedAmount.toFixed(2)}</p>
            <p><strong>Reason:</strong> No response received within 7 days</p>
          </div>

          <p>The job is now marked as completed.</p>
        `,
        ctaText: 'View Job Details',
        ctaUrl: `https://trustbuild.uk/dashboard/client/jobs/${job.id}`,
        footerText: 'This action was taken automatically due to the response timeout.'
      });

      // Email to contractor
      const contractorMailOptions = createServiceEmail({
        to: job.wonByContractor?.user?.email || 'contractor@example.com',
        subject: `Final Price Auto-Confirmed - Job: ${job.title}`,
        heading: 'Final Price Auto-Confirmed',
        body: `
          <p>Your final price proposal has been automatically confirmed due to the customer not responding within 7 days.</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Job Details</h3>
            <p><strong>Job Title:</strong> ${job.title}</p>
            <p><strong>Customer:</strong> ${job.customer.user.name}</p>
            <p><strong>Confirmed Final Price:</strong> £${job.contractorProposedAmount.toFixed(2)}</p>
            <p><strong>Reason:</strong> Customer did not respond within 7 days</p>
          </div>

          <p>The job is now marked as completed and you can request a review from the customer.</p>
        `,
        ctaText: 'View Job Details',
        ctaUrl: `https://trustbuild.uk/dashboard/contractor/jobs/${job.id}`,
        footerText: 'This action was taken automatically due to the response timeout.'
      });

      await Promise.all([
        emailService.sendMail(customerMailOptions),
        emailService.sendMail(contractorMailOptions)
      ]);
      

    } catch (error) {
      console.error(`Failed to send auto-confirmation notifications for job ${job.id}:`, error);
    }
  }
  

}
