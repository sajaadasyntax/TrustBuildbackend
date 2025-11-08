import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protectAdmin, AdminAuthRequest, requirePermission } from '../middleware/adminAuth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { AdminPermission } from '../config/permissions';

const router = Router();

// @desc    Get all invoices with filters and pagination
// @route   GET /api/admin/invoices
// @access  Private (Admin only)
export const getAllInvoices = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
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
    where.payments = {
      some: {
        type
      }
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

  // Build filter conditions for manual invoices
  const manualInvoiceWhere: any = {};
  
  if (startDate && endDate) {
    manualInvoiceWhere.createdAt = {
      gte: new Date(startDate),
      lte: new Date(endDate),
    };
  }

  if (status) {
    if (status === 'PAID') {
      manualInvoiceWhere.paidAt = { not: null };
    } else if (status === 'PENDING') {
      manualInvoiceWhere.paidAt = null;
      manualInvoiceWhere.dueDate = { gt: new Date() };
      manualInvoiceWhere.status = { in: ['DRAFT', 'ISSUED'] };
    } else if (status === 'OVERDUE') {
      manualInvoiceWhere.paidAt = null;
      manualInvoiceWhere.dueDate = { lt: new Date() };
      manualInvoiceWhere.status = { in: ['ISSUED'] };
    }
  }

  if (search) {
    manualInvoiceWhere.OR = [
      { number: { contains: search, mode: 'insensitive' } },
      { reason: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
      { contractor: { user: { email: { contains: search, mode: 'insensitive' } } } },
    ];
  }

  // Get both regular invoices and manual invoices
  // Fetch enough items to ensure proper sorting and pagination across both types
  // For proper pagination, we need to fetch at least (skip + limit) items from each source
  const fetchLimit = Math.max(limit * 5, skip + limit); // Fetch enough for pagination
  const [regularInvoices, manualInvoices, regularCount, manualCount] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        payments: {
          select: {
            id: true,
            type: true,
            status: true,
            customerId: true,
            contractorId: true,
            jobId: true,
            amount: true,
            createdAt: true,
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
          take: 1
        }
      },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit
    }),
    prisma.manualInvoice.findMany({
      where: manualInvoiceWhere,
      include: {
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
        items: true,
      },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit
    }),
    prisma.invoice.count({ where }),
    prisma.manualInvoice.count({ where: manualInvoiceWhere })
  ]);

  // Combine and format invoices for response
  const allInvoices = [
    ...regularInvoices.map(inv => ({
      ...inv,
      type: 'regular',
      invoiceNumber: inv.invoiceNumber,
      totalAmount: Number(inv.totalAmount),
      amount: Number(inv.amount),
      vatAmount: Number(inv.vatAmount || 0),
    })),
    ...manualInvoices.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.number,
      type: 'manual',
      contractorId: inv.contractorId,
      contractor: inv.contractor,
      totalAmount: inv.total / 100, // Convert from pence
      amount: inv.subtotal / 100, // Convert from pence
      vatAmount: inv.tax / 100, // Convert from pence
      status: inv.status,
      createdAt: inv.createdAt,
      issuedAt: inv.issuedAt,
      paidAt: inv.paidAt,
      dueAt: inv.dueDate,
      description: inv.reason || inv.notes || 'Manual Invoice',
      recipientName: inv.contractor.businessName || inv.contractor.user.name,
      recipientEmail: inv.contractor.user.email,
      payments: [],
      items: inv.items.map(item => ({
        description: item.description,
        amount: item.amount / 100,
        quantity: item.quantity,
      })),
    }))
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = regularCount + manualCount;

  // Apply pagination after sorting
  const paginatedInvoices = allInvoices.slice(skip, skip + limit);

  res.status(200).json({
    status: 'success',
    data: {
      invoices: paginatedInvoices,
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
export const getInvoiceById = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      payments: {
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
              location: true
              }
            }
        },
        take: 1 // Take just the first payment for display
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
export const updateInvoiceStatus = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
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
      payments: {
        take: 1
      }
    }
  });

  // If invoice status is updated to paid, also update related payment if it exists
  if (status === 'PAID' && invoice.payments && invoice.payments.length > 0) {
    await prisma.payment.update({
      where: { id: invoice.payments[0].id },
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
export const getInvoiceStats = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
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
        payments: {
          select: {
            type: true,
            contractor: {
              include: {
                user: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          take: 1,
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
router.use(protectAdmin); // All routes require admin authentication

router.get('/stats', requirePermission(AdminPermission.PAYMENTS_READ), getInvoiceStats);
router.get('/', requirePermission(AdminPermission.PAYMENTS_READ), getAllInvoices);
router.get('/:id', requirePermission(AdminPermission.PAYMENTS_READ), getInvoiceById);
router.patch('/:id/status', requirePermission(AdminPermission.PAYMENTS_WRITE), updateInvoiceStatus);

export default router;
