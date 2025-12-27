import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

type AuthedRequest = Request & { 
  user?: { 
    healthId: string; 
    role: string; 
  };
  ip?: string;
  headers: any;
};

// Request consent from a provider
export const requestConsent = async (req: AuthedRequest, res: Response) => {
  try {
    const { patientHealthId, scope, purpose, requestedExpiry, message } = req.body;
    const providerId = req.user?.healthId;

    if (!providerId) {
      return res.status(401).json({ message: 'Provider authentication required' });
    }

    if (!patientHealthId || !purpose) {
      return res.status(400).json({ message: 'Patient Health ID and purpose are required' });
    }

    // Verify patient exists
    const patient = await prisma.user.findUnique({
      where: { healthId: patientHealthId },
      select: { healthId: true, role: true }
    });

    if (!patient || patient.role !== 'patient') {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Check if there's already an active consent
    const existingConsent = await prisma.consent.findFirst({
      where: {
        patientId: patientHealthId,
        providerId,
        status: 'ACTIVE',
        OR: [
          { endTime: null },
          { endTime: { gt: new Date() } }
        ]
      }
    });

    if (existingConsent) {
      return res.status(400).json({ 
        message: 'Active consent already exists',
        consentId: existingConsent.id
      });
    }

    // Check for pending request
    const pendingRequest = await prisma.consentRequest.findFirst({
      where: {
        patientId: patientHealthId,
        providerId,
        status: 'PENDING',
        expiresAt: { gt: new Date() }
      }
    });

    if (pendingRequest) {
      return res.status(400).json({ 
        message: 'Consent request already pending',
        requestId: pendingRequest.id
      });
    }

    // Create consent request (expires in 48 hours, or 7 days in development)
    const expiresAt = new Date();
    const hoursToAdd = process.env.NODE_ENV === 'production' ? 48 : 168; // 7 days in dev
    expiresAt.setHours(expiresAt.getHours() + hoursToAdd);

    const consentRequest = await prisma.consentRequest.create({
      data: {
        patientId: patientHealthId,
        providerId,
        scope: Array.isArray(scope) ? scope : ['READ_BASIC'],
        purpose,
        requestedExpiry: requestedExpiry ? new Date(requestedExpiry) : null,
        message,
        expiresAt
      },
      include: {
        patient: { select: { healthId: true, email: true, healthProfile: true } },
        provider: { select: { healthId: true, email: true, role: true, healthProfile: true } }
      }
    });

    // Create audit log
    await prisma.healthIdAudit.create({
      data: {
        healthId: patientHealthId,
        accessedBy: providerId,
        action: 'CONSENT_REQUESTED',
        details: { requestId: consentRequest.id, purpose, scope },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    // PRODUCTION: Implement notification service
    // Send real-time notification to patient about consent request

    return res.status(201).json({
      message: 'Consent request created successfully',
      request: consentRequest
    });

  } catch (error) {
    logger.error('Error in requestConsent', { error, providerId: req.user?.healthId });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Grant consent (patient only)
export const grantConsent = async (req: AuthedRequest, res: Response) => {
  try {
    const { requestId, providerId, scope, purpose, endTime } = req.body;
    const patientId = req.user?.healthId;

    if (!patientId) {
      return res.status(401).json({ message: 'Patient authentication required' });
    }

    let consentData: any = {};

    if (requestId) {
      // Grant based on existing request
      console.log('Looking for consent request with ID:', requestId);
      const request = await prisma.consentRequest.findUnique({
        where: { id: requestId },
        include: { provider: true }
      });

      if (!request || request.patientId !== patientId) {
        return res.status(404).json({ message: 'Consent request not found' });
      }

      const isExpired = request.expiresAt && request.expiresAt < new Date();
      
      // In development, auto-extend expired requests
      if (isExpired && process.env.NODE_ENV !== 'production') {
        const newExpiresAt = new Date();
        newExpiresAt.setHours(newExpiresAt.getHours() + 48);
        await prisma.consentRequest.update({
          where: { id: requestId },
          data: { expiresAt: newExpiresAt }
        });
      } else if (request.status !== 'PENDING' || isExpired) {
        return res.status(400).json({ message: 'Consent request expired or already processed' });
      }

      consentData = {
        patientId,
        providerId: request.providerId,
        scope: request.scope,
        purpose: request.purpose,
        endTime: endTime ? new Date(endTime) : (request.requestedExpiry ? new Date(request.requestedExpiry) : null),
        requestId: request.id
      };

      // Update request status
      await prisma.consentRequest.update({
        where: { id: requestId },
        data: { 
          status: 'APPROVED',
          reviewedAt: new Date()
        }
      });

    } else {
      // Direct consent grant
      if (!providerId || !purpose) {
        return res.status(400).json({ message: 'Provider ID and purpose are required for direct grant' });
      }

      consentData = {
        patientId,
        providerId,
        scope: Array.isArray(scope) ? scope : ['READ_BASIC'],
        purpose,
        endTime: endTime ? new Date(endTime) : null
      };
    }

    // Create consent
    const consent = await prisma.consent.create({
      data: {
        ...consentData,
        status: 'ACTIVE'
      },
      include: {
        provider: { select: { healthId: true, email: true, role: true, healthProfile: true } }
      }
    });

    // Create audit log
    await prisma.healthIdAudit.create({
      data: {
        healthId: patientId,
        accessedBy: patientId,
        action: 'CONSENT_GRANTED',
        details: { consentId: consent.id, requestId: requestId || null },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    // PRODUCTION: Implement event system and notifications
    // Emit consent.granted event for real-time updates
    // Send notification to provider about granted consent

    return res.status(201).json({
      message: 'Consent granted successfully',
      consent
    });

  } catch (error) {
    logger.error('Error in grantConsent', { error, patientId: req.user?.healthId });
    if (error instanceof Error) {
      return res.status(500).json({ 
        message: 'Internal server error',
        error: error.message 
      });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Revoke consent (patient only)
export const revokeConsent = async (req: AuthedRequest, res: Response) => {
  try {
    const { consentId, reason } = req.body;
    const patientId = req.user?.healthId;

    if (!patientId) {
      return res.status(401).json({ message: 'Patient authentication required' });
    }

    if (!consentId) {
      return res.status(400).json({ message: 'Consent ID is required' });
    }

    // Find and verify consent ownership
    const consent = await prisma.consent.findUnique({
      where: { id: consentId },
      include: { provider: { select: { healthId: true, email: true, healthProfile: true } } }
    });

    if (!consent || consent.patientId !== patientId) {
      return res.status(404).json({ message: 'Consent not found' });
    }

    if (consent.status !== 'ACTIVE') {
      return res.status(400).json({ message: 'Consent is not active' });
    }

    // Revoke consent
    const revokedConsent = await prisma.consent.update({
      where: { id: consentId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date()
      }
    });

    // Create audit log
    await prisma.healthIdAudit.create({
      data: {
        healthId: patientId,
        accessedBy: patientId,
        action: 'CONSENT_REVOKED',
        details: { consentId, reason },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    // PRODUCTION: Implement event system, notifications, and cache invalidation
    // Emit consent.revoked event for real-time updates
    // Send notification to provider about revoked consent
    // Invalidate any cached consent data (if using Redis/similar)

    return res.json({
      message: 'Consent revoked successfully',
      consent: revokedConsent
    });

  } catch (error) {
    logger.error('Error in revokeConsent', { error, patientId: req.user?.healthId });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// List consents
export const listConsents = async (req: AuthedRequest, res: Response) => {
  try {
    const { patientId, providerId, activeOnly } = req.query;
    const userId = req.user?.healthId;
    const userRole = req.user?.role;

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    let whereClause: any = {};

    // Access control
    if (userRole === 'patient') {
      whereClause.patientId = userId;
    } else if (userRole === 'doctor' || userRole === 'pharmacy') {
      whereClause.providerId = userId;
    } else if (userRole === 'admin') {
      // Admin can filter by patientId or providerId
      if (patientId) whereClause.patientId = patientId as string;
      if (providerId) whereClause.providerId = providerId as string;
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Filter active only
    if (activeOnly === 'true') {
      whereClause.status = 'ACTIVE';
      whereClause.OR = [
        { endTime: null },
        { endTime: { gt: new Date() } }
      ];
    }

    const consents = await prisma.consent.findMany({
      where: whereClause,
      include: {
        patient: { 
          select: { 
            healthId: true, 
            email: true, 
            healthProfile: { 
              select: { firstName: true, lastName: true } 
            } 
          } 
        },
        provider: { 
          select: { 
            healthId: true, 
            email: true, 
            role: true,
            healthProfile: { 
              select: { firstName: true, lastName: true } 
            } 
          } 
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({ consents });

  } catch (error) {
    logger.error('Error in listConsents', { error, userId: req.user?.healthId });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get consent details
export const getConsentDetails = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.healthId;
    const userRole = req.user?.role;

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const consent = await prisma.consent.findUnique({
      where: { id },
      include: {
        patient: { 
          select: { 
            healthId: true, 
            email: true, 
            healthProfile: { 
              select: { firstName: true, lastName: true, displayName: true } 
            } 
          } 
        },
        provider: { 
          select: { 
            healthId: true, 
            email: true, 
            role: true,
            healthProfile: { 
              select: { firstName: true, lastName: true, displayName: true } 
            } 
          } 
        }
      }
    });

    if (!consent) {
      return res.status(404).json({ message: 'Consent not found' });
    }

    // Access control
    const hasAccess = userRole === 'admin' || 
                     consent.patientId === userId || 
                     consent.providerId === userId;

    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get related audit entries
    const auditEntries = await prisma.healthIdAudit.findMany({
      where: { 
        healthId: consent.patientId,
        details: {
          path: ['consentId'],
          equals: id
        }
      },
      orderBy: { timestamp: 'desc' },
      take: 20
    });

    return res.json({ 
      consent,
      auditTrail: auditEntries
    });

  } catch (error) {
    logger.error('Error in getConsentDetails', { error, consentId: req.params.id });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get consent requests (patient view)
export const getConsentRequests = async (req: AuthedRequest, res: Response) => {
  try {
    console.log('=== GET CONSENT REQUESTS ===');
    console.log('User:', req.user);
    console.log('Query params:', req.query);
    
    const userId = req.user?.healthId;
    const userRole = req.user?.role;
    console.log('Extracted values - userId:', userId, 'userRole:', userRole);

    if (!userId) {
      console.log('ERROR: No user ID found in request');
      return res.status(401).json({ message: 'Authentication required' });
    }

    let whereClause: any = {};

    if (userRole === 'patient') {
      whereClause.patientId = userId;
      // For patients, only show PENDING requests in notifications
      whereClause.status = 'PENDING';
    } else if (userRole === 'doctor' || userRole === 'pharmacy') {
      whereClause.providerId = userId;
      // For providers, show all their requests by default
      // Can be filtered by query params if needed
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Allow filtering by status via query params
    if (req.query.status) {
      whereClause.status = req.query.status;
    }

    const requests = await prisma.consentRequest.findMany({
      where: whereClause,
      include: {
        patient: { 
          select: { 
            healthId: true, 
            email: true, 
            healthProfile: { 
              select: { firstName: true, lastName: true } 
            } 
          } 
        },
        provider: { 
          select: { 
            healthId: true, 
            email: true, 
            role: true,
            healthProfile: { 
              select: { firstName: true, lastName: true } 
            } 
          } 
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({ requests });

  } catch (error) {
    logger.error('Error in getConsentRequests', { error, userId: req.user?.healthId });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Reject consent request (patient only)
export const rejectConsentRequest = async (req: AuthedRequest, res: Response) => {
  try {
    const { requestId, reason } = req.body;
    const patientId = req.user?.healthId;

    if (!patientId) {
      return res.status(401).json({ message: 'Patient authentication required' });
    }

    if (!requestId) {
      return res.status(400).json({ message: 'Request ID is required' });
    }

    const request = await prisma.consentRequest.findUnique({
      where: { id: requestId }
    });

    if (!request || request.patientId !== patientId) {
      return res.status(404).json({ message: 'Consent request not found' });
    }

    if (request.status !== 'PENDING') {
      return res.status(400).json({ message: 'Request already processed' });
    }

    // Reject request
    const rejectedRequest = await prisma.consentRequest.update({
      where: { id: requestId },
      data: {
        status: 'DENIED',
        reviewedAt: new Date()
      }
    });

    // Create audit log
    await prisma.healthIdAudit.create({
      data: {
        healthId: patientId,
        accessedBy: patientId,
        action: 'CONSENT_REQUEST_REJECTED',
        details: { requestId, reason },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    return res.json({
      message: 'Consent request rejected',
      request: rejectedRequest
    });

  } catch (error) {
    logger.error('Error in rejectConsentRequest', { error, patientId: req.user?.healthId });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Development utility: Refresh expired consent requests
export const refreshExpiredRequests = async (req: AuthedRequest, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ message: 'Not available in production' });
    }

    const now = new Date();
    const newExpiresAt = new Date();
    newExpiresAt.setHours(newExpiresAt.getHours() + 48);

    const result = await prisma.consentRequest.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: now }
      },
      data: {
        expiresAt: newExpiresAt
      }
    });

    console.log(`Refreshed ${result.count} expired consent requests`);
    return res.json({ 
      message: `Refreshed ${result.count} expired consent requests`,
      newExpiresAt 
    });

  } catch (error) {
    console.error('refreshExpiredRequests error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export default {
  requestConsent,
  grantConsent,
  revokeConsent,
  listConsents,
  getConsentDetails,
  getConsentRequests,
  rejectConsentRequest,
  refreshExpiredRequests
};