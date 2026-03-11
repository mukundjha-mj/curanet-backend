import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import crypto from 'crypto';

const prisma = new PrismaClient();

interface AuthenticatedRequest extends Request {
  user?: {
    healthId: string;
    email: string | null;
    role: string;
    status: string;
    tokenId: string;
  };
}

const getPepper = (): string => {
  const pepper = process.env.PASSWORD_PEPPER;
  if (!pepper) {
    throw new Error('PASSWORD_PEPPER is not set in environment variables');
  }
  return pepper;
};

const addPepper = (password: string): string => {
  return password + getPepper();
};

/**
 * Change password for authenticated user
 * POST /api/security/change-password
 */
export const changePassword = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    // Get user with current password
    const user = await prisma.user.findUnique({
      where: { healthId: userId },
      select: { healthId: true, passwordHash: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const currentPasswordWithPepper = addPepper(currentPassword);
    const isValidPassword = await argon2.verify(user.passwordHash, currentPasswordWithPepper);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const newPasswordWithPepper = addPepper(newPassword);
    const newPasswordHash = await argon2.hash(newPasswordWithPepper);

    // Update password and security settings
    await prisma.$transaction([
      prisma.user.update({
        where: { healthId: userId },
        data: { 
          passwordHash: newPasswordHash,
          updatedAt: new Date()
        }
      }),
      prisma.securitySettings.upsert({
        where: { userId },
        create: {
          userId,
          passwordChangedAt: new Date(),
          lastPasswordCheck: new Date()
        },
        update: {
          passwordChangedAt: new Date(),
          lastPasswordCheck: new Date()
        }
      })
    ]);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
};

/**
 * Get active sessions for authenticated user
 * GET /api/security/sessions
 */
export const listSessions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentTokenId = req.user?.tokenId;

    // Get all active sessions
    const sessions = await prisma.userSession.findMany({
      where: {
        userId,
        isActive: true,
        expiresAt: {
          gt: new Date()
        }
      },
      select: {
        id: true,
        deviceInfo: true,
        deviceId: true,
        ipAddress: true,
        userAgent: true,
        location: true,
        browser: true,
        os: true,
        isTrusted: true,
        lastActivity: true,
        expiresAt: true,
        createdAt: true
      },
      orderBy: {
        lastActivity: 'desc'
      }
    });

    // Also get refresh tokens as additional sessions
    const refreshTokens = await prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: new Date()
        }
      },
      select: {
        id: true,
        deviceFingerprint: true,
        lastUsedAt: true,
        expiresAt: true,
        issuedAt: true
      },
      orderBy: {
        lastUsedAt: 'desc'
      }
    });

    res.json({
      success: true,
      data: {
        sessions: sessions.map(session => ({
          ...session,
          isCurrent: session.id === currentTokenId
        })),
        refreshTokens: refreshTokens.map(token => ({
          id: token.id,
          device: token.deviceFingerprint,
          lastUsed: token.lastUsedAt,
          expiresAt: token.expiresAt,
          createdAt: token.issuedAt
        }))
      }
    });

  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
};

/**
 * Revoke a specific session
 * DELETE /api/security/sessions/:sessionId
 */
export const revokeSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    // Check if session belongs to user
    const session = await prisma.userSession.findFirst({
      where: {
        id: sessionId,
        userId
      }
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Revoke the session
    await prisma.userSession.update({
      where: { id: sessionId },
      data: {
        isActive: false,
        lastActivity: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Session revoked successfully'
    });

  } catch (error) {
    console.error('Error revoking session:', error);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
};

/**
 * Revoke all other sessions (keep current)
 * POST /api/security/sessions/revoke-all
 */
export const revokeAllOtherSessions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentTokenId = req.user?.tokenId;

    // Revoke all other sessions
    await prisma.$transaction([
      prisma.userSession.updateMany({
        where: {
          userId,
          id: { not: currentTokenId },
          isActive: true
        },
        data: {
          isActive: false,
          lastActivity: new Date()
        }
      }),
      prisma.refreshToken.updateMany({
        where: {
          userId,
          id: { not: currentTokenId },
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      })
    ]);

    res.json({
      success: true,
      message: 'All other sessions revoked successfully'
    });

  } catch (error) {
    console.error('Error revoking sessions:', error);
    res.status(500).json({ error: 'Failed to revoke sessions' });
  }
};

/**
 * Get recovery options (backup email/phone)
 * GET /api/security/recovery-options
 */
export const getRecoveryOptions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await prisma.user.findUnique({
      where: { healthId: userId },
      select: {
        email: true,
        phone: true,
        healthProfile: {
          select: {
            emergencyContact: true,
            emergencyPhone: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        primaryEmail: user.email,
        primaryPhone: user.phone,
        emergencyContact: user.healthProfile?.emergencyContact,
        emergencyPhone: user.healthProfile?.emergencyPhone
      }
    });

  } catch (error) {
    console.error('Error getting recovery options:', error);
    res.status(500).json({ error: 'Failed to get recovery options' });
  }
};

/**
 * Update recovery options
 * PUT /api/security/recovery-options
 */
export const updateRecoveryOptions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { backupEmail, backupPhone } = req.body;

    // Validate at least one is provided
    if (!backupEmail && !backupPhone) {
      return res.status(400).json({ error: 'At least one recovery option (email or phone) is required' });
    }

    // Validate email format if provided
    if (backupEmail) {
      const emailRegex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/;
      if (!emailRegex.test(backupEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    // Validate phone format if provided
    if (backupPhone) {
      const phoneRegex = /^[\d\s\+\-\(\)]+$/;
      if (!phoneRegex.test(backupPhone)) {
        return res.status(400).json({ error: 'Invalid phone format' });
      }
    }

    // Update user profile emergency contact info
    await prisma.healthProfile.upsert({
      where: { userId },
      create: {
        userId,
        firstName: 'Unknown', // Will be updated by user
        lastName: 'User',
        emergencyContact: backupEmail || null,
        emergencyPhone: backupPhone || null
      },
      update: {
        emergencyContact: backupEmail || undefined,
        emergencyPhone: backupPhone || undefined,
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Recovery options updated successfully',
      data: {
        backupEmail,
        backupPhone
      }
    });

  } catch (error) {
    console.error('Error updating recovery options:', error);
    res.status(500).json({ error: 'Failed to update recovery options' });
  }
};

/**
 * Get security settings
 * GET /api/security/settings
 */
export const getSecuritySettings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const settings = await prisma.securitySettings.findUnique({
      where: { userId },
      select: {
        twoFactorEnabled: true,
        sessionTimeout: true,
        loginNotifications: true,
        deviceTracking: true,
        passwordChangedAt: true,
        maxConcurrentSessions: true,
        autoLockTimeout: true
      }
    });

    res.json({
      success: true,
      data: settings || {
        twoFactorEnabled: false,
        sessionTimeout: 3600,
        loginNotifications: true,
        deviceTracking: true,
        passwordChangedAt: null,
        maxConcurrentSessions: 5,
        autoLockTimeout: 900
      }
    });

  } catch (error) {
    console.error('Error getting security settings:', error);
    res.status(500).json({ error: 'Failed to get security settings' });
  }
};
