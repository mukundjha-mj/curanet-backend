/**
 * Appearance Settings Controller
 * Handles user appearance and theme preferences
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
const AppearanceSettingsSchema = z.object({
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
});

// Get user appearance settings
export const getAppearanceSettings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    let settings = await prisma.appearanceSettings.findUnique({
      where: { userId },
    });

    // Create default settings if none exist
    if (!settings) {
      settings = await prisma.appearanceSettings.create({
        data: {
          userId,
          theme: 'SYSTEM',
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
        },
      });

      // Log the creation
      await auditLogger.logAction({
        actorId: userId,
        actorRole: req.user?.role || 'unknown',
        action: 'CREATE_APPEARANCE_SETTINGS',
        resourceType: 'AppearanceSettings',
        resourceId: settings.id,
        patientHealthId: userId,
        metadata: { message: 'Default appearance settings created' },
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });
    }

    res.json(settings);
  } catch (error) {
    console.error('Error fetching appearance settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Update user appearance settings
export const updateAppearanceSettings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Validate request body
    const validationResult = AppearanceSettingsSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: 'Invalid input data',
        errors: validationResult.error.issues,
      });
    }

    const updateData = validationResult.data;

    // Update or create appearance settings
    const settings = await prisma.appearanceSettings.upsert({
      where: { userId },
      update: {
        ...updateData,
        updatedAt: new Date(),
      },
      create: {
        userId,
        theme: 'SYSTEM',
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
        ...updateData,
      },
    });

    // Log the update
    await auditLogger.logAction({
      actorId: userId,
      actorRole: req.user?.role || 'unknown',
      action: 'UPDATE_APPEARANCE_SETTINGS',
      resourceType: 'AppearanceSettings',
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
    console.error('Error updating appearance settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Reset appearance settings to defaults
export const resetAppearanceSettings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const defaultSettings = {
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

    const settings = await prisma.appearanceSettings.upsert({
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
      action: 'RESET_APPEARANCE_SETTINGS',
      resourceType: 'AppearanceSettings',
      resourceId: settings.id,
      patientHealthId: userId,
      metadata: { message: 'Appearance settings reset to defaults' },
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.json(settings);
  } catch (error) {
    console.error('Error resetting appearance settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export default {
  getAppearanceSettings,
  updateAppearanceSettings,
  resetAppearanceSettings,
};