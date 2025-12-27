import prisma from '../utils/prisma';
import logger from '../utils/logger';

export interface NotificationData {
  appointmentId: string;
  recipientId: string;
  type: 'APPOINTMENT_REQUESTED' | 'APPOINTMENT_CONFIRMED' | 'APPOINTMENT_REJECTED' | 'APPOINTMENT_CANCELLED' | 'APPOINTMENT_REMINDER';
  message: string;
  metadata?: any;
}

export class NotificationService {
  /**
   * Create and optionally send a notification
   */
  static async createNotification(data: NotificationData, sendImmediately = false): Promise<void> {
    try {
      const notification = await prisma.appointmentNotification.create({
        data: {
          appointmentId: data.appointmentId,
          recipientId: data.recipientId,
          type: data.type,
          message: data.message,
          sent: sendImmediately,
          sentAt: sendImmediately ? new Date() : null
        }
      });

      if (sendImmediately) {
        await this.sendNotification(notification.id);
      }

      logger.info('Notification created', { type: data.type, recipientId: data.recipientId });
    } catch (error) {
      logger.error('Error creating notification', { error });
    }
  }

  /**
   * Send a notification (placeholder for actual implementation)
   * In production, this would integrate with email service, SMS service, etc.
   */
  static async sendNotification(notificationId: string): Promise<boolean> {
    try {
      const notification = await prisma.appointmentNotification.findUnique({
        where: { id: notificationId },
        include: {
          recipient: true,
          appointment: {
            include: {
              patient: { include: { healthProfile: true } },
              doctor: { include: { healthProfile: true } }
            }
          }
        }
      });

      if (!notification) {
        logger.warn('Notification not found', { notificationId });
        return false;
      }

      // In development, we'll just log the notification
      // In production, integrate with:
      // - Email service (SendGrid, AWS SES, etc.)
      // - SMS service (Twilio, AWS SNS, etc.)
      // - Push notification service
      // - In-app notification system

      logger.info('Notification sent', {
        to: notification.recipient.email,
        type: notification.type,
        message: notification.message
      });

      // Mark notification as sent
      await prisma.appointmentNotification.update({
        where: { id: notificationId },
        data: {
          sent: true,
          sentAt: new Date()
        }
      });

      return true;
    } catch (error) {
      logger.error('Error sending notification', { error, notificationId });
      return false;
    }
  }

  /**
   * Send appointment reminder notifications
   * This would typically be called by a cron job or scheduled task
   */
  static async sendAppointmentReminders(): Promise<void> {
    try {
      // Find appointments that are confirmed and starting in the next 24 hours
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const upcomingAppointments = await prisma.appointment.findMany({
        where: {
          status: 'CONFIRMED',
          requestedTime: {
            gte: new Date(),
            lte: tomorrow
          }
        },
        include: {
          patient: { include: { healthProfile: true } },
          doctor: { include: { healthProfile: true } }
        }
      });

      for (const appointment of upcomingAppointments) {
        // Check if reminder already sent
        const existingReminder = await prisma.appointmentNotification.findFirst({
          where: {
            appointmentId: appointment.id,
            type: 'APPOINTMENT_REMINDER',
            sent: true
          }
        });

        if (!existingReminder) {
          const patientName = `${appointment.patient.healthProfile?.firstName} ${appointment.patient.healthProfile?.lastName}`;
          const doctorName = `Dr. ${appointment.doctor.healthProfile?.firstName} ${appointment.doctor.healthProfile?.lastName}`;

          // Send reminder to patient
          await this.createNotification({
            appointmentId: appointment.id,
            recipientId: appointment.patientId,
            type: 'APPOINTMENT_REMINDER',
            message: `Reminder: You have an appointment with ${doctorName} tomorrow at ${appointment.requestedTime.toLocaleString()}`
          }, true);

          // Send reminder to doctor
          await this.createNotification({
            appointmentId: appointment.id,
            recipientId: appointment.doctorId,
            type: 'APPOINTMENT_REMINDER',
            message: `Reminder: You have an appointment with ${patientName} tomorrow at ${appointment.requestedTime.toLocaleString()}`
          }, true);
        }
      }

      logger.info('Processed upcoming appointments for reminders', { count: upcomingAppointments.length });
    } catch (error) {
      logger.error('Error sending appointment reminders', { error });
    }
  }

  /**
   * Get notifications for a user
   */
  static async getUserNotifications(userId: string, limit = 20): Promise<any[]> {
    try {
      const notifications = await prisma.appointmentNotification.findMany({
        where: { recipientId: userId },
        include: {
          appointment: {
            include: {
              patient: { include: { healthProfile: true } },
              doctor: { include: { healthProfile: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      return notifications.map(notif => ({
        id: notif.id,
        type: notif.type,
        message: notif.message,
        sent: notif.sent,
        sentAt: notif.sentAt,
        createdAt: notif.createdAt,
        appointment: {
          id: notif.appointment.id,
          requestedTime: notif.appointment.requestedTime,
          status: notif.appointment.status
        }
      }));
    } catch (error) {
      console.error('Error getting user notifications:', error);
      return [];
    }
  }

  /**
   * Mark notifications as read
   */
  static async markNotificationsAsRead(userId: string, notificationIds: string[]): Promise<void> {
    try {
      await prisma.appointmentNotification.updateMany({
        where: {
          id: { in: notificationIds },
          recipientId: userId
        },
        data: {
          sent: true,
          sentAt: new Date()
        }
      });

      logger.info('Marked notifications as read', { count: notificationIds.length, userId });
    } catch (error) {
      logger.error('Error marking notifications as read', { error, userId });
    }
  }
}

export default NotificationService;