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

export class AuditExportController {
  /**
   * GET /api/admin/audit/export
   * Export audit logs to CSV with filtering
   */
  static async exportAuditLogs(req: AuthenticatedRequest, res: Response) {
    try {
      const {
        startDate,
        endDate,
        action,
        userId,
        healthId,
        format = 'csv',
        limit = '10000'
      } = req.query;

      // Build where clause
      const whereClause: any = {};

      // Date range filter
      if (startDate || endDate) {
        whereClause.timestamp = {};
        if (startDate) {
          whereClause.timestamp.gte = new Date(startDate as string);
        }
        if (endDate) {
          whereClause.timestamp.lte = new Date(endDate as string);
        }
      }

      // Action filter
      if (action && action !== 'all') {
        whereClause.action = action as string;
      }

      // User filter (person who performed the action)
      if (userId && userId !== 'all') {
        whereClause.accessedBy = userId as string;
      }

      // Health ID filter (patient whose data was accessed)
      if (healthId && healthId !== 'all') {
        whereClause.healthId = healthId as string;
      }

      // Get audit logs with user details
      const auditLogs = await prisma.healthIdAudit.findMany({
        where: whereClause,
        orderBy: { timestamp: 'desc' },
        take: parseInt(limit as string),
        select: {
          id: true,
          healthId: true,
          accessedBy: true,
          action: true,
          details: true,
          ipAddress: true,
          userAgent: true,
          timestamp: true
        }
      });

      // Get unique user IDs for user details
      const userIds = Array.from(new Set([
        ...auditLogs.map(log => log.accessedBy),
        ...auditLogs.map(log => log.healthId)
      ].filter(Boolean)));

      // Get user details
      const users = await prisma.user.findMany({
        where: { healthId: { in: userIds } },
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

      const userMap = new Map(users.map(user => [user.healthId, user]));

      // Format audit logs with user details
      const formattedLogs = auditLogs.map(log => {
        const actor = userMap.get(log.accessedBy);
        const subject = userMap.get(log.healthId);

        return {
          id: log.id,
          timestamp: log.timestamp,
          action: log.action,
          healthId: log.healthId,
          accessedBy: log.accessedBy,
          
          // Subject (patient/user whose data was accessed)
          subjectEmail: subject?.email || 'Unknown',
          subjectName: subject?.healthProfile 
            ? `${subject.healthProfile.firstName} ${subject.healthProfile.lastName}`
            : 'Unknown',
          subjectRole: subject?.role || 'Unknown',

          // Actor (user who performed the action)
          actorEmail: actor?.email || 'Unknown',
          actorName: actor?.healthProfile 
            ? `${actor.healthProfile.firstName} ${actor.healthProfile.lastName}`
            : 'Unknown',
          actorRole: actor?.role || 'Unknown',

          ipAddress: log.ipAddress,
          userAgent: log.userAgent,
          details: log.details
        };
      });

      // Log the export action
      await prisma.healthIdAudit.create({
        data: {
          healthId: req.user!.healthId,
          accessedBy: req.user!.healthId,
          action: 'AUDIT_LOGS_EXPORTED',
          details: {
            exportCount: formattedLogs.length,
            filters: { startDate, endDate, action, userId, healthId },
            format,
            limit: parseInt(limit as string),
            adminEmail: req.user!.email
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      if (format === 'json') {
        res.json({
          success: true,
          data: {
            auditLogs: formattedLogs,
            totalCount: auditLogs.length,
            filters: { startDate, endDate, action, userId, healthId },
            exportedAt: new Date().toISOString(),
            exportedBy: req.user!.email
          }
        });
        return;
      }

      // Generate CSV
      const csvHeaders = [
        'ID',
        'Timestamp',
        'Action',
        'Subject Health ID',
        'Subject Email', 
        'Subject Name',
        'Subject Role',
        'Actor Health ID',
        'Actor Email',
        'Actor Name', 
        'Actor Role',
        'IP Address',
        'User Agent',
        'Details'
      ];

      const csvRows = formattedLogs.map(log => [
        log.id,
        log.timestamp.toISOString(),
        log.action,
        log.healthId,
        log.subjectEmail,
        log.subjectName,
        log.subjectRole,
        log.accessedBy,
        log.actorEmail,
        log.actorName,
        log.actorRole,
        log.ipAddress || '',
        log.userAgent || '',
        JSON.stringify(log.details || {})
      ]);

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const filename = `audit-logs-${startDate || 'all'}-to-${endDate || 'all'}-${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);

    } catch (error) {
      console.error('Error exporting audit logs:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export audit logs'
      });
    }
  }

  /**
   * GET /api/admin/audit/summary
   * Get audit log summary for export preparation
   */
  static async getAuditSummary(req: Request, res: Response) {
    try {
      const {
        startDate,
        endDate,
        action,
        userId,
        healthId
      } = req.query;

      // Build where clause
      const whereClause: any = {};

      if (startDate || endDate) {
        whereClause.timestamp = {};
        if (startDate) {
          whereClause.timestamp.gte = new Date(startDate as string);
        }
        if (endDate) {
          whereClause.timestamp.lte = new Date(endDate as string);
        }
      }

      if (action && action !== 'all') {
        whereClause.action = action as string;
      }

      if (userId && userId !== 'all') {
        whereClause.accessedBy = userId as string;
      }

      if (healthId && healthId !== 'all') {
        whereClause.healthId = healthId as string;
      }

      // Get count and date range
      const [totalCount, dateRange] = await Promise.all([
        prisma.healthIdAudit.count({ where: whereClause }),
        prisma.healthIdAudit.aggregate({
          where: whereClause,
          _min: { timestamp: true },
          _max: { timestamp: true }
        })
      ]);

      // Get unique actions for filter options
      const actions = await prisma.healthIdAudit.findMany({
        where: whereClause,
        select: { action: true },
        distinct: ['action']
      });

      // Get sample of recent logs for preview
      const sampleLogs = await prisma.healthIdAudit.findMany({
        where: whereClause,
        orderBy: { timestamp: 'desc' },
        take: 5,
        select: {
          action: true,
          timestamp: true,
          accessedBy: true,
          healthId: true
        }
      });

      res.json({
        success: true,
        data: {
          summary: {
            totalCount,
            dateRange: {
              earliest: dateRange._min.timestamp,
              latest: dateRange._max.timestamp
            },
            estimatedSizeKB: Math.round((totalCount * 500) / 1024), // Rough estimate
            exportRecommendation: totalCount > 50000 
              ? 'Consider filtering by date range for better performance'
              : 'Ready for export'
          },
          filters: {
            availableActions: actions.map(a => a.action).sort(),
            appliedFilters: { startDate, endDate, action, userId, healthId }
          },
          preview: sampleLogs
        }
      });

    } catch (error) {
      console.error('Error getting audit summary:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get audit summary'
      });
    }
  }

  /**
   * GET /api/admin/audit/actions
   * Get list of all available audit actions for filtering
   */
  static async getAuditActions(req: Request, res: Response) {
    try {
      const actions = await prisma.healthIdAudit.findMany({
        select: { action: true },
        distinct: ['action'],
        orderBy: { action: 'asc' }
      });

      // Get count for each action using raw query
      const actionCounts = await prisma.$queryRaw<Array<{
        action: string;
        count: bigint;
      }>>`
        SELECT action, COUNT(*) as count
        FROM health_id_audits 
        GROUP BY action
        ORDER BY count DESC
      `;

      const actionsWithCounts = actions.map(actionItem => {
        const countItem = actionCounts.find(c => c.action === actionItem.action);
        return {
          action: actionItem.action,
          count: Number(countItem?.count || 0)
        };
      });

      res.json({
        success: true,
        data: {
          actions: actionsWithCounts,
          totalActions: actions.length
        }
      });

    } catch (error) {
      console.error('Error getting audit actions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get audit actions'
      });
    }
  }
}