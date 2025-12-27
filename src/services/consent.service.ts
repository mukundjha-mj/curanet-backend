import prisma from '../utils/prisma';

/**
 * Enhanced Consent Service for CuraNet Healthcare Platform
 * Critical consent validation and tracking functionality
 */
export class ConsentService {
  /**
   * Validate if a provider has consent to access patient data
   */
  static async validateConsentAccess(
    patientId: string,
    providerId: string,
    action: string,
    scopes: string[]
  ): Promise<boolean> {
    // Allow patient to access their own data
    if (patientId === providerId) {
      return true;
    }

    const now = new Date();
    
    try {
      const consent = await prisma.consent.findFirst({
        where: {
          patientId,
          providerId,
          status: 'ACTIVE',
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } }
          ]
        }
      });

      if (!consent) {
        return false;
      }

      // Check if action is permitted
      if (!consent.permissions.includes(action)) {
        return false;
      }

      // Check if all required scopes are granted
      const hasAllScopes = scopes.every(scope => 
        consent.scope.includes(scope as any)
      );

      if (!hasAllScopes) {
        return false;
      }

      // Track access
      await this.trackConsentAccess(consent.id);

      return true;
    } catch (error) {
      console.error('Consent validation error:', error);
      return false;
    }
  }

  /**
   * Get active consent between patient and provider
   */
  static async getActiveConsent(patientId: string, providerId: string) {
    const now = new Date();
    
    try {
      return await prisma.consent.findFirst({
        where: {
          patientId,
          providerId,
          status: 'ACTIVE',
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } }
          ]
        }
      });
    } catch (error) {
      console.error('Get active consent error:', error);
      return null;
    }
  }

  /**
   * Check if provider has emergency access
   */
  static async hasEmergencyAccess(patientId: string, providerId: string): Promise<boolean> {
    try {
      const provider = await prisma.user.findUnique({
        where: { healthId: providerId },
        select: { role: true }
      });

      // Only healthcare providers can have emergency access
      return provider?.role === 'doctor' || provider?.role === 'pharmacy';
    } catch (error) {
      console.error('Emergency access check error:', error);
      return false;
    }
  }

  /**
   * Track consent access for auditing
   */
  static async trackConsentAccess(consentId: string): Promise<void> {
    try {
      await prisma.consent.update({
        where: { id: consentId },
        data: {
          accessCount: { increment: 1 },
          lastAccessed: new Date()
        }
      });
    } catch (error) {
      console.error('Track consent access error:', error);
    }
  }

  /**
   * Check if consent is expired
   */
  static isConsentExpired(consent: { expiresAt: Date | null; status: string }): boolean {
    if (consent.status !== 'ACTIVE') {
      return true;
    }
    
    if (!consent.expiresAt) {
      return false;
    }
    
    return consent.expiresAt < new Date();
  }
}

// Legacy function for backward compatibility
export async function hasConsent(patientId: string, providerId: string): Promise<boolean> {
  return ConsentService.validateConsentAccess(patientId, providerId, 'read', ['READ_BASIC']);
}

export default { hasConsent, ConsentService };
