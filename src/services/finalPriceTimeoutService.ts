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
