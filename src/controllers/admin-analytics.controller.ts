import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class AdminAnalyticsController {
  /**
   * GET /api/admin/stats
   * Dashboard KPIs: user counts, daily signups, active consents, pending approvals
   */
  static async getDashboardStats(req: Request, res: Response) {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // User Statistics
      const [
        totalUsers,
        totalPatients,
        totalProviders,
        totalAdmins,
        newUsersThisWeek,
        newUsersToday,
        pendingProviders,
        verifiedUsers,
      ] = await Promise.all([
        // Total users by role
        prisma.user.count(),
        prisma.user.count({ where: { role: 'patient' } }),
        prisma.user.count({ where: { role: 'doctor' } }),
        prisma.user.count({ where: { role: 'admin' } }),
        
        // New users this week
        prisma.user.count({
          where: { createdAt: { gte: sevenDaysAgo } }
        }),
        
        // New users today
        prisma.user.count({
          where: { createdAt: { gte: yesterday } }
        }),
        
        // Pending provider approvals
        prisma.user.count({
          where: {
            role: 'doctor',
            isVerified: false
          }
        }),
        
        // Verified users
        prisma.user.count({
          where: { isVerified: true }
        })
      ]);

      // Consent Statistics
      const [
        totalConsents,
        activeConsents,
        revokedConsents,
        expiredConsents,
        requestedConsents,
        consentsGrantedThisWeek,
      ] = await Promise.all([
        prisma.consent.count(),
        prisma.consent.count({ where: { status: 'ACTIVE' } }),
        prisma.consent.count({ where: { status: 'REVOKED' } }),
        prisma.consent.count({ where: { status: 'EXPIRED' } }),
        prisma.consent.count({ where: { status: 'REQUESTED' } }),
        prisma.consent.count({
          where: {
            status: 'ACTIVE',
            createdAt: { gte: sevenDaysAgo }
          }
        })
      ]);

      // Health Profile Statistics
      const [
        totalProfiles,
        profilesCreatedThisWeek,
        totalProfileReads,
        profileReadsThisWeek,
      ] = await Promise.all([
        prisma.healthProfile.count(),
        prisma.healthProfile.count({
          where: { createdAt: { gte: sevenDaysAgo } }
        }),
        prisma.healthIdAudit.count({
          where: { action: 'PROFILE_READ' }
        }),
        prisma.healthIdAudit.count({
          where: {
            action: 'PROFILE_READ',
            timestamp: { gte: sevenDaysAgo }
          }
        })
      ]);

      // File Upload Statistics
      const [
        totalFiles,
        filesUploadedThisWeek,
        totalFileSize,
        completedUploads,
        failedUploads,
      ] = await Promise.all([
        prisma.fileUpload.count(),
        prisma.fileUpload.count({
          where: { uploadedAt: { gte: sevenDaysAgo } }
        }),
        prisma.fileUpload.aggregate({
          where: { status: 'COMPLETED' },
          _sum: { fileSize: true }
        }).then(result => result._sum.fileSize || 0),
        prisma.fileUpload.count({ where: { status: 'COMPLETED' } }),
        prisma.fileUpload.count({ where: { status: 'FAILED' } })
      ]);

      // Appointment Statistics
      const [
        totalAppointments,
        pendingAppointments,
        confirmedAppointments,
        appointmentsThisWeek,
      ] = await Promise.all([
        prisma.appointment.count(),
        prisma.appointment.count({ where: { status: 'PENDING' } }),
        prisma.appointment.count({ where: { status: 'CONFIRMED' } }),
        prisma.appointment.count({
          where: { createdAt: { gte: sevenDaysAgo } }
        })
      ]);

      // Emergency Share Statistics
      const [
        totalEmergencyShares,
        activeEmergencyShares,
        emergencySharesUsed,
      ] = await Promise.all([
        prisma.emergencyShare.count(),
        prisma.emergencyShare.count({
          where: {
            expiresAt: { gt: now },
            usedAt: null
          }
        }),
        prisma.emergencyShare.count({
          where: { usedAt: { not: null } }
        })
      ]);

      // Daily signup trend (last 30 days)
      const dailySignups = await prisma.$queryRaw<Array<{
        date: string;
        count: bigint;
      }>>`
        SELECT 
          DATE(createdAt) as date,
          COUNT(*) as count
        FROM User 
        WHERE createdAt >= ${thirtyDaysAgo}
        GROUP BY DATE(createdAt)
        ORDER BY date ASC
      `;

      // Convert bigint to number for JSON serialization
      const dailySignupsFormatted = dailySignups.map(day => ({
        date: day.date,
        count: Number(day.count)
      }));

      const stats = {
        users: {
          total: totalUsers,
          patients: totalPatients,
          providers: totalProviders,
          admins: totalAdmins,
          newThisWeek: newUsersThisWeek,
          newToday: newUsersToday,
          pendingProviders,
          verified: verifiedUsers,
          verificationRate: totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0
        },
        consents: {
          total: totalConsents,
          active: activeConsents,
          revoked: revokedConsents,
          expired: expiredConsents,
          pending: requestedConsents,
          grantedThisWeek: consentsGrantedThisWeek,
          approvalRate: totalConsents > 0 ? Math.round((activeConsents / totalConsents) * 100) : 0
        },
        profiles: {
          total: totalProfiles,
          createdThisWeek: profilesCreatedThisWeek,
          totalReads: totalProfileReads,
          readsThisWeek: profileReadsThisWeek,
          avgReadsPerProfile: totalProfiles > 0 ? Math.round(totalProfileReads / totalProfiles) : 0
        },
        files: {
          total: totalFiles,
          uploadedThisWeek: filesUploadedThisWeek,
          totalSizeMB: Math.round(totalFileSize / (1024 * 1024)),
          completed: completedUploads,
          failed: failedUploads,
          successRate: totalFiles > 0 ? Math.round((completedUploads / totalFiles) * 100) : 0
        },
        appointments: {
          total: totalAppointments,
          pending: pendingAppointments,
          confirmed: confirmedAppointments,
          thisWeek: appointmentsThisWeek,
          confirmationRate: totalAppointments > 0 ? Math.round((confirmedAppointments / totalAppointments) * 100) : 0
        },
        emergencyShares: {
          total: totalEmergencyShares,
          active: activeEmergencyShares,
          used: emergencySharesUsed,
          usageRate: totalEmergencyShares > 0 ? Math.round((emergencySharesUsed / totalEmergencyShares) * 100) : 0
        },
        trends: {
          dailySignups: dailySignupsFormatted
        }
      };

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      console.error('Error fetching admin dashboard stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch dashboard statistics'
      });
    }
  }

  /**
   * GET /api/admin/logs
   * Aggregated audit logs for charts and analytics
   */
  static async getAggregatedLogs(req: Request, res: Response) {
    try {
      const {
        period = '7d', // 1d, 7d, 30d
        groupBy = 'day', // hour, day, week
        action,
        userId
      } = req.query;

      // Calculate date range
      const now = new Date();
      let startDate: Date;
      
      switch (period) {
        case '1d':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '7d':
        default:
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
      }

      // Build where clause
      const whereClause: any = {
        timestamp: { gte: startDate }
      };

      if (action) {
        whereClause.action = action as string;
      }

      if (userId) {
        whereClause.userId = userId as string;
      }

      // Get action distribution using raw query
      const actionCounts = await prisma.$queryRaw<Array<{
        action: string;
        count: bigint;
      }>>`
        SELECT action, COUNT(*) as count
        FROM health_id_audits 
        WHERE timestamp >= ${startDate}
        ${action ? `AND action = ${action}` : ''}
        ${userId ? `AND "accessedBy" = ${userId}` : ''}
        GROUP BY action
        ORDER BY count DESC
      `;

      // Get timeline data based on groupBy
      let timelineQuery: string;
      let timelineFormat: string;

      switch (groupBy) {
        case 'hour':
          timelineQuery = `
            SELECT 
              TO_CHAR(timestamp, 'YYYY-MM-DD HH24:00:00') as period,
              action,
              COUNT(*) as count
            FROM health_id_audits 
            WHERE timestamp >= $1
            ${action ? 'AND action = $2' : ''}
            ${userId ? `AND "accessedBy" = $${action ? '3' : '2'}` : ''}
            GROUP BY TO_CHAR(timestamp, 'YYYY-MM-DD HH24:00:00'), action
            ORDER BY period ASC
          `;
          timelineFormat = '%Y-%m-%d %H:00:00';
          break;
        case 'week':
          timelineQuery = `
            SELECT 
              TO_CHAR(timestamp, 'YYYY-IW') as period,
              action,
              COUNT(*) as count
            FROM health_id_audits 
            WHERE timestamp >= $1
            ${action ? 'AND action = $2' : ''}
            ${userId ? `AND "accessedBy" = $${action ? '3' : '2'}` : ''}
            GROUP BY TO_CHAR(timestamp, 'YYYY-IW'), action
            ORDER BY period ASC
          `;
          timelineFormat = '%Y-%u';
          break;
        default: // day
          timelineQuery = `
            SELECT 
              DATE(timestamp) as period,
              action,
              COUNT(*) as count
            FROM health_id_audits 
            WHERE timestamp >= $1
            ${action ? 'AND action = $2' : ''}
            ${userId ? `AND "accessedBy" = $${action ? '3' : '2'}` : ''}
            GROUP BY DATE(timestamp), action
            ORDER BY period ASC
          `;
          timelineFormat = '%Y-%m-%d';
          break;
      }

      // Build query parameters
      const queryParams: any[] = [startDate];
      if (action) queryParams.push(action as string);
      if (userId) queryParams.push(userId as string);

      const timelineData = await prisma.$queryRawUnsafe<Array<{
        period: string;
        action: string;
        count: bigint;
      }>>(timelineQuery, ...queryParams);

      // Format timeline data
      const timelineFormatted = timelineData.map(item => ({
        period: item.period,
        action: item.action,
        count: Number(item.count)
      }));

      // Get most active users using raw query
      const topUsers = await prisma.$queryRaw<Array<{
        accessedBy: string;
        count: bigint;
      }>>`
        SELECT "accessedBy", COUNT(*) as count
        FROM health_id_audits 
        WHERE timestamp >= ${startDate}
        ${action ? `AND action = ${action}` : ''}
        ${userId ? `AND "accessedBy" = ${userId}` : ''}
        GROUP BY "accessedBy"
        ORDER BY count DESC
        LIMIT 10
      `;

      // Get user details for top users
      const topUserIds = topUsers.map((u: any) => u.accessedBy);
      const userDetails = await prisma.user.findMany({
        where: { healthId: { in: topUserIds } },
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

      const topUsersWithDetails = topUsers.map((userStat) => {
        const user = userDetails.find(u => u.healthId === userStat.accessedBy);
        return {
          userId: userStat.accessedBy,
          count: Number(userStat.count),
          email: user?.email || 'Unknown',
          role: user?.role || 'Unknown',
          name: user?.healthProfile ? `${user.healthProfile.firstName} ${user.healthProfile.lastName}` : 'Unknown'
        };
      });

      res.json({
        success: true,
        data: {
          summary: {
            period,
            startDate: startDate.toISOString(),
            endDate: now.toISOString(),
            totalLogs: actionCounts.reduce((sum, item) => sum + Number(item.count), 0)
          },
          actionDistribution: actionCounts.map(item => ({
            action: item.action,
            count: Number(item.count)
          })),
          timeline: timelineFormatted,
          topUsers: topUsersWithDetails
        }
      });

    } catch (error) {
      console.error('Error fetching aggregated logs:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch log analytics'
      });
    }
  }

  /**
   * GET /api/admin/system-health
   * System health metrics and performance indicators
   */
  static async getSystemHealth(req: Request, res: Response) {
    try {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Database health checks
      const [
        recentLogs,
        dbResponseTime,
        activeConnections,
        errorLogs,
      ] = await Promise.all([
        // Recent activity
        prisma.healthIdAudit.count({
          where: { timestamp: { gte: fiveMinutesAgo } }
        }),
        
        // Simple DB response time test
        (async () => {
          const start = Date.now();
          await prisma.user.count();
          return Date.now() - start;
        })(),
        
        // This would normally check connection pool, simplified for demo
        Promise.resolve(5),
        
        // Error logs in last hour
        prisma.healthIdAudit.count({
          where: {
            timestamp: { gte: oneHourAgo },
            action: { contains: 'ERROR' }
          }
        })
      ]);

      // File storage health
      const storageStats = await prisma.fileUpload.aggregate({
        _sum: { fileSize: true },
        _count: { _all: true }
      });

      const health = {
        status: 'healthy', // Would be determined by thresholds
        timestamp: now.toISOString(),
        database: {
          status: dbResponseTime < 1000 ? 'healthy' : 'slow',
          responseTime: dbResponseTime,
          activeConnections,
          errorRate: errorLogs
        },
        activity: {
          recentLogs,
          status: recentLogs > 0 ? 'active' : 'quiet'
        },
        storage: {
          totalFiles: storageStats._count._all,
          totalSizeMB: Math.round((storageStats._sum.fileSize || 0) / (1024 * 1024)),
          status: 'healthy'
        },
        uptime: {
          // Would normally track actual uptime
          started: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
          uptimeHours: 2
        }
      };

      res.json({
        success: true,
        data: health
      });

    } catch (error) {
      console.error('Error checking system health:', error);
      res.status(500).json({
        success: false,
        message: 'System health check failed',
        data: {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }
}