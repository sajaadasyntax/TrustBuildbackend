import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest, restrictTo } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { generateInvoicePDF } from '../services/pdfService';

const router = Router();

// @desc    Get customer's invoices
// @route   GET /api/customers/me/invoices
// @access  Private (Customer only)
export const getCustomerInvoices = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        payment: {
          customerId: customer.id
        }
      },
      include: {
        payment: {
          select: {
            amount: true,
            status: true,
            type: true,
            createdAt: true
          }
        },
        job: {
          select: {
            id: true,
            title: true,
            description: true,
            location: true
          }
        },
        contractor: {
          select: {
            businessName: true,
            user: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.invoice.count({
      where: {
        payment: {
          customerId: customer.id
        }
      }
    })
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

// @desc    Get customer's invoice by ID
// @route   GET /api/customers/me/invoices/:id
// @access  Private (Customer only)
export const getCustomerInvoiceById = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  const invoice = await prisma.invoice.findFirst({
    where: {
      id,
      payment: {
        customerId: customer.id
      }
    },
    include: {
      payment: {
        select: {
          id: true,
          amount: true,
          status: true,
          type: true,
          createdAt: true
        }
      },
      job: {
        select: {
          id: true,
          title: true,
          description: true,
          location: true
        }
      },
      contractor: {
        select: {
          businessName: true,
          user: {
            select: {
              name: true
            }
          }
        }
      }
    }
  });

  if (!invoice) {
    return next(new AppError('Invoice not found or you do not have permission to view it', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { invoice }
  });
});


// @desc    Download invoice PDF
// @route   GET /api/customers/me/invoices/:id/download
// @access  Private (Customer only)
export const downloadCustomerInvoice = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  const invoice = await prisma.invoice.findFirst({
    where: {
      id,
      payments: {
        some: {
          customerId: customer.id
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

// Register routes
router.use(protect); // All routes require authentication
router.use(restrictTo('CUSTOMER')); // All routes restricted to customers

router.get('/', getCustomerInvoices);
router.get('/:id', getCustomerInvoiceById);
router.get('/:id/download', downloadCustomerInvoice);

export default router;
