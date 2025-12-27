// Email OTP methods to be added to profile.controller.ts

import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import EmailService from '../services/email.service';

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

/**
 * Send email OTP for verification
 * POST /api/profile/send-email-otp
 */
export async function sendEmailOtp(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if email is already taken by another user
    const existingEmailUser = await prisma.user.findUnique({
      where: { email }
    });
    if (existingEmailUser && existingEmailUser.healthId !== userId) {
      return res.status(400).json({ error: 'Email already in use by another account' });
    }

    // Generate OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP
    await prisma.emailOtpVerification.create({
      data: {
        userId,
        email,
        otpHash,
        expiresAt,
      }
    });

    // Send OTP email
    await EmailService.sendEmailOtp(email, otp);

    res.json({
      success: true,
      data: {
        message: 'OTP sent to email successfully',
        email: email
      }
    });

  } catch (error) {
    console.error('Error sending email OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
}

/**
 * Verify email OTP and update email
 * POST /api/profile/verify-email-otp
 */
export async function verifyEmailOtp(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.healthId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    // Find valid OTP
    const verification = await prisma.emailOtpVerification.findFirst({
      where: {
        email,
        userId,
        otpHash,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!verification) {
      // Check if there were too many failed attempts
      const recentAttempts = await prisma.emailOtpVerification.findMany({
        where: {
          email,
          userId,
          createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) }
        }
      });

      const totalAttempts = recentAttempts.reduce((sum, v) => sum + v.attempts, 0);
      
      if (totalAttempts >= 5) {
        return res.status(429).json({ 
          error: 'Too many failed attempts. Please request a new OTP.' 
        });
      }

      // Increment attempt counter
      const latestVerification = recentAttempts[0];
      if (latestVerification) {
        await prisma.emailOtpVerification.update({
          where: { id: latestVerification.id },
          data: { attempts: { increment: 1 } }
        });
      }

      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Mark OTP as used
    await prisma.emailOtpVerification.update({
      where: { id: verification.id },
      data: { usedAt: new Date() }
    });

    // Update user email
    await prisma.user.update({
      where: { healthId: userId },
      data: { 
        email,
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: {
        message: 'Email verified and updated successfully',
        email: email
      }
    });

  } catch (error) {
    console.error('Error verifying email OTP:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
}
