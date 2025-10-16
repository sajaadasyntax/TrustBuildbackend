import express, { Response } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import {
  protectAdmin,
  requirePermission,
  AdminAuthRequest,
} from '../middleware/adminAuth';
import { protect, restrictTo, AuthenticatedRequest } from '../middleware/auth';
import { getActivityLogs, getLoginActivities } from '../services/auditService';
import { prisma } from '../config/database';

const router = express.Router();

// Get activity logs with filters (SUPER_ADMIN only)
router.get(
  '/logs',
  protect,
  restrictTo('SUPER_ADMIN'),
  catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const {
      adminId,
      action,
      entityType,
      startDate,
      endDate,
      page = '1',
      limit = '50',
    } = req.query;

    const filters: any = {
      limit: parseInt(limit as string),
      offset: (parseInt(page as string) - 1) * parseInt(limit as string),
    };

    if (adminId) filters.adminId = adminId as string;
    if (action) filters.action = action as string;
    if (entityType) filters.entityType = entityType as string;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const result = await getActivityLogs(filters);

    res.status(200).json({
      status: 'success',
      data: result,
    });
  })
);

// Get login activities (SUPER_ADMIN only)
router.get(
  '/logins',
  protect,
  restrictTo('SUPER_ADMIN'),
  catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const {
      adminId,
      startDate,
      endDate,
      page = '1',
      limit = '50',
    } = req.query;

    const filters: any = {
      limit: parseInt(limit as string),
      offset: (parseInt(page as string) - 1) * parseInt(limit as string),
    };

    if (adminId) filters.adminId = adminId as string;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const result = await getLoginActivities(filters);

    res.status(200).json({
      status: 'success',
      data: result,
    });
  })
);

// Get activity statistics (SUPER_ADMIN only)
router.get(
  '/stats',
  protect,
  restrictTo('SUPER_ADMIN'),
  catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { startDate, endDate } = req.query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    // Get activity counts by action
    const activityByAction = await prisma.activityLog.groupBy({
      by: ['action'],
      where,
      _count: {
        action: true,
      },
      orderBy: {
        _count: {
          action: 'desc',
        },
      },
    });

    // Get activity counts by admin
    const activityByAdmin = await prisma.activityLog.groupBy({
      by: ['adminId'],
      where,
      _count: {
        adminId: true,
      },
      orderBy: {
        _count: {
          adminId: 'desc',
        },
      },
      take: 10,
    });

    // Get admin details for the top active admins
    const adminIds = activityByAdmin.map(item => item.adminId);
    const admins = await prisma.admin.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, email: true, name: true, role: true },
    });

    const activityByAdminWithDetails = activityByAdmin.map(item => ({
      admin: admins.find(a => a.id === item.adminId),
      count: item._count.adminId,
    }));

    // Get total counts
    const totalActivities = await prisma.activityLog.count({ where });
    const totalLogins = await prisma.loginActivity.count({
      where: {
        success: true,
        ...(where.createdAt && { createdAt: where.createdAt }),
      },
    });

    res.status(200).json({
      status: 'success',
      data: {
        totalActivities,
        totalLogins,
        activityByAction,
        activityByAdmin: activityByAdminWithDetails,
      },
    });
  })
);

export default router;

