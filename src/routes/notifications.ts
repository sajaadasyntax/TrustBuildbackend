import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { markNotificationAsRead, markAllNotificationsAsRead } from '../services/notificationService';

const router = Router();

// @desc    Get user notifications
// @route   GET /api/notifications
// @access  Private
export const getNotifications = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const unreadOnly = req.query.unreadOnly === 'true';

  // Build where clause
  const where: any = { userId };
  if (unreadOnly) {
    where.isRead = false;
  }

  // Get notifications
  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  // Get total count
  const total = await prisma.notification.count({ where });

  // Get unread count
  const unreadCount = await prisma.notification.count({
    where: {
      userId,
      isRead: false,
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      notifications,
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

// @desc    Mark notification as read
// @route   PATCH /api/notifications/:id/read
// @access  Private
export const readNotification = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const result = await markNotificationAsRead(id, userId);

  if (!result || result.count === 0) {
    return next(new AppError('Notification not found or already read', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Notification marked as read',
  });
});

// @desc    Mark all notifications as read
// @route   PATCH /api/notifications/read-all
// @access  Private
export const readAllNotifications = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;

  await markAllNotificationsAsRead(userId);

  res.status(200).json({
    status: 'success',
    message: 'All notifications marked as read',
  });
});

// @desc    Delete notification
// @route   DELETE /api/notifications/:id
// @access  Private
export const deleteNotification = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const result = await prisma.notification.deleteMany({
    where: {
      id,
      userId,
    },
  });

  if (result.count === 0) {
    return next(new AppError('Notification not found', 404));
  }

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

// @desc    Update notification settings
// @route   PATCH /api/notifications/settings
// @access  Private
export const updateNotificationSettings = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;
  const { settings } = req.body;

  if (!settings) {
    return next(new AppError('Notification settings are required', 400));
  }

  // Get current settings
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationSettings: true },
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Parse current settings
  const currentSettings = typeof user.notificationSettings === 'string'
    ? JSON.parse(user.notificationSettings)
    : user.notificationSettings;

  // Merge with new settings
  const updatedSettings = {
    ...currentSettings,
    ...settings,
  };

  // Update user settings
  await prisma.user.update({
    where: { id: userId },
    data: {
      notificationSettings: updatedSettings,
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      settings: updatedSettings,
    },
  });
});

// @desc    Get notification settings
// @route   GET /api/notifications/settings
// @access  Private
export const getNotificationSettings = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationSettings: true },
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Parse settings
  const settings = typeof user.notificationSettings === 'string'
    ? JSON.parse(user.notificationSettings)
    : user.notificationSettings;

  res.status(200).json({
    status: 'success',
    data: {
      settings,
    },
  });
});

// Routes
router.use(protect);

router.get('/', getNotifications);
router.patch('/:id/read', readNotification);
router.patch('/read-all', readAllNotifications);
router.delete('/:id', deleteNotification);
router.get('/settings', getNotificationSettings);
router.patch('/settings', updateNotificationSettings);

export default router;
