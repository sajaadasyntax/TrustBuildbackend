import express, { Response } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import {
  protectAdmin,
  requirePermission,
  AdminAuthRequest,
} from '../middleware/adminAuth';
import { AdminPermission } from '../config/permissions';
import { prisma } from '../config/database';

const router = express.Router();

// Get email logs with filters
router.get(
  '/logs',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const {
      page = '1',
      limit = '50',
      status,
      type,
      recipient,
      startDate,
      endDate,
      search,
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    const where: any = {};

    if (status) {
      // Convert to uppercase to match enum values
      const statusUpper = (status as string).toUpperCase();
      if (['PENDING', 'SENT', 'FAILED'].includes(statusUpper)) {
        where.status = statusUpper;
      }
    }
    if (type) where.type = type;
    if (recipient) where.recipient = { contains: recipient as string, mode: 'insensitive' };
    
    if (search) {
      where.OR = [
        { recipient: { contains: search as string, mode: 'insensitive' } },
        { subject: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (startDate || endDate) {
      where.sentAt = {};
      if (startDate) where.sentAt.gte = new Date(startDate as string);
      if (endDate) where.sentAt.lte = new Date(endDate as string);
    }

    const [logs, total] = await Promise.all([
      prisma.emailLog.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        take: limitNum,
        skip: offset,
      }),
      prisma.emailLog.count({ where }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        logs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  })
);

// Get email statistics
router.get(
  '/stats',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { startDate, endDate } = req.query;

    const where: any = {};
    if (startDate || endDate) {
      where.sentAt = {};
      if (startDate) where.sentAt.gte = new Date(startDate as string);
      if (endDate) where.sentAt.lte = new Date(endDate as string);
    }

    const [totalSent, totalFailed, totalPending, recentEmails] = await Promise.all([
      prisma.emailLog.count({ where: { ...where, status: 'SENT' } }),
      prisma.emailLog.count({ where: { ...where, status: 'FAILED' } }),
      prisma.emailLog.count({ where: { ...where, status: 'PENDING' } }),
      prisma.emailLog.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        take: 10,
      }),
    ]);

    const total = totalSent + totalFailed + totalPending;
    const successRate = total > 0 ? (totalSent / total) * 100 : 0;

    res.status(200).json({
      status: 'success',
      data: {
        totalSent,
        totalFailed,
        totalPending,
        successRate,
        recentEmails,
      },
    });
  })
);

// Get single email log
router.get(
  '/logs/:id',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { id } = req.params;

    const log = await prisma.emailLog.findUnique({
      where: { id },
    });

    if (!log) {
      return res.status(404).json({
        status: 'error',
        message: 'Email log not found',
      });
    }

    res.status(200).json({
      status: 'success',
      data: { log },
    });
  })
);

export default router;

