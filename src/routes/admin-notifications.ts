import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { adminProtect, requirePermission } from '../middleware/adminAuth';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedAdminRequest } from '../types/admin';
import { createBulkNotifications } from '../services/notificationService';
import { UserRole } from '@prisma/client';

const router = Router();

// @desc    Send bulk notification to users
// @route   POST /api/admin/notifications/bulk
// @access  Private (Admin only - requires notifications:write permission)
export const sendBulkNotification = catchAsync(
  async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      title,
      message,
      type,
      recipientType, // 'all', 'contractors', 'customers', 'specific'
      specificUserIds, // Array of user IDs for 'specific' type
      actionLink,
      actionText,
      expiresInDays, // Optional: number of days until notification expires
    } = req.body;

    // Validate required fields
    if (!title || !message) {
      throw new AppError('Title and message are required', 400);
    }

    if (!recipientType || !['all', 'contractors', 'customers', 'specific'].includes(recipientType)) {
      throw new AppError('Invalid recipient type. Must be: all, contractors, customers, or specific', 400);
    }

    if (recipientType === 'specific' && (!specificUserIds || !Array.isArray(specificUserIds) || specificUserIds.length === 0)) {
      throw new AppError('Specific user IDs are required when recipient type is "specific"', 400);
    }

    // Get recipient user IDs based on type
    let recipientUserIds: string[] = [];

    if (recipientType === 'all') {
      // Get all users
      const users = await prisma.user.findMany({
        where: {
          isActive: true,
          role: { in: ['CUSTOMER', 'CONTRACTOR'] },
        },
        select: { id: true },
      });
      recipientUserIds = users.map(u => u.id);
    } else if (recipientType === 'contractors') {
      // Get all contractor users
      const contractors = await prisma.contractor.findMany({
        where: {
          accountStatus: 'ACTIVE',
        },
        include: {
          user: {
            select: { id: true },
          },
        },
      });
      recipientUserIds = contractors.map(c => c.user.id);
    } else if (recipientType === 'customers') {
      // Get all customer users
      const customers = await prisma.customer.findMany({
        include: {
          user: {
            select: { id: true },
          },
        },
      });
      recipientUserIds = customers.map(c => c.user.id);
    } else if (recipientType === 'specific') {
      recipientUserIds = specificUserIds;
    }

    if (recipientUserIds.length === 0) {
      throw new AppError('No recipients found for the selected criteria', 400);
    }

    // Calculate expiration date if provided
    let expiresAt: Date | undefined;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    // Create notifications for all recipients
    const notifications = recipientUserIds.map(userId => ({
      userId,
      title,
      message,
      type: type || 'INFO',
      actionLink: actionLink || undefined,
      actionText: actionText || undefined,
      expiresAt,
    }));

    // Send bulk notifications
    await createBulkNotifications(notifications);

    // Log admin action
    await prisma.activityLog.create({
      data: {
        adminId: req.admin!.id,
        action: 'BULK_NOTIFICATION_SENT',
        entityType: 'Notification',
        description: `Sent bulk notification to ${recipientUserIds.length} ${recipientType} users: "${title}"`,
        diff: {
          recipientType,
          recipientCount: recipientUserIds.length,
          title,
          message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
        },
      },
    });

    res.status(200).json({
      status: 'success',
      message: `Notification sent to ${recipientUserIds.length} users`,
      data: {
        recipientCount: recipientUserIds.length,
        recipientType,
      },
    });
  }
);

// @desc    Get notification statistics
// @route   GET /api/admin/notifications/stats
// @access  Private (Admin only)
export const getNotificationStats = catchAsync(
  async (req: AuthenticatedAdminRequest, res: Response) => {
    const now = new Date();
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get notification statistics
    const [
      totalNotifications,
      readNotifications,
      unreadNotifications,
      recentNotifications,
      notificationsByType,
    ] = await Promise.all([
      prisma.notification.count(),
      prisma.notification.count({ where: { isRead: true } }),
      prisma.notification.count({ where: { isRead: false } }),
      prisma.notification.count({
        where: {
          createdAt: { gte: last30Days },
        },
      }),
      prisma.notification.groupBy({
        by: ['type'],
        _count: true,
        where: {
          createdAt: { gte: last30Days },
        },
      }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        total: totalNotifications,
        read: readNotifications,
        unread: unreadNotifications,
        last30Days: recentNotifications,
        readRate: totalNotifications > 0 ? ((readNotifications / totalNotifications) * 100).toFixed(2) : 0,
        byType: notificationsByType.map(item => ({
          type: item.type,
          count: item._count,
        })),
      },
    });
  }
);

// @desc    Get bulk notification history
// @route   GET /api/admin/notifications/history
// @access  Private (Admin only)
export const getBulkNotificationHistory = catchAsync(
  async (req: AuthenticatedAdminRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Get bulk notification activity logs
    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where: {
          action: 'BULK_NOTIFICATION_SENT',
        },
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.activityLog.count({
        where: {
          action: 'BULK_NOTIFICATION_SENT',
        },
      }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        logs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  }
);

// Register routes
router.post('/bulk', adminProtect, requirePermission('notifications:write'), sendBulkNotification);
router.get('/stats', adminProtect, requirePermission('notifications:read'), getNotificationStats);
router.get('/history', adminProtect, requirePermission('notifications:read'), getBulkNotificationHistory);

export default router;

