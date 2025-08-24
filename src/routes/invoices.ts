import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import nodemailer from 'nodemailer';

const router = Router();

// Email transporter configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Fix for connection timeout issues
  connectionTimeout: 10000, // 10 seconds
  socketTimeout: 20000, // 20 seconds
  tls: {
    rejectUnauthorized: process.env.NODE_ENV === 'production',
  },
});

// @desc    Get contractor's invoices
// @route   GET /api/invoices
// @access  Private (Contractor only)
export const getInvoices = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get invoices
  const invoices = await prisma.invoice.findMany({
    where: { contractorId: contractor.id },
    include: {
      payment: {
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
        },
      },
      job: {
        select: {
          id: true,
          title: true,
          location: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const total = await prisma.invoice.count({
    where: { contractorId: contractor.id },
  });

  res.status(200).json({
    status: 'success',
    data: {
      invoices,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get single invoice
// @route   GET /api/invoices/:id
// @access  Private
export const getInvoice = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const invoice = await prisma.invoice.findFirst({
    where: {
      id,
      contractorId: contractor.id,
    },
    include: {
      payment: {
        select: {
          id: true,
          type: true,
          status: true,
          amount: true,
          createdAt: true,
        },
      },
      job: {
        select: {
          id: true,
          title: true,
          location: true,
          description: true,
        },
      },
      contractor: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!invoice) {
    return next(new AppError('Invoice not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { invoice },
  });
});

// @desc    Send invoice via email (simplified without PDF for now)
// @route   POST /api/invoices/:id/send
// @access  Private
export const sendInvoiceEmail = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const invoice = await prisma.invoice.findFirst({
    where: {
      id,
      contractorId: contractor.id,
    },
    include: {
      payment: {
        select: {
          type: true,
          createdAt: true,
        },
      },
      job: {
        select: {
          title: true,
          location: true,
        },
      },
      contractor: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!invoice) {
    return next(new AppError('Invoice not found', 404));
  }

  // Send email
  const mailOptions = {
    from: process.env.SMTP_FROM || 'noreply@trustbuild.com',
    to: invoice.contractor.user.email,
    subject: `TrustBuild Invoice ${invoice.invoiceNumber}`,
    html: `
      <h2>Invoice from TrustBuild</h2>
      <p>Dear ${invoice.contractor.user.name},</p>
      <p>Please find your invoice details for the job lead access.</p>
      
      <h3>Invoice Details:</h3>
      <ul>
        <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
        <li><strong>Date:</strong> ${invoice.createdAt.toLocaleDateString()}</li>
        <li><strong>Amount:</strong> £${invoice.totalAmount.toFixed(2)}</li>
        <li><strong>Status:</strong> ${invoice.status}</li>
      </ul>
      
      ${invoice.job ? `
      <h3>Job Details:</h3>
      <ul>
        <li><strong>Job:</strong> ${invoice.job.title}</li>
        <li><strong>Location:</strong> ${invoice.job.location}</li>
      </ul>
      ` : ''}
      
      <p>Thank you for using TrustBuild!</p>
      <p>Best regards,<br>The TrustBuild Team</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    
    // Update invoice to mark as sent
    await prisma.invoice.update({
      where: { id },
      data: { emailSent: true },
    });

    res.status(200).json({
      status: 'success',
      message: 'Invoice sent successfully',
    });
  } catch (error) {
    console.error('Email sending failed:', error);
    return next(new AppError('Failed to send invoice email', 500));
  }
});

// @desc    Get invoice statistics (for admin)
// @route   GET /api/invoices/stats
// @access  Private (Admin only)
export const getInvoiceStats = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }

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
      where: { status: 'PAID' },
    }),
    prisma.invoice.aggregate({
      where: { status: 'PAID' },
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
router.use(protect); // All routes require authentication

router.get('/', getInvoices);
router.get('/stats', getInvoiceStats);
router.get('/:id', getInvoice);
router.post('/:id/send', sendInvoiceEmail);

export default router; 