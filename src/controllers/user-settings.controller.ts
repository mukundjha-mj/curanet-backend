/**
 * User Settings Controller
 * Handles user consent settings, privacy preferences, and emergency contacts
 */

import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// Extend Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        healthId: string;
        email: string | null;
        role: string;
        status: string;
        tokenId: string;
      };
    }
  }
}

// Validation schemas
const ConsentSettingsSchema = z.object({
  emailNotifications: z.boolean().optional(),
  smsNotifications: z.boolean().optional(),
  profileVisibility: z.enum(['PUBLIC', 'FRIENDS', 'PRIVATE']).optional(),
  shareLocation: z.boolean().optional(),
  shareWithEmergency: z.boolean().optional(),
});

const PrivacySettingsSchema = z.object({
  profileVisibility: z.enum(['PUBLIC', 'FRIENDS', 'PRIVATE']).optional(),
  dataRetentionPeriod: z.number().min(1).optional(),
  emergencyAccessLevel: z.enum(['BASIC', 'MEDICAL', 'FULL']).optional(),
});

const EmergencyContactSchema = z.object({
  name: z.string().min(1),
  relationship: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  accessLevel: z.enum(['BASIC', 'MEDICAL', 'FULL']).optional(),
  isPrimary: z.boolean().optional(),
});

/**
 * Get user consent settings
 */
export const getUserConsentSettings = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get or create user settings
    const userSettings = await prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        profileVisibility: 'PRIVATE',
      },
      update: {},
    });

    // Return structure that matches frontend expectations
    res.json({
      consentSettings: {
        dataSharing: userSettings.shareWithEmergency,
        researchParticipation: false, // Add default values for missing fields
        marketingCommunications: false,
        thirdPartyIntegrations: false,
        emergencyAccess: userSettings.emergencyAccessLevel !== 'BASIC',
        analyticsOptOut: true,
      },
      privacySettings: {
        profileVisibility: userSettings.profileVisibility.toLowerCase().replace('_', '-') as 'private' | 'providers-only' | 'network',
        recordAccess: 'authorized-providers' as const,
        communicationPreferences: 'secure-portal' as const,
        auditTrail: true,
      },
      // Keep the original structure for compatibility
      notifications: {
        email: userSettings.emailNotifications,
        sms: userSettings.smsNotifications,
      },
      profileVisibility: userSettings.profileVisibility,
      sharing: {
        shareLocation: userSettings.shareLocation,
        shareWithEmergency: userSettings.shareWithEmergency,
        autoShareLabs: userSettings.autoShareLabs,
        autoShareRadiology: userSettings.autoShareRadiology,
      },
      emergencyAccess: {
        accessLevel: userSettings.emergencyAccessLevel,
        reminderDays: userSettings.consentReminderDays,
      },
      session: {
        timeoutMinutes: userSettings.sessionTimeoutMinutes,
        twoFactorEnabled: userSettings.twoFactorEnabled,
      },
    });
  } catch (error) {
    console.error('Error fetching consent settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update user consent settings
 */
export const updateUserConsentSettings = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { consentSettings, privacySettings } = req.body;
    
    // Map frontend consent settings to backend fields
    const updateData: any = {};
    
    if (consentSettings) {
      if (consentSettings.dataSharing !== undefined) {
        updateData.shareWithEmergency = consentSettings.dataSharing;
      }
      if (consentSettings.emergencyAccess !== undefined) {
        updateData.emergencyAccessLevel = consentSettings.emergencyAccess ? 'FULL' : 'BASIC';
      }
    }
    
    if (privacySettings) {
      if (privacySettings.profileVisibility !== undefined) {
        // Map frontend values to backend enum
        const visibilityMap: Record<string, string> = {
          'private': 'PRIVATE',
          'providers-only': 'FRIENDS', // Map to closest available option
          'network': 'PUBLIC'
        };
        updateData.profileVisibility = visibilityMap[privacySettings.profileVisibility] || 'PRIVATE';
      }
    }

    const userSettings = await prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        profileVisibility: 'PRIVATE',
        ...updateData,
      },
      update: updateData,
    });

    // Log the action
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'UPDATE_CONSENT_SETTINGS',
        resource: 'USER_SETTINGS',
        details: { consentSettings, privacySettings },
      },
    });

    // Return the updated settings in the expected format
    res.json({
      consentSettings: {
        dataSharing: userSettings.shareWithEmergency,
        researchParticipation: false,
        marketingCommunications: false,
        thirdPartyIntegrations: false,
        emergencyAccess: userSettings.emergencyAccessLevel !== 'BASIC',
        analyticsOptOut: true,
      },
      privacySettings: {
        profileVisibility: userSettings.profileVisibility.toLowerCase().replace('_', '-'),
        recordAccess: 'authorized-providers',
        communicationPreferences: 'secure-portal',
        auditTrail: true,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.issues });
    }
    console.error('Error updating consent settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update user privacy settings
 */
export const updateUserPrivacySettings = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const validatedData = PrivacySettingsSchema.parse(req.body);

    const userSettings = await prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        profileVisibility: 'PRIVATE',
        ...validatedData,
      },
      update: validatedData,
    });

    // Log the action
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'UPDATE_PRIVACY_SETTINGS',
        resource: 'USER_SETTINGS',
        details: validatedData,
      },
    });

    res.json({ 
      message: 'Privacy settings updated successfully',
      settings: userSettings 
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.issues });
    }
    console.error('Error updating privacy settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get emergency contacts
 */
export const getEmergencyContacts = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // First, get or create user settings to ensure the relation exists
    const userSettings = await prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        profileVisibility: 'PRIVATE',
      },
      update: {},
    });

    const contacts = await prisma.emergencyContact.findMany({
      where: { 
        userSettingsId: userSettings.id
      },
      orderBy: { isPrimary: 'desc' },
    });

    res.json(contacts);
  } catch (error) {
    console.error('Error fetching emergency contacts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Create emergency contact
 */
export const createEmergencyContact = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const validatedData = EmergencyContactSchema.parse(req.body);

    // Get or create user settings first
    const userSettings = await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, profileVisibility: 'PRIVATE' },
      update: {},
    });

    const contact = await prisma.emergencyContact.create({
      data: {
        userSettingsId: userSettings.id,
        ...validatedData,
      },
    });

    // Log the action
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'CREATE_EMERGENCY_CONTACT',
        resource: 'EMERGENCY_CONTACT',
        resourceId: contact.id,
      },
    });

    res.status(201).json(contact);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.issues });
    }
    console.error('Error creating emergency contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update emergency contact
 */
export const updateEmergencyContact = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.healthId;
    const { id: contactId } = req.params;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const validatedData = EmergencyContactSchema.parse(req.body);

    // First get user settings to ensure proper ownership
    const userSettings = await prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!userSettings) {
      return res.status(404).json({ error: 'User settings not found' });
    }

    const contact = await prisma.emergencyContact.update({
      where: { 
        id: contactId,
        userSettingsId: userSettings.id
      },
      data: validatedData,
    });

    // Log the action
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'UPDATE_EMERGENCY_CONTACT',
        resource: 'EMERGENCY_CONTACT',
        resourceId: contact.id,
      },
    });

    res.json(contact);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.issues });
    }
    console.error('Error updating emergency contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete emergency contact
 */
export const deleteEmergencyContact = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.healthId;
    const { id: contactId } = req.params;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // First get user settings to ensure proper ownership
    const userSettings = await prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!userSettings) {
      return res.status(404).json({ error: 'User settings not found' });
    }

    const contact = await prisma.emergencyContact.findFirst({
      where: { 
        id: contactId,
        userSettingsId: userSettings.id
      },
    });

    if (!contact) {
      return res.status(404).json({ error: 'Emergency contact not found' });
    }

    await prisma.emergencyContact.delete({
      where: { id: contactId },
    });

    // Log the action
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'DELETE_EMERGENCY_CONTACT',
        resource: 'EMERGENCY_CONTACT',
        resourceId: contactId,
      },
    });

    res.json({ message: 'Emergency contact deleted successfully' });
  } catch (error) {
    console.error('Error deleting emergency contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get user dashboard data
 */
export const getUserDashboardData = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const [userSettings, emergencyContacts, recentActivity] = await Promise.all([
      prisma.userSettings.findUnique({ where: { userId } }),
      prisma.emergencyContact.findMany({ 
        where: { 
          userSettings: { userId } 
        } 
      }),
      prisma.auditLog.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: 10,
      }),
    ]);

    // Log dashboard access
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'VIEW_DASHBOARD',
        resource: 'USER_DATA',
      },
    });

    res.json({
      settings: userSettings,
      emergencyContacts,
      recentActivity,
      stats: {
        totalContacts: emergencyContacts.length,
        primaryContacts: emergencyContacts.filter(c => c.isPrimary).length,
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete all user data
 */
export const deleteUserData = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Delete all user data in a transaction
    await prisma.$transaction(async (tx: any) => {
      // Delete emergency contacts first (due to foreign key constraints)
      await tx.emergencyContact.deleteMany({ 
        where: { 
          userSettings: { userId } 
        } 
      });
      
      // Delete user settings
      await tx.userSettings.deleteMany({ where: { userId } });
      
      // Delete audit logs
      await tx.auditLog.deleteMany({ where: { userId } });
      
      // Create final audit log entry
      await tx.auditLog.create({
        data: {
          userId,
          action: 'DELETE_ALL_USER_DATA',
          resource: 'USER_DATA',
        },
      });
    });

    res.json({ message: 'All user data deleted successfully' });
  } catch (error) {
    console.error('Error deleting user data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};