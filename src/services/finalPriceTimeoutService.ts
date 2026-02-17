import { prisma } from '../config/database';
import { processCommissionForJob } from './commissionService';

// Service to handle final price confirmation timeouts
export const processFinalPriceTimeouts = async (): Promise<void> => {

  
  const now = new Date();
  
  // Get all jobs awaiting final price confirmation that have timed out
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
    try {

      
      // Auto-confirm the final price due to timeout
      const updatedJob = await prisma.job.update({
        where: { id: job.id },
        data: {
          finalAmount: Number(job.contractorProposedAmount),
          finalPriceConfirmedAt: new Date(),
          status: 'COMPLETED',
          completionDate: new Date(),
          customerConfirmed: true,
          adminOverrideAt: new Date(),
          adminOverrideBy: 'SYSTEM_TIMEOUT',
        },
      });

      // Process commission if applicable
      await processCommissionForJob(job.id, Number(job.contractorProposedAmount!));

      // Send timeout notification to both parties
      await sendTimeoutNotification(job);


    } catch (error) {
      console.error(`❌ Error processing timeout for job ${job.id}:`, error);
    }
  }


};

// Process completed jobs where customer has not confirmed completion within 7 days
// This ensures commissions are always created even if the customer doesn't respond
export const processCompletionConfirmationTimeouts = async (): Promise<void> => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Find jobs that are COMPLETED, have a finalAmount, but customer hasn't confirmed
  const unconfirmedJobs = await prisma.job.findMany({
    where: {
      status: 'COMPLETED',
      customerConfirmed: false,
      finalAmount: { not: null },
      completionDate: {
        lte: sevenDaysAgo, // Completed more than 7 days ago
      },
      commissionPaid: false, // Commission not yet processed
    },
    include: {
      customer: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      wonByContractor: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  console.log(`🔍 Found ${unconfirmedJobs.length} completed jobs awaiting customer confirmation (>7 days)`);

  for (const job of unconfirmedJobs) {
    try {
      const finalAmount = Number(job.finalAmount);
      if (finalAmount <= 0 || !job.wonByContractorId) continue;

      console.log(`⏰ Auto-confirming completion for job ${job.id}: ${job.title} (£${finalAmount})`);

      // Auto-confirm the completion
      await prisma.job.update({
        where: { id: job.id },
        data: {
          customerConfirmed: true,
          finalPriceConfirmedAt: new Date(),
          adminOverrideAt: new Date(),
          adminOverrideBy: 'SYSTEM_COMPLETION_TIMEOUT',
        },
      });

      // Process commission
      await processCommissionForJob(job.id, finalAmount);

      // Update contractor stats
      await prisma.contractor.update({
        where: { id: job.wonByContractorId },
        data: { jobsCompleted: { increment: 1 } },
      });

      // Notify both parties
      try {
        const { createNotification } = await import('./notificationService');
        
        // Notify customer
        if (job.customer?.user?.id) {
          await createNotification({
            userId: job.customer.user.id,
            title: 'Job Completion Auto-Confirmed',
            message: `Job "${job.title}" was auto-confirmed as complete after 7 days without response. Commission has been applied to the contractor.`,
            type: 'INFO',
            actionLink: `/dashboard/client/jobs/${job.id}`,
            actionText: 'View Job',
          });
        }

        // Notify contractor
        if (job.wonByContractor?.user?.id) {
          await createNotification({
            userId: job.wonByContractor.user.id,
            title: 'Job Completion Auto-Confirmed',
            message: `Job "${job.title}" has been auto-confirmed as complete. Commission invoice has been generated.`,
            type: 'SUCCESS',
            actionLink: `/dashboard/contractor/commissions`,
            actionText: 'View Commissions',
          });
        }
      } catch (notifError) {
        console.error(`Failed to send completion timeout notifications for job ${job.id}:`, notifError);
      }

      console.log(`✅ Auto-confirmed completion and processed commission for job ${job.id}`);
    } catch (error) {
      console.error(`❌ Error auto-confirming completion for job ${job.id}:`, error);
    }
  }
};

// Send timeout notification to both customer and contractor
async function sendTimeoutNotification(jobData: any) {
  try {
    const { createServiceEmail } = await import('./emailService');
    const emailService = (await import('./emailService')).createEmailService();
    
    // Email to customer
    const customerMailOptions = createServiceEmail({
      to: jobData.customer.user.email,
      subject: `Final Price Auto-Confirmed - Job: ${jobData.title}`,
      heading: 'Final Price Auto-Confirmed',
      body: `
        <p>Your final price has been automatically confirmed due to the 7-day response period expiring.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>Job Details</h3>
          <p><strong>Job Title:</strong> ${jobData.title}</p>
          <p><strong>Contractor:</strong> ${jobData.wonByContractor.user.name}</p>
          <p><strong>Confirmed Final Price:</strong> £${Number(jobData.contractorProposedAmount).toFixed(2)}</p>
          <p><strong>Reason:</strong> No response received within 7 days</p>
        </div>

        <p>The job is now marked as completed.</p>
      `,
      ctaText: 'View Job Details',
      ctaUrl: `https://trustbuild.uk/dashboard/client/jobs/${jobData.id}`,
      footerText: 'This action was taken automatically due to the response timeout.'
    });

    // Email to contractor
    const contractorMailOptions = createServiceEmail({
      to: jobData.wonByContractor.user.email,
      subject: `Final Price Auto-Confirmed - Job: ${jobData.title}`,
      heading: 'Final Price Auto-Confirmed',
      body: `
        <p>Your final price proposal has been automatically confirmed due to the customer not responding within 7 days.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>Job Details</h3>
          <p><strong>Job Title:</strong> ${jobData.title}</p>
          <p><strong>Customer:</strong> ${jobData.customer.user.name}</p>
          <p><strong>Confirmed Final Price:</strong> £${Number(jobData.contractorProposedAmount).toFixed(2)}</p>
          <p><strong>Reason:</strong> Customer did not respond within 7 days</p>
        </div>

        <p>The job is now marked as completed and you can request a review from the customer.</p>
      `,
      ctaText: 'View Job Details',
      ctaUrl: `https://trustbuild.uk/dashboard/contractor/jobs/${jobData.id}`,
      footerText: 'This action was taken automatically due to the response timeout.'
    });

    await Promise.all([
      emailService.sendMail(customerMailOptions),
      emailService.sendMail(contractorMailOptions)
    ]);
    

  } catch (error) {
    console.error('Failed to send timeout notifications:', error);
  }
}
