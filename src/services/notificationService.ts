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