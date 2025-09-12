import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { createEmailService, createServiceEmail } from '../services/emailService';
import { generateInvoicePDF } from '../services/pdfService';

const router = Router();

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

  // Get invoices where payment is related to the contractor
  const invoices = await prisma.invoice.findMany({
    where: {
      payments: {
        some: {
          contractorId: contractor.id
        }
      }
    },
    include: {
      payments: {
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          job: {
            select: {
              id: true,
              title: true,
              location: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const total = await prisma.invoice.count({
    where: {
      payments: {
        some: {
          contractorId: contractor.id
        }
      }
    },
  });

  res.status(200).json({
    status: 'success',
    data: invoices,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
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
      payments: {
        some: {
          contractorId: contractor.id
        }
      }
    },
    include: {
      payments: {
        select: {
          id: true,
          type: true,
          status: true,
          amount: true,
          createdAt: true,
          job: {
            select: {
              id: true,
              title: true,
              location: true,
              description: true,
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
      payments: {
        some: {
          contractorId: contractor.id
        }
      }
    },
    include: {
      payments: {
        select: {
          type: true,
          status: true,
          createdAt: true,
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
              title: true,
              location: true,
            },
          },
        },
      },
    },
  });

  if (!invoice) {
    return next(new AppError('Invoice not found', 404));
  }

  try {
    // Create email service
    const emailService = createEmailService();
    
    // Get the first payment with its associated contractor and job
    const payment = invoice.payments[0];
    const recipientEmail = payment?.contractor?.user?.email || invoice.recipientEmail;
    const recipientName = payment?.contractor?.user?.name || invoice.recipientName;
    const jobTitle = payment?.job?.title || 'Job lead access';
    const jobLocation = payment?.job?.location || 'Unknown location';
    const paymentStatus = payment?.status || 'PENDING';
    
    // Create mail options with proper template
    const mailOptions = createServiceEmail({
      to: recipientEmail,
      subject: `TrustBuild Invoice ${invoice.invoiceNumber}`,
      heading: 'Invoice from TrustBuild',
      body: `
        <p>Dear ${recipientName},</p>
        <p>Please find your invoice details for the job lead access.</p>
        
        <h3>Invoice Details:</h3>
        <ul>
          <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
          <li><strong>Date:</strong> ${invoice.createdAt.toLocaleDateString()}</li>
          <li><strong>Amount:</strong> £${invoice.totalAmount.toFixed(2)}</li>
          <li><strong>Status:</strong> ${paymentStatus}</li>
        </ul>
        
        <h3>Job Details:</h3>
        <ul>
          <li><strong>Job:</strong> ${jobTitle}</li>
          <li><strong>Location:</strong> ${jobLocation}</li>
        </ul>
      `
    });
    
    // Email notifications disabled - invoices are now only accessible in-app
    console.log(`✅ Email sending disabled - Invoice ${invoice.invoiceNumber} for recipient: ${mailOptions.to}`);
    
    // Update invoice to mark as sent
    await prisma.invoice.update({
      where: { id },
      data: { emailSent: true } as any,
    });

    res.status(200).json({
      status: 'success',
      message: 'Invoice sent successfully',
    });
  } catch (error) {
    console.error('❌ Failed to send invoice email:', error);
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
      where: { 
        payments: {
          some: {
            status: 'COMPLETED'
          }
        }
      },
    }),
    prisma.invoice.aggregate({
      where: { 
        payments: {
          some: {
            status: 'COMPLETED'
          }
        }
      },
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
          }
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
    revenue: totalRevenue._sum?.totalAmount ?? 0,
    recent: recentInvoices,
    byType: invoicesByType,
  };

  res.status(200).json({
    status: 'success',
    data: { stats },
  });
});

// @desc    Get user's invoices (contractor or customer)
// @route   GET /api/invoices/my
// @access  Private
export const getMyInvoices = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  
  let whereCondition = {};
  let invoices = [];
  let total = 0;
  
  // Different logic based on user role
  if (userRole === 'CONTRACTOR') {
    // Get contractor profile
    const contractor = await prisma.contractor.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!contractor) {
      return next(new AppError('Contractor profile not found', 404));
    }
    
    // Query invoices related to this contractor
    whereCondition = {
      payments: {
        some: {
          contractorId: contractor.id
        }
      }
    };
  } else if (userRole === 'CUSTOMER') {
    // Get customer profile
    const customer = await prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!customer) {
      return next(new AppError('Customer profile not found', 404));
    }
    
    // Query invoices related to this customer
    whereCondition = {
      payments: {
        some: {
          customerId: customer.id
        }
      }
    };
  } else {
    return next(new AppError('Unauthorized', 403));
  }
  
  // Get invoices
  invoices = await prisma.invoice.findMany({
    where: whereCondition,
    include: {
      payments: {
        select: {
          id: true,
          type: true,
          status: true,
          amount: true,
          createdAt: true,
          job: {
            select: {
              id: true,
              title: true,
              location: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });
  
  // Get total count
  total = await prisma.invoice.count({
    where: whereCondition,
  });

  res.status(200).json({
    status: 'success',
    data: invoices,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// @desc    Download invoice PDF
// @route   GET /api/invoices/:id/download
// @access  Private (Contractor only)
export const downloadInvoice = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

  // Get invoice with payment details
  const invoice = await prisma.invoice.findFirst({
    where: {
      id,
      payments: {
        some: {
          contractorId: contractor.id
        }
      }
    },
    include: {
      payments: {
        include: {
          job: {
            select: {
              title: true
            }
          }
        }
      }
    }
  });

  if (!invoice) {
    return next(new AppError('Invoice not found or you do not have permission to view it', 404));
  }

  try {
    // Generate PDF on the fly
    const pdfBuffer = await generateInvoicePDF({
      invoiceNumber: invoice.invoiceNumber,
      recipientName: invoice.recipientName,
      recipientEmail: invoice.recipientEmail,
      recipientAddress: invoice.recipientAddress || undefined,
      description: invoice.description,
      amount: Number(invoice.amount),
      vatAmount: Number(invoice.vatAmount),
      totalAmount: Number(invoice.totalAmount),
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt || undefined,
      paidAt: invoice.paidAt || undefined,
      paymentType: invoice.payments[0]?.type || undefined,
      vatRate: Number(invoice.vatRate)
    });

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send the PDF buffer
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Failed to generate invoice PDF:', error);
    return next(new AppError('Failed to generate invoice PDF', 500));
  }
});

// Routes
router.use(protect); // All routes require authentication

router.get('/', getInvoices);
router.get('/my', getMyInvoices); // Add the /my endpoint with the new handler
router.get('/stats', getInvoiceStats);
router.get('/:id', getInvoice);
router.get('/:id/download', downloadInvoice);
router.post('/:id/send', sendInvoiceEmail);

export default router; 