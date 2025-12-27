import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuditEvent {
  type: 'record.read' | 'record.write';
  actorId: string;
  actorRole: string;
  patientId: string;
  resourceType: 'Encounter' | 'Observation';
  resourceId?: string;
  timestamp: string;
  details?: Record<string, any>;
}

interface AuditLogParams {
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  patientHealthId: string;
  consentId?: string;
  reason?: string;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
}

class AuditService {
  /**
   * Log an audit entry for any system action
   */
  static async logAction(params: AuditLogParams): Promise<void> {
    try {
      await prisma.healthIdAudit.create({
        data: {
          healthId: params.patientHealthId,
          accessedBy: params.actorId,
          action: params.action,
          details: {
            actorRole: params.actorRole,
            resourceType: params.resourceType,
            resourceId: params.resourceId,
            consentId: params.consentId,
            reason: params.reason,
            metadata: params.metadata
          },
          ipAddress: params.ipAddress,
          userAgent: params.userAgent
        }
      });
    } catch (error) {
      // Log audit failures but don't throw - audit shouldn't break main functionality
      console.error('Audit logging failed:', error);
    }
  }

  /**
   * Log record access (read/write)
   */
  static async logRecordAccess(
    actorId: string,
    actorRole: string,
    action: 'RECORD_READ' | 'RECORD_CREATE' | 'RECORD_UPDATE' | 'RECORD_DELETE' | 'RECORD_ACCESS_DENIED',
    patientHealthId: string,
    recordId: string,
    recordType: string,
    consentId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.logAction({
      actorId,
      actorRole,
      action,
      resourceType: recordType,
      resourceId: recordId,
      patientHealthId,
      consentId,
      ipAddress,
      userAgent
    });
  }

  /**
   * Check if actor has valid consent for action
   */
  static async verifyConsent(
    actorId: string,
    patientHealthId: string,
    requiredScope: string[]
  ): Promise<{ hasConsent: boolean; consentId?: string; error?: string }> {
    try {
      // If actor is the patient themselves, always allow
      if (actorId === patientHealthId) {
        return { hasConsent: true };
      }

      // Check for active consent
      const consent = await prisma.consent.findFirst({
        where: {
          patientId: patientHealthId,
          providerId: actorId,
          status: 'ACTIVE',
          OR: [
            { endTime: null },
            { endTime: { gt: new Date() } }
          ]
        }
      });

      if (!consent) {
        return { 
          hasConsent: false, 
          error: 'No active consent found' 
        };
      }

      // Check if consent covers required scope
      const consentScope = consent.scope as string[];
      const hasRequiredScope = requiredScope.every(scope => 
        consentScope.includes(scope) || consentScope.includes('READ_BASIC')
      );

      if (!hasRequiredScope) {
        return { 
          hasConsent: false, 
          error: 'Consent does not cover required scope',
          consentId: consent.id
        };
      }

      // Update access count and last accessed time
      await prisma.consent.update({
        where: { id: consent.id },
        data: {
          accessCount: { increment: 1 },
          lastAccessed: new Date()
        }
      });

      return { 
        hasConsent: true, 
        consentId: consent.id 
      };

    } catch (error) {
      console.error('Consent verification failed:', error);
      return { 
        hasConsent: false, 
        error: 'Consent verification failed' 
      };
    }
  }
}

export async function emitAudit(event: AuditEvent): Promise<void> {
  // Use the new audit service for backwards compatibility
  await AuditService.logRecordAccess(
    event.actorId,
    event.actorRole,
    event.type === 'record.read' ? 'RECORD_READ' : 'RECORD_CREATE',
    event.patientId,
    event.resourceId || 'unknown',
    event.resourceType
  );
  
  console.info('[AUDIT]', JSON.stringify(event));
}

export default AuditService;
