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

// Get error logs with filters
router.get(
  '/logs',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const {
      page = '1',
      limit = '50',
      level,
      source,
      startDate,
      endDate,
      search,
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    const where: any = {};

    if (level) where.level = level;
    if (source) where.source = source;
    
    if (search) {
      where.OR = [
        { message: { contains: search as string, mode: 'insensitive' } },
        { source: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const [errors, total] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip: offset,
      }),
      prisma.errorLog.count({ where }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        errors,
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

// Get error statistics
router.get(
  '/stats',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { startDate, endDate } = req.query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const [
      totalErrors,
      totalWarnings,
      criticalErrors,
      recentErrors,
      errorsBySource,
    ] = await Promise.all([
      prisma.errorLog.count({ where: { ...where, level: 'error' } }),
      prisma.errorLog.count({ where: { ...where, level: 'warning' } }),
      prisma.errorLog.count({ 
        where: { 
          ...where, 
          level: 'error',
          statusCode: { in: [500, 502, 503, 504] }
        } 
      }),
      prisma.errorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.errorLog.groupBy({
        by: ['source'],
        where,
        _count: {
          source: true,
        },
        orderBy: {
          _count: {
            source: 'desc',
          },
        },
        take: 10,
      }),
    ]);

    const topErrorSources = errorsBySource.map((item) => ({
      source: item.source,
      count: item._count.source,
    }));

    res.status(200).json({
      status: 'success',
      data: {
        totalErrors,
        totalWarnings,
        criticalErrors,
        recentErrors,
        topErrorSources,
      },
    });
  })
);

// Get single error log
router.get(
  '/logs/:id',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { id } = req.params;

    const error = await prisma.errorLog.findUnique({
      where: { id },
    });

    if (!error) {
      return res.status(404).json({
        status: 'error',
        message: 'Error log not found',
      });
    }

    res.status(200).json({
      status: 'success',
      data: { error },
    });
  })
);

export default router;

