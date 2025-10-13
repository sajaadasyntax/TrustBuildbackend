import express, { Response } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import {
  protectAdmin,
  requirePermission,
  getClientIp,
  getClientUserAgent,
  AdminAuthRequest,
} from '../middleware/adminAuth';
import { logActivity } from '../services/auditService';
import { prisma } from '../config/database';

const router = express.Router();

// Get all settings
router.get(
  '/',
  protectAdmin,
  requirePermission('settings:read'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const settings = await prisma.setting.findMany({
      orderBy: { key: 'asc' },
    });

    res.status(200).json({
      status: 'success',
      data: { settings },
    });
  })
);

// Get specific setting by key
router.get(
  '/:key',
  protectAdmin,
  requirePermission('settings:read'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { key } = req.params;

    const setting = await prisma.setting.findUnique({
      where: { key: key.toUpperCase() },
    });

    if (!setting) {
      return res.status(404).json({
        status: 'error',
        message: 'Setting not found',
      });
    }

    res.status(200).json({
      status: 'success',
      data: { setting },
    });
  })
);

// Update setting
router.put(
  '/:key',
  protectAdmin,
  requirePermission('settings:update_commission', 'settings:update_pricing'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { key } = req.params;
    const { value } = req.body;

    if (!value) {
      return res.status(400).json({
        status: 'error',
        message: 'Value is required',
      });
    }

    // Get old value for audit log
    const oldSetting = await prisma.setting.findUnique({
      where: { key: key.toUpperCase() },
    });

    const setting = await prisma.setting.upsert({
      where: { key: key.toUpperCase() },
      update: {
        value,
        updatedBy: req.admin!.id,
      },
      create: {
        key: key.toUpperCase(),
        value,
        updatedBy: req.admin!.id,
      },
    });

    // Determine action type for critical settings
    let action = 'SETTINGS_UPDATE';
    if (key.toUpperCase() === 'COMMISSION_RATE') {
      action = 'COMMISSION_RATE_CHANGE';
    }

    await logActivity({
      adminId: req.admin!.id,
      action,
      entityType: 'Setting',
      entityId: setting.key,
      description: `Updated setting: ${setting.key}`,
      diff: {
        before: oldSetting?.value || null,
        after: value,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      data: { setting },
    });
  })
);

// Get commission rate (helper endpoint)
router.get(
  '/commission/rate',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const setting = await prisma.setting.findUnique({
      where: { key: 'COMMISSION_RATE' },
    });

    const rate = setting?.value ? (setting.value as any).rate : 5.0;

    res.status(200).json({
      status: 'success',
      data: { rate },
    });
  })
);

// Get subscription pricing (helper endpoint)
router.get(
  '/subscription/pricing',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const setting = await prisma.setting.findUnique({
      where: { key: 'SUBSCRIPTION_PRICING' },
    });

    const pricing = setting?.value || {
      monthly: 49.99,
      sixMonths: 269.94,
      yearly: 479.88,
      currency: 'GBP',
    };

    res.status(200).json({
      status: 'success',
      data: { pricing },
    });
  })
);

// Get free job allocation (helper endpoint)
router.get(
  '/jobs/free-allocation',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const setting = await prisma.setting.findUnique({
      where: { key: 'FREE_JOB_ALLOCATION' },
    });

    const allocation = setting?.value || {
      standard: 0,
      premium: 2,
      enterprise: 5,
    };

    res.status(200).json({
      status: 'success',
      data: { allocation },
    });
  })
);

export default router;

