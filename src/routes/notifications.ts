import express from 'express';
import { protectRoute } from '../middleware/auth';
import * as notificationService from '../services/notificationService';

const router = express.Router();

/**
 * Get user notifications
 * GET /api/notifications
 */
router.get('/', protectRoute, async (req, res) => {
  try {
    const userId = req.user!.id;
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const result = await notificationService.getUserNotifications(userId, {
      unreadOnly,
      limit,
      offset,
    });

    res.json({
      status: 'success',
      data: result,
    });
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch notifications',
      error: error.message,
    });
  }
});

/**
 * Get unread count
 * GET /api/notifications/unread-count
 */
router.get('/unread-count', protectRoute, async (req, res) => {
  try {
    const userId = req.user!.id;
    const result = await notificationService.getUserNotifications(userId, {
      unreadOnly: true,
      limit: 0,
    });

    res.json({
      status: 'success',
      data: { count: result.unreadCount },
    });
  } catch (error: any) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch unread count',
      error: error.message,
    });
  }
});

/**
 * Mark notification as read
 * PATCH /api/notifications/:id/read
 */
router.patch('/:id/read', protectRoute, async (req, res) => {
  try {
    const userId = req.user!.id;
    const notificationId = req.params.id;

    const notification = await notificationService.markNotificationAsRead(
      notificationId,
      userId
    );

    res.json({
      status: 'success',
      data: notification,
    });
  } catch (error: any) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to mark notification as read',
      error: error.message,
    });
  }
});

/**
 * Mark all notifications as read
 * PATCH /api/notifications/read-all
 */
router.patch('/read-all', protectRoute, async (req, res) => {
  try {
    const userId = req.user!.id;

    const result = await notificationService.markAllNotificationsAsRead(userId);

    res.json({
      status: 'success',
      data: result,
    });
  } catch (error: any) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to mark all notifications as read',
      error: error.message,
    });
  }
});

/**
 * Delete notification
 * DELETE /api/notifications/:id
 */
router.delete('/:id', protectRoute, async (req, res) => {
  try {
    const userId = req.user!.id;
    const notificationId = req.params.id;

    await notificationService.deleteNotification(notificationId, userId);

    res.json({
      status: 'success',
      message: 'Notification deleted',
    });
  } catch (error: any) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete notification',
      error: error.message,
    });
  }
});

/**
 * Delete all notifications
 * DELETE /api/notifications
 */
router.delete('/', protectRoute, async (req, res) => {
  try {
    const userId = req.user!.id;

    await notificationService.deleteAllNotifications(userId);

    res.json({
      status: 'success',
      message: 'All notifications deleted',
    });
  } catch (error: any) {
    console.error('Error deleting all notifications:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete all notifications',
      error: error.message,
    });
  }
});

/**
 * Subscribe to push notifications
 * POST /api/notifications/push/subscribe
 */
router.post('/push/subscribe', protectRoute, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { subscription, deviceType } = req.body;
    const userAgent = req.headers['user-agent'];

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid subscription object',
      });
    }

    const result = await notificationService.subscribeToPush(
      userId,
      subscription,
      deviceType,
      userAgent
    );

    res.json({
      status: 'success',
      data: result,
      message: 'Successfully subscribed to push notifications',
    });
  } catch (error: any) {
    console.error('Error subscribing to push notifications:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to subscribe to push notifications',
      error: error.message,
    });
  }
});

/**
 * Unsubscribe from push notifications
 * POST /api/notifications/push/unsubscribe
 */
router.post('/push/unsubscribe', protectRoute, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({
        status: 'error',
        message: 'Endpoint is required',
      });
    }

    await notificationService.unsubscribeFromPush(userId, endpoint);

    res.json({
      status: 'success',
      message: 'Successfully unsubscribed from push notifications',
    });
  } catch (error: any) {
    console.error('Error unsubscribing from push notifications:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to unsubscribe from push notifications',
      error: error.message,
    });
  }
});

/**
 * Get VAPID public key
 * GET /api/notifications/push/public-key
 */
router.get('/push/public-key', (req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  
  if (!publicKey) {
    return res.status(500).json({
      status: 'error',
      message: 'Push notifications are not configured',
    });
  }

  res.json({
    status: 'success',
    data: { publicKey },
  });
});

export default router;
