import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest, restrictTo } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import nodemailer from 'nodemailer';

const router = Router();

// Email transporter configuration
const getEmailTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.mailersend.net',
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
};

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

  // Get regular invoices
  const regularInvoices = await prisma.invoice.findMany({
    where: {
      ...where,
      // Add search filter if provided
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { recipientName: { contains: search, mode: 'insensitive' } },
          { recipientEmail: { contains: search, mode: 'insensitive' } },
        ],
      }),
    },
    include: {
      payment: {
        select: {
          id: true,
          status: true,
          type: true,
          contractor: {
            select: {
              id: true,
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  // Get commission invoices
  const commissionInvoices = await prisma.commissionInvoice.findMany({
    where: {
      ...where,
      // Add search filter if provided
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { jobTitle: { contains: search, mode: 'insensitive' } },
          { contractorName: { contains: search, mode: 'insensitive' } },
          { contractorEmail: { contains: search, mode: 'insensitive' } },
        ],
      }),
    },
    include: {
      commissionPayment: {
        select: {
          id: true,
          status: true,
          dueDate: true,
          paidAt: true,
          contractor: {
            select: {
              id: true,
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  // Format invoices for consistent response
  const formattedRegularInvoices = regularInvoices.map(invoice => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    type: 'regular',
    description: invoice.description,
    amount: invoice.amount,
    vatAmount: invoice.vatAmount,
    totalAmount: invoice.totalAmount,
    status: invoice.payment?.status || 'PENDING',
    paymentType: invoice.payment?.type || 'UNKNOWN',
    recipientName: invoice.recipientName,
    recipientEmail: invoice.recipientEmail,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    contractor: invoice.payment?.contractor || null,
  }));

  const formattedCommissionInvoices = commissionInvoices.map(invoice => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    type: 'commission',
    description: `Commission for ${invoice.jobTitle}`,
    amount: invoice.commissionAmount,
    vatAmount: invoice.vatAmount,
    totalAmount: invoice.totalAmount,
    status: invoice.commissionPayment?.status || 'PENDING',
    dueDate: invoice.commissionPayment?.dueDate,
    paidAt: invoice.commissionPayment?.paidAt,
    recipientName: invoice.contractorName,
    recipientEmail: invoice.contractorEmail,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    contractor: invoice.commissionPayment?.contractor || null,
  }));

  // Combine and sort all invoices by date
  let allInvoices = [...formattedRegularInvoices, ...formattedCommissionInvoices];
  
  // Apply type filter if provided
  if (type === 'regular') {
    allInvoices = formattedRegularInvoices;
  } else if (type === 'commission') {
    allInvoices = formattedCommissionInvoices;
  }
  
  // Apply status filter if provided
  if (status) {
    allInvoices = allInvoices.filter(invoice => invoice.status === status.toUpperCase());
  }
  
  // Sort by date
  allInvoices.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  
  // Paginate results
  const paginatedInvoices = allInvoices.slice(skip, skip + limit);
  
  // Count totals for pagination
  const totalRegularInvoices = await prisma.invoice.count({ where });
  const totalCommissionInvoices = await prisma.commissionInvoice.count({ where });
  const total = type === 'regular' ? totalRegularInvoices : 
                type === 'commission' ? totalCommissionInvoices : 
                totalRegularInvoices + totalCommissionInvoices;

  res.status(200).json({
    status: 'success',
    data: {
      invoices: paginatedInvoices,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get invoice details
// @route   GET /api/admin/invoices/:id
// @access  Private (Admin only)
export const getInvoiceDetails = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { type } = req.query;

  let invoice;
  let invoiceType = type as string;

  // Try to find regular invoice if type not specified or is 'regular'
  if (!invoiceType || invoiceType === 'regular') {
    invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        payment: {
          select: {
            id: true,
            status: true,
            type: true,
            createdAt: true,
            contractor: {
              select: {
                id: true,
                businessName: true,
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (invoice) {
      invoiceType = 'regular';
    }
  }

  // Try to find commission invoice if type not specified or is 'commission'
  if (!invoice && (!invoiceType || invoiceType === 'commission')) {
    invoice = await prisma.commissionInvoice.findUnique({
      where: { id },
      include: {
        commissionPayment: {
          select: {
            id: true,
            status: true,
            dueDate: true,
            paidAt: true,
            finalJobAmount: true,
            commissionRate: true,
            remindersSent: true,
            lastReminderSent: true,
            job: {
              select: {
                id: true,
                title: true,
                completionDate: true,
              },
            },
            contractor: {
              select: {
                id: true,
                businessName: true,
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (invoice) {
      invoiceType = 'commission';
    }
  }

  if (!invoice) {
    return next(new AppError('Invoice not found', 404));
  }

  // Format response based on invoice type
  const formattedInvoice = invoiceType === 'regular' 
    ? {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        type: 'regular',
        description: invoice.description,
        amount: invoice.amount,
        vatAmount: invoice.vatAmount,
        totalAmount: invoice.totalAmount,
        status: invoice.payment?.status || 'PENDING',
        paymentType: invoice.payment?.type || 'UNKNOWN',
        recipientName: invoice.recipientName,
        recipientEmail: invoice.recipientEmail,
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
        contractor: invoice.payment?.contractor || null,
        payment: invoice.payment,
      }
    : {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        type: 'commission',
        description: `Commission for ${invoice.jobTitle}`,
        amount: invoice.commissionAmount,
        vatAmount: invoice.vatAmount,
        totalAmount: invoice.totalAmount,
        status: invoice.commissionPayment?.status || 'PENDING',
        dueDate: invoice.commissionPayment?.dueDate,
        paidAt: invoice.commissionPayment?.paidAt,
        recipientName: invoice.contractorName,
        recipientEmail: invoice.contractorEmail,
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
        contractor: invoice.commissionPayment?.contractor || null,
        commissionPayment: invoice.commissionPayment,
        job: invoice.commissionPayment?.job,
      };

  res.status(200).json({
    status: 'success',
    data: {
      invoice: formattedInvoice,
    },
  });
});

// @desc    Get overdue commission payments
// @route   GET /api/admin/invoices/overdue-commissions
// @access  Private (Admin only)
export const getOverdueCommissions = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const now = new Date();

  // Find overdue commission payments
  const overdueCommissions = await prisma.commissionPayment.findMany({
    where: {
      OR: [
        { status: 'PENDING', dueDate: { lt: now } },
        { status: 'OVERDUE' },
      ],
    },
    include: {
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
      job: {
        select: {
          id: true,
          title: true,
          completionDate: true,
        },
      },
      invoice: true,
    },
    orderBy: { dueDate: 'asc' },
    skip,
    take: limit,
  });

  const total = await prisma.commissionPayment.count({
    where: {
      OR: [
        { status: 'PENDING', dueDate: { lt: now } },
        { status: 'OVERDUE' },
      ],
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      overdueCommissions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Send manual reminder for overdue commission
// @route   POST /api/admin/invoices/send-commission-reminder/:id
// @access  Private (Admin only)
export const sendCommissionReminder = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { message } = req.body;

  // Get commission payment
  const commission = await prisma.commissionPayment.findUnique({
    where: { id },
    include: {
      contractor: {
        include: {
          user: true,
        },
      },
      job: true,
      invoice: true,
    },
  });

  if (!commission) {
    return next(new AppError('Commission payment not found', 404));
  }

  if (commission.status === 'PAID') {
    return next(new AppError('Commission has already been paid', 400));
  }

  // Send reminder email
  const transporter = getEmailTransporter();
  
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@trustbuild.uk',
    to: commission.contractor.user.email,
    subject: `URGENT: Overdue Commission Payment - ${commission.invoice?.invoiceNumber}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; }
          .commission-details { background-color: #fef2f2; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #dc2626; }
          .footer { background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; }
          .urgent { font-weight: bold; color: #dc2626; }
          .amount { font-size: 1.2em; font-weight: bold; color: #dc2626; }
          .admin-message { background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0; font-style: italic; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>⚠️ URGENT: OVERDUE COMMISSION PAYMENT</h1>
        </div>
        
        <div class="content">
          <p>Dear ${commission.contractor.user.name},</p>
          
          <p>This is an <span class="urgent">URGENT NOTICE</span> regarding your <span class="urgent">OVERDUE</span> TrustBuild commission payment.</p>
          
          <div class="commission-details">
            <h3>Commission Invoice Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td><strong>Invoice Number:</strong></td><td>${commission.invoice?.invoiceNumber}</td></tr>
              <tr><td><strong>Job Title:</strong></td><td>${commission.job.title}</td></tr>
              <tr><td><strong>Final Job Amount:</strong></td><td>£${commission.finalJobAmount.toNumber().toFixed(2)}</td></tr>
              <tr><td><strong>Commission (5%):</strong></td><td>£${commission.commissionAmount.toNumber().toFixed(2)}</td></tr>
              <tr><td><strong>VAT (20%):</strong></td><td>£${commission.vatAmount.toNumber().toFixed(2)}</td></tr>
              <tr class="amount"><td><strong>Total Due:</strong></td><td><strong>£${commission.totalAmount.toNumber().toFixed(2)}</strong></td></tr>
              <tr><td><strong>Due Date:</strong></td><td class="urgent">${commission.dueDate.toLocaleDateString('en-GB')}</td></tr>
              <tr><td><strong>Days Overdue:</strong></td><td class="urgent">${Math.floor((Date.now() - commission.dueDate.getTime()) / (1000 * 60 * 60 * 24))}</td></tr>
            </table>
          </div>
          
          ${message ? `
          <div class="admin-message">
            <h3>Message from TrustBuild Admin:</h3>
            <p>${message}</p>
          </div>
          ` : ''}
          
          <div style="background-color: #fef2f2; padding: 15px; border-radius: 5px; margin: 20px 0; border: 2px solid #dc2626;">
            <h3 style="color: #dc2626;">🚨 ACCOUNT SUSPENSION NOTICE</h3>
            <p><strong>Your account has been suspended due to non-payment of commission fees.</strong></p>
            <p>To restore your account:</p>
            <ol>
              <li>Pay the outstanding commission immediately</li>
              <li>Contact TrustBuild support to request account reactivation</li>
            </ol>
          </div>
          
          <div style="background-color: #eff6ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>💳 Pay Now</h3>
            <ol>
              <li>Log into your TrustBuild dashboard</li>
              <li>Go to "Commission Payments" section</li>
              <li>Click "Pay Now" next to this invoice</li>
              <li>Pay using any of our supported methods: Visa, MasterCard, Amex, Apple Pay, Google Pay</li>
            </ol>
          </div>
          
          <p><strong>PAY IMMEDIATELY to restore your account.</strong></p>
          
          <p>TrustBuild Support Team</p>
        </div>
        
        <div class="footer">
          <p>TrustBuild - Professional Contractor Platform</p>
          <p>Pay now: <a href="https://trustbuild.uk/dashboard/commissions">https://trustbuild.uk/dashboard/commissions</a></p>
        </div>
      </body>
      </html>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    
    // Update reminder count
    await prisma.commissionPayment.update({
      where: { id },
      data: {
        remindersSent: { increment: 1 },
        lastReminderSent: new Date(),
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Reminder sent successfully',
    });
  } catch (error) {
    console.error('Failed to send reminder:', error);
    return next(new AppError('Failed to send reminder email', 500));
  }
});

// @desc    Waive commission payment
// @route   PATCH /api/admin/invoices/waive-commission/:id
// @access  Private (Admin only)
export const waiveCommission = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!reason) {
    return next(new AppError('Reason for waiving commission is required', 400));
  }

  // Get commission payment
  const commission = await prisma.commissionPayment.findUnique({
    where: { id },
    include: {
      contractor: true,
    },
  });

  if (!commission) {
    return next(new AppError('Commission payment not found', 404));
  }

  if (commission.status === 'PAID') {
    return next(new AppError('Commission has already been paid', 400));
  }

  // Update commission status to waived
  const updatedCommission = await prisma.commissionPayment.update({
    where: { id },
    data: {
      status: 'WAIVED',
    },
  });

  // If contractor was suspended due to this commission, reactivate them
  if (commission.contractor.status === 'SUSPENDED') {
    await prisma.contractor.update({
      where: { id: commission.contractor.id },
      data: {
        status: 'VERIFIED',
      },
    });
  }

  // Update job as commission paid
  await prisma.job.update({
    where: { id: commission.jobId },
    data: { commissionPaid: true },
  });

  // Log admin action
  await prisma.adminAction.create({
    data: {
      action: 'WAIVE_COMMISSION',
      description: `Waived commission payment ${commission.id} for contractor ${commission.contractor.id}. Reason: ${reason}`,
      performedBy: req.user!.id,
      metadata: {
        commissionId: commission.id,
        contractorId: commission.contractor.id,
        amount: commission.totalAmount.toNumber(),
        reason,
      },
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      commission: updatedCommission,
    },
  });
});

// @desc    Get invoice statistics
// @route   GET /api/admin/invoices/statistics
// @access  Private (Admin only)
export const getInvoiceStatistics = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { startDate, endDate } = req.query;
  
  const dateFilter: any = {};
  if (startDate && endDate) {
    dateFilter.createdAt = {
      gte: new Date(startDate as string),
      lte: new Date(endDate as string),
    };
  }

  // Get regular invoice statistics
  const regularInvoices = await prisma.invoice.findMany({
    where: dateFilter,
    select: {
      amount: true,
      vatAmount: true,
      totalAmount: true,
      createdAt: true,
      payment: {
        select: {
          status: true,
        },
      },
    },
  });

  // Get commission invoice statistics
  const commissionInvoices = await prisma.commissionInvoice.findMany({
    where: dateFilter,
    select: {
      commissionAmount: true,
      vatAmount: true,
      totalAmount: true,
      createdAt: true,
      commissionPayment: {
        select: {
          status: true,
        },
      },
    },
  });

  // Calculate statistics
  const regularTotal = regularInvoices.reduce((sum, invoice) => sum + invoice.totalAmount.toNumber(), 0);
  const commissionTotal = commissionInvoices.reduce((sum, invoice) => sum + invoice.totalAmount.toNumber(), 0);
  const totalAmount = regularTotal + commissionTotal;

  const regularPaid = regularInvoices
    .filter(invoice => invoice.payment?.status === 'COMPLETED')
    .reduce((sum, invoice) => sum + invoice.totalAmount.toNumber(), 0);
    
  const commissionPaid = commissionInvoices
    .filter(invoice => invoice.commissionPayment?.status === 'PAID')
    .reduce((sum, invoice) => sum + invoice.totalAmount.toNumber(), 0);
    
  const totalPaid = regularPaid + commissionPaid;

  const regularUnpaid = regularInvoices
    .filter(invoice => invoice.payment?.status !== 'COMPLETED')
    .reduce((sum, invoice) => sum + invoice.totalAmount.toNumber(), 0);
    
  const commissionUnpaid = commissionInvoices
    .filter(invoice => invoice.commissionPayment?.status !== 'PAID')
    .reduce((sum, invoice) => sum + invoice.totalAmount.toNumber(), 0);
    
  const totalUnpaid = regularUnpaid + commissionUnpaid;

  const overdueCommissions = await prisma.commissionPayment.count({
    where: {
      ...dateFilter,
      OR: [
        { status: 'PENDING', dueDate: { lt: new Date() } },
        { status: 'OVERDUE' },
      ],
    },
  });

  // Group by month for chart data
  const months = [];
  const currentDate = new Date();
  for (let i = 11; i >= 0; i--) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    months.push(date);
  }

  const monthlyData = months.map(month => {
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    
    const regularMonthly = regularInvoices
      .filter(invoice => invoice.createdAt >= month && invoice.createdAt < nextMonth)
      .reduce((sum, invoice) => sum + invoice.totalAmount.toNumber(), 0);
      
    const commissionMonthly = commissionInvoices
      .filter(invoice => invoice.createdAt >= month && invoice.createdAt < nextMonth)
      .reduce((sum, invoice) => sum + invoice.totalAmount.toNumber(), 0);
    
    return {
      month: month.toLocaleString('default', { month: 'short', year: 'numeric' }),
      regularAmount: regularMonthly,
      commissionAmount: commissionMonthly,
      totalAmount: regularMonthly + commissionMonthly,
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      summary: {
        totalAmount,
        totalPaid,
        totalUnpaid,
        overdueCommissions,
        regularCount: regularInvoices.length,
        commissionCount: commissionInvoices.length,
        regularTotal,
        commissionTotal,
      },
      monthly: monthlyData,
    },
  });
});

// Routes
router.use(protect);
router.use(restrictTo('ADMIN', 'SUPER_ADMIN'));

router.get('/', getAllInvoices);
router.get('/statistics', getInvoiceStatistics);
router.get('/overdue-commissions', getOverdueCommissions);
router.get('/:id', getInvoiceDetails);
router.post('/send-commission-reminder/:id', sendCommissionReminder);
router.patch('/waive-commission/:id', waiveCommission);

export default router;
