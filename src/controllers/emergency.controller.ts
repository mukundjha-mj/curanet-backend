import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import AuditService from '../services/audit.service';
import runtimeConfig from '../config/runtime-config';

const prisma = new PrismaClient();

interface AuthenticatedRequest extends Request {
  user?: {
    healthId: string;
    email: string | null;
    role: string;
    status: string;
    tokenId: string;
  };
}

export class EmergencyController {
  private static normalizeScope(rawScope: unknown): string[] {
    if (Array.isArray(rawScope)) {
      return rawScope.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }

    if (typeof rawScope === 'string' && rawScope.trim().length > 0) {
      return [rawScope.trim()];
    }

    return ['emergency'];
  }

  /**
   * Create Emergency Share Link
   * POST /api/emergency/share
   * Creates a one-time, time-limited emergency access link
   */
  static async createEmergencyShare(req: AuthenticatedRequest, res: Response) {
    try {
      const { expires_in_seconds = runtimeConfig.emergencyShareDefaultExpirySeconds, scope = ['basic', 'emergency', 'allergies'] } = req.body;
      const patientHealthId = req.user?.healthId;

      if (!patientHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Validate user is a patient or has permission to create emergency shares
      const user = await prisma.user.findUnique({
        where: { healthId: patientHealthId },
        include: { healthProfile: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Generate cryptographically secure tokens
      const shareId = crypto.randomUUID();
      const token = crypto.randomBytes(8).toString('hex'); // 16 character hex string
      const tokenHash = await bcrypt.hash(token, 12);

      // Calculate expiration time
      const expiresAt = new Date(Date.now() + expires_in_seconds * 1000);

      // Validate expiration time (max 24 hours for security)
      const maxExpiry = runtimeConfig.emergencyShareMaxExpirySeconds;
      if (expires_in_seconds > maxExpiry) {
        return res.status(400).json({ 
          error: 'Maximum expiration time is 24 hours',
          max_expires_in_seconds: maxExpiry
        });
      }

      // Create a public URL that responders can open in the frontend app.
      const frontendUrl = process.env.FRONTEND_URL?.trim();
      const baseUrl = process.env.BASE_URL?.trim();
      const requestOrigin = req.get('origin')?.trim();
      const hostFallback = req.get('host') ? `${req.protocol}://${req.get('host')}` : undefined;
      const publicBaseUrl = frontendUrl || baseUrl || requestOrigin || hostFallback;

      if (!publicBaseUrl) {
        return res.status(500).json({ error: 'Unable to build emergency link URL. Configure FRONTEND_URL.' });
      }

      const normalizedBase = publicBaseUrl.replace(/\/$/, '');
      const shortUrl = `${normalizedBase}/one/${token}`;

      // Create emergency share record with shortUrl
      const emergencyShare = await prisma.emergencyShare.create({
        data: {
          shareId,
          tokenHash,
          patientHealthId,
          shortUrl,
          scope: scope,
          expiresAt,
          createdBy: patientHealthId
        }
      });

      // Log the creation
      await AuditService.logAction({
        actorId: patientHealthId,
        actorRole: user.role,
        action: 'EMERGENCY_SHARE_CREATED',
        resourceType: 'EmergencyShare',
        resourceId: shareId,
        patientHealthId: patientHealthId,
        metadata: {
          scope,
          expiresAt: expiresAt.toISOString(),
          expires_in_seconds
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(201).json({
        success: true,
        data: {
          share_id: shareId,
          token,
          short_url: shortUrl,
          expires_at: expiresAt.toISOString(),
          expires_in_seconds,
          scope,
          qr_data: shortUrl // Can be used to generate QR code on frontend
        }
      });

    } catch (error) {
      console.error('Error creating emergency share:', error);
      res.status(500).json({ error: 'Failed to create emergency share' });
    }
  }

  /**
   * Access Emergency Share
   * GET /one/:token
   * Public endpoint - no authentication required
   */
  static async accessEmergencyShare(req: Request, res: Response) {
    try {
      const { token } = req.params;

      if (!token) {
        return res.status(400).json({ error: 'Token required' });
      }

      // Find all non-expired emergency shares (allow multiple accesses)
      const emergencyShares = await prisma.emergencyShare.findMany({
        where: {
          expiresAt: {
            gt: new Date()
          }
        },
        include: {
          patient: {
            include: {
              healthProfile: true
            }
          }
        }
      });

      // Check token against all shares (bcrypt comparison)
      let validShare = null;
      for (const share of emergencyShares) {
        const isValid = await bcrypt.compare(token, share.tokenHash);
        if (isValid) {
          validShare = share;
          break;
        }
      }

      if (!validShare) {
        // Log failed access attempt
        await AuditService.logAction({
          actorId: req.ip || 'UNKNOWN',
          actorRole: 'anonymous',
          action: 'EMERGENCY_ACCESS_FAILED',
          resourceType: 'EmergencyShare',
          resourceId: 'UNKNOWN',
          patientHealthId: 'UNKNOWN',
          reason: 'Invalid or expired token',
          metadata: {
            token_prefix: token.substring(0, 8) + '...'
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        });

        return res.status(404).json({ 
          error: 'Invalid or expired emergency link',
          message: 'This emergency access link is either invalid or expired.'
        });
      }

      const normalizedScope = EmergencyController.normalizeScope(validShare.scope);

      // Extract emergency data based on scope
      const emergencyData = EmergencyController.extractEmergencyData(validShare.patient, normalizedScope);

      // Best-effort access counters/logging. Data access should not fail if audit writes fail.
      const now = new Date();
      let accessCount = (validShare as any).accessCount ?? 0;
      let lastAccessedAt = now;

      try {
        const updatedShare = await prisma.emergencyShare.update({
          where: { id: validShare.id },
          data: {
            accessCount: { increment: 1 },
            lastAccessedAt: now,
            // Keep backward compatibility
            used: true,
            usedAt: validShare.usedAt || now,
            accessedBy: req.ip || 'UNKNOWN'
          }
        });

        accessCount = updatedShare.accessCount;
        lastAccessedAt = updatedShare.lastAccessedAt || now;
      } catch (updateError) {
        console.error('Emergency share access counter update failed:', updateError);
        accessCount = accessCount + 1;
      }

      try {
        await prisma.emergencyAccessLog.create({
          data: {
            shareId: validShare.id,
            ipAddress: req.ip || 'UNKNOWN',
            userAgent: req.get('User-Agent') || 'UNKNOWN',
            scope: normalizedScope as any,
            dataAccessed: Object.keys(emergencyData) as any
          }
        });
      } catch (logError) {
        console.error('Emergency access log write failed:', logError);
      }

      // Log successful emergency access
      await AuditService.logAction({
        actorId: req.ip || 'EMERGENCY_ACCESS',
        actorRole: 'anonymous',
        action: 'EMERGENCY_ACCESS_GRANTED',
        resourceType: 'EmergencyShare',
        resourceId: validShare.shareId,
        patientHealthId: validShare.patientHealthId,
        reason: 'emergency',
        metadata: {
          scope: normalizedScope,
          accessedData: Object.keys(emergencyData),
          createdAt: validShare.createdAt.toISOString()
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        emergency_access: true,
        accessed_at: now.toISOString(),
        data: emergencyData,
        warning: 'This is emergency access. All accesses are logged for security purposes.',
        scope: normalizedScope,
        accessCount,
        lastAccessedAt: lastAccessedAt?.toISOString()
      });

    } catch (error) {
      console.error('Error accessing emergency share:', error);
      const message = error instanceof Error ? error.message : 'Failed to access emergency data';
      res.status(500).json({
        error: 'Failed to access emergency data',
        ...(process.env.NODE_ENV !== 'production' ? { debug: message } : {})
      });
    }
  }

  /**
   * List Patient's Emergency Shares
   * GET /api/emergency/shares
   * Shows patient their active emergency shares
   */
  static async listEmergencyShares(req: AuthenticatedRequest, res: Response) {
    try {
      const patientHealthId = req.user?.healthId;

      if (!patientHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const shares = await prisma.emergencyShare.findMany({
        where: {
          patientHealthId,
          expiresAt: {
            gt: new Date() // Only show non-expired shares
          }
        },
        select: {
          id: true,
          shareId: true,
          shortUrl: true,
          scope: true,
          expiresAt: true,
          createdAt: true,
          used: true,
          usedAt: true,
          accessedBy: true,
          accessCount: true,
          lastAccessedAt: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      res.status(200).json({
        success: true,
        data: {
          active_shares: shares.filter((s: any) => !s.used),
          used_shares: shares.filter((s: any) => s.used),
          total: shares.length
        }
      });

    } catch (error) {
      console.error('Error listing emergency shares:', error);
      res.status(500).json({ error: 'Failed to list emergency shares' });
    }
  }

  /**
   * Revoke Emergency Share
   * DELETE /api/emergency/share/:shareId
   * Allows patient to revoke an active emergency share
   */
  static async revokeEmergencyShare(req: AuthenticatedRequest, res: Response) {
    try {
      const { shareId } = req.params;
      const patientHealthId = req.user?.healthId;

      if (!patientHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const share = await prisma.emergencyShare.findFirst({
        where: {
          shareId,
          patientHealthId,
          used: false,
          expiresAt: {
            gt: new Date()
          }
        }
      });

      if (!share) {
        return res.status(404).json({ error: 'Emergency share not found or already used/expired' });
      }

      // Mark as used (effectively revoking it)
      await prisma.emergencyShare.update({
        where: { id: share.id },
        data: {
          used: true,
          usedAt: new Date(),
          accessedBy: 'REVOKED_BY_PATIENT'
        }
      });

      // Log the revocation
      const user = await prisma.user.findUnique({ where: { healthId: patientHealthId } });
      await AuditService.logAction({
        actorId: patientHealthId,
        actorRole: user?.role || 'patient',
        action: 'EMERGENCY_SHARE_REVOKED',
        resourceType: 'EmergencyShare',
        resourceId: shareId,
        patientHealthId: patientHealthId,
        metadata: {
          revokedAt: new Date().toISOString()
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        message: 'Emergency share revoked successfully'
      });

    } catch (error) {
      console.error('Error revoking emergency share:', error);
      res.status(500).json({ error: 'Failed to revoke emergency share' });
    }
  }

  /**
   * Extract emergency data based on scope
   * Private helper method
   */
  private static extractEmergencyData(patient: any, scope: string[]) {
    const emergencyData: any = {
      emergency_access_notice: 'This data was accessed via emergency share link',
      health_id: patient.healthId
    };

    // Basic information (always included)
    if (scope.includes('basic') || scope.includes('emergency')) {
      emergencyData.basic_info = {
        name: patient.healthProfile ? `${patient.healthProfile.firstName} ${patient.healthProfile.lastName}` : 'Not provided',
        health_id: patient.healthId,
        phone: patient.phone || 'Not provided'
      };
    }

    // Blood group (critical for emergency)
    if (scope.includes('blood_group') || scope.includes('emergency')) {
      emergencyData.blood_group = patient.healthProfile?.bloodGroup || 'Not specified';
    }

    // Allergies (critical for emergency)
    if (scope.includes('allergies') || scope.includes('emergency')) {
      emergencyData.allergies = patient.healthProfile?.allergies || 'No known allergies';
    }

    // Chronic conditions (stored in medications JSON)
    if (scope.includes('chronic_conditions') || scope.includes('emergency')) {
      const medications = patient.healthProfile?.medications as any;
      emergencyData.chronic_conditions = medications?.chronicConditions || 'None specified';
    }

    // Emergency contact
    if (scope.includes('emergency_contact') || scope.includes('emergency')) {
      emergencyData.emergency_contact = patient.healthProfile?.emergencyContact || 'Not provided';
    }

    // Medications (if specifically requested)
    if (scope.includes('medications')) {
      const medications = patient.healthProfile?.medications as any;
      emergencyData.current_medications = medications?.current || 'None specified';
    }

    // Medical conditions (if specifically requested)
    if (scope.includes('medical_conditions')) {
      const medications = patient.healthProfile?.medications as any;
      emergencyData.medical_conditions = medications?.conditions || 'None specified';
    }

    return emergencyData;
  }

  /**
   * Get Emergency Card Data
   * GET /api/emergency/card
   * Returns emergency card information for the authenticated patient
   */
  static async getEmergencyCard(req: AuthenticatedRequest, res: Response) {
    try {
      const patientHealthId = req.user?.healthId;

      if (!patientHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const user = await prisma.user.findUnique({
        where: { healthId: patientHealthId },
        include: { healthProfile: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const emergencyCard = {
        health_id: user.healthId,
        name: user.healthProfile ? `${user.healthProfile.firstName} ${user.healthProfile.lastName}` : 'Not provided',
        blood_group: user.healthProfile?.bloodGroup || 'Not specified',
        allergies: user.healthProfile?.allergies || 'No known allergies',
        chronic_conditions: (user.healthProfile?.medications as any)?.chronicConditions || 'None',
        emergency_contact: user.healthProfile?.emergencyContact || 'Not provided',
        current_medications: (user.healthProfile?.medications as any)?.current || 'None',
        phone: user.phone || 'Not provided',
        created_at: new Date().toISOString()
      };

      // Log emergency card view
      await AuditService.logAction({
        actorId: patientHealthId,
        actorRole: user.role,
        action: 'EMERGENCY_CARD_VIEWED',
        resourceType: 'EmergencyCard',
        resourceId: patientHealthId,
        patientHealthId: patientHealthId,
        metadata: {
          viewed_at: new Date().toISOString()
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        data: emergencyCard
      });

    } catch (error) {
      console.error('Error getting emergency card:', error);
      res.status(500).json({ error: 'Failed to get emergency card data' });
    }
  }

  /**
   * Get Emergency Share Access Logs
   * GET /api/emergency/share/:shareId/logs
   * Returns access logs for a specific emergency share
   */
  static async getShareAccessLogs(req: AuthenticatedRequest, res: Response) {
    try {
      const { shareId } = req.params;
      const patientHealthId = req.user?.healthId;

      if (!patientHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Verify the share belongs to this patient
      const share = await prisma.emergencyShare.findFirst({
        where: {
          shareId,
          patientHealthId
        },
        include: {
          accessLogs: {
            orderBy: {
              accessedAt: 'desc'
            }
          }
        }
      });

      if (!share) {
        return res.status(404).json({ error: 'Emergency share not found' });
      }

      res.status(200).json({
        success: true,
        data: {
          shareId: share.shareId,
          shortUrl: share.shortUrl,
          scope: share.scope,
          expiresAt: share.expiresAt,
          createdAt: share.createdAt,
          accessCount: share.accessCount,
          lastAccessedAt: share.lastAccessedAt,
          accessLogs: share.accessLogs.map(log => ({
            id: log.id,
            accessedAt: log.accessedAt,
            ipAddress: log.ipAddress,
            userAgent: log.userAgent,
            scope: log.scope
          }))
        }
      });

    } catch (error) {
      console.error('Error getting share access logs:', error);
      res.status(500).json({ error: 'Failed to get access logs' });
    }
  }
}