import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Generate unique Health ID in format HID-YYYY-XXXXXXXX
const generateHealthId = (): string => {
    const year = new Date().getFullYear();
    const randomString = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `HID-${year}-${randomString}`;
};

type AuthedRequest = Request & { user?: { healthId: string; role: string } };

export const approveProvider = async (req: AuthedRequest, res: Response) => {
  try {
    const { healthId } = req.params as { healthId: string };
    if (!healthId) return res.status(400).json({ message: 'User healthId is required' });

    const user = await prisma.user.findUnique({ where: { healthId } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.role !== 'doctor' && user.role !== 'pharmacy') {
      return res.status(400).json({ message: 'Only providers (doctor/pharmacy) require approval' });
    }

    if (user.status === 'active') {
      return res.json({ message: 'User is already active', user: { healthId: user.healthId, status: user.status } });
    }

    const updated = await prisma.user.update({
      where: { healthId },
      data: { status: 'active' }
    });

    return res.json({ message: 'Provider approved', user: { healthId: updated.healthId, status: updated.status } });
  } catch (err) {
    console.error('approveProvider error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const listPendingProviders = async (_req: AuthedRequest, res: Response) => {
  try {
    const pending = await prisma.user.findMany({
      where: { status: 'pending_approval', OR: [{ role: 'doctor' }, { role: 'pharmacy' }] },
      select: { healthId: true, email: true, role: true, status: true, createdAt: true }
    });
    return res.json({ pending });
  } catch (err) {
    console.error('listPendingProviders error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get all users with filtering and pagination
export const getAllUsers = async (req: AuthedRequest, res: Response) => {
  try {
    const { page = 1, limit = 50, role, status, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // Build where clause for filtering
    const where: any = {};
    if (role && role !== 'all') where.role = role;
    if (status && status !== 'all') where.status = status;
    if (search) {
      where.OR = [
        { email: { contains: search as string, mode: 'insensitive' } },
        { healthId: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          healthId: true,
          email: true,
          role: true,
          status: true,
          isVerified: true,
          createdAt: true,
          updatedAt: true,
          healthProfile: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true
            }
          }
        },
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    return res.json({ 
      users, 
      pagination: { 
        page: Number(page), 
        limit: Number(limit), 
        total: totalCount,
        pages: Math.ceil(totalCount / Number(limit))
      } 
    });
  } catch (err) {
    console.error('getAllUsers error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get system statistics
export const getSystemStats = async (_req: AuthedRequest, res: Response) => {
  try {
    const [
      totalUsers,
      activeUsers,
      pendingProviders,
      suspendedUsers,
      totalHealthProfiles,
      totalEncounters,
      totalObservations,
      recentActivity
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'active' } }),
      prisma.user.count({ 
        where: { 
          status: 'pending_approval', 
          OR: [{ role: 'doctor' }, { role: 'pharmacy' }] 
        } 
      }),
      prisma.user.count({ where: { status: 'suspended' } }),
      prisma.healthProfile.count(),
      prisma.encounter.count(),
      prisma.observation.count(),
      // Recent activity in last 24 hours (count of new users, profiles, encounters)
      Promise.all([
        prisma.user.count({ 
          where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } 
        }),
        prisma.encounter.count({ 
          where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } 
        }),
        prisma.observation.count({ 
          where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } 
        })
      ]).then(([newUsers, newEncounters, newObservations]) => newUsers + newEncounters + newObservations)
    ]);

    return res.json({
      totalUsers,
      activeUsers,
      pendingProviders,
      suspendedUsers,
      totalHealthProfiles,
      totalEncounters,
      totalObservations,
      recentActivity
    });
  } catch (err) {
    console.error('getSystemStats error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Suspend a user
export const suspendUser = async (req: AuthedRequest, res: Response) => {
  try {
    const { healthId } = req.params as { healthId: string };
    const { reason } = req.body as { reason?: string };

    if (!healthId) return res.status(400).json({ message: 'User healthId is required' });

    const user = await prisma.user.findUnique({ where: { healthId } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.role === 'admin') {
      return res.status(400).json({ message: 'Cannot suspend admin users' });
    }

    const updated = await prisma.user.update({
      where: { healthId },
      data: { status: 'suspended' }
    });

    // Log the suspension action
    await prisma.healthIdAudit.create({
      data: {
        healthId,
        accessedBy: req.user?.healthId || 'system',
        action: 'SUSPEND',
        details: { reason: reason || 'No reason provided', action: 'User suspended by admin' },
        timestamp: new Date()
      }
    });

    return res.json({ 
      message: 'User suspended successfully', 
      user: { healthId: updated.healthId, status: updated.status } 
    });
  } catch (err) {
    console.error('suspendUser error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Reactivate a user
export const reactivateUser = async (req: AuthedRequest, res: Response) => {
  try {
    const { healthId } = req.params as { healthId: string };

    if (!healthId) return res.status(400).json({ message: 'User healthId is required' });

    const user = await prisma.user.findUnique({ where: { healthId } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const updated = await prisma.user.update({
      where: { healthId },
      data: { status: 'active' }
    });

    // Log the reactivation action
    await prisma.healthIdAudit.create({
      data: {
        healthId,
        accessedBy: req.user?.healthId || 'system',
        action: 'REACTIVATE',
        details: { action: 'User reactivated by admin' },
        timestamp: new Date()
      }
    });

    return res.json({ 
      message: 'User reactivated successfully', 
      user: { healthId: updated.healthId, status: updated.status } 
    });
  } catch (err) {
    console.error('reactivateUser error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get user details
export const getUserDetails = async (req: AuthedRequest, res: Response) => {
  try {
    const { healthId } = req.params as { healthId: string };

    if (!healthId) return res.status(400).json({ message: 'User healthId is required' });

    const user = await prisma.user.findUnique({
      where: { healthId },
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
            displayName: true,
            dateOfBirth: true,
            gender: true,
            emergencyContact: true,
            emergencyPhone: true,
            allergies: true,
            medications: true,
            bloodGroup: true,
            address: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Get audit trail for this user
    const auditTrail = await prisma.healthIdAudit.findMany({
      where: { healthId },
      orderBy: { timestamp: 'desc' },
      take: 20 // Last 20 activities
    });

    return res.json({ user, auditTrail });
  } catch (err) {
    console.error('getUserDetails error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Reject provider application
export const rejectProvider = async (req: AuthedRequest, res: Response) => {
  try {
    const { healthId } = req.params as { healthId: string };
    const { reason } = req.body as { reason?: string };

    if (!healthId) return res.status(400).json({ message: 'User healthId is required' });

    const user = await prisma.user.findUnique({ where: { healthId } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.role !== 'doctor' && user.role !== 'pharmacy') {
      return res.status(400).json({ message: 'Only providers (doctor/pharmacy) can be rejected' });
    }

    const updated = await prisma.user.update({
      where: { healthId },
      data: { status: 'suspended' } // Or you might want a specific 'rejected' status
    });

    // Log the rejection action
    await prisma.healthIdAudit.create({
      data: {
        healthId,
        accessedBy: req.user?.healthId || 'system',
        action: 'REJECT_PROVIDER',
        details: { reason: reason || 'No reason provided', action: 'Provider application rejected' },
        timestamp: new Date()
      }
    });

    return res.json({ 
      message: 'Provider application rejected', 
      user: { healthId: updated.healthId, status: updated.status } 
    });
  } catch (err) {
    console.error('rejectProvider error', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export default { 
  approveProvider, 
  listPendingProviders, 
  getAllUsers,
  getSystemStats,
  suspendUser,
  reactivateUser,
  getUserDetails,
  rejectProvider
};

// DEV-ONLY bootstrap to create or promote an admin using a shared token
export const bootstrapAdmin = async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ message: 'Not allowed in production' });
    }

    const headerToken = (req.headers['x-bootstrap-token'] as string) || '';
    const bodyToken = (req.body?.token as string) || '';
    const provided = headerToken || bodyToken;
    const expected = process.env.ADMIN_BOOTSTRAP_TOKEN;
    if (!expected || !provided || provided !== expected) {
      return res.status(401).json({ message: 'Invalid bootstrap token' });
    }

    const { email, password, name, phone } = req.body as { email: string; password?: string; name?: string; phone?: string };
    if (!email) return res.status(400).json({ message: 'email is required' });
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    // optional password handling
    async function hashPasswordIfProvided(pw?: string): Promise<string | undefined> {
      if (!pw) return undefined;
      const pepper = process.env.PASSWORD_PEPPER;
      if (!pepper) throw new Error('PASSWORD_PEPPER not configured');
      if (pw.length < 8) throw new Error('Password must be at least 8 characters long');
      const peppered = pw + pepper;
      return argon2.hash(peppered, { type: argon2.argon2id, memoryCost: 2 ** 16, timeCost: 3, parallelism: 1 });
    }

    if (existing) {
      const passwordHash = await hashPasswordIfProvided(password);
      const updated = await prisma.user.update({
        where: { healthId: existing.healthId },
        data: {
          role: 'admin',
          status: 'active',
          ...(passwordHash ? { passwordHash } : {}),
          ...(phone ? { phone } : {}),
          ...(name ? { profileRef: name } : {})
        },
        select: { healthId: true, email: true, role: true, status: true }
      });
      return res.json({ message: 'Admin promoted', user: updated });
    }

    if (!password) return res.status(400).json({ message: 'password is required to create a new admin' });
    const passwordHash = await hashPasswordIfProvided(password);
    
    // Generate unique Health ID
    let healthId: string;
    let isUnique = false;
    do {
      healthId = generateHealthId();
      const existingWithHealthId = await prisma.user.findUnique({ where: { healthId } });
      isUnique = !existingWithHealthId;
    } while (!isUnique);
    
    const created = await prisma.user.create({
      data: {
        healthId,
        email: normalizedEmail,
        phone: phone || null,
        role: 'admin',
        status: 'active',
        passwordHash: passwordHash!,
        profileRef: name || null,
      },
      select: { healthId: true, email: true, role: true, status: true }
    });
    return res.status(201).json({ message: 'Admin created', user: created });
  } catch (err: any) {
    console.error('bootstrapAdmin error', err);
    return res.status(500).json({ message: err?.message || 'Internal server error' });
  }
};

/**
 * GET /api/admin/stats
 * Get admin dashboard statistics and KPIs
 */
export const getAdminStats = async (req: AuthedRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    
    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get current date ranges
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Total users
    const totalUsers = await prisma.user.count();

    // Active users (logged in within 24 hours) - using lastLoginAt if available
    const activeUsers = await prisma.user.count({
      where: {
        updatedAt: {
          gte: yesterday
        }
      }
    });

    // Daily signups (today)
    const dailySignups = await prisma.user.count({
      where: {
        createdAt: {
          gte: today
        }
      }
    });

    // Total health profiles/records
    const totalRecords = await prisma.user.count({
      where: {
        profileRef: {
          not: null
        }
      }
    });

    // Total appointments (if appointment table exists)
    let totalAppointments = 0;
    try {
      totalAppointments = await prisma.appointment?.count() || 0;
    } catch {
      // Appointment table might not exist yet
    }

    // Total files (if file upload table exists)
    let totalFiles = 0;
    let storageUsed = 0;
    try {
      totalFiles = await prisma.fileUpload?.count() || 0;
      const storageStats = await prisma.fileUpload?.aggregate({
        _sum: {
          fileSize: true
        }
      });
      storageUsed = storageStats?._sum?.fileSize || 0;
    } catch {
      // File upload table might not exist yet
    }

    // Active consents
    let activeConsents = 0;
    try {
      activeConsents = await prisma.consent.count({
        where: {
          status: 'ACTIVE'
        }
      });
    } catch {
      // Consent table might not exist yet
    }

    // Pending provider approvals
    const pendingProviders = await prisma.user.count({
      where: {
        status: 'pending_approval',
        OR: [
          { role: 'doctor' },
          { role: 'pharmacy' }
        ]
      }
    });

    // System health assessment (basic)
    const systemHealth = pendingProviders > 10 ? 'warning' : 'healthy';

    res.json({
      totalUsers,
      activeUsers,
      dailySignups,
      totalRecords,
      totalAppointments,
      totalFiles,
      storageUsed,
      activeConsents,
      pendingProviders,
      systemHealth
    });

  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Failed to fetch admin statistics' });
  }
};

/**
 * GET /api/admin/logs
 * Get aggregated logs for charts and analytics
 */
export const getAdminLogs = async (req: AuthedRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    const { period = '7d' } = req.query;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    // Get user signups over time for chart
    const signupData = await prisma.user.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: {
          gte: startDate
        }
      },
      _count: {
        healthId: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Group by day
    const dailySignups = signupData.reduce((acc: any, signup) => {
      const date = signup.createdAt.toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = 0;
      }
      acc[date] += signup._count?.healthId || 0;
      return acc;
    }, {});

    // Get role distribution
    const roleDistribution = await prisma.user.groupBy({
      by: ['role'],
      _count: {
        healthId: true
      },
      orderBy: {
        _count: {
          healthId: 'desc'
        }
      }
    });

    // Get status distribution
    const statusDistribution = await prisma.user.groupBy({
      by: ['status'],
      _count: {
        healthId: true
      },
      orderBy: {
        _count: {
          healthId: 'desc'
        }
      }
    });

    res.json({
      dailySignups,
      roleDistribution: roleDistribution.map(rd => ({
        role: rd.role,
        count: rd._count?.healthId || 0
      })),
      statusDistribution: statusDistribution.map(sd => ({
        status: sd.status,
        count: sd._count?.healthId || 0
      })),
      period,
      totalSignups: signupData.length
    });

  } catch (error) {
    console.error('Error fetching admin logs:', error);
    res.status(500).json({ error: 'Failed to fetch admin logs' });
  }
};

/**
 * GET /api/admin/users
 * Get users with filtering and search capabilities
 */
export const getAdminUsers = async (req: AuthedRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    const {
      page = '1',
      limit = '20',
      search,
      role,
      status,
      healthId,
      email,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Build where clause
    const where: any = {};

    if (search) {
      where.OR = [
        { email: { contains: search as string, mode: 'insensitive' } },
        { healthId: { contains: search as string, mode: 'insensitive' } },
        { profileRef: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    if (role) {
      where.role = role;
    }

    if (status) {
      where.status = status;
    }

    if (healthId) {
      where.healthId = { contains: healthId as string, mode: 'insensitive' };
    }

    if (email) {
      where.email = { contains: email as string, mode: 'insensitive' };
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate as string);
      }
    }

    // Calculate pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build orderBy
    const orderBy: any = {};
    if (sortBy === 'name') {
      orderBy.profileRef = sortOrder;
    } else if (sortBy === 'email') {
      orderBy.email = sortOrder;
    } else {
      orderBy[sortBy as string] = sortOrder;
    }

    // Get users with pagination
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        select: {
          healthId: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          profileRef: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.user.count({ where })
    ]);

    // Format users for admin interface
    const usersWithStats = users.map(user => {
      let profileCompleteness = 20; // Base for having an account
      
      if (user.email) profileCompleteness += 20;
      if (user.profileRef) profileCompleteness += 30;
      if (user.phone) profileCompleteness += 15;
      if (user.status === 'active') profileCompleteness += 15;

      return {
        id: user.healthId,
        healthId: user.healthId,
        email: user.email,
        firstName: user.profileRef?.split(' ')[0] || '',
        lastName: user.profileRef?.split(' ').slice(1).join(' ') || '',
        role: user.role,
        status: user.status,
        emailVerified: user.status === 'active',
        lastLogin: user.updatedAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        profileCompleteness,
        recordsCount: 1, // Placeholder
        appointmentsCount: 0, // Placeholder
        filesCount: 0 // Placeholder
      };
    });

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      users: usersWithStats,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages
    });

  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

/**
 * PUT /api/admin/users/:id/status
 * Update user status (activate, suspend, etc.)
 */
export const updateUserStatus = async (req: AuthedRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    const { id: targetUserId } = req.params;
    const { status } = req.body;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Validate status
    const validStatuses = ['active', 'inactive', 'pending_approval', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Update user status
    const updatedUser = await prisma.user.update({
      where: { healthId: targetUserId },
      data: { status },
      select: {
        healthId: true,
        email: true,
        status: true,
        profileRef: true
      }
    });

    res.json({
      message: 'User status updated successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
};

/**
 * PUT /api/admin/users/:id/role
 * Update user role
 */
export const updateUserRole = async (req: AuthedRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    const { id: targetUserId } = req.params;
    const { role } = req.body;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Validate role
    const validRoles = ['patient', 'doctor', 'pharmacy', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Update user role
    const updatedUser = await prisma.user.update({
      where: { healthId: targetUserId },
      data: { role },
      select: {
        healthId: true,
        email: true,
        role: true,
        profileRef: true
      }
    });

    res.json({
      message: 'User role updated successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
};

/**
 * POST /api/admin/settings
 * Update admin settings (maintenance mode, etc.)
 */
export const updateAdminSettings = async (req: AuthedRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    const settings = req.body;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Validate and return settings (in a real app, you'd store these in DB)
    const validatedSettings = {
      maintenanceMode: typeof settings.maintenanceMode === 'boolean' ? settings.maintenanceMode : false,
      allowRegistration: typeof settings.allowRegistration === 'boolean' ? settings.allowRegistration : true,
      maxFileSize: typeof settings.maxFileSize === 'number' ? settings.maxFileSize : 50 * 1024 * 1024,
      maxFilesPerUser: typeof settings.maxFilesPerUser === 'number' ? settings.maxFilesPerUser : 100,
      sessionTimeout: typeof settings.sessionTimeout === 'number' ? settings.sessionTimeout : 24 * 60 * 60,
      auditRetentionDays: typeof settings.auditRetentionDays === 'number' ? settings.auditRetentionDays : 365,
      backupEnabled: typeof settings.backupEnabled === 'boolean' ? settings.backupEnabled : true,
      emailNotifications: typeof settings.emailNotifications === 'boolean' ? settings.emailNotifications : true
    };

    res.json({
      message: 'Admin settings updated successfully',
      settings: validatedSettings
    });

  } catch (error) {
    console.error('Error updating admin settings:', error);
    res.status(500).json({ error: 'Failed to update admin settings' });
  }
};

