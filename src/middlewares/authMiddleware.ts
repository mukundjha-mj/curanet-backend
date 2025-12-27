import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

const prisma = new PrismaClient();

interface JwtPayload {
    sub: string;
    email?: string;
    role: string;
    status: string;
    jti: string;
    iat: number;
    exp: number;
}

type AuthenticatedRequest = Request & { 
    user?: {
        healthId: string;
        email: string | null;
        role: string;
        status: string;
        tokenId: string;
    }
};

const getJwtSecret = (): string => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET is not set in environment variables');
    }
    return secret;
};

// Token blacklist for logout (in production, use Redis for better performance)
const tokenBlacklist = new Set<string>();

export const authenticateToken = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        logger.debug('Auth middleware invoked', { hasAuthHeader: !!authHeader, hasToken: !!token });

        if (!token) {
            logger.debug('No token provided');
            res.status(401).json({ message: 'Access token required' });
            return;
        }

        // Check if token is blacklisted
        if (tokenBlacklist.has(token)) {
            res.status(401).json({ message: 'Token has been revoked' });
            return;
        }

        // Verify JWT
        const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;

        // Additional validation - check if user still exists and is active
        const user = await prisma.user.findUnique({
            where: { healthId: decoded.sub },
            select: {
                healthId: true,
                email: true,
                role: true,
                status: true
            }
        });

        if (!user) {
            res.status(401).json({ message: 'User not found' });
            return;
        }

        if (user.status !== 'active') {
            res.status(401).json({ message: 'Account not active' });
            return;
        }

        // Attach user info to request
        req.user = {
            healthId: user.healthId!,
            email: user.email ?? null,
            role: user.role,
            status: user.status,
            tokenId: decoded.jti
        };

        logger.debug('Authentication successful', {
            healthId: user.healthId,
            role: user.role
        });

        next();

    } catch (error: any) {
        if (error.name === 'JsonWebTokenError') {
            res.status(401).json({ message: 'Invalid token' });
        } else if (error.name === 'TokenExpiredError') {
            res.status(401).json({ message: 'Token expired' });
        } else {
            logger.error('Auth middleware error', { error });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
};

// Optional token (for endpoints that work with or without auth)
export const optionalAuth = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            next();
            return;
        }

        // Same logic as authenticateToken but don't fail if no token
        if (tokenBlacklist.has(token)) {
            next();
            return;
        }

        const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
        const user = await prisma.user.findUnique({
            where: { healthId: decoded.sub },
            select: {
                healthId: true,
                email: true,
                role: true,
                status: true
            }
        });

        if (user && user.status === 'active') {
            req.user = {
                healthId: user.healthId!,
                email: user.email ?? null,
                role: user.role,
                status: user.status,
                tokenId: decoded.jti
            };
        }

        next();

    } catch (error) {
        // For optional auth, continue even if token validation fails
        next();
    }
};

// Role-based authorization middleware
export const requireRole = (...roles: string[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ message: 'Authentication required' });
            return;
        }

        if (!roles.includes(req.user.role)) {
            res.status(403).json({ message: 'Insufficient permissions' });
            return;
        }

        next();
    };
};

// Specific role middlewares for common cases
export const requirePatient = requireRole('patient');
export const requireDoctor = requireRole('doctor');
export const requirePharmacy = requireRole('pharmacy');
export const requireAdmin = requireRole('admin');
export const requireHealthProvider = requireRole('doctor', 'pharmacy');

// Add token to blacklist (for logout)
export const blacklistToken = (token: string): void => {
    tokenBlacklist.add(token);
};

// Clean up expired tokens from blacklist (call periodically)
export const cleanupTokenBlacklist = (): void => {
    // In production, implement proper cleanup logic
    // For now, just clear the set periodically
    tokenBlacklist.clear();
};

// Account lockout tracking (basic implementation)
const failedAttempts = new Map<string, { count: number; lockUntil: number }>();

export const trackFailedLogin = (email: string): boolean => {
    const maxAttempts = 5;
    const lockoutDuration = 15 * 60 * 1000; // 15 minutes
    const now = Date.now();

    let attempts = failedAttempts.get(email);

    if (!attempts) {
        attempts = { count: 1, lockUntil: 0 };
        failedAttempts.set(email, attempts);
        return false; // Not locked
    }

    if (attempts.lockUntil > now) {
        return true; // Still locked
    }

    attempts.count++;

    if (attempts.count >= maxAttempts) {
        attempts.lockUntil = now + lockoutDuration;
        return true; // Now locked
    }

    return false; // Not locked yet
};

export const clearFailedAttempts = (email: string): void => {
    failedAttempts.delete(email);
};

export const isAccountLocked = (email: string): boolean => {
    const attempts = failedAttempts.get(email);
    if (!attempts) return false;
    return attempts.lockUntil > Date.now();
};

export default {
    authenticateToken,
    optionalAuth,
    requireRole,
    requirePatient,
    requireDoctor,
    requirePharmacy,
    requireAdmin,
    requireHealthProvider,
    blacklistToken,
    cleanupTokenBlacklist,
    trackFailedLogin,
    clearFailedAttempts,
    isAccountLocked
};