import express, { Response } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import {
  protectAdmin,
  requirePermission,
  getClientIp,
  getClientUserAgent,
  AdminAuthRequest,
} from '../middleware/adminAuth';
import { logActivity } from '../services/auditService';
import { prisma } from '../config/database';
import {
  generateInvoiceNumber,
  generateAndSaveInvoicePDF,
  sendInvoiceEmail,
  sendInvoiceReminder,
} from '../services/manualInvoiceService';

const router = express.Router();

// List manual invoices
router.get(
  '/',
  protectAdmin,
  requirePermission('invoices:read'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const {
      status,
      contractorId,
      page = '1',
      limit = '20',
    } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (contractorId) where.contractorId = contractorId;

    const [invoices, total] = await Promise.all([
      prisma.manualInvoice.findMany({
        where,
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
          items: true,
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string),
        skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      }),
      prisma.manualInvoice.count({ where }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        invoices,
        total,
        page: parseInt(page as string),
        totalPages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  })
);

// Get specific invoice
router.get(
  '/:invoiceId',
  protectAdmin,
  requirePermission('invoices:read'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { invoiceId } = req.params;

    const invoice = await prisma.manualInvoice.findUnique({
      where: { id: invoiceId },
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
        items: true,
      },
    });

    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        message: 'Invoice not found',
      });
    }

    res.status(200).json({
      status: 'success',
      data: { invoice },
    });
  })
);

// Create manual invoice (draft)
router.post(
  '/',
  protectAdmin,
  requirePermission('invoices:create'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const {
      contractorId,
      items,
      reason,
      notes,
      dueDate,
    } = req.body;

    if (!contractorId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Contractor ID and invoice items are required',
      });
    }

    // Calculate totals
    let subtotal = 0;
    items.forEach((item: any) => {
      if (!item.description || !item.amount) {
        throw new Error('Each item must have description and amount');
      }
      subtotal += item.amount * (item.quantity || 1);
    });

    const tax = Math.round(subtotal * 0.2); // 20% VAT
    const total = subtotal + tax;

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // Create invoice
    const invoice = await prisma.manualInvoice.create({
      data: {
        contractorId,
        number: invoiceNumber,
        subtotal,
        tax,
        total,
        reason,
        notes,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        createdByAdminId: req.admin!.id,
        status: 'DRAFT',
        items: {
          create: items.map((item: any) => ({
            description: item.description,
            amount: item.amount,
            quantity: item.quantity || 1,
          })),
        },
      },
      include: {
        items: true,
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

    await logActivity({
      adminId: req.admin!.id,
      action: 'MANUAL_INVOICE_CREATE',
      entityType: 'ManualInvoice',
      entityId: invoice.id,
      description: `Created manual invoice ${invoice.number} for contractor ${invoice.contractor.user.email}`,
      diff: { total: total / 100, currency: invoice.currency },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(201).json({
      status: 'success',
      data: { invoice },
    });
  })
);

// Issue invoice (send to contractor)
router.post(
  '/:invoiceId/issue',
  protectAdmin,
  requirePermission('invoices:update'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { invoiceId } = req.params;

    const invoice = await prisma.manualInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        contractor: {
          include: {
            user: {
              select: {
                email: true,
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        message: 'Invoice not found',
      });
    }

    if (invoice.status !== 'DRAFT') {
      return res.status(400).json({
        status: 'error',
        message: 'Only draft invoices can be issued',
      });
    }

    // Generate PDF
    const pdfPath = await generateAndSaveInvoicePDF(invoiceId);

    // Update invoice status
    await prisma.manualInvoice.update({
      where: { id: invoiceId },
      data: {
        status: 'ISSUED',
        issuedAt: new Date(),
      },
    });

    // Send email
    await sendInvoiceEmail(invoiceId);

    await logActivity({
      adminId: req.admin!.id,
      action: 'MANUAL_INVOICE_ISSUE',
      entityType: 'ManualInvoice',
      entityId: invoiceId,
      description: `Issued invoice ${invoice.number} to ${invoice.contractor.user.email}`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Invoice issued and sent successfully',
      data: { pdfPath },
    });
  })
);

// Send reminder
router.post(
  '/:invoiceId/remind',
  protectAdmin,
  requirePermission('invoices:update'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { invoiceId } = req.params;

    const invoice = await prisma.manualInvoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        message: 'Invoice not found',
      });
    }

    if (invoice.status === 'DRAFT' || invoice.status === 'PAID') {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot send reminder for draft or paid invoices',
      });
    }

    await sendInvoiceReminder(invoiceId);

    await logActivity({
      adminId: req.admin!.id,
      action: 'INVOICE_REMINDER_SENT',
      entityType: 'ManualInvoice',
      entityId: invoiceId,
      description: `Sent payment reminder for invoice ${invoice.number}`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Reminder sent successfully',
    });
  })
);

// Record payment
router.post(
  '/:invoiceId/record-payment',
  protectAdmin,
  requirePermission('invoices:update'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { invoiceId } = req.params;
    const { notes } = req.body;

    const invoice = await prisma.manualInvoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        message: 'Invoice not found',
      });
    }

    if (invoice.status === 'PAID') {
      return res.status(400).json({
        status: 'error',
        message: 'Invoice is already marked as paid',
      });
    }

    await prisma.manualInvoice.update({
      where: { id: invoiceId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        notes: notes || invoice.notes,
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'INVOICE_PAYMENT_RECORDED',
      entityType: 'ManualInvoice',
      entityId: invoiceId,
      description: `Recorded payment for invoice ${invoice.number}`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Payment recorded successfully',
    });
  })
);

// Cancel invoice
router.post(
  '/:invoiceId/cancel',
  protectAdmin,
  requirePermission('invoices:delete'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { invoiceId } = req.params;
    const { reason } = req.body;

    const invoice = await prisma.manualInvoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        message: 'Invoice not found',
      });
    }

    if (invoice.status === 'PAID') {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot cancel a paid invoice',
      });
    }

    await prisma.manualInvoice.update({
      where: { id: invoiceId },
      data: {
        status: 'CANCELED',
        notes: reason || invoice.notes,
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'MANUAL_INVOICE_CANCEL',
      entityType: 'ManualInvoice',
      entityId: invoiceId,
      description: `Cancelled invoice ${invoice.number}. Reason: ${reason || 'Not provided'}`,
      diff: { reason },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Invoice cancelled successfully',
    });
  })
);

export default router;

