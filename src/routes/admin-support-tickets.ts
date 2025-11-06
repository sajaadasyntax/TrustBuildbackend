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

const router = express.Router();

// Generate ticket number
async function generateTicketNumber(): Promise<string> {
  const count = await prisma.supportTicket.count();
  const ticketNum = (count + 1).toString().padStart(6, '0');
  return `TKT${ticketNum}`;
}

// Get all support tickets
router.get(
  '/',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const {
      status,
      priority,
      category,
      search,
      page = '1',
      limit = '20',
    } = req.query;

    const where: any = {};
    if (status && status !== 'all') where.status = status;
    if (priority && priority !== 'all') where.priority = priority;
    if (category && category !== 'all') where.category = category;
    
    if (search) {
      where.OR = [
        { ticketNumber: { contains: search as string, mode: 'insensitive' } },
        { subject: { contains: search as string, mode: 'insensitive' } },
        { customerName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        include: {
          responses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string),
        skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      }),
      prisma.supportTicket.count({ where }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        tickets,
        total,
        page: parseInt(page as string),
        totalPages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  })
);

// Get ticket statistics
router.get(
  '/stats',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const [
      openTickets,
      inProgressTickets,
      resolvedToday,
      totalTickets,
    ] = await Promise.all([
      prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      prisma.supportTicket.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.supportTicket.count({
        where: {
          status: 'RESOLVED',
          resolvedAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
      prisma.supportTicket.count(),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        stats: {
          openTickets,
          inProgressTickets,
          resolvedToday,
          totalTickets,
          averageResponseTime: '2.5 hours', // Can be calculated from response times
        },
      },
    });
  })
);

// Get specific ticket
router.get(
  '/:ticketId',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { ticketId } = req.params;

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        responses: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({
        status: 'error',
        message: 'Ticket not found',
      });
    }

    res.status(200).json({
      status: 'success',
      data: { ticket },
    });
  })
);

// Create support ticket (can be created by admin on behalf of customer)
router.post(
  '/',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const {
      customerName,
      email,
      subject,
      description,
      category = 'GENERAL',
      priority = 'MEDIUM',
      customerId,
    } = req.body;

    if (!customerName || !email || !subject || !description) {
      return res.status(400).json({
        status: 'error',
        message: 'Customer name, email, subject, and description are required',
      });
    }

    const ticketNumber = await generateTicketNumber();

    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNumber,
        customerId,
        customerName,
        email,
        subject,
        description,
        category,
        priority,
        status: 'OPEN',
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'SUPPORT_TICKET_CREATE',
      entityType: 'SupportTicket',
      entityId: ticket.id,
      description: `Created support ticket ${ticket.ticketNumber} for ${customerName}`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(201).json({
      status: 'success',
      data: { ticket },
    });
  })
);

// Update ticket status
router.patch(
  '/:ticketId/status',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { ticketId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        status: 'error',
        message: 'Status is required',
      });
    }

    const updateData: any = { status };
    
    if (status === 'RESOLVED') {
      updateData.resolvedAt = new Date();
      updateData.resolvedBy = req.admin!.email;
    }

    const ticket = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: updateData,
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'SUPPORT_TICKET_STATUS_UPDATE',
      entityType: 'SupportTicket',
      entityId: ticketId,
      description: `Updated ticket ${ticket.ticketNumber} status to ${status}`,
      diff: { oldStatus: ticket.status, newStatus: status },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      data: { ticket },
    });
  })
);

// Assign ticket
router.patch(
  '/:ticketId/assign',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { ticketId } = req.params;
    const { assignee, assigneeId } = req.body;

    const ticket = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        assignee: assignee || req.admin!.name,
        assigneeId: assigneeId || req.admin!.id,
        status: 'IN_PROGRESS',
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'SUPPORT_TICKET_ASSIGN',
      entityType: 'SupportTicket',
      entityId: ticketId,
      description: `Assigned ticket ${ticket.ticketNumber} to ${assignee || req.admin!.name}`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      data: { ticket },
    });
  })
);

// Add response to ticket
router.post(
  '/:ticketId/responses',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { ticketId } = req.params;
    const { message, isInternal = false } = req.body;

    if (!message) {
      return res.status(400).json({
        status: 'error',
        message: 'Message is required',
      });
    }

    const response = await prisma.supportTicketResponse.create({
      data: {
        ticketId,
        userId: req.admin!.id,
        userName: req.admin!.name,
        userRole: 'ADMIN',
        message,
        isInternal,
      },
    });

    // Update ticket's lastResponse timestamp
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { lastResponse: new Date() },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'SUPPORT_TICKET_RESPONSE',
      entityType: 'SupportTicket',
      entityId: ticketId,
      description: `Added ${isInternal ? 'internal note' : 'response'} to support ticket`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(201).json({
      status: 'success',
      data: { response },
    });
  })
);

export default router;

