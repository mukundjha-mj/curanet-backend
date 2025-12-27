import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

export class HealthIdService {
  
  /**
   * Generate a user-friendly Health ID
   * Format: HID-YYYY-XXXXXXXX (where X is alphanumeric)
   */
  private generateHealthId(): string {
    const year = new Date().getFullYear();
    const randomString = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `HID-${year}-${randomString}`;
  }

  /**
   * Create extended Health ID profile after user registration
   * This is called automatically when a user is created
   */
  async createHealthIdProfile(userId: string, healthId: string, initialData?: {
    firstName?: string;
    lastName?: string;
    displayName?: string;
    dateOfBirth?: string;
    gender?: string;
    phone?: string;
  }): Promise<void> {
    await prisma.healthProfile.create({
      data: {
        userId: healthId, // userId references User.healthId
        firstName: initialData?.firstName || '', // Required field
        lastName: initialData?.lastName || '',   // Required field
        displayName: initialData?.displayName,
        dateOfBirth: initialData?.dateOfBirth ? new Date(initialData.dateOfBirth) : undefined,
        gender: initialData?.gender,
        emergencyPhone: initialData?.phone,
        isActive: true
      }
    });
  }

  /**
   * Format existing user's healthId to new format if needed
   */
  async formatHealthId(healthId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { healthId }
    });

    if (!user) {
      throw new Error('User not found');
    }

    // If healthId doesn't follow our format, update it
    if (!user.healthId.startsWith('HID-')) {
      const newHealthId = this.generateHealthId();
      
      // Cannot update primary key - would need to create new user
      throw new Error('Cannot update Health ID - it is the primary key');

      return newHealthId;
    }

    return user.healthId;
  }

  /**
   * Verify a user's identity and activate their Health ID
   */
  async verifyIdentity(healthId: string, verificationData: {
    documentType: string;
    documentNumber: string;
    fullName: string;
  }): Promise<void> {
    // In a real system, this would integrate with government ID verification services
    // For now, we'll mark as verified
    
    await prisma.healthProfile.update({
      where: { userId: healthId },
      data: {
        verifiedAt: new Date()
      }
    });

    await prisma.user.update({
      where: { healthId },
      data: { isVerified: true }
    });

    // Log the verification
    await this.logAccess(healthId, healthId, 'IDENTITY_VERIFIED', {
      documentType: verificationData.documentType,
      // Don't log sensitive document numbers
      verifiedAt: new Date().toISOString()
    });
  }

  /**
   * Grant data access consent
   */
  async grantConsent(healthId: string, consentData: {
    grantedTo: string;
    purpose: string;
    expiresAt?: Date;
  }): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { healthId }
    });

    if (!user) {
      throw new Error('User not found');
    }

    const consent = await prisma.consent.create({
      data: {
        patientId: healthId,
        providerId: consentData.grantedTo,
        purpose: consentData.purpose || 'Health record access',
        expiresAt: consentData.expiresAt,
        status: 'ACTIVE'
      }
    });

    // Log the consent grant
    await this.logAccess(healthId, healthId, 'CONSENT_GRANTED', {
      consentId: consent.id,
      grantedTo: consentData.grantedTo
    });

    return consent.id;
  }

  /**
   * Revoke data access consent
   */
  async revokeConsent(consentId: string, healthId: string): Promise<void> {
    const consent = await prisma.consent.findUnique({
      where: { id: consentId }
    });

    if (!consent) {
      throw new Error('Consent not found');
    }

    if (consent.patientId !== healthId) {
      throw new Error('Unauthorized to revoke this consent');
    }

    await prisma.consent.update({
      where: { id: consentId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date()
      }
    });

    // Log the consent revocation
    await this.logAccess(healthId, healthId, 'CONSENT_REVOKED', {
      consentId: consentId,
      revokedAt: new Date().toISOString()
    });
  }

  /**
   * Check if access is allowed based on consent
   */
  async checkAccess(healthId: string, requestedBy: string, purpose: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { healthId }
    });

    if (!user) {
      return false;
    }

    const consents = await prisma.consent.findMany({
      where: {
        patientId: healthId,
        providerId: requestedBy,
        status: 'ACTIVE',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      }
    });

    // Log the access attempt
    await this.logAccess(healthId, requestedBy, 'ACCESS_ATTEMPT', {
      purpose,
      allowed: consents.length > 0
    });

    return consents.length > 0;
  }

  /**
   * Get user's Health ID information
   */
  async getHealthIdInfo(healthId: string): Promise<any> {
    const healthProfile = await prisma.healthProfile.findUnique({
      where: { userId: healthId },
      include: {
        user: true
      }
    });

    const consents = await prisma.consent.findMany({
      where: { 
        patientId: healthId,
        status: 'ACTIVE' 
      },
      orderBy: { createdAt: 'desc' }
    });

    return {
      ...healthProfile,
      consents
    };
  }

  /**
   * Log access to Health ID
   */
  private async logAccess(healthId: string, accessedBy: string, action: string, details?: any): Promise<void> {
    await prisma.healthIdAudit.create({
      data: {
        healthId,
        accessedBy,
        action,
        details,
        timestamp: new Date()
      }
    });
  }

  /**
   * Get audit trail for a Health ID
   */
  async getAuditTrail(healthId: string, requestingHealthId: string): Promise<any[]> {
    // Only allow users to access their own audit trail or admin access
    if (healthId !== requestingHealthId) {
      throw new Error('Unauthorized access to audit trail');
    }

    return await prisma.healthIdAudit.findMany({
      where: { healthId },
      orderBy: { timestamp: 'desc' },
      take: 100 // Limit to last 100 entries
    });
  }
}

export default new HealthIdService();