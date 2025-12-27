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

export class AdminUserController {
  /**
   * GET /api/admin/users
   * Search and filter users with pagination
   */
  static async searchUsers(req: Request, res: Response) {
    try {
      const {
        page = '1',
        limit = '20',
        search = '',
        role,
        status,
        isVerified,
        createdAfter,
        createdBefore,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      // Build where clause
      const whereClause: any = {};

      // Search by email, healthId, or name
      if (search) {
        whereClause.OR = [
          { email: { contains: search as string, mode: 'insensitive' } },
          { healthId: { contains: search as string, mode: 'insensitive' } },
          {
            healthProfile: {
              OR: [
                { firstName: { contains: search as string, mode: 'insensitive' } },
                { lastName: { contains: search as string, mode: 'insensitive' } }
              ]
            }
          }
        ];
      }

      // Filter by role
      if (role && role !== 'all') {
        whereClause.role = role as string;
      }

      // Filter by status
      if (status && status !== 'all') {
        whereClause.status = status as string;
      }

      // Filter by verification status
      if (isVerified !== undefined) {
        whereClause.isVerified = isVerified === 'true';
      }

      // Filter by creation date range
      if (createdAfter || createdBefore) {
        whereClause.createdAt = {};
        if (createdAfter) {
          whereClause.createdAt.gte = new Date(createdAfter as string);
        }
        if (createdBefore) {
          whereClause.createdAt.lte = new Date(createdBefore as string);
        }
      }

      // Build order by clause
      const orderByField = sortBy as string;
      const orderByDirection = sortOrder as 'asc' | 'desc';
      
      let orderBy: any = {};
      if (orderByField === 'name') {
        orderBy = {
          healthProfile: {
            firstName: orderByDirection
          }
        };
      } else {
        orderBy[orderByField] = orderByDirection;
      }

      // Execute queries
      const [users, totalCount] = await Promise.all([
        prisma.user.findMany({
          where: whereClause,
          select: {
            healthId: true,
            email: true,
            phone: true,
            role: true,
            status: true,
            isVerified: true,
            createdAt: true,
            updatedAt: true,
            healthProfile: {
              select: {
                firstName: true,
                lastName: true,
                dateOfBirth: true,
                gender: true,
                isActive: true,
                verifiedAt: true
              }
            },
            // Count related data
            _count: {
              select: {
                patientConsents: true,
                providerConsents: true,
                fileUploads: true,
                patientAppointments: true,
                doctorAppointments: true
              }
            }
          },
          orderBy,
          skip,
          take: limitNum
        }),
        prisma.user.count({ where: whereClause })
      ]);

      // Format response data
      const formattedUsers = users.map(user => ({
        healthId: user.healthId,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        profile: user.healthProfile ? {
          name: `${user.healthProfile.firstName} ${user.healthProfile.lastName}`,
          firstName: user.healthProfile.firstName,
          lastName: user.healthProfile.lastName,
          dateOfBirth: user.healthProfile.dateOfBirth,
          gender: user.healthProfile.gender,
          isActive: user.healthProfile.isActive,
          verifiedAt: user.healthProfile.verifiedAt
        } : null,
        stats: {
          consentsAsPatient: user._count.patientConsents,
          consentsAsProvider: user._count.providerConsents,
          fileUploads: user._count.fileUploads,
          appointmentsAsPatient: user._count.patientAppointments,
          appointmentsAsDoctor: user._count.doctorAppointments,
          totalConsents: user._count.patientConsents + user._count.providerConsents,
          totalAppointments: user._count.patientAppointments + user._count.doctorAppointments
        }
      }));

      const totalPages = Math.ceil(totalCount / limitNum);

      res.json({
        success: true,
        data: {
          users: formattedUsers,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: totalCount,
            totalPages,
            hasNext: pageNum < totalPages,
            hasPrev: pageNum > 1
          },
          filters: {
            search: search as string,
            role: role as string || 'all',
            status: status as string || 'all',
            isVerified: isVerified as string,
            createdAfter: createdAfter as string,
            createdBefore: createdBefore as string,
            sortBy: orderByField,
            sortOrder: orderByDirection
          }
        }
      });

    } catch (error) {
      console.error('Error searching users:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search users'
      });
    }
  }

  /**
   * GET /api/admin/users/:healthId
   * Get detailed user information
   */
  static async getUserDetails(req: Request, res: Response) {
    try {
      const { healthId } = req.params;

      const user = await prisma.user.findUnique({
        where: { healthId },
        include: {
          healthProfile: true,
          patientConsents: {
            include: {
              provider: {
                select: {
                  healthId: true,
                  email: true,
                  healthProfile: {
                    select: { firstName: true, lastName: true }
                  }
                }
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 10
          },
          providerConsents: {
            include: {
              patient: {
                select: {
                  healthId: true,
                  email: true,
                  healthProfile: {
                    select: { firstName: true, lastName: true }
                  }
                }
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 10
          },
          fileUploads: {
            select: {
              id: true,
              filename: true,
              mimeType: true,
              fileSize: true,
              status: true,
              uploadedAt: true,
              createdAt: true
            },
            orderBy: { createdAt: 'desc' },
            take: 10
          },
          patientAppointments: {
            include: {
              doctor: {
                select: {
                  healthId: true,
                  email: true,
                  healthProfile: {
                    select: { firstName: true, lastName: true }
                  }
                }
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 5
          },
          doctorAppointments: {
            include: {
              patient: {
                select: {
                  healthId: true,
                  email: true,
                  healthProfile: {
                    select: { firstName: true, lastName: true }
                  }
                }
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 5
          }
        }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Get recent audit logs for this user
      const recentActivity = await prisma.healthIdAudit.findMany({
        where: {
          OR: [
            { healthId: healthId },
            { accessedBy: healthId }
          ]
        },
        orderBy: { timestamp: 'desc' },
        take: 20,
        select: {
          id: true,
          action: true,
          details: true,
          timestamp: true,
          ipAddress: true,
          accessedBy: true
        }
      });

      res.json({
        success: true,
        data: {
          user: {
            ...user,
            recentActivity
          }
        }
      });

    } catch (error) {
      console.error('Error fetching user details:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user details'
      });
    }
  }

  /**
   * PUT /api/admin/users/:healthId/status
   * Update user status (suspend/activate/approve)
   */
  static async updateUserStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const { healthId } = req.params;
      const { status, reason } = req.body;

      // Validate status
      const validStatuses = ['active', 'suspended', 'pending_verification', 'pending_approval'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
        });
      }

      const user = await prisma.user.findUnique({
        where: { healthId },
        select: { healthId: true, status: true, role: true, email: true }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update user status
      const updatedUser = await prisma.user.update({
        where: { healthId },
        data: { status },
        select: {
          healthId: true,
          email: true,
          role: true,
          status: true,
          updatedAt: true
        }
      });

      // Log the admin action
      await prisma.healthIdAudit.create({
        data: {
          healthId: healthId,
          accessedBy: req.user!.healthId,
          action: 'USER_STATUS_UPDATED',
          details: {
            previousStatus: user.status,
            newStatus: status,
            reason: reason || 'No reason provided',
            adminEmail: req.user!.email
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      res.json({
        success: true,
        message: `User status updated to ${status}`,
        data: {
          user: updatedUser,
          previousStatus: user.status
        }
      });

    } catch (error) {
      console.error('Error updating user status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update user status'
      });
    }
  }

  /**
   * PUT /api/admin/users/:healthId/verify
   * Verify user (for doctors/providers)
   */
  static async verifyUser(req: AuthenticatedRequest, res: Response) {
    try {
      const { healthId } = req.params;
      const { isVerified, verificationNotes } = req.body;

      const user = await prisma.user.findUnique({
        where: { healthId },
        select: { 
          healthId: true, 
          isVerified: true, 
          role: true, 
          email: true,
          status: true
        }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update verification status
      const updatedUser = await prisma.user.update({
        where: { healthId },
        data: { 
          isVerified,
          status: isVerified ? 'active' : user.status
        },
        select: {
          healthId: true,
          email: true,
          role: true,
          status: true,
          isVerified: true,
          updatedAt: true
        }
      });

      // Update health profile verification timestamp if verified
      if (isVerified && user.role === 'doctor') {
        await prisma.healthProfile.updateMany({
          where: { userId: healthId },
          data: { verifiedAt: new Date() }
        });
      }

      // Log the admin action
      await prisma.healthIdAudit.create({
        data: {
          healthId: healthId,
          accessedBy: req.user!.healthId,
          action: isVerified ? 'USER_VERIFIED' : 'USER_UNVERIFIED',
          details: {
            previousVerification: user.isVerified,
            newVerification: isVerified,
            verificationNotes: verificationNotes || 'No notes provided',
            adminEmail: req.user!.email
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      res.json({
        success: true,
        message: `User ${isVerified ? 'verified' : 'unverified'} successfully`,
        data: {
          user: updatedUser,
          previousVerification: user.isVerified
        }
      });

    } catch (error) {
      console.error('Error updating user verification:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update user verification'
      });
    }
  }

  /**
   * PUT /api/admin/users/bulk-action
   * Perform bulk actions on multiple users
   */
  static async bulkUserAction(req: AuthenticatedRequest, res: Response) {
    try {
      const { action, userIds, reason } = req.body;

      if (!action || !userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Action and userIds array are required'
        });
      }

      const validActions = ['suspend', 'activate', 'verify', 'unverify'];
      if (!validActions.includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid action. Must be one of: ' + validActions.join(', ')
        });
      }

      // Verify all users exist
      const users = await prisma.user.findMany({
        where: { healthId: { in: userIds } },
        select: { healthId: true, email: true, status: true, isVerified: true }
      });

      if (users.length !== userIds.length) {
        return res.status(400).json({
          success: false,
          message: 'Some users not found'
        });
      }

      let updateData: any = {};
      let auditAction = '';

      switch (action) {
        case 'suspend':
          updateData = { status: 'suspended' };
          auditAction = 'BULK_USER_SUSPENDED';
          break;
        case 'activate':
          updateData = { status: 'active' };
          auditAction = 'BULK_USER_ACTIVATED';
          break;
        case 'verify':
          updateData = { isVerified: true, status: 'active' };
          auditAction = 'BULK_USER_VERIFIED';
          break;
        case 'unverify':
          updateData = { isVerified: false };
          auditAction = 'BULK_USER_UNVERIFIED';
          break;
      }

      // Perform bulk update
      const result = await prisma.user.updateMany({
        where: { healthId: { in: userIds } },
        data: updateData
      });

      // Log audit entries for each user
      const auditEntries = users.map(user => ({
        healthId: user.healthId,
        accessedBy: req.user!.healthId,
        action: auditAction,
        details: {
          reason: reason || `Bulk ${action} action`,
          adminEmail: req.user!.email,
          affectedUserEmail: user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date()
      }));

      await prisma.healthIdAudit.createMany({
        data: auditEntries
      });

      res.json({
        success: true,
        message: `Bulk ${action} completed successfully`,
        data: {
          affectedUsers: result.count,
          action,
          reason: reason || `Bulk ${action} action`
        }
      });

    } catch (error) {
      console.error('Error performing bulk user action:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to perform bulk action'
      });
    }
  }

  /**
   * GET /api/admin/users/export
   * Export user data to CSV
   */
  static async exportUsers(req: AuthenticatedRequest, res: Response) {
    try {
      const {
        role,
        status,
        isVerified,
        createdAfter,
        createdBefore,
        format = 'csv'
      } = req.query;

      // Build where clause (similar to search)
      const whereClause: any = {};

      if (role && role !== 'all') {
        whereClause.role = role as string;
      }

      if (status && status !== 'all') {
        whereClause.status = status as string;
      }

      if (isVerified !== undefined) {
        whereClause.isVerified = isVerified === 'true';
      }

      if (createdAfter || createdBefore) {
        whereClause.createdAt = {};
        if (createdAfter) {
          whereClause.createdAt.gte = new Date(createdAfter as string);
        }
        if (createdBefore) {
          whereClause.createdAt.lte = new Date(createdBefore as string);
        }
      }

      const users = await prisma.user.findMany({
        where: whereClause,
        select: {
          healthId: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          isVerified: true,
          createdAt: true,
          updatedAt: true,
          healthProfile: {
            select: {
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              gender: true,
              bloodGroup: true,
              emergencyContact: true,
              emergencyPhone: true,
              verifiedAt: true
            }
          },
          _count: {
            select: {
              patientConsents: true,
              providerConsents: true,
              fileUploads: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      // Log the export action
      await prisma.healthIdAudit.create({
        data: {
          healthId: req.user!.healthId,
          accessedBy: req.user!.healthId,
          action: 'USER_DATA_EXPORTED',
          details: {
            exportCount: users.length,
            filters: { role, status, isVerified, createdAfter, createdBefore },
            format,
            adminEmail: req.user!.email
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      if (format === 'json') {
        res.json({
          success: true,
          data: users,
          exportedAt: new Date().toISOString(),
          count: users.length
        });
        return;
      }

      // Generate CSV
      const csvHeaders = [
        'Health ID',
        'Email',
        'Phone',
        'Role',
        'Status',
        'Verified',
        'First Name',
        'Last Name',
        'Date of Birth',
        'Gender',
        'Blood Group',
        'Emergency Contact',
        'Emergency Phone',
        'Created At',
        'Verified At',
        'Patient Consents',
        'Provider Consents',
        'File Uploads'
      ];

      const csvRows = users.map(user => [
        user.healthId,
        user.email,
        user.phone || '',
        user.role,
        user.status,
        user.isVerified ? 'Yes' : 'No',
        user.healthProfile?.firstName || '',
        user.healthProfile?.lastName || '',
        user.healthProfile?.dateOfBirth?.toISOString().split('T')[0] || '',
        user.healthProfile?.gender || '',
        user.healthProfile?.bloodGroup || '',
        user.healthProfile?.emergencyContact || '',
        user.healthProfile?.emergencyPhone || '',
        user.createdAt.toISOString(),
        user.healthProfile?.verifiedAt?.toISOString() || '',
        user._count.patientConsents.toString(),
        user._count.providerConsents.toString(),
        user._count.fileUploads.toString()
      ]);

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(field => `"${field}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="users-export-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csvContent);

    } catch (error) {
      console.error('Error exporting users:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export user data'
      });
    }
  }
}