import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type AuthedRequest = Request & { 
  user?: { 
    healthId: string; 
    role: string; 
  };
  ip?: string;
  headers: any;
};

// Internal audit logging (services write events)
export const createAuditEntry = async (req: AuthedRequest, res: Response) => {
  try {
    const { 
      actorId, 
      actorRole, 
      action, 
      resourceType, 
      resourceId, 
      consentId, 
      reason, 
      metadata 
    } = req.body;

    if (!actorId || !action || !resourceType) {
      return res.status(400).json({ 
        message: 'Actor ID, action, and resource type are required' 
      });
    }

    const auditEntry = await prisma.healthIdAudit.create({
      data: {
        healthId: resourceId, // The health ID being accessed
        accessedBy: actorId,
        action,
        details: {
          actorRole,
          resourceType,
          resourceId,
          consentId,
          reason,
          metadata
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    return res.status(201).json({ 
      message: 'Audit entry created',
      auditId: auditEntry.id 
    });

  } catch (error) {
    console.error('createAuditEntry error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Admin access - filter by actorId / resourceId / action / date range / patientId
export const getAuditEntries = async (req: AuthedRequest, res: Response) => {
  try {
    const { 
      actorId, 
      resourceId, 
      action, 
      startDate, 
      endDate, 
      patientId,
      page = '1',
      limit = '50'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    if (actorId) where.accessedBy = actorId;
    if (action) where.action = action;
    if (patientId) where.healthId = patientId;
    if (resourceId) {
      where.details = {
        path: ['resourceId'],
        equals: resourceId
      };
    }
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate as string);
      if (endDate) where.timestamp.lte = new Date(endDate as string);
    }

    const [auditEntries, totalCount] = await Promise.all([
      prisma.healthIdAudit.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: offset,
        take: limitNum,

      }),
      prisma.healthIdAudit.count({ where })
    ]);

    // Enrich with user details
    const enrichedEntries = await Promise.all(
      auditEntries.map(async (entry) => {
        try {
          const actor = await prisma.user.findUnique({
            where: { healthId: entry.accessedBy },
            select: { 
              healthId: true, 
              email: true, 
              role: true,
              healthProfile: {
                select: { 
                  firstName: true, 
                  lastName: true 
                }
              }
            }
          });

          const patient = entry.healthId !== entry.accessedBy ? await prisma.user.findUnique({
            where: { healthId: entry.healthId },
            select: { 
              healthId: true, 
              email: true,
              healthProfile: {
                select: { 
                  firstName: true, 
                  lastName: true 
                }
              }
            }
          }) : null;

          return {
            ...entry,
            actor: actor || { healthId: entry.accessedBy, email: 'Unknown', role: 'unknown' },
            patient: patient || { healthId: entry.healthId, email: 'Unknown' }
          };
        } catch (error) {
          return {
            ...entry,
            actor: { healthId: entry.accessedBy, email: 'Unknown', role: 'unknown' },
            patient: { healthId: entry.healthId, email: 'Unknown' }
          };
        }
      })
    );

    return res.json({
      auditEntries: enrichedEntries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum)
      }
    });

  } catch (error) {
    console.error('getAuditEntries error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Patient-only view (limited to their data)
export const getPatientAuditEntries = async (req: AuthedRequest, res: Response) => {
  try {
    const { healthId } = req.params;
    const currentUserId = req.user?.healthId;
    const currentUserRole = req.user?.role;

    // Security check: only the patient themselves or admin can access
    if (currentUserRole !== 'admin' && currentUserId !== healthId) {
      return res.status(403).json({ 
        message: 'Access denied: Can only view your own audit records' 
      });
    }

    const { 
      action, 
      startDate, 
      endDate,
      page = '1',
      limit = '50'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Build where clause - only for this patient's data
    const where: any = {
      healthId: healthId
    };

    if (action) where.action = action;
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate as string);
      if (endDate) where.timestamp.lte = new Date(endDate as string);
    }

    const [auditEntries, totalCount] = await Promise.all([
      prisma.healthIdAudit.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: offset,
        take: limitNum
      }),
      prisma.healthIdAudit.count({ where })
    ]);

    // Enrich with actor details
    const enrichedEntries = await Promise.all(
      auditEntries.map(async (entry) => {
        try {
          const actor = await prisma.user.findUnique({
            where: { healthId: entry.accessedBy },
            select: { 
              healthId: true, 
              email: true, 
              role: true,
              healthProfile: {
                select: { 
                  firstName: true, 
                  lastName: true 
                }
              }
            }
          });

          // Get consent details if this was a consent-related action
          let consentDetails = null;
          if (entry.details && typeof entry.details === 'object' && 'consentId' in entry.details) {
            const consentId = (entry.details as any).consentId;
            if (consentId) {
              consentDetails = await prisma.consent.findUnique({
                where: { id: consentId },
                select: { 
                  id: true, 
                  purpose: true, 
                  scope: true,
                  status: true 
                }
              });
            }
          }

          return {
            ...entry,
            actor: actor || { 
              healthId: entry.accessedBy, 
              email: 'Unknown', 
              role: 'unknown',
              healthProfile: { firstName: 'Unknown', lastName: 'User' }
            },
            consentDetails,
            // Format for patient-friendly display
            friendlyAction: getFriendlyActionName(entry.action),
            actionDescription: getActionDescription(entry.action, entry.details)
          };
        } catch (error) {
          return {
            ...entry,
            actor: { 
              healthId: entry.accessedBy, 
              email: 'Unknown', 
              role: 'unknown',
              healthProfile: { firstName: 'Unknown', lastName: 'User' }
            },
            friendlyAction: getFriendlyActionName(entry.action),
            actionDescription: getActionDescription(entry.action, entry.details)
          };
        }
      })
    );

    return res.json({
      auditEntries: enrichedEntries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum)
      }
    });

  } catch (error) {
    console.error('getPatientAuditEntries error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Export audit data (admin only)
export const exportAuditEntries = async (req: AuthedRequest, res: Response) => {
  try {
    const { 
      actorId, 
      resourceId, 
      action, 
      startDate, 
      endDate, 
      patientId,
      format = 'csv'
    } = req.query;

    // Build where clause (same as getAuditEntries)
    const where: any = {};

    if (actorId) where.accessedBy = actorId;
    if (action) where.action = action;
    if (patientId) where.healthId = patientId;
    if (resourceId) {
      where.details = {
        path: ['resourceId'],
        equals: resourceId
      };
    }
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate as string);
      if (endDate) where.timestamp.lte = new Date(endDate as string);
    }

    const auditEntries = await prisma.healthIdAudit.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: 10000 // Limit exports to prevent memory issues
    });

    if (format === 'csv') {
      // Generate CSV
      const csvHeader = 'ID,Timestamp,Patient Health ID,Actor Health ID,Action,Resource Type,Resource ID,IP Address,User Agent,Details\n';
      const csvRows = auditEntries.map(entry => {
        const details = entry.details ? JSON.stringify(entry.details).replace(/"/g, '""') : '';
        return [
          entry.id,
          entry.timestamp.toISOString(),
          entry.healthId,
          entry.accessedBy,
          entry.action,
          (entry.details as any)?.resourceType || 'N/A',
          (entry.details as any)?.resourceId || 'N/A',
          entry.ipAddress || 'N/A',
          entry.userAgent || 'N/A',
          `"${details}"`
        ].join(',');
      }).join('\n');

      const csv = csvHeader + csvRows;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-export-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csv);
    }

    // Default JSON export
    return res.json({ auditEntries });

  } catch (error) {
    console.error('exportAuditEntries error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Helper functions for patient-friendly display
const getFriendlyActionName = (action: string): string => {
  const actionMap: { [key: string]: string } = {
    'RECORD_READ': 'Record Viewed',
    'RECORD_CREATE': 'Record Created',
    'RECORD_UPDATE': 'Record Updated',
    'CONSENT_REQUESTED': 'Consent Requested',
    'CONSENT_GRANTED': 'Consent Granted',
    'CONSENT_REVOKED': 'Consent Revoked',
    'CONSENT_REQUEST_REJECTED': 'Consent Request Rejected',
    'PRESCRIPTION_CREATE': 'Prescription Created',
    'PRESCRIPTION_DISPENSE': 'Prescription Dispensed',
    'LOGIN': 'Account Login',
    'HEALTH_ID_ACCESS': 'Health ID Accessed'
  };

  return actionMap[action] || action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

const getActionDescription = (action: string, details: any): string => {
  if (!details || typeof details !== 'object') return '';

  switch (action) {
    case 'CONSENT_REQUESTED':
      return `Access requested for: ${details.purpose || 'healthcare services'}`;
    case 'CONSENT_GRANTED':
      return `Access granted for: ${details.purpose || 'healthcare services'}`;
    case 'CONSENT_REVOKED':
      return `Access revoked${details.reason ? `: ${details.reason}` : ''}`;
    case 'RECORD_READ':
      return `Viewed ${details.resourceType || 'medical record'}`;
    case 'PRESCRIPTION_CREATE':
      return `Created prescription${details.medication ? ` for ${details.medication}` : ''}`;
    default:
      return details.reason || details.purpose || '';
  }
};

export default {
  createAuditEntry,
  getAuditEntries,
  getPatientAuditEntries,
  exportAuditEntries
};