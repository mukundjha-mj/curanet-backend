import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import EmailService from '../services/email.service';
import OtpService from '../services/otp.service';

dotenv.config();

const prisma = new PrismaClient();
const authEventEmitter = new EventEmitter();

// Helper types for requests with additional properties populated by middlewares
type AuthenticatedRequest = Request & { user?: any };
type CookieRequest = Request & { cookies?: Record<string, string> };

interface RegisterRequest {
    email: string;
    phone?: string;
    password: string;
    role: 'patient' | 'doctor' | 'pharmacy' | 'admin';
    name?: string;
}

interface LoginRequest {
    email: string;
    password: string;
    deviceFingerprint?: string;
}

const getJwtSecret = (): string => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET is not set in environment variables');
    }
    return secret;
};

const getJwtRefreshSecret = (): string => {
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) {
        throw new Error('JWT_REFRESH_SECRET is not set in environment variables');
    }
    return secret;
};

const getPepper = (): string => {
    const pepper = process.env.PASSWORD_PEPPER;
    if (!pepper) {
        throw new Error('PASSWORD_PEPPER is not set in environment variables');
    }
    return pepper;
};

/**
 * Generate a unique Health ID
 * Format: HID-YYYY-XXXXXXXX (where X is alphanumeric)
 */
const generateHealthId = (): string => {
    const year = new Date().getFullYear();
    const randomString = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `HID-${year}-${randomString}`;
};

// Generate secure random token
const generateSecureToken = (): string => {
    return crypto.randomBytes(32).toString('hex');
};

// Hash token for storage
const hashToken = (token: string): string => {
    return crypto.createHash('sha256').update(token).digest('hex');
};

// Add pepper to password before hashing
const addPepper = (password: string): string => {
    return password + getPepper();
};

export const register = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, phone, password, role, name }: RegisterRequest = req.body;

        // Validate input - either email or phone is required
        if ((!email && !phone) || !password || !role) {
            res.status(400).json({ message: 'Email or phone, password and role are required' });
            return;
        }

        // Validate name is required
        if (!name || name.trim().length === 0) {
            res.status(400).json({ message: 'Name is required' });
            return;
        }

        // Normalize email if provided
        const normalizedEmail = email ? email.toLowerCase().trim() : null;

        // Check for existing user
        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
                    ...(phone ? [{ phone }] : [])
                ]
            }
        });

        if (existingUser) {
            res.status(400).json({ message: 'User with this email or phone already exists' });
            return;
        }

        // Enforce password policy (basic example)
        if (password.length < 8) {
            res.status(400).json({ message: 'Password must be at least 8 characters long' });
            return;
        }

        // Hash password with pepper and Argon2
        const pepperedPassword = addPepper(password);
        const passwordHash = await argon2.hash(pepperedPassword, {
            type: argon2.argon2id,
            memoryCost: 2 ** 16, // 64 MB
            timeCost: 3,
            parallelism: 1,
        });

        // Generate verification token (only if email provided)
        const verificationToken = normalizedEmail ? generateSecureToken() : '';
        const tokenHash = normalizedEmail ? hashToken(verificationToken) : '';
        const tokenExpiry = normalizedEmail ? new Date(Date.now() + 24 * 60 * 60 * 1000) : new Date(); // 24 hours

        // Generate unique Health ID
        let healthId: string;
        let isUnique = false;
        let attempts = 0;
        const maxAttempts = 10;

        while (!isUnique && attempts < maxAttempts) {
            healthId = generateHealthId();

            const existing = await prisma.user.findUnique({
                where: { healthId }
            });

            if (!existing) {
                isUnique = true;
            }
            attempts++;
        }

        if (!isUnique) {
            res.status(500).json({ message: 'Failed to generate unique Health ID' });
            return;
        }

        // Create user with pending verification status
        const newUser = await prisma.user.create({
            data: {
                healthId: healthId!,
                email: normalizedEmail || `phone_${phone}@curanet.placeholder`,
                phone,
                role,
                passwordHash,
                status: phone && !normalizedEmail ? 'pending_verification' : (role === 'patient' ? 'pending_verification' : 'pending_approval'),
                ...(normalizedEmail ? {
                    emailVerifications: {
                        create: {
                            tokenHash,
                            expiresAt: tokenExpiry
                        }
                    }
                } : {})
            },
            select: {
                healthId: true,
                email: true,
                phone: true,
                role: true,
                status: true,
                createdAt: true
            }
        });

        // Create health profile for patients
        if (role === 'patient') {
            // Split name into firstName and lastName if provided
            let firstName = '';
            let lastName = '';
            if (name && name.trim()) {
                const nameParts = name.trim().split(' ');
                firstName = nameParts[0] || '';
                lastName = nameParts.slice(1).join(' ') || '';
            }

            await prisma.healthProfile.create({
                data: {
                    userId: newUser.healthId!,
                    firstName,
                    lastName,
                    isActive: true
                }
            });
        }

        // Emit UserCreated event for user-service to create profile
        authEventEmitter.emit('user-created', {
            userId: newUser.healthId,
            email: normalizedEmail,
            role,
            name
        });

        // Emit email verification event for notification service (only if email provided)
        if (normalizedEmail) {
            authEventEmitter.emit('send-verification-email', {
                email: normalizedEmail,
                token: verificationToken,
                userId: newUser.healthId
            });
            // Also send immediately (sync) for now; later move to async worker
            try {
                await EmailService.sendVerificationEmail(normalizedEmail, verificationToken);
            } catch (e) {
                console.warn('Email send failed (dev fallback used if configured):', e);
            }

            // In development, log verification token only for real emails
            const isProduction = process.env.NODE_ENV === 'production';
            if (!isProduction) {
                console.info(`[DEV] Email verification token for ${normalizedEmail}: ${verificationToken}`);
            }
        }

        // Send OTP for phone registration (even if email is also provided)
        if (phone) {
            const otp = OtpService.generateOtp();
            await OtpService.storeOtp(newUser.healthId, phone, otp);
            await OtpService.sendOtp(phone, otp);
            console.log(`[OTP] Sent OTP to phone: ${phone}`);
        }

        // Filter out placeholder email from response
        const userResponse = {
            ...newUser,
            email: normalizedEmail || null
        };

        res.status(201).json({
            message: normalizedEmail && phone
                ? 'User registered successfully. Please check your email and phone for verification.'
                : normalizedEmail
                    ? 'User registered successfully. Please check your email for verification.'
                    : 'User registered successfully. Please check your phone for OTP.',
            user: userResponse,
            ...(process.env.NODE_ENV !== 'production' && normalizedEmail ? { devVerificationToken: verificationToken } : {})
        });

    } catch (error: any) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
    try {
        const token = (req.body as any)?.token ?? (req.query as any)?.token;

        if (!token) {
            res.status(400).json({ message: 'Verification token is required' });
            return;
        }

        const tokenHash = hashToken(token);

        // Find and validate verification token
        const verification = await prisma.emailVerification.findFirst({
            where: {
                tokenHash,
                expiresAt: {
                    gt: new Date()
                },
                usedAt: null
            },
            include: {
                user: true
            }
        });

        if (!verification) {
            res.status(400).json({ message: 'Invalid or expired verification token' });
            return;
        }

        // Update user status and mark token as used
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { healthId: verification.userId },
                data: {
                    status: verification.user.role === 'patient' ? 'active' : 'pending_approval'
                }
            });

            await tx.emailVerification.update({
                where: { id: verification.id },
                data: { usedAt: new Date() }
            });
        });

        res.json({ message: 'Email verified successfully' });

    } catch (error: any) {
        console.error('Email verification error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const login = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, phone, password, deviceFingerprint }: LoginRequest & { phone?: string } = req.body;

        if ((!email && !phone) || !password) {
            res.status(400).json({ message: 'Email or phone and password are required' });
            return;
        }

        const normalizedEmail = email ? email.toLowerCase().trim() : null;

        // Find user by email or phone
        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
                    ...(phone ? [{ phone }] : [])
                ]
            }
        });

        console.log('🔍 Login Debug:');
        console.log('Email entered:', email);
        console.log('Normalized email:', normalizedEmail);
        console.log('User found:', user ? 'YES' : 'NO');
        if (user) {
            console.log('User email in DB:', user.email);
            console.log('User status:', user.status);
            console.log('Password hash exists:', user.passwordHash ? 'YES' : 'NO');
        }

        if (!user) {
            console.log('❌ User not found in database');
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        // Check account status
        if (user.status !== 'active') {
            console.log('❌ Account status not active:', user.status);
            let message = 'Account not activated';
            if (user.status === 'pending_verification') {
                message = 'Please verify your email first';
            } else if (user.status === 'pending_approval') {
                message = 'Account pending approval';
            } else if (user.status === 'suspended') {
                message = 'Account suspended';
            }
            res.status(401).json({ message });
            return;
        }

        // Verify password
        console.log('🔐 Verifying password...');
        console.log('Password length:', password.length);
        const pepperedPassword = addPepper(password);
        console.log('Peppered password length:', pepperedPassword.length);
        const isValidPassword = await argon2.verify(user.passwordHash, pepperedPassword);
        console.log('Password valid:', isValidPassword);

        if (!isValidPassword) {
            console.log('❌ Password verification failed');
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        console.log('✅ Login successful!');

        // Detect platform from User-Agent or explicit 'platform' parameter
        const userAgent = req.get('User-Agent') || '';
        const platform = (req.body as any)?.platform?.toLowerCase() || '';
        const isMobile = platform === 'mobile' || platform === 'flutter' || platform === 'android' || platform === 'ios' ||
            userAgent.includes('Dart') || userAgent.includes('Flutter') ||
            (userAgent.includes('Mobile') && !userAgent.includes('Mozilla'));

        // Token expiry: 15 minutes for web, 30 days for mobile
        const tokenExpiry = isMobile ? '30d' : '15m';
        console.log(`📱 Platform detected: ${isMobile ? 'Mobile' : 'Web'}, token expiry: ${tokenExpiry}`);

        // Generate tokens
        const accessTokenPayload = {
            sub: user.healthId,
            email: user.email,
            role: user.role,
            status: user.status,
            jti: crypto.randomUUID()
        };

        const accessToken = jwt.sign(accessTokenPayload, getJwtSecret(), {
            expiresIn: tokenExpiry,
            algorithm: 'HS256'
        });

        const refreshToken = generateSecureToken();
        const refreshTokenHash = hashToken(refreshToken);
        const deviceFingerprintToStore = deviceFingerprint || 'unknown';

        // Store refresh token
        await prisma.refreshToken.create({
            data: {
                userId: user.healthId!,
                tokenHash: refreshTokenHash,
                deviceFingerprint: deviceFingerprintToStore,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                lastUsedAt: new Date()
            }
        });

        // Set refresh token as HTTP-only cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        // Emit login event for audit service
        authEventEmitter.emit('user-login', {
            userId: user.healthId,
            email: user.email,
            role: user.role,
            deviceFingerprint: deviceFingerprintToStore,
            timestamp: new Date(),
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        const { passwordHash: _omit, ...userResponse } = user;

        res.json({
            message: 'Login successful',
            accessToken,
            refreshToken, // Also return in body for mobile apps that can't access cookies
            user: userResponse
        });

    } catch (error: any) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const refresh = async (req: CookieRequest, res: Response): Promise<void> => {
    try {
        // Accept refresh token from cookie (web) or body/header (mobile)
        const refreshToken = req.cookies?.refreshToken ||
            (req.body as any)?.refreshToken ||
            req.headers['x-refresh-token'] as string;

        if (!refreshToken) {
            res.status(401).json({ message: 'Refresh token not provided' });
            return;
        }

        const tokenHash = hashToken(refreshToken);

        // Find valid refresh token
        const storedToken = await prisma.refreshToken.findFirst({
            where: {
                tokenHash,
                expiresAt: {
                    gt: new Date()
                },
                revokedAt: null
            },
            include: {
                user: true
            }
        });

        if (!storedToken) {
            // Possible token reuse - revoke all tokens for security
            res.status(401).json({ message: 'Invalid refresh token' });
            return;
        }

        // Generate new tokens
        const newRefreshToken = generateSecureToken();
        const newRefreshTokenHash = hashToken(newRefreshToken);

        const accessTokenPayload = {
            sub: storedToken.user.healthId,
            email: storedToken.user.email,
            role: storedToken.user.role,
            status: storedToken.user.status,
            jti: crypto.randomUUID()
        };

        // Detect platform for token expiry
        const userAgent = req.get('User-Agent') || '';
        const platform = (req.body as any)?.platform?.toLowerCase() || '';
        const isMobile = platform === 'mobile' || platform === 'flutter' || platform === 'android' || platform === 'ios' ||
            userAgent.includes('Dart') || userAgent.includes('Flutter') ||
            (userAgent.includes('Mobile') && !userAgent.includes('Mozilla'));
        const tokenExpiry = isMobile ? '30d' : '15m';

        const accessToken = jwt.sign(accessTokenPayload, getJwtSecret(), {
            expiresIn: tokenExpiry,
            algorithm: 'HS256'
        });

        // Rotate refresh token
        await prisma.$transaction(async (tx) => {
            // Revoke old token
            await tx.refreshToken.update({
                where: { id: storedToken.id },
                data: { revokedAt: new Date() }
            });

            // Create new token
            await tx.refreshToken.create({
                data: {
                    userId: storedToken.userId,
                    tokenHash: newRefreshTokenHash,
                    deviceFingerprint: storedToken.deviceFingerprint,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    lastUsedAt: new Date()
                }
            });
        });

        // Set new refresh token cookie (for web)
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        // Return both tokens in body for mobile apps
        res.json({ accessToken, refreshToken: newRefreshToken });

    } catch (error: any) {
        console.error('Refresh token error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const logout = async (req: CookieRequest & AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const refreshToken = req.cookies?.refreshToken;

        if (refreshToken) {
            const tokenHash = hashToken(refreshToken);

            // Revoke refresh token
            await prisma.refreshToken.updateMany({
                where: { tokenHash },
                data: { revokedAt: new Date() }
            });
        }

        // Clear cookies
        res.clearCookie('refreshToken');

        // Emit logout event for audit
        if (req.user) {
            authEventEmitter.emit('user-logout', {
                userId: req.user.id,
                timestamp: new Date(),
                ip: req.ip
            });
        }

        res.json({ message: 'Logged out successfully' });

    } catch (error: any) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const requestPasswordReset = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email } = req.body;

        if (!email) {
            res.status(400).json({ message: 'Email is required' });
            return;
        }

        const normalizedEmail = email.toLowerCase().trim();
        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail }
        });

        // Don't reveal if user exists or not for security
        if (user && user.status === 'active') {
            const resetToken = generateSecureToken();
            const tokenHash = hashToken(resetToken);
            const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

            await prisma.passwordResetToken.create({
                data: {
                    userId: user.healthId,
                    tokenHash,
                    expiresAt: tokenExpiry
                }
            });

            // Emit password reset email event
            authEventEmitter.emit('send-password-reset-email', {
                email: normalizedEmail,
                token: resetToken,
                userId: user.healthId
            });
        }

        res.json({ message: 'If the email exists, a password reset link has been sent' });

    } catch (error: any) {
        console.error('Password reset request error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            res.status(400).json({ message: 'Token and new password are required' });
            return;
        }

        if (newPassword.length < 8) {
            res.status(400).json({ message: 'Password must be at least 8 characters long' });
            return;
        }

        const tokenHash = hashToken(token);

        // Find valid reset token
        const resetToken = await prisma.passwordResetToken.findFirst({
            where: {
                tokenHash,
                expiresAt: {
                    gt: new Date()
                },
                usedAt: null
            }
        });

        if (!resetToken) {
            res.status(400).json({ message: 'Invalid or expired reset token' });
            return;
        }

        // Hash new password
        const pepperedPassword = addPepper(newPassword);
        const newPasswordHash = await argon2.hash(pepperedPassword, {
            type: argon2.argon2id,
            memoryCost: 2 ** 16,
            timeCost: 3,
            parallelism: 1,
        });

        // Update password and revoke all refresh tokens
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { healthId: resetToken.userId },
                data: { passwordHash: newPasswordHash }
            });

            await tx.passwordResetToken.update({
                where: { id: resetToken.id },
                data: { usedAt: new Date() }
            });

            // Revoke all refresh tokens for security
            await tx.refreshToken.updateMany({
                where: { userId: resetToken.userId },
                data: { revokedAt: new Date() }
            });
        });

        res.json({ message: 'Password reset successful' });

    } catch (error: any) {
        console.error('Password reset error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const profile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.user) {
            res.status(401).json({ message: 'User not authenticated' });
            return;
        }

        // Handle GET request - fetch profile
        if (req.method === 'GET') {
            const user = await prisma.user.findUnique({
                where: { healthId: req.user.healthId },
                select: {
                    healthId: true,
                    email: true,
                    phone: true,
                    role: true,
                    status: true,
                    profileRef: true,
                    isVerified: true,
                    createdAt: true,
                    updatedAt: true,
                    healthProfile: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            displayName: true,
                            dateOfBirth: true,
                            gender: true,
                            bloodGroup: true,
                            allergies: true,
                            medications: true,
                            emergencyContact: true,
                            emergencyPhone: true,
                            address: true,
                            isActive: true,
                            verifiedAt: true,
                            createdAt: true,
                            updatedAt: true
                        }
                    }
                }
            });

            if (!user) {
                res.status(404).json({ message: 'User not found' });
                return;
            }

            res.json({ user });
            return;
        }

        // Handle POST request - update profile
        if (req.method === 'POST') {
            const { phone, healthProfile: healthProfileData } = req.body;

            // Update user phone if provided
            const userUpdateData: any = {};
            if (phone !== undefined) {
                userUpdateData.phone = phone;
            }

            // Update user basic info
            if (Object.keys(userUpdateData).length > 0) {
                await prisma.user.update({
                    where: { healthId: req.user.healthId },
                    data: userUpdateData
                });
            }

            // Update or create health profile
            if (healthProfileData) {
                const existingProfile = await prisma.healthProfile.findUnique({
                    where: { userId: req.user.healthId }
                });

                if (existingProfile) {
                    // Update existing health profile
                    await prisma.healthProfile.update({
                        where: { userId: req.user.healthId },
                        data: {
                            firstName: healthProfileData.firstName,
                            lastName: healthProfileData.lastName,
                            displayName: healthProfileData.displayName,
                            dateOfBirth: healthProfileData.dateOfBirth ? new Date(healthProfileData.dateOfBirth) : null,
                            gender: healthProfileData.gender,
                            bloodGroup: healthProfileData.bloodGroup,
                            allergies: healthProfileData.allergies,
                            medications: healthProfileData.medications,
                            emergencyContact: healthProfileData.emergencyContact,
                            emergencyPhone: healthProfileData.emergencyPhone,
                            address: healthProfileData.address
                        }
                    });
                } else {
                    // Create new health profile
                    await prisma.healthProfile.create({
                        data: {
                            userId: req.user.healthId,
                            firstName: healthProfileData.firstName,
                            lastName: healthProfileData.lastName,
                            displayName: healthProfileData.displayName,
                            dateOfBirth: healthProfileData.dateOfBirth ? new Date(healthProfileData.dateOfBirth) : null,
                            gender: healthProfileData.gender,
                            bloodGroup: healthProfileData.bloodGroup,
                            allergies: healthProfileData.allergies,
                            medications: healthProfileData.medications,
                            emergencyContact: healthProfileData.emergencyContact,
                            emergencyPhone: healthProfileData.emergencyPhone,
                            address: healthProfileData.address
                        }
                    });
                }
            }

            // Return updated profile
            const updatedUser = await prisma.user.findUnique({
                where: { healthId: req.user.healthId },
                select: {
                    healthId: true,
                    email: true,
                    phone: true,
                    role: true,
                    status: true,
                    profileRef: true,
                    isVerified: true,
                    createdAt: true,
                    updatedAt: true,
                    healthProfile: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            displayName: true,
                            dateOfBirth: true,
                            gender: true,
                            bloodGroup: true,
                            allergies: true,
                            medications: true,
                            emergencyContact: true,
                            emergencyPhone: true,
                            address: true,
                            isActive: true,
                            verifiedAt: true,
                            createdAt: true,
                            updatedAt: true
                        }
                    }
                }
            });

            res.json({
                message: 'Profile updated successfully',
                user: updatedUser
            });
            return;
        }

        res.status(405).json({ message: 'Method not allowed' });

    } catch (error: any) {
        console.error('Profile error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Health check endpoint
export const health = async (_req: Request, res: Response): Promise<void> => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'healthy', service: 'auth-service' });
    } catch (error) {
        res.status(503).json({ status: 'unhealthy', service: 'auth-service' });
    }
};

// Resend email verification
export const resendVerification = async (req: Request, res: Response): Promise<void> => {
    try {
        const email = (req.body as any)?.email ?? (req.query as any)?.email;
        if (!email) {
            res.status(400).json({ message: 'Email is required' });
            return;
        }
        const normalizedEmail = String(email).toLowerCase().trim();
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        // Always return 200 to avoid user enumeration
        if (!user) {
            res.json({ message: 'If the account exists, a verification email has been sent' });
            return;
        }
        if (user.status !== 'pending_verification') {
            res.json({ message: 'Account already verified or not eligible' });
            return;
        }

        // Find an existing valid verification token
        let verification = await prisma.emailVerification.findFirst({
            where: {
                userId: user.healthId,
                usedAt: null,
                expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
        });

        let token: string;
        if (!verification) {
            token = generateSecureToken();
            const tokenHash = hashToken(token);
            const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
            verification = await prisma.emailVerification.create({
                data: {
                    userId: user.healthId,
                    tokenHash,
                    expiresAt: tokenExpiry,
                },
            });
        } else {
            // Can't recover original token from hash; issue a new one for resend
            token = generateSecureToken();
            const tokenHash = hashToken(token);
            verification = await prisma.emailVerification.create({
                data: {
                    userId: user.healthId,
                    tokenHash,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                },
            });
        }

        await EmailService.sendVerificationEmail(normalizedEmail, token);
        res.json({ message: 'Verification email sent' });
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const verifyPhoneOtp = async (req: Request, res: Response): Promise<void> => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            res.status(400).json({ message: 'Phone number and OTP are required' });
            return;
        }

        const result = await OtpService.verifyOtp(phone, otp);

        if (result.success) {
            res.json({
                message: 'Phone verified successfully',
                userId: result.userId
            });
        } else {
            res.status(400).json({ message: result.message });
        }

    } catch (error: any) {
        console.error('Phone OTP verification error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const resendPhoneOtp = async (req: Request, res: Response): Promise<void> => {
    try {
        const { phone } = req.body;

        if (!phone) {
            res.status(400).json({ message: 'Phone number is required' });
            return;
        }

        // Find user by phone
        const user = await prisma.user.findUnique({
            where: { phone }
        });

        if (!user) {
            res.status(404).json({ message: 'User not found' });
            return;
        }

        if (user.status === 'active') {
            res.status(400).json({ message: 'Phone already verified' });
            return;
        }

        // Generate and send new OTP
        const otp = OtpService.generateOtp();
        await OtpService.storeOtp(user.healthId, phone, otp);
        await OtpService.sendOtp(phone, otp);

        res.json({ message: 'OTP sent successfully' });

    } catch (error: any) {
        console.error('Resend OTP error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};





export default {
    register,
    verifyEmail,
    verifyPhoneOtp,
    resendPhoneOtp,
    login,
    refresh,
    logout,
    requestPasswordReset,
    resetPassword,
    profile,
    health,
    resendVerification,
};