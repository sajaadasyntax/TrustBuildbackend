import express, { Response } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import {
  protectAdmin,
  requirePermission,
  getClientIp,
  getClientUserAgent,
  AdminAuthRequest,
} from '../middleware/adminAuth';
import { AdminPermission } from '../config/permissions';
import { logActivity } from '../services/auditService';
import { prisma } from '../config/database';

const router = express.Router();

// Get all settings
router.get(
  '/',
  protectAdmin,
  requirePermission(AdminPermission.SETTINGS_READ),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const settings = await prisma.adminSettings.findMany({
      orderBy: { key: 'asc' },
    });

    // Convert to key-value object for easier frontend usage
    const settingsObject = settings.reduce((acc, setting) => {
      // Try to parse JSON values, otherwise use as-is
      let parsedValue;
      try {
        parsedValue = JSON.parse(setting.value);
      } catch {
        // If parsing fails, use the raw string value
        parsedValue = setting.value;
      }

      acc[setting.key] = {
        value: parsedValue,
        description: setting.description,
        updatedAt: setting.updatedAt,
      };
      return acc;
    }, {} as Record<string, any>);

    res.status(200).json({
      status: 'success',
      data: {
        settings: settingsObject,
      },
    });
  })
);

// Get specific setting by key
router.get(
  '/:key',
  protectAdmin,
  requirePermission(AdminPermission.SETTINGS_READ),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { key } = req.params;

    const setting = await prisma.adminSettings.findUnique({
      where: { key: key.toUpperCase() },
    });

    if (!setting) {
      return res.status(404).json({
        status: 'error',
        message: 'Setting not found',
      });
    }

    // Try to parse JSON value
    let parsedValue;
    try {
      parsedValue = JSON.parse(setting.value);
    } catch {
      parsedValue = setting.value;
    }

    res.status(200).json({
      status: 'success',
      data: {
        setting: {
          ...setting,
          value: parsedValue,
        },
      },
    });
  })
);

// Update setting
router.patch(
  '/:key',
  protectAdmin,
  requirePermission(AdminPermission.SETTINGS_WRITE),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { key } = req.params;
    const { value, description } = req.body;

    if (!value) {
      return res.status(400).json({
        status: 'error',
        message: 'Value is required',
      });
    }

    // Convert value to string - if it's an object, stringify it as JSON
    const valueString = typeof value === 'object' ? JSON.stringify(value) : value.toString();

    // Get old value for audit log
    const oldSetting = await prisma.adminSettings.findUnique({
      where: { key: key.toUpperCase() },
    });

    const setting = await prisma.adminSettings.upsert({
      where: { key: key.toUpperCase() },
      update: {
        value: valueString,
        ...(description && { description }),
      },
      create: {
        key: key.toUpperCase(),
        value: valueString,
        ...(description && { description }),
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
      entityType: 'AdminSettings',
      entityId: setting.id,
      description: `Updated setting: ${setting.key}`,
      diff: {
        before: oldSetting?.value || null,
        after: valueString,
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
    const setting = await prisma.adminSettings.findUnique({
      where: { key: 'COMMISSION_RATE' },
    });

    let rate = 5.0;
    if (setting?.value) {
      try {
        const parsed = JSON.parse(setting.value);
        rate = parsed.rate || 5.0;
      } catch {
        rate = parseFloat(setting.value) || 5.0;
      }
    }

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
    const setting = await prisma.adminSettings.findUnique({
      where: { key: 'SUBSCRIPTION_PRICING' },
    });

    let pricing = {
      monthly: 49.99,
      sixMonths: 269.94,
      yearly: 479.88,
      currency: 'GBP',
    };

    if (setting?.value) {
      try {
        pricing = JSON.parse(setting.value);
      } catch {
        // Use default if parsing fails
      }
    }

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
    const setting = await prisma.adminSettings.findUnique({
      where: { key: 'FREE_JOB_ALLOCATION' },
    });

    let allocation = {
      standard: 0,
      premium: 2,
      enterprise: 5,
    };

    if (setting?.value) {
      try {
        allocation = JSON.parse(setting.value);
      } catch {
        // Use default if parsing fails
      }
    }

    res.status(200).json({
      status: 'success',
      data: { allocation },
    });
  })
);

export default router;

