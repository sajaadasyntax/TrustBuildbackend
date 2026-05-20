import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protectAdmin, AdminAuthRequest } from '../middleware/adminAuth';
import { AppError, catchAsync } from '../middleware/errorHandler';

const router = Router();

router.use(protectAdmin);

// @desc    Get price confirmation history log with optional contractor-name search
// @route   GET /api/admin/price-confirmations/history
// @access  Private (Admin only)
export const getPriceConfirmationHistory = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const q = (req.query.q as string) || '';
  const action = req.query.action as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  const validActions = ['PROPOSED', 'CONFIRMED', 'REJECTED', 'ADMIN_OVERRIDE'];

  const where: any = {};

  if (action && validActions.includes(action)) {
    where.action = action;
  }

  if (from) {
    where.createdAt = { ...where.createdAt, gte: new Date(from) };
  }
  if (to) {
    where.createdAt = { ...where.createdAt, lte: new Date(to) };
  }

  if (q) {
    where.contractor = {
      OR: [
        { businessName: { contains: q, mode: 'insensitive' } },
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ],
    };
  }

  const [logs, total] = await Promise.all([
    prisma.priceConfirmationLog.findMany({
      where,
      include: {
        job: { select: { id: true, title: true, status: true } },
        contractor: {
          select: {
            id: true,
            businessName: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.priceConfirmationLog.count({ where }),
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
});

router.get('/history', getPriceConfirmationHistory);

export default router;
