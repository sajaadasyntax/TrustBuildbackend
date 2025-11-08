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
    // Get or create the admin's user record
    let adminUser = await prisma.user.findUnique({
      where: { email: req.admin!.email },
      select: { id: true },
    });

    // If user record doesn't exist, create it
    if (!adminUser) {
      // Map AdminRole to UserRole
      const userRole = req.admin!.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
      
      adminUser = await prisma.user.create({
        data: {
          email: req.admin!.email,
          name: req.admin!.name,
          password: 'ADMIN_USER_NO_PASSWORD', // Placeholder - admins use Admin table for auth
          role: userRole,
          isActive: true,
        },
        select: { id: true },
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
    // Get or create the admin's user record
    let adminUser = await prisma.user.findUnique({
      where: { email: req.admin!.email },
      select: { id: true },
    });

    // If user record doesn't exist, create it
    if (!adminUser) {
      // Map AdminRole to UserRole
      const userRole = req.admin!.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
      
      adminUser = await prisma.user.create({
        data: {
          email: req.admin!.email,
          name: req.admin!.name,
          password: 'ADMIN_USER_NO_PASSWORD', // Placeholder - admins use Admin table for auth
          role: userRole,
          isActive: true,
        },
        select: { id: true },
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
    // Get or create the admin's user record
    let adminUser = await prisma.user.findUnique({
      where: { email: req.admin!.email },
      select: { id: true },
    });

    // If user record doesn't exist, create it
    if (!adminUser) {
      const userRole = req.admin!.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
      adminUser = await prisma.user.create({
        data: {
          email: req.admin!.email,
          name: req.admin!.name,
          password: 'ADMIN_USER_NO_PASSWORD',
          role: userRole,
          isActive: true,
        },
        select: { id: true },
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
    // Get or create the admin's user record
    let adminUser = await prisma.user.findUnique({
      where: { email: req.admin!.email },
      select: { id: true },
    });

    // If user record doesn't exist, create it
    if (!adminUser) {
      const userRole = req.admin!.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
      adminUser = await prisma.user.create({
        data: {
          email: req.admin!.email,
          name: req.admin!.name,
          password: 'ADMIN_USER_NO_PASSWORD',
          role: userRole,
          isActive: true,
        },
        select: { id: true },
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
    // Get or create the admin's user record
    let adminUser = await prisma.user.findUnique({
      where: { email: req.admin!.email },
      select: { id: true },
    });

    // If user record doesn't exist, create it
    if (!adminUser) {
      const userRole = req.admin!.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
      adminUser = await prisma.user.create({
        data: {
          email: req.admin!.email,
          name: req.admin!.name,
          password: 'ADMIN_USER_NO_PASSWORD',
          role: userRole,
          isActive: true,
        },
        select: { id: true },
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

