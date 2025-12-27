import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type AuthenticatedRequest = Request & { 
  user?: {
      healthId: string;
      email: string | null;
      role: string;
      status: string;
      tokenId: string;
  }
};

// In-memory settings store (in production, this would be database-backed)
interface SystemSettings {
  maintenanceMode: boolean;
  allowRegistration: boolean;
  requireEmailVerification: boolean;
  requireAdminApproval: boolean;
  maxFileUploadSize: number; // in bytes
  allowedFileTypes: string[];
  sessionTimeout: number; // in minutes
  maxLoginAttempts: number;
  consentExpiryDays: number;
  emergencyShareExpiryHours: number;
  systemMessage: string | null;
  systemMessageType: 'info' | 'warning' | 'error' | null;
  enableNotifications: boolean;
  enableAuditExport: boolean;
  enableDataExport: boolean;
}

// Default system settings
const defaultSettings: SystemSettings = {
  maintenanceMode: false,
  allowRegistration: true,
  requireEmailVerification: true,
  requireAdminApproval: true, // Require admin approval for doctor accounts
  maxFileUploadSize: 52428800, // 50MB
  allowedFileTypes: [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv', 'application/dicom'
  ],
  sessionTimeout: 60, // 1 hour
  maxLoginAttempts: 5,
  consentExpiryDays: 365, // 1 year default
  emergencyShareExpiryHours: 24, // 1 day
  systemMessage: null,
  systemMessageType: null,
  enableNotifications: true,
  enableAuditExport: true,
  enableDataExport: true
};

// Current settings (would be loaded from database in production)
let currentSettings: SystemSettings = { ...defaultSettings };

export class AdminSettingsController {
  /**
   * GET /api/admin/settings
   * Get current system settings
   */
  static async getSettings(req: Request, res: Response) {
    try {
      // In production, load from database
      // const settings = await prisma.systemSettings.findFirst();
      
      res.json({
        success: true,
        data: {
          settings: currentSettings,
          lastUpdated: new Date().toISOString(), // Would be actual timestamp from DB
          environment: process.env.NODE_ENV || 'development'
        }
      });

    } catch (error) {
      console.error('Error fetching system settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch system settings'
      });
    }
  }

  /**
   * POST /api/admin/settings
   * Update system settings (development only for sensitive settings)
   */
  static async updateSettings(req: AuthenticatedRequest, res: Response) {
    try {
      const {
        maintenanceMode,
        allowRegistration,
        requireEmailVerification,
        requireAdminApproval,
        maxFileUploadSize,
        allowedFileTypes,
        sessionTimeout,
        maxLoginAttempts,
        consentExpiryDays,
        emergencyShareExpiryHours,
        systemMessage,
        systemMessageType,
        enableNotifications,
        enableAuditExport,
        enableDataExport
      } = req.body;

      // Validate environment for sensitive settings
      const isDevelopment = process.env.NODE_ENV === 'development';
      const sensitiveSettings = ['maintenanceMode', 'allowRegistration', 'requireEmailVerification'];
      
      const updatedFields: Partial<SystemSettings> = {};

      // Update each field if provided
      if (maintenanceMode !== undefined) {
        if (!isDevelopment) {
          return res.status(403).json({
            success: false,
            message: 'Maintenance mode can only be toggled in development environment'
          });
        }
        updatedFields.maintenanceMode = Boolean(maintenanceMode);
      }

      if (allowRegistration !== undefined) {
        updatedFields.allowRegistration = Boolean(allowRegistration);
      }

      if (requireEmailVerification !== undefined) {
        updatedFields.requireEmailVerification = Boolean(requireEmailVerification);
      }

      if (requireAdminApproval !== undefined) {
        updatedFields.requireAdminApproval = Boolean(requireAdminApproval);
      }

      if (maxFileUploadSize !== undefined) {
        if (maxFileUploadSize < 1024000 || maxFileUploadSize > 104857600) { // 1MB to 100MB
          return res.status(400).json({
            success: false,
            message: 'File upload size must be between 1MB and 100MB'
          });
        }
        updatedFields.maxFileUploadSize = parseInt(maxFileUploadSize);
      }

      if (allowedFileTypes !== undefined) {
        if (!Array.isArray(allowedFileTypes) || allowedFileTypes.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Allowed file types must be a non-empty array'
          });
        }
        updatedFields.allowedFileTypes = allowedFileTypes;
      }

      if (sessionTimeout !== undefined) {
        if (sessionTimeout < 15 || sessionTimeout > 480) { // 15 minutes to 8 hours
          return res.status(400).json({
            success: false,
            message: 'Session timeout must be between 15 minutes and 8 hours'
          });
        }
        updatedFields.sessionTimeout = parseInt(sessionTimeout);
      }

      if (maxLoginAttempts !== undefined) {
        if (maxLoginAttempts < 3 || maxLoginAttempts > 10) {
          return res.status(400).json({
            success: false,
            message: 'Max login attempts must be between 3 and 10'
          });
        }
        updatedFields.maxLoginAttempts = parseInt(maxLoginAttempts);
      }

      if (consentExpiryDays !== undefined) {
        if (consentExpiryDays < 1 || consentExpiryDays > 1095) { // 1 day to 3 years
          return res.status(400).json({
            success: false,
            message: 'Consent expiry must be between 1 day and 3 years'
          });
        }
        updatedFields.consentExpiryDays = parseInt(consentExpiryDays);
      }

      if (emergencyShareExpiryHours !== undefined) {
        if (emergencyShareExpiryHours < 1 || emergencyShareExpiryHours > 168) { // 1 hour to 1 week
          return res.status(400).json({
            success: false,
            message: 'Emergency share expiry must be between 1 hour and 1 week'
          });
        }
        updatedFields.emergencyShareExpiryHours = parseInt(emergencyShareExpiryHours);
      }

      if (systemMessage !== undefined) {
        updatedFields.systemMessage = systemMessage ? String(systemMessage) : null;
      }

      if (systemMessageType !== undefined) {
        const validTypes = ['info', 'warning', 'error'];
        if (systemMessageType && !validTypes.includes(systemMessageType)) {
          return res.status(400).json({
            success: false,
            message: 'System message type must be one of: ' + validTypes.join(', ')
          });
        }
        updatedFields.systemMessageType = systemMessageType || null;
      }

      if (enableNotifications !== undefined) {
        updatedFields.enableNotifications = Boolean(enableNotifications);
      }

      if (enableAuditExport !== undefined) {
        updatedFields.enableAuditExport = Boolean(enableAuditExport);
      }

      if (enableDataExport !== undefined) {
        updatedFields.enableDataExport = Boolean(enableDataExport);
      }

      // Update current settings
      currentSettings = { ...currentSettings, ...updatedFields };

      // In production, save to database
      // await prisma.systemSettings.upsert({
      //   where: { id: 1 },
      //   update: updatedFields,
      //   create: currentSettings
      // });

      // Log the settings change
      await prisma.healthIdAudit.create({
        data: {
          healthId: req.user!.healthId,
          accessedBy: req.user!.healthId,
          action: 'SYSTEM_SETTINGS_UPDATED',
          details: {
            updatedFields: Object.keys(updatedFields),
            adminEmail: req.user!.email,
            environment: process.env.NODE_ENV || 'development'
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      res.json({
        success: true,
        message: 'System settings updated successfully',
        data: {
          settings: currentSettings,
          updatedFields: Object.keys(updatedFields),
          updatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error updating system settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update system settings'
      });
    }
  }

  /**
   * POST /api/admin/settings/reset
   * Reset settings to defaults (development only)
   */
  static async resetSettings(req: AuthenticatedRequest, res: Response) {
    try {
      if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({
          success: false,
          message: 'Settings reset is only available in development environment'
        });
      }

      currentSettings = { ...defaultSettings };

      // Log the reset action
      await prisma.healthIdAudit.create({
        data: {
          healthId: req.user!.healthId,
          accessedBy: req.user!.healthId,
          action: 'SYSTEM_SETTINGS_RESET',
          details: {
            adminEmail: req.user!.email,
            environment: process.env.NODE_ENV || 'development'
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      res.json({
        success: true,
        message: 'System settings reset to defaults',
        data: {
          settings: currentSettings,
          resetAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error resetting system settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reset system settings'
      });
    }
  }

  /**
   * GET /api/admin/settings/maintenance
   * Check maintenance mode status (public endpoint)
   */
  static async getMaintenanceStatus(req: Request, res: Response) {
    try {
      res.json({
        success: true,
        data: {
          maintenanceMode: currentSettings.maintenanceMode,
          systemMessage: currentSettings.systemMessage,
          systemMessageType: currentSettings.systemMessageType,
          allowRegistration: currentSettings.allowRegistration,
          checkedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error checking maintenance status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check maintenance status'
      });
    }
  }

  /**
   * GET /api/admin/settings/file-limits
   * Get file upload settings (public for upload validation)
   */
  static async getFileUploadSettings(req: Request, res: Response) {
    try {
      res.json({
        success: true,
        data: {
          maxFileUploadSize: currentSettings.maxFileUploadSize,
          allowedFileTypes: currentSettings.allowedFileTypes,
          maxFileSizeMB: Math.round(currentSettings.maxFileUploadSize / (1024 * 1024)),
          checkedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error fetching file upload settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch file upload settings'
      });
    }
  }

  /**
   * GET /api/admin/settings/validation
   * Validate current settings and return any issues
   */
  static async validateSettings(req: Request, res: Response) {
    try {
      const issues: Array<{ field: string; issue: string; severity: 'warning' | 'error' }> = [];

      // Validate file upload settings
      if (currentSettings.maxFileUploadSize > 104857600) { // 100MB
        issues.push({
          field: 'maxFileUploadSize',
          issue: 'File upload size is very large and may cause server issues',
          severity: 'warning'
        });
      }

      if (currentSettings.allowedFileTypes.length > 20) {
        issues.push({
          field: 'allowedFileTypes',
          issue: 'Too many allowed file types may pose security risks',
          severity: 'warning'
        });
      }

      // Validate security settings
      if (currentSettings.maxLoginAttempts > 10) {
        issues.push({
          field: 'maxLoginAttempts',
          issue: 'High max login attempts may allow brute force attacks',
          severity: 'warning'
        });
      }

      if (currentSettings.sessionTimeout > 480) { // 8 hours
        issues.push({
          field: 'sessionTimeout',
          issue: 'Very long session timeout may pose security risks',
          severity: 'warning'
        });
      }

      if (!currentSettings.requireEmailVerification) {
        issues.push({
          field: 'requireEmailVerification',
          issue: 'Email verification is disabled, may allow fake accounts',
          severity: 'warning'
        });
      }

      // Validate consent settings
      if (currentSettings.consentExpiryDays < 30) {
        issues.push({
          field: 'consentExpiryDays',
          issue: 'Short consent expiry may cause frequent re-authorization requests',
          severity: 'warning'
        });
      }

      // Check maintenance mode
      if (currentSettings.maintenanceMode) {
        issues.push({
          field: 'maintenanceMode',
          issue: 'System is in maintenance mode - users cannot access the platform',
          severity: 'error'
        });
      }

      res.json({
        success: true,
        data: {
          isValid: issues.filter(i => i.severity === 'error').length === 0,
          issues,
          totalIssues: issues.length,
          errors: issues.filter(i => i.severity === 'error').length,
          warnings: issues.filter(i => i.severity === 'warning').length,
          validatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error validating settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to validate settings'
      });
    }
  }

  /**
   * GET /api/admin/settings/defaults
   * Get default settings for comparison
   */
  static async getDefaultSettings(req: Request, res: Response) {
    try {
      res.json({
        success: true,
        data: {
          defaults: defaultSettings,
          current: currentSettings,
          hasChanges: JSON.stringify(currentSettings) !== JSON.stringify(defaultSettings)
        }
      });

    } catch (error) {
      console.error('Error fetching default settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch default settings'
      });
    }
  }
}