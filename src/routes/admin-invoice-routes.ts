import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest, restrictTo } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';

const router = Router();

// @desc    Get all invoices with filters and pagination
// @route   GET /api/admin/invoices
// @access  Private (Admin only)
export const getAllInvoices = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const status = req.query.status as string;
  const type = req.query.type as string;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;
  const search = req.query.search as string;

  // Build filter conditions
  const where: any = {};

  // Filter by date range
  if (startDate && endDate) {
    where.createdAt = {
      gte: new Date(startDate),
      lte: new Date(endDate),
    };
  }

  // Filter by status
  if (status) {
    if (status === 'PAID') {
      where.paidAt = { not: null };
    } else if (status === 'PENDING') {
      where.paidAt = null;
      where.dueAt = { gt: new Date() };
    } else if (status === 'OVERDUE') {
      where.paidAt = null;
      where.dueAt = { lt: new Date() };
    }
  }

  // Filter by payment type
  if (type) {
    where.payment = {
      type
    };
  }

  // Search by invoice number or description
  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { recipientName: { contains: search, mode: 'insensitive' } },
      { recipientEmail: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Get invoices with pagination
  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        payment: {
          select: {
            id: true,
            type: true,
            status: true,
            customerId: true,
            contractorId: true,
            jobId: true,
            amount: true,
            createdAt: true,
          }
        },
        contractor: {
          select: {
            businessName: true,
            user: {
              select: {
                name: true,
                email: true
              }
            }
          }
        },
        job: {
          select: {
            id: true,
            title: true,
            description: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.invoice.count({ where })
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      invoices,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// @desc    Get invoice by ID
// @route   GET /api/admin/invoices/:id
// @access  Private (Admin only)
export const getInvoiceById = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      payment: {
        select: {
          id: true,
          type: true,
          status: true,
          amount: true,
          stripePaymentId: true,
          customerId: true,
          contractorId: true,
          jobId: true,
          createdAt: true,
        }
      },
      contractor: {
        select: {
          id: true,
          businessName: true,
          user: {
            select: {
              name: true,
              email: true
            }
          }
        }
      },
      job: {
        select: {
          id: true,
          title: true,
          description: true,
          location: true,
        }
      }
    }
  });

  if (!invoice) {
    return next(new AppError('Invoice not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { invoice }
  });
});

// @desc    Update invoice status
// @route   PATCH /api/admin/invoices/:id/status
// @access  Private (Admin only)
export const updateInvoiceStatus = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return next(new AppError('Status is required', 400));
  }

  let updateData: any = {};

  // Update invoice based on status
  if (status === 'PAID') {
    updateData.paidAt = new Date();
  } else if (status === 'PENDING') {
    updateData.paidAt = null;
    updateData.dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Due in 30 days
  } else if (status === 'OVERDUE') {
    updateData.paidAt = null;
    updateData.dueAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // Due yesterday (overdue)
  } else if (status === 'CANCELLED') {
    updateData.paidAt = null;
    updateData.dueAt = null;
  } else {
    return next(new AppError('Invalid status', 400));
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data: updateData,
    include: {
      payment: true
    }
  });

  // If invoice status is updated to paid, also update related payment if it exists
  if (status === 'PAID' && invoice.payment) {
    await prisma.payment.update({
      where: { id: invoice.payment.id },
      data: { status: 'COMPLETED' }
    });
  }

  res.status(200).json({
    status: 'success',
    data: { invoice }
  });
});

// @desc    Get invoice statistics
// @route   GET /api/admin/invoices/stats
// @access  Private (Admin only)
export const getInvoiceStats = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { period = '30' } = req.query; // days
  const days = parseInt(period as string);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const [
    totalInvoices,
    paidInvoices,
    totalRevenue,
    recentInvoices,
    invoicesByType,
  ] = await Promise.all([
    prisma.invoice.count(),
    prisma.invoice.count({
      where: { paidAt: { not: null } },
    }),
    prisma.invoice.aggregate({
      where: { paidAt: { not: null } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.findMany({
      where: {
        createdAt: { gte: startDate },
      },
      include: {
        contractor: {
          include: {
            user: {
              select: {
                name: true,
              },
            },
          },
        },
        payment: {
          select: {
            type: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.payment.groupBy({
      by: ['type'],
      _count: { id: true },
      _sum: { amount: true },
    }),
  ]);

  const stats = {
    total: totalInvoices,
    paid: paidInvoices,
    pending: totalInvoices - paidInvoices,
    revenue: totalRevenue._sum.totalAmount || 0,
    recent: recentInvoices,
    byType: invoicesByType,
  };

  res.status(200).json({
    status: 'success',
    data: { stats },
  });
});

// Routes
router.use(protect);
router.use(restrictTo('ADMIN', 'SUPER_ADMIN'));

router.get('/stats', getInvoiceStats);
router.get('/', getAllInvoices);
router.get('/:id', getInvoiceById);
router.patch('/:id/status', updateInvoiceStatus);

export default router;
