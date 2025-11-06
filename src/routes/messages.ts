import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { protect } from '../middleware/auth';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types';
import { UserRole } from '@prisma/client';

const router = Router();

// @desc    Send a message (with restrictions)
// @route   POST /api/messages
// @access  Private
export const sendMessage = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { recipientId, subject, content, relatedJobId, attachmentUrls } = req.body;
  const senderId = req.user!.id;
  const senderRole = req.user!.role;

  if (!recipientId || !content) {
    throw new AppError('Recipient and message content are required', 400);
  }

  // Get recipient information
  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { id: true, role: true, email: true, name: true },
  });

  if (!recipient) {
    throw new AppError('Recipient not found', 404);
  }

  // CRITICAL: Enforce messaging restrictions
  // Only allowed: Admin↔Customer, Admin↔Contractor
  // NOT allowed: Customer↔Contractor

  const isAdminSender = senderRole === 'ADMIN' || senderRole === 'SUPER_ADMIN';
  const isAdminRecipient = recipient.role === 'ADMIN' || recipient.role === 'SUPER_ADMIN';
  const isCustomerSender = senderRole === 'CUSTOMER';
  const isContractorSender = senderRole === 'CONTRACTOR';
  const isCustomerRecipient = recipient.role === 'CUSTOMER';
  const isContractorRecipient = recipient.role === 'CONTRACTOR';

  // Check if this is a forbidden customer-contractor direct message
  if ((isCustomerSender && isContractorRecipient) || (isContractorSender && isCustomerRecipient)) {
    throw new AppError(
      'Direct messaging between customers and contractors is not allowed. Please contact admin for assistance.',
      403
    );
  }

  // Validate allowed message types
  const isAllowed =
    (isAdminSender && (isCustomerRecipient || isContractorRecipient)) || // Admin → Customer/Contractor
    ((isCustomerSender || isContractorSender) && isAdminRecipient); // Customer/Contractor → Admin

  if (!isAllowed) {
    throw new AppError('You do not have permission to send this message', 403);
  }

  // Create the message
  const message = await prisma.message.create({
    data: {
      senderId,
      senderRole,
      recipientId,
      recipientRole: recipient.role,
      subject,
      content,
      relatedJobId,
      attachmentUrls: attachmentUrls || [],
    },
  });

  // Create notification for recipient
  const { createNotification } = await import('../services/notificationService');
  await createNotification({
    userId: recipientId,
    title: subject || 'New Message',
    message: `You have a new message from ${req.user!.name}`,
    type: 'MESSAGE_RECEIVED',
    actionLink: `/messages/${message.id}`,
    actionText: 'View Message',
  });

  res.status(201).json({
    status: 'success',
    message: 'Message sent successfully',
    data: { message },
  });
});

// @desc    Get user's messages (inbox)
// @route   GET /api/messages
// @access  Private
export const getMessages = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;
  const type = req.query.type as string; // 'inbox' or 'sent'

  const where =
    type === 'sent'
      ? { senderId: userId }
      : { recipientId: userId };

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        recipient: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.message.count({ where }),
  ]);

  // Get unread count for inbox
  const unreadCount =
    type === 'sent'
      ? 0
      : await prisma.message.count({
          where: {
            recipientId: userId,
            isRead: false,
          },
        });

  res.status(200).json({
    status: 'success',
    data: {
      messages,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get single message
// @route   GET /api/messages/:id
// @access  Private
export const getMessage = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const messageId = req.params.id;
  const userId = req.user!.id;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
      recipient: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  });

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  // Check if user has access to this message
  if (message.senderId !== userId && message.recipientId !== userId) {
    throw new AppError('You do not have permission to view this message', 403);
  }

  // Mark as read if user is recipient
  if (message.recipientId === userId && !message.isRead) {
    await prisma.message.update({
      where: { id: messageId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
    message.isRead = true;
    message.readAt = new Date();
  }

  res.status(200).json({
    status: 'success',
    data: { message },
  });
});

// @desc    Mark message as read
// @route   PATCH /api/messages/:id/read
// @access  Private
export const markMessageAsRead = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const messageId = req.params.id;
  const userId = req.user!.id;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  // Only recipient can mark as read
  if (message.recipientId !== userId) {
    throw new AppError('You do not have permission to update this message', 403);
  }

  const updatedMessage = await prisma.message.update({
    where: { id: messageId },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  res.status(200).json({
    status: 'success',
    data: { message: updatedMessage },
  });
});

// @desc    Delete message
// @route   DELETE /api/messages/:id
// @access  Private
export const deleteMessage = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const messageId = req.params.id;
  const userId = req.user!.id;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  // Only sender or recipient can delete
  if (message.senderId !== userId && message.recipientId !== userId) {
    throw new AppError('You do not have permission to delete this message', 403);
  }

  await prisma.message.delete({
    where: { id: messageId },
  });

  res.status(200).json({
    status: 'success',
    message: 'Message deleted successfully',
  });
});

// @desc    Get conversation thread
// @route   GET /api/messages/conversation/:userId
// @access  Private
export const getConversation = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const currentUserId = req.user!.id;
  const otherUserId = req.params.userId;

  // Get messages between these two users
  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: currentUserId, recipientId: otherUserId },
        { senderId: otherUserId, recipientId: currentUserId },
      ],
    },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
      recipient: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  res.status(200).json({
    status: 'success',
    data: { messages },
  });
});

// Register routes
router.post('/', protect, sendMessage);
router.get('/', protect, getMessages);
router.get('/conversation/:userId', protect, getConversation);
router.get('/:id', protect, getMessage);
router.patch('/:id/read', protect, markMessageAsRead);
router.delete('/:id', protect, deleteMessage);

export default router;

