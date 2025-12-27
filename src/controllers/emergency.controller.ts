import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import AuditService from '../services/audit.service';

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
  /**
   * Create Emergency Share Link
   * POST /api/emergency/share
   * Creates a one-time, time-limited emergency access link
   */
  static async createEmergencyShare(req: AuthenticatedRequest, res: Response) {
    try {
      const { expires_in_seconds = 3600, scope = ['basic', 'emergency', 'allergies'] } = req.body;
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
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = await bcrypt.hash(token, 12);

      // Calculate expiration time
      const expiresAt = new Date(Date.now() + expires_in_seconds * 1000);

      // Validate expiration time (max 24 hours for security)
      const maxExpiry = 24 * 60 * 60; // 24 hours in seconds
      if (expires_in_seconds > maxExpiry) {
        return res.status(400).json({ 
          error: 'Maximum expiration time is 24 hours',
          max_expires_in_seconds: maxExpiry
        });
      }

      // Create emergency share record
      const emergencyShare = await prisma.emergencyShare.create({
        data: {
          shareId,
          tokenHash,
          patientHealthId,
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

      // Create short URL
      const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
      const shortUrl = `${baseUrl}/one/${token}`;

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

      // Find all non-expired, non-used emergency shares
      const emergencyShares = await prisma.emergencyShare.findMany({
        where: {
          used: false,
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
          message: 'This emergency access link is either invalid, expired, or has already been used.'
        });
      }

      // Mark token as used
      await prisma.emergencyShare.update({
        where: { id: validShare.id },
        data: {
          used: true,
          usedAt: new Date(),
          accessedBy: req.ip || 'UNKNOWN',
          accessLog: {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString()
          }
        }
      });

      // Extract emergency data based on scope
      const emergencyData = this.extractEmergencyData(validShare.patient, validShare.scope as string[]);

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
          scope: validShare.scope,
          accessedData: Object.keys(emergencyData),
          createdAt: validShare.createdAt.toISOString()
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        emergency_access: true,
        accessed_at: new Date().toISOString(),
        data: emergencyData,
        warning: 'This is emergency access. Access has been logged for security purposes.',
        scope: validShare.scope
      });

    } catch (error) {
      console.error('Error accessing emergency share:', error);
      res.status(500).json({ error: 'Failed to access emergency data' });
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
          scope: true,
          expiresAt: true,
          createdAt: true,
          used: true,
          usedAt: true,
          accessedBy: true
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
}