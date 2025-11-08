import express, { Response } from 'express';
import { protectAdmin, AdminAuthRequest } from '../middleware/adminAuth';
import { catchAsync } from '../middleware/errorHandler';
import * as notificationService from '../services/notificationService';
import { prisma } from '../config/database';

const router = express.Router();

/**
 * Get admin notifications
 * GET /api/admin/notifications
 */
router.get(
  '/',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    // Get the admin's user record
    const adminUser = await prisma.user.findUnique({
      where: { email: req.admin!.email },
      select: { id: true },
    });

    if (!adminUser) {
      return res.status(404).json({
        status: 'error',
        message: 'Admin user record not found',
      });
    }

    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const result = await notificationService.getUserNotifications(adminUser.id, {
      unreadOnly,
      limit,
      offset,
    });

    res.json({
      status: 'success',
      data: result,
    });
  })
);

/**
 * Get unread count
 * GET /api/admin/notifications/unread-count
 */
router.get(
  '/unread-count',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    // Get the admin's user record
    const adminUser = await prisma.user.findUnique({
      where: { email: req.admin!.email },
      select: { id: true },
    });

    if (!adminUser) {
      return res.status(404).json({
        status: 'error',
        message: 'Admin user record not found',
      });
    }

    const result = await notificationService.getUserNotifications(adminUser.id, {
      unreadOnly: true,
      limit: 0,
    });

    res.json({
      status: 'success',
      data: { count: result.unreadCount },
    });
  })
);

/**
 * Mark notification as read
 * PATCH /api/admin/notifications/:id/read
 */
router.patch(
  '/:id/read',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    // Get the admin's user record
    const adminUser = await prisma.user.findUnique({
      where: { email: req.admin!.email },
      select: { id: true },
    });

    if (!adminUser) {
      return res.status(404).json({
        status: 'error',
        message: 'Admin user record not found',
      });
    }

    await notificationService.markNotificationAsRead(req.params.id, adminUser.id);

    res.json({
      status: 'success',
      message: 'Notification marked as read',
    });
  })
);

/**
 * Mark all notifications as read
 * PATCH /api/admin/notifications/read-all
 */
router.patch(
  '/read-all',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    // Get the admin's user record
    const adminUser = await prisma.user.findUnique({
      where: { email: req.admin!.email },
      select: { id: true },
    });

    if (!adminUser) {
      return res.status(404).json({
        status: 'error',
        message: 'Admin user record not found',
      });
    }

    await notificationService.markAllNotificationsAsRead(adminUser.id);

    res.json({
      status: 'success',
      message: 'All notifications marked as read',
    });
  })
);

/**
 * Delete notification
 * DELETE /api/admin/notifications/:id
 */
router.delete(
  '/:id',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    // Get the admin's user record
    const adminUser = await prisma.user.findUnique({
      where: { email: req.admin!.email },
      select: { id: true },
    });

    if (!adminUser) {
      return res.status(404).json({
        status: 'error',
        message: 'Admin user record not found',
      });
    }

    await notificationService.deleteNotification(req.params.id, adminUser.id);

    res.json({
      status: 'success',
      message: 'Notification deleted',
    });
  })
);

export default router;

