import { PrismaClient, NotificationType } from '@prisma/client';
import webpush from 'web-push';

const prisma = new PrismaClient();

// Configure web-push (VAPID keys should be in environment variables)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

interface NotificationData {
  userId: string;
  title: string;
  message: string;
  type?: NotificationType;
  actionLink?: string;
  actionText?: string;
  metadata?: any;
  expiresAt?: Date;
}

interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: any;
}

/**
 * Create an in-app notification
 */
export async function createNotification(data: NotificationData) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type || 'INFO',
        actionLink: data.actionLink,
        actionText: data.actionText,
        metadata: data.metadata,
        expiresAt: data.expiresAt,
      },
    });

    // Also send push notification
    await sendPushNotification(data.userId, {
      title: data.title,
      body: data.message,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      data: {
        url: data.actionLink,
        notificationId: notification.id,
      },
    });

    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
}

/**
 * Create multiple notifications (bulk)
 */
export async function createBulkNotifications(notifications: NotificationData[]) {
  try {
    const created = await prisma.notification.createMany({
      data: notifications.map(notif => ({
        userId: notif.userId,
        title: notif.title,
        message: notif.message,
        type: notif.type || 'INFO',
        actionLink: notif.actionLink,
        actionText: notif.actionText,
        metadata: notif.metadata,
        expiresAt: notif.expiresAt,
      })),
    });

    // Send push notifications for all
    await Promise.all(
      notifications.map(notif =>
        sendPushNotification(notif.userId, {
          title: notif.title,
          body: notif.message,
          icon: '/icon-192.png',
          data: { url: notif.actionLink },
        }).catch(err => console.error('Push notification failed:', err))
      )
    );

    return created;
  } catch (error) {
    console.error('Error creating bulk notifications:', error);
    throw error;
  }
}

/**
 * Get notifications for a user
 */
export async function getUserNotifications(
  userId: string,
  options?: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  }
) {
  try {
    const where: any = { userId };

    if (options?.unreadOnly) {
      where.isRead = false;
    }

    // Don't show expired notifications
    where.OR = [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } }
    ];

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: options?.limit || 50,
        skip: options?.offset || 0,
      }),
      prisma.notification.count({
        where: {
          userId,
          isRead: false,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } }
          ],
        },
      }),
    ]);

    return { notifications, unreadCount };
  } catch (error) {
    console.error('Error getting user notifications:', error);
    throw error;
  }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(notificationId: string, userId: string) {
  try {
    return await prisma.notification.update({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(userId: string) {
  try {
    return await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
}

/**
 * Delete a notification
 */
export async function deleteNotification(notificationId: string, userId: string) {
  try {
    return await prisma.notification.delete({
      where: { id: notificationId, userId },
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
}

/**
 * Delete all notifications for a user
 */
export async function deleteAllNotifications(userId: string) {
  try {
    return await prisma.notification.deleteMany({
      where: { userId },
    });
  } catch (error) {
    console.error('Error deleting all notifications:', error);
    throw error;
  }
}

/**
 * Clean up expired notifications (run as cron job)
 */
export async function cleanupExpiredNotifications() {
  try {
    const result = await prisma.notification.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    console.log(`Cleaned up ${result.count} expired notifications`);
    return result;
  } catch (error) {
    console.error('Error cleaning up expired notifications:', error);
    throw error;
  }
}

// ==================== PUSH NOTIFICATIONS ====================

/**
 * Subscribe to push notifications
 */
export async function subscribeToPush(
  userId: string,
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  },
  deviceType?: string,
  userAgent?: string
) {
  try {
    return await prisma.pushSubscription.upsert({
      where: {
        userId_endpoint: {
          userId,
          endpoint: subscription.endpoint,
        },
      },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        deviceType,
        userAgent,
      },
      update: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        deviceType,
        userAgent,
      },
    });
  } catch (error) {
    console.error('Error subscribing to push:', error);
    throw error;
  }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(userId: string, endpoint: string) {
  try {
    return await prisma.pushSubscription.delete({
      where: {
        userId_endpoint: {
          userId,
          endpoint,
        },
      },
    });
  } catch (error) {
    console.error('Error unsubscribing from push:', error);
    throw error;
  }
}

/**
 * Send push notification to a user
 */
export async function sendPushNotification(userId: string, payload: PushNotificationPayload) {
  try {
    // Get all push subscriptions for this user
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (subscriptions.length === 0) {
      console.log(`No push subscriptions found for user ${userId}`);
      return;
    }

    // Send to all subscriptions
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            JSON.stringify(payload)
          );
          return { success: true, endpoint: sub.endpoint };
        } catch (error: any) {
          // If subscription is no longer valid, delete it
          if (error.statusCode === 410 || error.statusCode === 404) {
            await prisma.pushSubscription.delete({
              where: { id: sub.id },
            });
            console.log(`Deleted invalid push subscription: ${sub.endpoint}`);
          }
          throw error;
        }
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`Push notifications sent: ${successful} successful, ${failed} failed`);
  } catch (error) {
    console.error('Error sending push notification:', error);
    // Don't throw - push notifications are optional
  }
}

/**
 * Send push notification to multiple users
 */
export async function sendBulkPushNotifications(
  userIds: string[],
  payload: PushNotificationPayload
) {
  try {
    await Promise.all(
      userIds.map(userId => sendPushNotification(userId, payload).catch(err => 
        console.error(`Failed to send push to user ${userId}:`, err)
      ))
    );
  } catch (error) {
    console.error('Error sending bulk push notifications:', error);
  }
}

// ==================== NOTIFICATION HELPERS ====================

/**
 * Notify admin of new contractor registration
 */
export async function notifyAdminsNewContractor(contractorId: string, contractorName: string) {
  try {
    // Get all admin users
    const admins = await prisma.admin.findMany({
      select: { id: true },
    });

    // For now, we'll create notifications for admin IDs directly
    // In a real implementation, you might want to create a separate notification system for admins
    // or link admins to users
    console.log(`New contractor ${contractorName} registered. Notify admins:`, admins.map(a => a.id));
    
    // TODO: Implement admin notification system
    // This could be:
    // 1. Email notifications to admins
    // 2. A separate admin notification table
    // 3. Dashboard alerts
  } catch (error) {
    console.error('Error notifying admins of new contractor:', error);
  }
}

/**
 * Notify contractor of approval
 */
export async function notifyContractorApproval(userId: string, contractorName: string) {
  await createNotification({
    userId,
    title: 'Profile Approved! 🎉',
    message: 'Your contractor profile has been approved. You can now start bidding on jobs!',
    type: 'SUCCESS',
    actionLink: '/dashboard',
    actionText: 'View Dashboard',
  });
}

/**
 * Notify contractor of rejection
 */
export async function notifyContractorRejection(userId: string, reason?: string) {
  await createNotification({
    userId,
    title: 'Profile Update Required',
    message: reason || 'Your contractor profile requires additional information. Please review and resubmit.',
    type: 'WARNING',
    actionLink: '/profile',
    actionText: 'Update Profile',
  });
}

/**
 * Notify of payment received
 */
export async function notifyPaymentReceived(userId: string, amount: number, description: string) {
  await createNotification({
    userId,
    title: 'Payment Received',
    message: `You received £${amount.toFixed(2)} for ${description}`,
    type: 'SUCCESS',
    actionLink: '/dashboard/payments',
    actionText: 'View Payments',
  });
}

/**
 * Notify of dispute
 */
export async function notifyDispute(userId: string, jobId: string, jobTitle: string) {
  await createNotification({
    userId,
    title: 'Dispute Filed',
    message: `A dispute has been filed for job: ${jobTitle}`,
    type: 'WARNING',
    actionLink: `/dashboard/jobs/${jobId}`,
    actionText: 'View Job',
  });
}

/**
 * Notify of job status change
 */
export async function notifyJobStatusChange(
  userId: string,
  jobId: string,
  jobTitle: string,
  newStatus: string
) {
  await createNotification({
    userId,
    title: 'Job Status Updated',
    message: `Job "${jobTitle}" is now ${newStatus.toLowerCase()}`,
    type: 'INFO',
    actionLink: `/dashboard/jobs/${jobId}`,
    actionText: 'View Job',
  });
}

/**
 * Notify of new review
 */
export async function notifyNewReview(
  userId: string,
  rating: number,
  jobTitle: string
) {
  await createNotification({
    userId,
    title: 'New Review Received',
    message: `You received a ${rating}-star review for "${jobTitle}"`,
    type: 'SUCCESS',
    actionLink: '/dashboard/reviews',
    actionText: 'View Reviews',
  });
}

// Additional notification functions for existing code
export async function createContractorSelectedNotification(userId: string, jobTitle: string) {
  await createNotification({
    userId,
    title: 'Contractor Selected',
    message: `You have been selected for the job: ${jobTitle}`,
    type: 'SUCCESS',
    actionLink: '/dashboard/contractor/current-jobs',
    actionText: 'View Job',
  });
}

export async function createFinalPriceProposedNotification(userId: string, jobTitle: string, amount: number) {
  await createNotification({
    userId,
    title: 'Final Price Proposed',
    message: `A final price of £${amount} has been proposed for "${jobTitle}"`,
    type: 'INFO',
    actionLink: '/dashboard/client/current-jobs',
    actionText: 'Review Price',
  });
}

export async function createJobCompletedNotification(userId: string, jobTitle: string) {
  await createNotification({
    userId,
    title: 'Job Completed',
    message: `The job "${jobTitle}" has been marked as completed`,
    type: 'SUCCESS',
    actionLink: '/dashboard/job-history',
    actionText: 'View Job',
  });
}

export async function createJobStatusChangedNotification(userId: string, jobTitle: string, newStatus: string) {
  await createNotification({
    userId,
    title: 'Job Status Updated',
    message: `Job "${jobTitle}" status changed to ${newStatus}`,
    type: 'INFO',
    actionLink: '/dashboard/current-jobs',
    actionText: 'View Job',
  });
}

export async function createCommissionDueNotification(userId: string, amount: number) {
  await createNotification({
    userId,
    title: 'Commission Due',
    message: `You have a commission payment of £${amount} due`,
    type: 'COMMISSION_DUE',
    actionLink: '/dashboard/contractor/commissions',
    actionText: 'View Commissions',
  });
}

export async function createJobStartedNotification(userId: string, jobTitle: string) {
  await createNotification({
    userId,
    title: 'Job Started',
    message: `Work has begun on "${jobTitle}"`,
    type: 'INFO',
    actionLink: '/dashboard/current-jobs',
    actionText: 'View Job',
  });
}

export async function createReviewRequestNotification(userId: string, jobTitle: string) {
  await createNotification({
    userId,
    title: 'Review Request',
    message: `Please leave a review for "${jobTitle}"`,
    type: 'INFO',
    actionLink: '/dashboard/reviews',
    actionText: 'Leave Review',
  });
}

export async function createPaymentFailedNotification(userId: string, amount: number, reason?: string) {
  await createNotification({
    userId,
    title: 'Payment Failed',
    message: `Payment of £${amount} failed${reason ? `: ${reason}` : ''}`,
    type: 'ERROR',
    actionLink: '/dashboard/payments',
    actionText: 'Retry Payment',
  });
}

export async function createAccountSuspendedNotification(userId: string, reason?: string) {
  await createNotification({
    userId,
    title: 'Account Suspended',
    message: `Your account has been suspended${reason ? `: ${reason}` : ''}`,
    type: 'ERROR',
    actionLink: '/contact',
    actionText: 'Contact Support',
  });
}

export async function createFinalPriceConfirmationReminderNotification(userId: string, jobTitle: string) {
  await createNotification({
    userId,
    title: 'Final Price Confirmation Reminder',
    message: `Please confirm the final price for "${jobTitle}"`,
    type: 'WARNING',
    actionLink: '/dashboard/client/current-jobs',
    actionText: 'Confirm Price',
  });
}

export default {
  createNotification,
  createBulkNotifications,
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  deleteAllNotifications,
  cleanupExpiredNotifications,
  subscribeToPush,
  unsubscribeFromPush,
  sendPushNotification,
  sendBulkPushNotifications,
  notifyAdminsNewContractor,
  notifyContractorApproval,
  notifyContractorRejection,
  notifyPaymentReceived,
  notifyDispute,
  notifyJobStatusChange,
  notifyNewReview,
};
