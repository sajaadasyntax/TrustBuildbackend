import { prisma } from '../config/database';
import { NotificationType } from '@prisma/client';

/**
 * Create a notification for a user
 */
export async function createNotification({
  userId,
  title,
  message,
  type = 'INFO',
  actionLink,
  actionText,
  metadata,
  expiresAt,
}: {
  userId: string;
  title: string;
  message: string;
  type?: NotificationType;
  actionLink?: string;
  actionText?: string;
  metadata?: any;
  expiresAt?: Date;
}) {
  try {
    // Check user notification settings
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationSettings: true },
    });

    if (!user) {
      console.error(`Cannot create notification: User ${userId} not found`);
      return null;
    }

    // Parse notification settings
    const settings = typeof user.notificationSettings === 'string' 
      ? JSON.parse(user.notificationSettings) 
      : user.notificationSettings;

    // Check if in-app notifications are enabled
    if (!settings.inApp) {
      console.log(`In-app notifications disabled for user ${userId}`);
      return null;
    }

    // Check if specific notification type is enabled
    const typeMap: Record<NotificationType, string> = {
      COMMISSION_DUE: 'commission',
      COMMISSION_OVERDUE: 'commission',
      SUBSCRIPTION_EXPIRING: 'subscription',
      JOB_PURCHASED: 'jobs',
      REVIEW_RECEIVED: 'reviews',
      ACCOUNT_SUSPENDED: 'commission',
      JOB_STATUS_CHANGED: 'jobs',
      JOB_STARTED: 'jobs',
      JOB_COMPLETED: 'jobs',
      PAYMENT_FAILED: 'commission',
      ACCOUNT_HOLD: 'commission',
      MESSAGE_RECEIVED: 'inApp',
      CONTRACTOR_SELECTED: 'jobs',
      FINAL_PRICE_PROPOSED: 'jobs',
      FINAL_PRICE_CONFIRMATION_REMINDER: 'jobs',
      INFO: 'inApp',
      WARNING: 'inApp',
      SUCCESS: 'inApp',
      ERROR: 'inApp',
    };

    const settingKey = typeMap[type as NotificationType];
    if (settingKey && settings[settingKey] === false) {
      console.log(`Notification type ${type} disabled for user ${userId}`);
      return null;
    }

    // Create the notification
    return await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type: type as NotificationType,
        actionLink,
        actionText,
        metadata,
        expiresAt,
      },
    });
  } catch (error) {
    console.error('Failed to create notification:', error);
    return null;
  }
}

/**
 * Create a commission due notification
 */
export async function createCommissionDueNotification(
  userId: string,
  commissionId: string,
  jobTitle: string,
  amount: number,
  dueDate: Date
) {
  const hoursRemaining = Math.max(0, Math.floor((dueDate.getTime() - Date.now()) / (1000 * 60 * 60)));
  const isOverdue = hoursRemaining === 0;
  
  return createNotification({
    userId,
    title: isOverdue ? '🚨 Commission Payment Overdue' : `⚠️ Commission Payment Due in ${hoursRemaining} hours`,
    message: isOverdue 
      ? `Your commission payment of £${amount.toFixed(2)} for job "${jobTitle}" is now overdue. Your account may be suspended.` 
      : `Your commission payment of £${amount.toFixed(2)} for job "${jobTitle}" is due in ${hoursRemaining} hours.`,
    type: isOverdue ? 'COMMISSION_OVERDUE' : 'COMMISSION_DUE',
    actionLink: '/dashboard/commissions',
    actionText: 'Pay Now',
    metadata: {
      commissionId,
      jobTitle,
      amount,
      dueDate: dueDate.toISOString(),
      hoursRemaining,
    },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Expire in 7 days
  });
}

/**
 * Create a subscription expiring notification
 */
export async function createSubscriptionExpiringNotification(
  userId: string,
  subscriptionId: string,
  expiryDate: Date,
  plan: string
) {
  const daysRemaining = Math.max(0, Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  
  return createNotification({
    userId,
    title: `📅 Your ${plan} Subscription is Expiring Soon`,
    message: `Your TrustBuild subscription will expire in ${daysRemaining} days. Renew now to maintain your benefits.`,
    type: 'SUBSCRIPTION_EXPIRING',
    actionLink: '/dashboard/subscription',
    actionText: 'Renew Subscription',
    metadata: {
      subscriptionId,
      expiryDate: expiryDate.toISOString(),
      daysRemaining,
      plan,
    },
    expiresAt: expiryDate,
  });
}

/**
 * Create a job purchased notification
 */
export async function createJobPurchasedNotification(
  userId: string,
  jobId: string,
  jobTitle: string,
  contractorName: string
) {
  return createNotification({
    userId,
    title: '🎉 New Contractor Interest',
    message: `${contractorName} has purchased access to your job "${jobTitle}". They may contact you soon.`,
    type: 'JOB_PURCHASED',
    actionLink: `/dashboard/jobs/${jobId}`,
    actionText: 'View Job',
    metadata: {
      jobId,
      jobTitle,
      contractorName,
    },
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Expire in 30 days
  });
}

/**
 * Create a review received notification
 */
export async function createReviewReceivedNotification(
  userId: string,
  reviewId: string,
  jobTitle: string,
  rating: number,
  customerName: string
) {
  return createNotification({
    userId,
    title: '⭐ New Review Received',
    message: `${customerName} has left a ${rating}-star review for your job "${jobTitle}".`,
    type: 'REVIEW_RECEIVED',
    actionLink: `/dashboard/reviews`,
    actionText: 'View Review',
    metadata: {
      reviewId,
      jobTitle,
      rating,
      customerName,
    },
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Expire in 30 days
  });
}

/**
 * Create an account suspended notification
 */
export async function createAccountSuspendedNotification(
  userId: string,
  reason: string,
  commissionId?: string
) {
  return createNotification({
    userId,
    title: '🚫 Account Suspended',
    message: `Your account has been suspended. Reason: ${reason}`,
    type: 'ACCOUNT_SUSPENDED',
    actionLink: commissionId ? '/dashboard/commissions' : '/dashboard/account',
    actionText: commissionId ? 'Pay Outstanding Commission' : 'Contact Support',
    metadata: {
      reason,
      commissionId,
      suspendedAt: new Date().toISOString(),
    },
    // No expiry for suspension notifications
  });
}

/**
 * Mark a notification as read
 */
export async function markNotificationAsRead(id: string, userId: string) {
  try {
    return await prisma.notification.updateMany({
      where: {
        id,
        userId,
      },
      data: {
        isRead: true,
      },
    });
  } catch (error) {
    console.error('Failed to mark notification as read:', error);
    return null;
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(userId: string) {
  try {
    return await prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });
  } catch (error) {
    console.error('Failed to mark all notifications as read:', error);
    return null;
  }
}

/**
 * Delete expired notifications
 */
export async function deleteExpiredNotifications() {
  try {
    const now = new Date();
    return await prisma.notification.deleteMany({
      where: {
        expiresAt: {
          lt: now,
        },
      },
    });
  } catch (error) {
    console.error('Failed to delete expired notifications:', error);
    return null;
  }
}

/**
 * Create a review request notification
 */
export async function createReviewRequestNotification(
  userId: string,
  jobId: string,
  jobTitle: string,
  contractorName: string
) {
  return createNotification({
    userId,
    title: '✍️ Review Request',
    message: `${contractorName} has requested a review for your job "${jobTitle}". Please share your experience.`,
    type: 'REVIEW_RECEIVED',
    actionLink: `/dashboard/client/jobs/${jobId}`,
    actionText: 'Leave a Review',
    metadata: {
      jobId,
      jobTitle,
      contractorName,
      requestedAt: new Date().toISOString(),
    },
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // Expire in 14 days
  });
}

/**
 * Create a job status changed notification
 */
export async function createJobStatusChangedNotification(
  userId: string,
  jobId: string,
  jobTitle: string,
  oldStatus: string,
  newStatus: string,
  isCustomer: boolean = false
) {
  const message = isCustomer 
    ? `Your job "${jobTitle}" status changed from ${oldStatus} to ${newStatus}.`
    : `Job "${jobTitle}" status changed from ${oldStatus} to ${newStatus}.`;

  return createNotification({
    userId,
    title: `📋 Job Status Updated`,
    message,
    type: 'JOB_STATUS_CHANGED',
    actionLink: `/dashboard/${isCustomer ? 'client' : 'contractor'}/jobs/${jobId}`,
    actionText: 'View Job',
    metadata: {
      jobId,
      jobTitle,
      oldStatus,
      newStatus,
      isCustomer,
    },
  });
}

/**
 * Create a job started notification
 */
export async function createJobStartedNotification(
  userId: string,
  jobId: string,
  jobTitle: string,
  contractorName: string,
  isCustomer: boolean = false
) {
  const message = isCustomer
    ? `Work has started on your job "${jobTitle}" by ${contractorName}.`
    : `You can now start working on job "${jobTitle}".`;

  return createNotification({
    userId,
    title: `🚀 Job Started`,
    message,
    type: 'JOB_STARTED',
    actionLink: `/dashboard/${isCustomer ? 'client' : 'contractor'}/jobs/${jobId}`,
    actionText: 'View Job',
    metadata: {
      jobId,
      jobTitle,
      contractorName,
      isCustomer,
    },
  });
}

/**
 * Create a job completed notification
 */
export async function createJobCompletedNotification(
  userId: string,
  jobId: string,
  jobTitle: string,
  finalAmount: number,
  isCustomer: boolean = false
) {
  const message = isCustomer
    ? `Your job "${jobTitle}" has been completed. Final amount: £${finalAmount.toFixed(2)}`
    : `Job "${jobTitle}" has been completed. Final amount: £${finalAmount.toFixed(2)}`;

  return createNotification({
    userId,
    title: `✅ Job Completed`,
    message,
    type: 'JOB_COMPLETED',
    actionLink: `/dashboard/${isCustomer ? 'client' : 'contractor'}/jobs/${jobId}`,
    actionText: 'View Job',
    metadata: {
      jobId,
      jobTitle,
      finalAmount,
      isCustomer,
    },
  });
}

/**
 * Create a payment failed notification
 */
export async function createPaymentFailedNotification(
  userId: string,
  paymentId: string,
  amount: number,
  reason: string,
  retryUrl?: string
) {
  return createNotification({
    userId,
    title: `💳 Payment Failed`,
    message: `Your payment of £${amount.toFixed(2)} failed. Reason: ${reason}`,
    type: 'PAYMENT_FAILED',
    actionLink: retryUrl || '/dashboard/payments',
    actionText: 'Retry Payment',
    metadata: {
      paymentId,
      amount,
      reason,
      retryUrl,
    },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Expire in 7 days
  });
}

/**
 * Create an account hold notification
 */
export async function createAccountHoldNotification(
  userId: string,
  reason: string,
  holdUntil?: Date
) {
  const message = holdUntil 
    ? `Your account is on hold until ${holdUntil.toLocaleDateString()}. Reason: ${reason}`
    : `Your account is on hold. Reason: ${reason}`;

  return createNotification({
    userId,
    title: `🚫 Account On Hold`,
    message,
    type: 'ACCOUNT_HOLD',
    actionLink: '/dashboard/support',
    actionText: 'Contact Support',
    metadata: {
      reason,
      holdUntil: holdUntil?.toISOString(),
    },
  });
}

/**
 * Create a contractor selected notification
 */
export async function createContractorSelectedNotification(
  customerId: string,
  contractorId: string,
  jobId: string,
  jobTitle: string,
  contractorName: string
) {
  return createNotification({
    userId: customerId,
    title: `👷 Contractor Selected`,
    message: `You have selected ${contractorName} for your job "${jobTitle}".`,
    type: 'CONTRACTOR_SELECTED',
    actionLink: `/dashboard/client/jobs/${jobId}`,
    actionText: 'View Job',
    metadata: {
      jobId,
      jobTitle,
      contractorId,
      contractorName,
    },
  });
}

/**
 * Create a final price proposed notification
 */
export async function createFinalPriceProposedNotification(
  userId: string,
  jobId: string,
  jobTitle: string,
  proposedAmount: number,
  contractorName: string,
  isCustomer: boolean = false
) {
  const message = isCustomer
    ? `${contractorName} has proposed a final price of £${proposedAmount.toFixed(2)} for your job "${jobTitle}".`
    : `You have proposed a final price of £${proposedAmount.toFixed(2)} for job "${jobTitle}".`;

  return createNotification({
    userId,
    title: `💰 Final Price Proposed`,
    message,
    type: 'FINAL_PRICE_PROPOSED',
    actionLink: `/dashboard/${isCustomer ? 'client' : 'contractor'}/jobs/${jobId}`,
    actionText: 'Review Price',
    metadata: {
      jobId,
      jobTitle,
      proposedAmount,
      contractorName,
      isCustomer,
    },
  });
}

/**
 * Create a final price confirmation reminder notification
 */
export async function createFinalPriceConfirmationReminderNotification(
  userId: string,
  jobId: string,
  jobTitle: string,
  proposedAmount: number,
  hoursRemaining: number
) {
  return createNotification({
    userId,
    title: `⏰ Final Price Confirmation Reminder`,
    message: `You have ${hoursRemaining} hours to confirm the final price of £${proposedAmount.toFixed(2)} for job "${jobTitle}".`,
    type: 'FINAL_PRICE_CONFIRMATION_REMINDER',
    actionLink: `/dashboard/client/jobs/${jobId}`,
    actionText: 'Confirm Price',
    metadata: {
      jobId,
      jobTitle,
      proposedAmount,
      hoursRemaining,
    },
  });
}

/**
 * Create a message received notification (for future chat system)
 */
export async function createMessageReceivedNotification(
  userId: string,
  senderName: string,
  jobId: string,
  jobTitle: string,
  messagePreview: string
) {
  return createNotification({
    userId,
    title: `💬 New Message from ${senderName}`,
    message: `"${messagePreview}" - Job: ${jobTitle}`,
    type: 'MESSAGE_RECEIVED',
    actionLink: `/dashboard/jobs/${jobId}/messages`,
    actionText: 'View Message',
    metadata: {
      senderName,
      jobId,
      jobTitle,
      messagePreview,
    },
  });
}