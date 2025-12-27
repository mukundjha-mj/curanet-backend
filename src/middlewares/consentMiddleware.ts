import { Request, Response, NextFunction } from 'express';
import AuditService from '../services/audit.service';
import logger from '../utils/logger';

type AuthedRequest = Request & { 
  user?: { 
    healthId: string; 
    role: string; 
  };
  consentId?: string; // Will be set by this middleware
};

/**
 * Middleware to enforce consent checks for patient data access
 * Use this on any endpoint that accesses patient records
 */
export const requireConsent = (requiredScope: string[] = ['READ_BASIC']) => {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = req.user?.healthId;
      const actorRole = req.user?.role;

      if (!actorId) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      // Extract patient health ID from request
      // This can come from params, body, or query depending on the endpoint
      let patientHealthId = req.params.healthId || 
                           req.params.patientId || 
                           req.body.patientId || 
                           req.body.healthId ||
                           req.query.patientId ||
                           req.query.healthId;

      // If no patientId specified and user is a patient, they're accessing their own records
      if (!patientHealthId && actorRole === 'patient') {
        patientHealthId = actorId;
      }

      if (!patientHealthId) {
        res.status(400).json({ message: 'Patient Health ID is required' });
        return;
      }

      // Skip consent check for admin users
      if (actorRole === 'admin') {
        req.consentId = 'admin-override';
        next();
        return;
      }

      // Skip consent check for patients accessing their own records
      if (actorRole === 'patient' && actorId === patientHealthId) {
        req.consentId = 'self-access';
        next();
        return;
      }

      // Development mode: Allow doctor-patient interactions for medical encounters
      // This should be removed in production and proper consent flow implemented
      if (process.env.NODE_ENV === 'development' && actorRole === 'doctor' && 
          (requiredScope.includes('WRITE_NOTES') || requiredScope.includes('READ_MEDICAL'))) {
        req.consentId = 'dev-doctor-override';
        next();
        return;
      }

      // Verify consent
      const consentCheck = await AuditService.verifyConsent(
        actorId,
        patientHealthId as string,
        requiredScope
      );

      if (!consentCheck.hasConsent) {
        // Log the failed access attempt
        await AuditService.logRecordAccess(
          actorId,
          actorRole || 'unknown',
          'RECORD_ACCESS_DENIED',
          patientHealthId as string,
          'consent-check',
          'access_control',
          undefined,
          req.ip,
          req.headers['user-agent']
        );

        res.status(403).json({ 
          message: 'Access denied: Valid consent required',
          error: consentCheck.error,
          requiredScope,
          suggestedAction: 'Request consent from patient'
        });
        return;
      }

      // Store consent ID for use in the endpoint
      req.consentId = consentCheck.consentId;
      next();

    } catch (error) {
      logger.error('Consent middleware error', { error });
      res.status(500).json({ message: 'Internal server error' });
      return;
    }
  };
};

/**
 * Middleware to log record access after successful consent check
 * Use this after requireConsent middleware
 */
export const logRecordAccess = (
  resourceType: string,
  action: 'RECORD_READ' | 'RECORD_CREATE' | 'RECORD_UPDATE' | 'RECORD_DELETE' | 'RECORD_ACCESS_DENIED' = 'RECORD_READ'
) => {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = req.user?.healthId;
      const actorRole = req.user?.role;
      const consentId = req.consentId;

      // Extract patient health ID and resource ID
      const patientHealthId = req.params.healthId || 
                             req.params.patientId || 
                             req.body.patientId || 
                             req.body.healthId ||
                             req.query.patientId ||
                             req.query.healthId;

      const resourceId = req.params.id || 
                        req.params.recordId || 
                        req.body.id || 
                        'batch-operation';

      if (actorId && patientHealthId) {
        // Log the access
        await AuditService.logRecordAccess(
          actorId,
          actorRole || 'unknown',
          action,
          patientHealthId as string,
          resourceId as string,
          resourceType,
          consentId,
          req.ip,
          req.headers['user-agent']
        );
      }

      next();

    } catch (error) {
      // Don't fail the request if audit logging fails
      logger.error('Audit logging middleware error', { error });
      next();
    }
  };
};

/**
 * Combined middleware for consent check + audit logging
 */
export const requireConsentAndLog = (
  resourceType: string,
  requiredScope: string[] = ['READ_BASIC'],
  action: 'RECORD_READ' | 'RECORD_CREATE' | 'RECORD_UPDATE' | 'RECORD_DELETE' | 'RECORD_ACCESS_DENIED' = 'RECORD_READ'
) => {
  return [
    requireConsent(requiredScope),
    logRecordAccess(resourceType, action)
  ];
};

export default {
  requireConsent,
  logRecordAccess,
  requireConsentAndLog
};