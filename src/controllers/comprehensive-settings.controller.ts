/**
 * Comprehensive User Settings Controller
 * Handles all user settings in one consolidated API
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

// Comprehensive settings validation schema
const ComprehensiveSettingsSchema = z.object({
  // Notification settings
  notificationSettings: z.object({
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
  }).optional(),

  // Appearance settings
  appearanceSettings: z.object({
    theme: z.enum(['LIGHT', 'DARK', 'SYSTEM']).optional(),
    language: z.string().min(2).max(10).optional(),
    timezone: z.string().optional(),
    dateFormat: z.string().optional(),
    timeFormat: z.enum(['12h', '24h']).optional(),
    fontSize: z.enum(['small', 'medium', 'large', 'extra-large']).optional(),
    fontFamily: z.enum(['system', 'serif', 'sans-serif', 'monospace']).optional(),
    highContrast: z.boolean().optional(),
    reduceMotion: z.boolean().optional(),
    compactMode: z.boolean().optional(),
    showAnimations: z.boolean().optional(),
  }).optional(),

  // Data management settings
  dataManagementSettings: z.object({
    dataRetentionPeriod: z.enum(['ONE_YEAR', 'TWO_YEARS', 'FIVE_YEARS', 'TEN_YEARS', 'INDEFINITE']).optional(),
    autoBackup: z.boolean().optional(),
    backupFrequency: z.string().optional(),
    exportFormat: z.enum(['JSON', 'CSV', 'PDF', 'XML']).optional(),
    includeDeletedData: z.boolean().optional(),
    shareAggregatedData: z.boolean().optional(),
    allowDataMining: z.boolean().optional(),
    gdprCompliant: z.boolean().optional(),
    hipaaCompliant: z.boolean().optional(),
    encryptBackups: z.boolean().optional(),
    cloudBackupEnabled: z.boolean().optional(),
  }).optional(),
});

// Get all user settings
export const getAllSettings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Fetch all settings in parallel
    const [
      userSettings,
      notificationSettings,
      appearanceSettings,
      securitySettings,
      dataManagementSettings,
      emergencyContacts,
    ] = await Promise.all([
      prisma.userSettings.findUnique({ where: { userId } }),
      prisma.notificationSettings.findUnique({ where: { userId } }),
      prisma.appearanceSettings.findUnique({ where: { userId } }),
      prisma.securitySettings.findUnique({ where: { userId } }),
      prisma.dataManagementSettings.findUnique({ where: { userId } }),
      prisma.emergencyContact.findMany({ 
        where: { 
          userSettings: { userId } 
        },
        orderBy: { createdAt: 'desc' }
      }),
    ]);

    // Create default settings if they don't exist
    const defaultUserSettings = userSettings || await createDefaultUserSettings(userId);
    const defaultNotificationSettings = notificationSettings || await createDefaultNotificationSettings(userId);
    const defaultAppearanceSettings = appearanceSettings || await createDefaultAppearanceSettings(userId);
    const defaultSecuritySettings = securitySettings || await createDefaultSecuritySettings(userId);
    const defaultDataManagementSettings = dataManagementSettings || await createDefaultDataManagementSettings(userId);

    const comprehensiveSettings = {
      userSettings: defaultUserSettings,
      notificationSettings: defaultNotificationSettings,
      appearanceSettings: defaultAppearanceSettings,
      securitySettings: {
        ...defaultSecuritySettings,
        // Don't expose sensitive security data
        twoFactorSecret: undefined,
        backupCodes: undefined,
      },
      dataManagementSettings: defaultDataManagementSettings,
      emergencyContacts,
      // Computed fields
      hasNotifications: defaultNotificationSettings.emailNotifications || defaultNotificationSettings.smsNotifications,
      isDarkMode: defaultAppearanceSettings.theme === 'DARK',
      totalEmergencyContacts: emergencyContacts.length,
    };

    res.json(comprehensiveSettings);
  } catch (error) {
    console.error('Error fetching comprehensive settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Update comprehensive settings
export const updateAllSettings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Validate request body
    const validationResult = ComprehensiveSettingsSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: 'Invalid input data',
        errors: validationResult.error.issues,
      });
    }

    const { notificationSettings, appearanceSettings, dataManagementSettings } = validationResult.data;

    // Update settings in parallel
    const updatePromises = [];

    if (notificationSettings) {
      updatePromises.push(
        prisma.notificationSettings.upsert({
          where: { userId },
          update: { ...notificationSettings, updatedAt: new Date() },
          create: { userId, ...await getDefaultNotificationSettings(), ...notificationSettings },
        })
      );
    }

    if (appearanceSettings) {
      updatePromises.push(
        prisma.appearanceSettings.upsert({
          where: { userId },
          update: { ...appearanceSettings, updatedAt: new Date() },
          create: { userId, ...await getDefaultAppearanceSettings(), ...appearanceSettings },
        })
      );
    }

    if (dataManagementSettings) {
      updatePromises.push(
        prisma.dataManagementSettings.upsert({
          where: { userId },
          update: { ...dataManagementSettings, updatedAt: new Date() },
          create: { userId, ...await getDefaultDataManagementSettings(), ...dataManagementSettings },
        })
      );
    }

    const updatedSettings = await Promise.all(updatePromises);

    // Log the comprehensive update
    await auditLogger.logAction({
      actorId: userId,
      actorRole: req.user?.role || 'unknown',
      action: 'UPDATE_COMPREHENSIVE_SETTINGS',
      resourceType: 'UserSettings',
      resourceId: userId,
      patientHealthId: userId,
      metadata: { 
        updated_sections: Object.keys(validationResult.data),
        changes: validationResult.data 
      },
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    // Return updated settings
    res.json({
      message: 'Settings updated successfully',
      updatedSettings: updatedSettings.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating comprehensive settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Helper functions for default settings
async function createDefaultUserSettings(userId: string) {
  return await prisma.userSettings.create({
    data: {
      userId,
      emailNotifications: true,
      smsNotifications: false,
      profileVisibility: 'PRIVATE',
      shareLocation: false,
      shareWithEmergency: true,
      dataRetentionPeriod: 365,
      autoShareLabs: false,
      autoShareRadiology: false,
      emergencyAccessLevel: 'BASIC',
      consentReminderDays: 30,
      sessionTimeoutMinutes: 60,
      twoFactorEnabled: false,
    },
  });
}

async function createDefaultNotificationSettings(userId: string) {
  return await prisma.notificationSettings.create({
    data: {
      userId,
      ...await getDefaultNotificationSettings(),
    },
  });
}

async function createDefaultAppearanceSettings(userId: string) {
  return await prisma.appearanceSettings.create({
    data: {
      userId,
      ...await getDefaultAppearanceSettings(),
    },
  });
}

async function createDefaultSecuritySettings(userId: string) {
  return await prisma.securitySettings.create({
    data: {
      userId,
      twoFactorEnabled: false,
      sessionTimeout: 3600,
      loginNotifications: true,
      deviceTracking: true,
      requirePasswordChange: false,
      maxConcurrentSessions: 5,
      autoLockTimeout: 900,
      requireBiometric: false,
    },
  });
}

async function createDefaultDataManagementSettings(userId: string) {
  return await prisma.dataManagementSettings.create({
    data: {
      userId,
      ...await getDefaultDataManagementSettings(),
    },
  });
}

async function getDefaultNotificationSettings() {
  return {
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
    timezone: 'UTC',
  };
}

async function getDefaultAppearanceSettings() {
  return {
    theme: 'SYSTEM' as const,
    language: 'en',
    timezone: 'UTC',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
    fontSize: 'medium',
    fontFamily: 'system',
    highContrast: false,
    reduceMotion: false,
    compactMode: false,
    showAnimations: true,
  };
}

async function getDefaultDataManagementSettings() {
  return {
    dataRetentionPeriod: 'FIVE_YEARS' as const,
    autoBackup: true,
    backupFrequency: 'weekly',
    exportFormat: 'JSON',
    includeDeletedData: false,
    shareAggregatedData: false,
    allowDataMining: false,
    gdprCompliant: true,
    hipaaCompliant: true,
    encryptBackups: true,
    cloudBackupEnabled: true,
  };
}

export default {
  getAllSettings,
  updateAllSettings,
};