import { prisma } from '../config/database';
import { createEmailService } from './emailService';
import { 
  createCommissionDueNotification, 
  createAccountSuspendedNotification 
} from './notificationService';

// Send commission reminder email (Email sending is disabled)
async function sendCommissionReminder(recipientEmail: string, reminderData: {
  invoiceNumber: string;
  contractorName: string;
  jobTitle: string;
  totalAmount: number;
  dueDate: string;
  hoursRemaining: number;
  reminderNumber: number;
}): Promise<boolean> {
  // Email notifications disabled - commission reminders are now only accessible in-app
  const urgencyLevel = reminderData.hoursRemaining <= 12 ? 'FINAL' : 'URGENT';
  console.log(`✅ Email sending disabled - ${urgencyLevel} commission reminder #${reminderData.reminderNumber} for: ${recipientEmail}, invoice: ${reminderData.invoiceNumber}`);
  return true;
}

// Check for overdue commission payments and send reminders
export async function processCommissionReminders(): Promise<void> {
  console.log('🔄 Processing commission payment reminders...');
  
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
      console.log(`⏰ Commission ${commission.id} is overdue, suspending contractor ${commission.contractorId}`);
      
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
  
  console.log(`✅ Processed ${commissions.length} commission payments`);
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
