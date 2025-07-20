import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';

const router = Router();

// Middleware to ensure admin access
const adminOnly = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }
  next();
};

// @desc    Get all services with pricing
// @route   GET /api/admin/payments/services
// @access  Private/Admin
export const getServicesWithPricing = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const services = await prisma.service.findMany({
    select: {
      id: true,
      name: true,
      category: true,
      smallJobPrice: true,
      mediumJobPrice: true,
      largeJobPrice: true,
      isActive: true,
      _count: {
        select: {
          jobs: true,
        },
      },
    },
    orderBy: [
      { category: 'asc' },
      { name: 'asc' },
    ],
  });

  res.status(200).json({
    status: 'success',
    data: { services },
  });
});

// @desc    Update service pricing
// @route   PUT /api/admin/payments/services/:id/pricing
// @access  Private/Admin
export const updateServicePricing = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { smallJobPrice, mediumJobPrice, largeJobPrice } = req.body;

  // Validate pricing values
  if (smallJobPrice < 0 || mediumJobPrice < 0 || largeJobPrice < 0) {
    return next(new AppError('Prices cannot be negative', 400));
  }

  const service = await prisma.service.update({
    where: { id },
    data: {
      smallJobPrice: parseFloat(smallJobPrice),
      mediumJobPrice: parseFloat(mediumJobPrice),
      largeJobPrice: parseFloat(largeJobPrice),
    },
    select: {
      id: true,
      name: true,
      smallJobPrice: true,
      mediumJobPrice: true,
      largeJobPrice: true,
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Service pricing updated successfully',
    data: { service },
  });
});

// @desc    Search contractors for credit management
// @route   GET /api/admin/payments/contractors/search
// @access  Private/Admin
export const searchContractors = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { query } = req.query;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (query) {
    where.OR = [
      { businessName: { contains: query as string, mode: 'insensitive' } },
      { user: { name: { contains: query as string, mode: 'insensitive' } } },
      { user: { email: { contains: query as string, mode: 'insensitive' } } },
    ];
  }

  const contractors = await prisma.contractor.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
  });

  const total = await prisma.contractor.count({ where });

  res.status(200).json({
    status: 'success',
    data: {
      contractors,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get contractor credit details
// @route   GET /api/admin/payments/contractors/:id/credits
// @access  Private/Admin
export const getContractorCredits = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const contractor = await prisma.contractor.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
      creditTransactions: {
        include: {
          job: {
            select: {
              title: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { contractor },
  });
});

// @desc    Adjust contractor credits
// @route   POST /api/admin/payments/contractors/:id/adjust-credits
// @access  Private/Admin
export const adjustContractorCredits = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { amount, reason, type } = req.body;

  if (!amount || !reason || !type) {
    return next(new AppError('Amount, reason, and type are required', 400));
  }

  if (!['ADDITION', 'DEDUCTION'].includes(type)) {
    return next(new AppError('Type must be ADDITION or DEDUCTION', 400));
  }

  const contractor = await prisma.contractor.findUnique({
    where: { id },
    select: { id: true, creditsBalance: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  // Check if deduction would result in negative balance
  if (type === 'DEDUCTION' && contractor.creditsBalance < amount) {
    return next(new AppError('Insufficient credits for deduction', 400));
  }

  await prisma.$transaction(async (tx) => {
    // Update contractor balance
    await tx.contractor.update({
      where: { id },
      data: {
        creditsBalance: type === 'ADDITION' 
          ? { increment: amount }
          : { decrement: amount },
      },
    });

    // Create transaction record
    await tx.creditTransaction.create({
      data: {
        contractorId: id,
        type,
        amount,
        description: `Admin adjustment: ${reason}`,
        adminUserId: req.user!.id,
      },
    });
  });

  res.status(200).json({
    status: 'success',
    message: 'Credits adjusted successfully',
  });
});

// @desc    Update contractor weekly credit limit
// @route   PUT /api/admin/payments/contractors/:id/credit-limit
// @access  Private/Admin
export const updateCreditLimit = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { weeklyCreditsLimit } = req.body;

  if (weeklyCreditsLimit < 0) {
    return next(new AppError('Weekly credits limit cannot be negative', 400));
  }

  await prisma.contractor.update({
    where: { id },
    data: { weeklyCreditsLimit },
  });

  res.status(200).json({
    status: 'success',
    message: 'Weekly credits limit updated successfully',
  });
});

// @desc    Reset all contractors' weekly credits
// @route   POST /api/admin/payments/reset-weekly-credits
// @access  Private/Admin
export const resetWeeklyCredits = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const now = new Date();

  // Get all contractors with subscriptions
  const contractors = await prisma.contractor.findMany({
    where: {
      weeklyCreditsLimit: { gt: 0 },
    },
    select: {
      id: true,
      weeklyCreditsLimit: true,
    },
  });

  // Update credits for each contractor
  await prisma.$transaction(async (tx) => {
    for (const contractor of contractors) {
      await tx.contractor.update({
        where: { id: contractor.id },
        data: {
          creditsBalance: contractor.weeklyCreditsLimit,
          lastCreditReset: now,
        },
      });

      await tx.creditTransaction.create({
        data: {
          contractorId: contractor.id,
          type: 'ADDITION',
          amount: contractor.weeklyCreditsLimit,
          description: 'Weekly credit reset',
          adminUserId: req.user!.id,
        },
      });
    }
  });

  res.status(200).json({
    status: 'success',
    message: `Weekly credits reset for ${contractors.length} contractors`,
  });
});

// @desc    Get payment system overview stats
// @route   GET /api/admin/payments/overview
// @access  Private/Admin
export const getPaymentOverview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const [
    totalServices,
    totalContractors,
    totalCreditsInCirculation,
    totalPayments,
    totalRevenue,
    recentPayments,
    creditTransactions,
  ] = await Promise.all([
    prisma.service.count(),
    prisma.contractor.count(),
    prisma.contractor.aggregate({
      _sum: { creditsBalance: true },
    }),
    prisma.payment.count(),
    prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
    }),
    prisma.payment.findMany({
      include: {
        contractor: {
          include: {
            user: { select: { name: true } },
          },
        },
        job: {
          select: { title: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.creditTransaction.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
    }),
  ]);

  const stats = {
    totalServices,
    totalContractors,
    totalCreditsInCirculation: totalCreditsInCirculation._sum.creditsBalance || 0,
    totalPayments,
    totalRevenue: totalRevenue._sum.amount || 0,
    recentPayments,
    weeklyTransactions: creditTransactions,
  };

  res.status(200).json({
    status: 'success',
    data: { stats },
  });
});

// @desc    Override job lead price
// @route   PUT /api/admin/payments/jobs/:jobId/price
// @access  Private/Admin
export const overrideJobPrice = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { jobId } = req.params;
  const { currentLeadPrice } = req.body;

  if (currentLeadPrice < 0) {
    return next(new AppError('Lead price cannot be negative', 400));
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { currentLeadPrice },
  });

  res.status(200).json({
    status: 'success',
    message: 'Job lead price updated successfully',
  });
});

// Routes
router.use(protect); // All routes require authentication
router.use(adminOnly); // All routes require admin access

router.get('/services', getServicesWithPricing);
router.put('/services/:id/pricing', updateServicePricing);
router.get('/contractors/search', searchContractors);
router.get('/contractors/:id/credits', getContractorCredits);
router.post('/contractors/:id/adjust-credits', adjustContractorCredits);
router.put('/contractors/:id/credit-limit', updateCreditLimit);
router.post('/reset-weekly-credits', resetWeeklyCredits);
router.get('/overview', getPaymentOverview);
router.put('/jobs/:jobId/price', overrideJobPrice);

export default router; 