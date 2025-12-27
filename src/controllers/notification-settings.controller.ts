/**
 * Notification Settings Controller
 * Handles user notification preferences and settings
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import auditLogger from '../services/audit.service';

const prisma = new PrismaClient();

// Request type with authenticated user
interface AuthenticatedRequest extends Request {
  user?: {
    healthId: string;
    email: string | null;
    role: string;
    status: string;
    tokenId: string;
  };
}

// Validation schemas
const NotificationSettingsSchema = z.object({
  emailNotifications: z.boolean().optional(),
  smsNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  appointmentReminders: z.boolean().optional(),
  recordUpdates: z.boolean().optional(),
  marketingEmails: z.boolean().optional(),
  securityAlerts: z.boolean().optional(),
  billingNotifications: z.boolean().optional(),
  labResults: z.boolean().optional(),
  prescriptionUpdates: z.boolean().optional(),
  frequency: z.enum(['IMMEDIATE', 'HOURLY', 'DAILY', 'WEEKLY', 'NEVER']).optional(),
  quietHoursStart: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  quietHoursEnd: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  timezone: z.string().optional(),
});

// Get user notification settings
export const getNotificationSettings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    let settings = await prisma.notificationSettings.findUnique({
      where: { userId },
    });

    // Create default settings if none exist
    if (!settings) {
      settings = await prisma.notificationSettings.create({
        data: {
          userId,
          emailNotifications: true,
          smsNotifications: false,
          pushNotifications: true,
          appointmentReminders: true,
          recordUpdates: true,
          marketingEmails: false,
          securityAlerts: true,
          billingNotifications: true,
          labResults: true,
          prescriptionUpdates: true,
          frequency: 'IMMEDIATE',
          timezone: 'UTC',
        },
      });

      // Log the creation
      await auditLogger.logAction({
        actorId: userId,
        actorRole: req.user?.role || 'unknown',
        action: 'CREATE_NOTIFICATION_SETTINGS',
        resourceType: 'NotificationSettings',
        resourceId: settings.id,
        patientHealthId: userId,
        metadata: { message: 'Default notification settings created' },
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });
    }

    res.json(settings);
  } catch (error) {
    console.error('Error fetching notification settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Update user notification settings
export const updateNotificationSettings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Validate request body
    const validationResult = NotificationSettingsSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: 'Invalid input data',
        errors: validationResult.error.issues,
      });
    }

    const updateData = validationResult.data;

    // Update or create notification settings
    const settings = await prisma.notificationSettings.upsert({
      where: { userId },
      update: {
        ...updateData,
        updatedAt: new Date(),
      },
      create: {
        userId,
        emailNotifications: true,
        smsNotifications: false,
        pushNotifications: true,
        appointmentReminders: true,
        recordUpdates: true,
        marketingEmails: false,
        securityAlerts: true,
        billingNotifications: true,
        labResults: true,
        prescriptionUpdates: true,
        frequency: 'IMMEDIATE',
        timezone: 'UTC',
        ...updateData,
      },
    });

    // Log the update
    await auditLogger.logAction({
      actorId: userId,
      actorRole: req.user?.role || 'unknown',
      action: 'UPDATE_NOTIFICATION_SETTINGS',
      resourceType: 'NotificationSettings',
      resourceId: settings.id,
      patientHealthId: userId,
      metadata: { 
        updated_fields: Object.keys(updateData),
        changes: updateData 
      },
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.json(settings);
  } catch (error) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Reset notification settings to defaults
export const resetNotificationSettings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const defaultSettings = {
      emailNotifications: true,
      smsNotifications: false,
      pushNotifications: true,
      appointmentReminders: true,
      recordUpdates: true,
      marketingEmails: false,
      securityAlerts: true,
      billingNotifications: true,
      labResults: true,
      prescriptionUpdates: true,
      frequency: 'IMMEDIATE' as const,
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: 'UTC',
    };

    const settings = await prisma.notificationSettings.upsert({
      where: { userId },
      update: {
        ...defaultSettings,
        updatedAt: new Date(),
      },
      create: {
        userId,
        ...defaultSettings,
      },
    });

    // Log the reset
    await auditLogger.logAction({
      actorId: userId,
      actorRole: req.user?.role || 'unknown',
      action: 'RESET_NOTIFICATION_SETTINGS',
      resourceType: 'NotificationSettings',
      resourceId: settings.id,
      patientHealthId: userId,
      metadata: { message: 'Notification settings reset to defaults' },
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.json(settings);
  } catch (error) {
    console.error('Error resetting notification settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export default {
  getNotificationSettings,
  updateNotificationSettings,
  resetNotificationSettings,
};