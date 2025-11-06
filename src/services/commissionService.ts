import { prisma } from '../config/database';
import { createEmailService } from './emailService';
import { 
  createCommissionDueNotification, 
  createAccountSuspendedNotification 
} from './notificationService';

// Process commission for a job
export async function processCommissionForJob(jobId: string, finalAmount: number) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      wonByContractor: {
        include: {
          subscription: true,
          user: true,
        }
      },
      jobAccess: true
    }
  });

  if (!job || !job.wonByContractor) {
    console.error(`❌ Job or contractor not found for commission processing: ${jobId}`);
    return;
  }

  // Filter jobAccess by contractorId after the job is fetched
  const relevantJobAccess = job.jobAccess.filter((access: any) => 
    access.contractorId === job.wonByContractorId
  );

  // Check if contractor accessed the job using credits or free trial point
  const accessedViaCredits = relevantJobAccess.length > 0 && relevantJobAccess[0].creditUsed === true;
  const accessedViaFreePoint = relevantJobAccess.length > 0 && relevantJobAccess[0].usedFreePoint === true;

  // Only charge commission if they used credits or free point and haven't paid commission yet
  // IMPORTANT: Commission applies even when using free trial point
  if ((accessedViaCredits || accessedViaFreePoint) && !job.commissionPaid) {
    // Get commission rate from settings
    const commissionRateSetting = await prisma.setting.findUnique({
      where: { key: 'COMMISSION_RATE' },
    });
    const commissionRatePercent = (commissionRateSetting?.value as any)?.rate || 5.0;
    const commissionAmount = (finalAmount * commissionRatePercent) / 100;
    const vatAmount = 0; // No additional VAT
    const totalAmount = commissionAmount;



    // Create commission payment record
    const commissionPayment = await prisma.commissionPayment.create({
      data: {
        jobId: job.id,
        contractorId: job.wonByContractorId!,
        customerId: job.customerId,
        finalJobAmount: finalAmount,
        commissionRate: commissionRatePercent,
        commissionAmount: commissionAmount,
        vatAmount: vatAmount,
        totalAmount: totalAmount,
        status: 'PENDING',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Due in 7 days
      },
    });

    // Create commission invoice
    const commissionInvoice = await prisma.commissionInvoice.create({
      data: {
        commissionPaymentId: commissionPayment.id,
        invoiceNumber: `COMM-${Date.now()}-${job.wonByContractorId!.slice(-6)}`,
        contractorName: job.wonByContractor.businessName || job.wonByContractor.user.name || 'Unknown Contractor',
        contractorEmail: job.wonByContractor.user.email || 'unknown@contractor.com',
        jobTitle: job.title,
        finalJobAmount: finalAmount,
        commissionAmount: commissionAmount,
        vatAmount: vatAmount,
        totalAmount: totalAmount,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Send commission invoice email
    try {
      const { sendCommissionInvoiceEmail } = await import('./emailNotificationService');
      await sendCommissionInvoiceEmail({
        invoiceNumber: commissionInvoice.invoiceNumber,
        contractorName: job.wonByContractor.businessName || job.wonByContractor.user.name || 'Unknown Contractor',
        contractorEmail: job.wonByContractor.user.email || 'unknown@contractor.com',
        jobTitle: job.title,
        finalJobAmount: finalAmount,
        commissionAmount: commissionAmount,
        commissionRate: commissionRatePercent,
        vatAmount: vatAmount,
        totalAmount: totalAmount,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

    } catch (emailError) {
      console.error('Failed to send commission invoice email:', emailError);
    }

    // Update job to mark commission as paid
    await prisma.job.update({
      where: { id: jobId },
      data: { commissionPaid: true }
    });


  } else {

  }
}

// Send commission reminder email
async function sendCommissionReminder(recipientEmail: string, reminderData: {
  invoiceNumber: string;
  contractorName: string;
  jobTitle: string;
  totalAmount: number;
  dueDate: string;
  hoursRemaining: number;
  reminderNumber: number;
}): Promise<boolean> {
  try {
    const { createServiceEmail } = await import('./emailService');
    const emailService = (await import('./emailService')).createEmailService();
    
    const urgencyLevel = reminderData.hoursRemaining <= 12 ? 'FINAL' : 'URGENT';
    const subject = `🚨 Commission Payment ${urgencyLevel} Reminder - Invoice ${reminderData.invoiceNumber}`;
    
    const mailOptions = createServiceEmail({
      to: recipientEmail,
      subject,
      heading: `Commission Payment ${urgencyLevel} Reminder`,
      body: `
        <p>This is a ${urgencyLevel.toLowerCase()} reminder about your outstanding commission payment.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>Payment Details</h3>
          <p><strong>Invoice Number:</strong> ${reminderData.invoiceNumber}</p>
          <p><strong>Job Title:</strong> ${reminderData.jobTitle}</p>
          <p><strong>Amount Due:</strong> £${reminderData.totalAmount.toFixed(2)}</p>
          <p><strong>Due Date:</strong> ${reminderData.dueDate}</p>
          <p><strong>Time Remaining:</strong> ${reminderData.hoursRemaining} hours</p>
        </div>

        ${reminderData.hoursRemaining <= 12 ? `
          <div style="background-color: #ffebee; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f44336;">
            <h4 style="color: #d32f2f; margin: 0 0 10px 0;">⚠️ URGENT: Payment Due Soon</h4>
            <p style="margin: 0; color: #d32f2f;">Your account will be suspended if payment is not received within ${reminderData.hoursRemaining} hours.</p>
          </div>
        ` : ''}

        <p>Please complete your payment to avoid account suspension and maintain your contractor status.</p>
      `,
      ctaText: 'Pay Now',
      ctaUrl: 'https://trustbuild.uk/dashboard/contractor/commissions',
      footerText: 'Please pay promptly to avoid account suspension.'
    });

    await emailService.sendMail(mailOptions);

    return true;
  } catch (error) {
    console.error(`Failed to send commission reminder email to ${recipientEmail}:`, error);
    return false;
  }
}

// Check for overdue commission payments and send reminders
export async function processCommissionReminders(): Promise<void> {

  
  const now = new Date();
  
  // Get all pending commission payments that are approaching due date or overdue
  const commissions = await prisma.commissionPayment.findMany({
    where: {
      status: 'PENDING',
      dueDate: {
        lte: new Date(now.getTime() + 48 * 60 * 60 * 1000), // Due within 48 hours
      },
    },
    include: {
      contractor: {
        include: {
          user: true,
        },
      },
      job: true,
      invoice: true,
    },
  });

  for (const commission of commissions) {
    const timeUntilDue = commission.dueDate.getTime() - now.getTime();
    const hoursUntilDue = Math.ceil(timeUntilDue / (1000 * 60 * 60));
    
    // If already overdue, suspend account and mark as overdue
    if (timeUntilDue <= 0) {

      
      await prisma.$transaction(async (tx) => {
        // Mark commission as overdue
        await tx.commissionPayment.update({
          where: { id: commission.id },
          data: { status: 'OVERDUE' },
        });
        
              // Suspend contractor account
      await tx.contractor.update({
        where: { id: commission.contractorId },
        data: { status: 'SUSPENDED' },
      });
      
      // Send account suspension notification
      await createAccountSuspendedNotification(
        commission.contractor.user.id,
        'Overdue commission payment',
        commission.id
      );
      });
      
      continue;
    }
    
    // Determine if we should send a reminder
    let shouldSendReminder = false;
    let reminderNumber = commission.remindersSent + 1;
    
    // Send reminders at: 36 hours, 24 hours, 12 hours, 6 hours, 2 hours before due
    const reminderTimes = [36, 24, 12, 6, 2];
    
    for (const reminderHour of reminderTimes) {
      if (hoursUntilDue <= reminderHour && commission.remindersSent < reminderTimes.indexOf(reminderHour) + 1) {
        shouldSendReminder = true;
        break;
      }
    }
    
    // Also send reminder if no reminder has been sent and due within 24 hours
    if (commission.remindersSent === 0 && hoursUntilDue <= 24) {
      shouldSendReminder = true;
    }
    
    if (shouldSendReminder && commission.contractor.user.email && commission.invoice) {
      const reminderSent = await sendCommissionReminder(commission.contractor.user.email, {
        invoiceNumber: commission.invoice.invoiceNumber,
        contractorName: commission.contractor.user.name,
        jobTitle: commission.job.title,
        totalAmount: commission.totalAmount.toNumber(),
        dueDate: commission.dueDate.toLocaleDateString('en-GB'),
        hoursRemaining: hoursUntilDue,
        reminderNumber: reminderNumber,
      });
      
          if (reminderSent) {
      // Update reminder count and last sent time
      await prisma.commissionPayment.update({
        where: { id: commission.id },
        data: {
          remindersSent: reminderNumber,
          lastReminderSent: now,
        },
      });
      
      // Also send in-app notification
      await createCommissionDueNotification(
        commission.contractor.user.id,
        commission.id,
        commission.job.title,
        commission.totalAmount.toNumber(),
        commission.dueDate
      );
    }
    }
  }
  

}

// Check subscription status and eligibility for commission
export async function checkSubscriptionCommissionEligibility(contractorId: string): Promise<boolean> {
  const contractor = await prisma.contractor.findUnique({
    where: { id: contractorId },
    include: {
      subscription: true,
    },
  });
  
  if (!contractor || !contractor.subscription) {
    return false; // No subscription = no commission
  }
  
  // Check if subscription is active and current
  const now = new Date();
  return (
    contractor.subscription.isActive &&
    contractor.subscription.status === 'active' &&
    now >= contractor.subscription.currentPeriodStart &&
    now <= contractor.subscription.currentPeriodEnd
  );
}

// Get subscription plan pricing
export function getSubscriptionPricing(plan: string): { monthly: number; total: number; savings?: number } {
  const basePriceMonthly = 49.99; // Base monthly price
  
  switch (plan) {
    case 'MONTHLY':
      return {
        monthly: basePriceMonthly,
        total: basePriceMonthly,
      };
    case 'SIX_MONTHS':
      const sixMonthTotal = basePriceMonthly * 6 * 0.9; // 10% discount
      return {
        monthly: sixMonthTotal / 6,
        total: sixMonthTotal,
        savings: (basePriceMonthly * 6) - sixMonthTotal,
      };
    case 'YEARLY':
      const yearlyTotal = basePriceMonthly * 12 * 0.8; // 20% discount
      return {
        monthly: yearlyTotal / 12,
        total: yearlyTotal,
        savings: (basePriceMonthly * 12) - yearlyTotal,
      };
    default:
      return {
        monthly: basePriceMonthly,
        total: basePriceMonthly,
      };
  }
}
