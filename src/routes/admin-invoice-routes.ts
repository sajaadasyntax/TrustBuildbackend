import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protectAdmin, AdminAuthRequest, requirePermission } from '../middleware/adminAuth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { AdminPermission } from '../config/permissions';
import { generateInvoicePDF } from '../services/pdfService';

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
      totalAmount: (inv.total || 0) / 100, // Convert from pence, handle null/undefined
      amount: (inv.subtotal || 0) / 100, // Convert from pence, handle null/undefined
      vatAmount: (inv.tax || 0) / 100, // Convert from pence, handle null/undefined
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

  // Try to find in regular invoices first
  let invoice = await prisma.invoice.findUnique({
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

  // If not found in regular invoices, check manual invoices
  if (!invoice) {
    const manualInvoice = await prisma.manualInvoice.findUnique({
      where: { id },
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
      }
    });

    if (manualInvoice) {
      // Format manual invoice to match regular invoice structure
      invoice = {
        id: manualInvoice.id,
        invoiceNumber: manualInvoice.number,
        type: 'manual',
        contractorId: manualInvoice.contractorId,
        totalAmount: (manualInvoice.total || 0) / 100, // Convert from pence, handle null/undefined
        amount: (manualInvoice.subtotal || 0) / 100, // Convert from pence, handle null/undefined
        vatAmount: (manualInvoice.tax || 0) / 100, // Convert from pence, handle null/undefined
        status: manualInvoice.status,
        createdAt: manualInvoice.createdAt,
        issuedAt: manualInvoice.issuedAt,
        paidAt: manualInvoice.paidAt,
        dueAt: manualInvoice.dueDate,
        description: manualInvoice.reason || manualInvoice.notes || 'Manual Invoice',
        recipientName: manualInvoice.contractor.businessName || manualInvoice.contractor.user.name,
        recipientEmail: manualInvoice.contractor.user.email,
        payments: [],
        items: manualInvoice.items.map(item => ({
          description: item.description,
          amount: item.amount / 100,
          quantity: item.quantity,
        })),
        contractor: manualInvoice.contractor,
      } as any;
    }
  }

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

  // First, try to find a regular invoice
  let invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      payments: {
        take: 1
      }
    }
  });

  if (invoice) {
    // Handle regular invoice
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

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: updateData,
      include: {
        payments: {
          take: 1
        }
      }
    });

    // If invoice status is updated to paid, also update related payment if it exists
    if (status === 'PAID' && updatedInvoice.payments && updatedInvoice.payments.length > 0) {
      await prisma.payment.update({
        where: { id: updatedInvoice.payments[0].id },
        data: { status: 'COMPLETED' }
      });
    }

    // Notify contractor when invoice is marked as paid
    if (status === 'PAID') {
      try {
        const invoiceWithContractor = await prisma.invoice.findUnique({
          where: { id },
          include: {
            payments: {
              include: {
                contractor: {
                  include: {
                    user: {
                      select: {
                        id: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        const contractorUserId = invoiceWithContractor?.payments?.[0]?.contractor?.user?.id;
        if (contractorUserId) {
          const { createNotification } = await import('../services/notificationService');
          await createNotification({
            userId: contractorUserId,
            title: 'Invoice Paid',
            message: `Your invoice ${updatedInvoice.invoiceNumber} has been marked as paid. Amount: £${(Number(updatedInvoice.totalAmount || 0) / 100).toFixed(2)}`,
            type: 'SUCCESS',
            actionLink: '/dashboard/contractor/invoices',
            actionText: 'View Invoices',
            metadata: {
              invoiceId: id,
              invoiceNumber: updatedInvoice.invoiceNumber,
            },
          });
        }
      } catch (error) {
        console.error('Failed to send invoice paid notification:', error);
      }
    }

    return res.status(200).json({
      status: 'success',
      data: { invoice: updatedInvoice }
    });
  }

  // If not a regular invoice, try manual invoice
  let manualInvoice = await prisma.manualInvoice.findUnique({
    where: { id },
    include: {
      contractor: {
        include: {
          user: {
            select: {
              name: true,
              email: true
            }
          }
        }
      },
      items: true
    }
  });

  if (manualInvoice) {
    // Handle manual invoice
    let updateData: any = {};

    // Map status to ManualInvoiceStatus enum
    if (status === 'PAID') {
      updateData.status = 'PAID';
      updateData.paidAt = new Date();
    } else if (status === 'PENDING' || status === 'ISSUED') {
      updateData.status = 'ISSUED';
      updateData.paidAt = null;
      if (!manualInvoice.issuedAt) {
        updateData.issuedAt = new Date();
      }
    } else if (status === 'OVERDUE') {
      updateData.status = 'OVERDUE';
      updateData.paidAt = null;
    } else if (status === 'CANCELLED' || status === 'CANCELED') {
      updateData.status = 'CANCELED';
      updateData.paidAt = null;
    } else if (status === 'DRAFT') {
      updateData.status = 'DRAFT';
      updateData.paidAt = null;
    } else {
      return next(new AppError('Invalid status', 400));
    }

    const updatedManualInvoice = await prisma.manualInvoice.update({
      where: { id },
      data: updateData,
      include: {
        contractor: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        },
        items: true
      }
    });

    // Notify contractor when manual invoice is marked as paid
    if (status === 'PAID') {
      try {
        const { createNotification } = await import('../services/notificationService');
        await createNotification({
          userId: updatedManualInvoice.contractor.user.id,
          title: 'Invoice Paid',
          message: `Your invoice ${updatedManualInvoice.number} has been marked as paid. Amount: £${((updatedManualInvoice.total || 0) / 100).toFixed(2)}`,
          type: 'SUCCESS',
          actionLink: '/dashboard/contractor/invoices',
          actionText: 'View Invoices',
          metadata: {
            invoiceId: id,
            invoiceNumber: updatedManualInvoice.number,
            isManual: true,
          },
        });
      } catch (error) {
        console.error('Failed to send manual invoice paid notification:', error);
      }
    }

    // Format response to match regular invoice structure
    const formattedInvoice = {
      id: updatedManualInvoice.id,
      invoiceNumber: updatedManualInvoice.number,
      recipientName: updatedManualInvoice.contractor.businessName || updatedManualInvoice.contractor.user.name,
      recipientEmail: updatedManualInvoice.contractor.user.email,
      description: updatedManualInvoice.reason || updatedManualInvoice.notes || 'Manual Invoice',
      amount: (updatedManualInvoice.subtotal || 0) / 100,
      vatAmount: (updatedManualInvoice.tax || 0) / 100,
      totalAmount: (updatedManualInvoice.total || 0) / 100,
      status: updatedManualInvoice.status,
      createdAt: updatedManualInvoice.createdAt,
      issuedAt: updatedManualInvoice.issuedAt,
      dueAt: updatedManualInvoice.dueDate,
      paidAt: updatedManualInvoice.paidAt,
      isManual: true,
    };

    return res.status(200).json({
      status: 'success',
      data: { invoice: formattedInvoice }
    });
  }

  // If neither invoice type found
  return next(new AppError('Invoice not found', 404));
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

// @desc    Download invoice PDF
// @route   GET /api/admin/invoices/:id/download
// @access  Private (Admin only)
export const downloadInvoice = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  // Try to find in regular invoices first
  let invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      payments: {
        take: 1
      }
    }
  });

  let invoiceData: any;

  if (invoice) {
    // Regular invoice
    invoiceData = {
      invoiceNumber: invoice.invoiceNumber,
      recipientName: invoice.recipientName,
      recipientEmail: invoice.recipientEmail,
      recipientAddress: invoice.recipientAddress || undefined,
      description: invoice.description,
      amount: Number(invoice.amount),
      vatAmount: Number(invoice.vatAmount || 0),
      totalAmount: Number(invoice.totalAmount),
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt || undefined,
      paidAt: invoice.paidAt || undefined,
      paymentType: invoice.payments[0]?.type || undefined,
      vatRate: Number(invoice.vatRate || 20)
    };
  } else {
    // Try manual invoice
    const manualInvoice = await prisma.manualInvoice.findUnique({
      where: { id },
      include: {
        contractor: {
          include: {
            user: {
              select: {
                name: true,
                email: true
              }
            }
          }
        },
        items: true,
      }
    });

    if (!manualInvoice) {
      return next(new AppError('Invoice not found', 404));
    }

    invoiceData = {
      invoiceNumber: manualInvoice.number,
      recipientName: manualInvoice.contractor.businessName || manualInvoice.contractor.user.name,
      recipientEmail: manualInvoice.contractor.user.email,
      recipientAddress: manualInvoice.contractor.businessAddress || undefined,
      description: manualInvoice.reason || manualInvoice.notes || 'Manual Invoice',
      amount: (manualInvoice.subtotal || 0) / 100,
      vatAmount: (manualInvoice.tax || 0) / 100,
      totalAmount: (manualInvoice.total || 0) / 100,
      issuedAt: manualInvoice.issuedAt || manualInvoice.createdAt,
      dueAt: manualInvoice.dueDate || undefined,
      paidAt: manualInvoice.paidAt || undefined,
      paymentType: 'Manual Invoice',
      vatRate: 20,
      items: manualInvoice.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        amount: item.amount / 100,
      }))
    };
  }

  try {
    // Generate PDF on the fly
    const pdfBuffer = await generateInvoicePDF(invoiceData);

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceData.invoiceNumber}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send the PDF buffer
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Failed to generate invoice PDF:', error);
    return next(new AppError('Failed to generate invoice PDF', 500));
  }
});

// @desc    Send invoice via email
// @route   POST /api/admin/invoices/:id/send-email
// @access  Private (Admin only)
export const sendInvoiceEmail = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  // Try to find in regular invoices first
  let invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      payments: {
        include: {
          contractor: {
            include: {
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
              title: true,
              location: true
            }
          }
        },
        take: 1
      }
    }
  });

  if (invoice) {
    // Regular invoice - send email
    try {
      const { createEmailService, createServiceEmail } = await import('../services/emailService');
      const emailService = createEmailService();
      
      const payment = invoice.payments[0];
      const recipientEmail = payment?.contractor?.user?.email || invoice.recipientEmail;
      const recipientName = payment?.contractor?.user?.name || invoice.recipientName;
      const jobTitle = payment?.job?.title || 'Job lead access';
      
      const mailOptions = createServiceEmail({
        to: recipientEmail,
        subject: `TrustBuild Invoice ${invoice.invoiceNumber}`,
        heading: 'Invoice from TrustBuild',
        body: `
          <p>Dear ${recipientName},</p>
          <p>Please find your invoice details below.</p>
          
          <h3>Invoice Details:</h3>
          <ul>
            <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
            <li><strong>Date:</strong> ${new Date(invoice.createdAt).toLocaleDateString()}</li>
            <li><strong>Amount:</strong> £${Number(invoice.totalAmount).toFixed(2)}</li>
            <li><strong>Description:</strong> ${invoice.description}</li>
            ${jobTitle ? `<li><strong>Job:</strong> ${jobTitle}</li>` : ''}
          </ul>
        `,
        ctaText: 'View Invoice',
        ctaUrl: `${process.env.FRONTEND_URL || 'https://trustbuild.uk'}/admin/invoices/${invoice.id}`
      });
      
      // Add emailType to options for logging
      (mailOptions as any).emailType = 'invoice';
      await emailService.sendMail(mailOptions);
      
      res.status(200).json({
        status: 'success',
        message: 'Invoice sent successfully',
      });
    } catch (error) {
      console.error('Failed to send invoice email:', error);
      return next(new AppError('Failed to send invoice email', 500));
    }
  } else {
    // Try manual invoice
    const { sendInvoiceEmail: sendManualInvoiceEmail } = await import('../services/manualInvoiceService');
    
    try {
      await sendManualInvoiceEmail(id);
      
      res.status(200).json({
        status: 'success',
        message: 'Invoice sent successfully',
      });
    } catch (error: any) {
      if (error.message === 'Invoice not found') {
        return next(new AppError('Invoice not found', 404));
      }
      console.error('Failed to send manual invoice email:', error);
      return next(new AppError('Failed to send invoice email', 500));
    }
  }
});

router.get('/stats', requirePermission(AdminPermission.PAYMENTS_READ), getInvoiceStats);
router.get('/', requirePermission(AdminPermission.PAYMENTS_READ), getAllInvoices);
router.get('/:id/download', requirePermission(AdminPermission.PAYMENTS_READ), downloadInvoice);
router.post('/:id/send-email', requirePermission(AdminPermission.PAYMENTS_WRITE), sendInvoiceEmail);
router.get('/:id', requirePermission(AdminPermission.PAYMENTS_READ), getInvoiceById);
router.patch('/:id/status', requirePermission(AdminPermission.PAYMENTS_WRITE), updateInvoiceStatus);

export default router;
