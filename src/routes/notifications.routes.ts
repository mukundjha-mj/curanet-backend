import express from 'express';
import { Request, Response } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import NotificationService from '../services/notification.service';

const router = express.Router();

interface AuthenticatedRequest extends Request {
  user?: {
    healthId: string;
    email: string | null;
    role: string;
    status: string;
    tokenId: string;
  };
}

/**
 * Get user notifications
 * GET /api/notifications
 */
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    const { limit = 20 } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const notifications = await NotificationService.getUserNotifications(userId, Number(limit));

    res.status(200).json({
      success: true,
      data: {
        notifications,
        count: notifications.length
      }
    });

  } catch (error) {
    console.error('Error getting notifications:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

/**
 * Mark notifications as read
 * POST /api/notifications/read
 */
router.post('/read', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    const { notificationIds } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!notificationIds || !Array.isArray(notificationIds)) {
      return res.status(400).json({ error: 'Notification IDs array required' });
    }

    await NotificationService.markNotificationsAsRead(userId, notificationIds);

    res.status(200).json({
      success: true,
      message: 'Notifications marked as read'
    });

  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

/**
 * Send appointment reminders (admin endpoint)
 * POST /api/notifications/reminders
 */
router.post('/reminders', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    await NotificationService.sendAppointmentReminders();

    res.status(200).json({
      success: true,
      message: 'Appointment reminders processed'
    });

  } catch (error) {
    console.error('Error sending reminders:', error);
    res.status(500).json({ error: 'Failed to send reminders' });
  }
});

export default router;