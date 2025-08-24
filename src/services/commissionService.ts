import { prisma } from '../config/database';
import nodemailer from 'nodemailer';
import { 
  createCommissionDueNotification, 
  createAccountSuspendedNotification 
} from './notificationService';

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
    // Fix for connection timeout issues
    connectionTimeout: 10000, // 10 seconds
    socketTimeout: 20000, // 20 seconds
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  });
};

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
    const transporter = getEmailTransporter();
    
    const urgencyLevel = reminderData.hoursRemaining <= 12 ? 'FINAL' : 'URGENT';
    const headerColor = urgencyLevel === 'FINAL' ? '#dc2626' : '#f59e0b';
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@trustbuild.uk',
      to: recipientEmail,
      subject: `${urgencyLevel} REMINDER: Commission Payment Due in ${reminderData.hoursRemaining} Hours - ${reminderData.invoiceNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .header { background-color: ${headerColor}; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .reminder-details { background-color: #fef2f2; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid ${headerColor}; }
            .footer { background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; }
            .urgent { font-weight: bold; color: ${headerColor}; }
            .countdown { font-size: 1.3em; font-weight: bold; color: ${headerColor}; text-align: center; padding: 15px; background-color: #fef2f2; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>🚨 ${urgencyLevel} REMINDER - Commission Payment Due</h1>
          </div>
          
          <div class="content">
            <p>Dear ${reminderData.contractorName},</p>
            
            <div class="countdown">
              ⏰ ONLY ${reminderData.hoursRemaining} HOURS REMAINING
            </div>
            
            <p>This is reminder #${reminderData.reminderNumber} for your <span class="urgent">OVERDUE commission payment</span>.</p>
            
            <div class="reminder-details">
              <h3>Payment Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td><strong>Invoice Number:</strong></td><td>${reminderData.invoiceNumber}</td></tr>
                <tr><td><strong>Job Title:</strong></td><td>${reminderData.jobTitle}</td></tr>
                <tr><td><strong>Amount Due:</strong></td><td class="urgent">£${reminderData.totalAmount.toFixed(2)}</td></tr>
                <tr><td><strong>Due Date:</strong></td><td class="urgent">${reminderData.dueDate}</td></tr>
              </table>
            </div>
            
            ${urgencyLevel === 'FINAL' ? `
              <div style="background-color: #fef2f2; padding: 15px; border-radius: 5px; margin: 20px 0; border: 2px solid #dc2626;">
                <h3 style="color: #dc2626;">🚨 FINAL WARNING - Account Suspension Imminent</h3>
                <p><strong>Your account will be automatically suspended in ${reminderData.hoursRemaining} hours if payment is not received.</strong></p>
                <p>Once suspended, you will lose access to:</p>
                <ul>
                  <li>❌ All job opportunities</li>
                  <li>❌ Customer contact details</li>
                  <li>❌ Platform features</li>
                  <li>❌ Your contractor profile visibility</li>
                </ul>
              </div>
            ` : `
              <div style="background-color: #fef3c7; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3>⚠️ Account Suspension Warning</h3>
                <p>If payment is not received by ${reminderData.dueDate}, your account will be suspended.</p>
              </div>
            `}
            
            <div style="background-color: #eff6ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3>💳 Pay Now - It Takes Less Than 2 Minutes</h3>
              <ol>
                <li>Click: <a href="https://trustbuild.uk/dashboard/commissions" style="color: #2563eb; font-weight: bold;">Pay Commission Now</a></li>
                <li>Select the invoice: ${reminderData.invoiceNumber}</li>
                <li>Pay with any card, Apple Pay, or Google Pay</li>
                <li>Get instant confirmation</li>
              </ol>
            </div>
            
            <p><strong>PAY IMMEDIATELY to avoid account suspension and maintain your contractor status.</strong></p>
            
            <p>TrustBuild Support Team</p>
          </div>
          
          <div class="footer">
            <p>TrustBuild - Professional Contractor Platform</p>
            <p>Pay now: <a href="https://trustbuild.uk/dashboard/commissions">https://trustbuild.uk/dashboard/commissions</a></p>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Commission reminder #${reminderData.reminderNumber} sent to: ${recipientEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send commission reminder:', error);
    return false;
  }
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
