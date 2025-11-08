import { prisma } from '../config/database';
import { createNotification, createBulkNotifications } from './notificationService';
import { NotificationType } from '@prisma/client';

/**
 * Get all admin user IDs (users with ADMIN or SUPER_ADMIN role)
 * This finds User records that correspond to Admin accounts, creating them if they don't exist
 */
async function getAdminUserIds(): Promise<string[]> {
  // First, get all active admins
  const admins = await prisma.admin.findMany({
    where: {
      isActive: true,
    },
    select: { email: true, name: true, role: true },
  });

  if (admins.length === 0) {
    return [];
  }

  // Get or create User records for each admin
  const adminUserIds: string[] = [];
  
  for (const admin of admins) {
    // Try to find existing User record
    let adminUser = await prisma.user.findUnique({
      where: { email: admin.email },
      select: { id: true },
    });

    // If user record doesn't exist, create it
    if (!adminUser) {
      // Map AdminRole to UserRole
      const userRole = admin.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
      
      adminUser = await prisma.user.create({
        data: {
          email: admin.email,
          name: admin.name,
          password: 'ADMIN_USER_NO_PASSWORD', // Placeholder - admins use Admin table for auth
          role: userRole,
          isActive: true,
        },
        select: { id: true },
      });
    }

    adminUserIds.push(adminUser.id);
  }

  return adminUserIds;
}

/**
 * Notify all admins about an action
 */
export async function notifyAllAdmins(data: {
  title: string;
  message: string;
  type?: NotificationType;
  actionLink?: string;
  actionText?: string;
  metadata?: any;
}) {
  try {
    const adminUserIds = await getAdminUserIds();
    if (adminUserIds.length === 0) {
      console.warn('No active admin users found to notify');
      return;
    }

    const notifications = adminUserIds.map(userId => ({
      userId,
      title: data.title,
      message: data.message,
      type: data.type || 'INFO',
      actionLink: data.actionLink,
      actionText: data.actionText,
      metadata: {
        ...data.metadata,
        adminNotification: true,
      },
    }));

    await createBulkNotifications(notifications);
  } catch (error) {
    console.error('Error notifying admins:', error);
    // Don't throw - notification failures shouldn't break the main operation
  }
}

/**
 * Notify admins about new contractor registration
 */
export async function notifyAdminsNewContractor(contractorId: string, contractorName: string) {
  await notifyAllAdmins({
    title: 'New Contractor Registration',
    message: `${contractorName} has registered and is awaiting approval`,
    type: 'INFO',
    actionLink: `/admin/contractors/${contractorId}`,
    actionText: 'Review Contractor',
    metadata: {
      contractorId,
      contractorName,
      action: 'CONTRACTOR_REGISTERED',
    },
  });
}

/**
 * Notify admins about contractor approval/rejection
 */
export async function notifyAdminsContractorDecision(
  contractorId: string,
  contractorName: string,
  approved: boolean,
  adminName: string
) {
  await notifyAllAdmins({
    title: `Contractor ${approved ? 'Approved' : 'Rejected'}`,
    message: `${adminName} ${approved ? 'approved' : 'rejected'} contractor ${contractorName}`,
    type: approved ? 'SUCCESS' : 'WARNING',
    actionLink: `/admin/contractors/${contractorId}`,
    actionText: 'View Contractor',
    metadata: {
      contractorId,
      contractorName,
      approved,
      action: approved ? 'CONTRACTOR_APPROVED' : 'CONTRACTOR_REJECTED',
    },
  });
}

/**
 * Notify admins about new KYC submission
 */
export async function notifyAdminsNewKYC(kycId: string, userName: string, userId: string) {
  await notifyAllAdmins({
    title: 'New KYC Submission',
    message: `${userName} has submitted KYC documents for verification`,
    type: 'INFO',
    actionLink: `/admin/kyc?kycId=${kycId}`,
    actionText: 'Review KYC',
    metadata: {
      kycId,
      userId,
      userName,
      action: 'KYC_SUBMITTED',
    },
  });
}

/**
 * Notify admins about KYC decision
 */
export async function notifyAdminsKYCDecision(
  kycId: string,
  userName: string,
  approved: boolean,
  adminName: string
) {
  await notifyAllAdmins({
    title: `KYC ${approved ? 'Approved' : 'Rejected'}`,
    message: `${adminName} ${approved ? 'approved' : 'rejected'} KYC verification for ${userName}`,
    type: approved ? 'SUCCESS' : 'WARNING',
    actionLink: `/admin/kyc?kycId=${kycId}`,
    actionText: 'View KYC',
    metadata: {
      kycId,
      userName,
      approved,
      action: 'KYC_DECISION',
    },
  });
}

/**
 * Notify admins about new support ticket
 */
export async function notifyAdminsNewSupportTicket(
  ticketId: string,
  subject: string,
  userName: string,
  priority: string
) {
  await notifyAllAdmins({
    title: 'New Support Ticket',
    message: `${userName} created a support ticket: ${subject}`,
    type: priority === 'URGENT' ? 'ERROR' : priority === 'HIGH' ? 'WARNING' : 'INFO',
    actionLink: `/admin/support?ticketId=${ticketId}`,
    actionText: 'View Ticket',
    metadata: {
      ticketId,
      subject,
      userName,
      priority,
      action: 'SUPPORT_TICKET_CREATE',
    },
  });
}

/**
 * Notify admins about support ticket update
 */
export async function notifyAdminsSupportTicketUpdate(
  ticketId: string,
  subject: string,
  status: string,
  adminName: string
) {
  await notifyAllAdmins({
    title: 'Support Ticket Updated',
    message: `${adminName} updated ticket "${subject}" to ${status}`,
    type: 'INFO',
    actionLink: `/admin/support?ticketId=${ticketId}`,
    actionText: 'View Ticket',
    metadata: {
      ticketId,
      subject,
      status,
      action: 'SUPPORT_TICKET_STATUS_UPDATE',
    },
  });
}

/**
 * Notify admins about new dispute
 */
export async function notifyAdminsNewDispute(
  disputeId: string,
  jobId: string,
  jobTitle: string,
  userName: string
) {
  await notifyAllAdmins({
    title: 'New Dispute Filed',
    message: `${userName} filed a dispute for job: ${jobTitle}`,
    type: 'WARNING',
    actionLink: `/admin/disputes?disputeId=${disputeId}`,
    actionText: 'View Dispute',
    metadata: {
      disputeId,
      jobId,
      jobTitle,
      userName,
      action: 'DISPUTE_CREATED',
    },
  });
}

/**
 * Notify admins about dispute resolution
 */
export async function notifyAdminsDisputeResolved(
  disputeId: string,
  jobTitle: string,
  adminName: string
) {
  await notifyAllAdmins({
    title: 'Dispute Resolved',
    message: `${adminName} resolved dispute for job: ${jobTitle}`,
    type: 'SUCCESS',
    actionLink: `/admin/disputes?disputeId=${disputeId}`,
    actionText: 'View Dispute',
    metadata: {
      disputeId,
      jobTitle,
      action: 'DISPUTE_RESOLVED',
    },
  });
}

/**
 * Notify admins about manual invoice creation
 */
export async function notifyAdminsManualInvoiceCreated(
  invoiceId: string,
  contractorName: string,
  amount: number,
  adminName: string
) {
  await notifyAllAdmins({
    title: 'Manual Invoice Created',
    message: `${adminName} created a manual invoice for ${contractorName} (${(amount / 100).toFixed(2)} GBP)`,
    type: 'INFO',
    actionLink: `/admin/invoices/${invoiceId}`,
    actionText: 'View Invoice',
    metadata: {
      invoiceId,
      contractorName,
      amount,
      action: 'MANUAL_INVOICE_CREATE',
    },
  });
}

/**
 * Notify admins about payment failure
 */
export async function notifyAdminsPaymentFailure(
  paymentId: string,
  userId: string,
  userName: string,
  amount: number,
  reason?: string
) {
  await notifyAllAdmins({
    title: 'Payment Failed',
    message: `Payment of ${(amount / 100).toFixed(2)} GBP failed for ${userName}${reason ? `: ${reason}` : ''}`,
    type: 'ERROR',
    actionLink: `/admin/payments?paymentId=${paymentId}`,
    actionText: 'View Payment',
    metadata: {
      paymentId,
      userId,
      userName,
      amount,
      reason,
      action: 'PAYMENT_FAILED',
    },
  });
}

/**
 * Notify admins about job status change
 */
export async function notifyAdminsJobStatusChange(
  jobId: string,
  jobTitle: string,
  oldStatus: string,
  newStatus: string,
  adminName?: string
) {
  const message = adminName
    ? `${adminName} changed job "${jobTitle}" from ${oldStatus} to ${newStatus}`
    : `Job "${jobTitle}" status changed from ${oldStatus} to ${newStatus}`;

  await notifyAllAdmins({
    title: 'Job Status Changed',
    message,
    type: newStatus === 'DISPUTED' ? 'WARNING' : 'INFO',
    actionLink: `/admin/jobs/${jobId}`,
    actionText: 'View Job',
    metadata: {
      jobId,
      jobTitle,
      oldStatus,
      newStatus,
      action: 'JOB_STATUS_CHANGE',
    },
  });
}

/**
 * Notify admins about flagged content
 */
export async function notifyAdminsFlaggedContent(
  contentType: string,
  contentId: string,
  contentTitle: string,
  userName: string
) {
  await notifyAllAdmins({
    title: 'Content Flagged',
    message: `${userName} flagged ${contentType}: ${contentTitle}`,
    type: 'WARNING',
    actionLink: `/admin/content?type=${contentType}&id=${contentId}`,
    actionText: 'Review Content',
    metadata: {
      contentType,
      contentId,
      contentTitle,
      userName,
      action: 'CONTENT_FLAGGED',
    },
  });
}

/**
 * Notify admins about settings change
 */
export async function notifyAdminsSettingsChange(
  settingKey: string,
  oldValue: any,
  newValue: any,
  adminName: string
) {
  await notifyAllAdmins({
    title: 'System Settings Updated',
    message: `${adminName} updated setting "${settingKey}"`,
    type: 'INFO',
    actionLink: `/admin/settings`,
    actionText: 'View Settings',
    metadata: {
      settingKey,
      oldValue,
      newValue,
      action: 'SETTINGS_UPDATE',
    },
  });
}

/**
 * Notify admins about commission rate change
 */
export async function notifyAdminsCommissionRateChange(
  oldRate: number,
  newRate: number,
  adminName: string
) {
  await notifyAllAdmins({
    title: 'Commission Rate Changed',
    message: `${adminName} changed commission rate from ${oldRate}% to ${newRate}%`,
    type: 'WARNING',
    actionLink: `/admin/payments?tab=settings`,
    actionText: 'View Settings',
    metadata: {
      oldRate,
      newRate,
      action: 'COMMISSION_RATE_CHANGE',
    },
  });
}

/**
 * Notify admins about user account action
 */
export async function notifyAdminsUserAction(
  userId: string,
  userName: string,
  action: string,
  adminName: string,
  details?: string
) {
  await notifyAllAdmins({
    title: `User Account ${action}`,
    message: `${adminName} ${action.toLowerCase()} user account: ${userName}${details ? ` (${details})` : ''}`,
    type: action.includes('SUSPEND') || action.includes('DELETE') ? 'WARNING' : 'INFO',
    actionLink: `/admin/users/${userId}`,
    actionText: 'View User',
    metadata: {
      userId,
      userName,
      action,
      details,
    },
  });
}

