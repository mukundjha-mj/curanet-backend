import crypto from 'crypto';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

class OtpService {
    /**
     * Generate a 6-digit OTP
     */
    generateOtp(): string {
        return crypto.randomInt(100000, 999999).toString();
    }

    /**
     * Hash OTP for secure storage
     */
    hashOtp(otp: string): string {
        return crypto.createHash('sha256').update(otp).digest('hex');
    }

    /**
     * Send OTP via SMS (mock implementation - integrate with Twilio/AWS SNS in production)
     */
    async sendOtp(phone: string, otp: string): Promise<boolean> {
        try {
            // In development, just log the OTP
            if (process.env.NODE_ENV !== 'production') {
                logger.info('[DEV] OTP generated', { phone, otp });
                logger.info('[DEV] OTP will expire in 10 minutes');
                return true;
            }

            // PRODUCTION: Integrate SMS provider (Twilio/AWS SNS/Vonage)
            // For production deployment, configure SMS service credentials in .env:
            // const accountSid = process.env.TWILIO_ACCOUNT_SID;
            // const authToken = process.env.TWILIO_AUTH_TOKEN;
            // const client = require('twilio')(accountSid, authToken);
            // 
            // await client.messages.create({
            //     body: `Your CuraNet verification code is: ${otp}. Valid for 10 minutes.`,
            //     from: process.env.TWILIO_PHONE_NUMBER,
            //     to: phone
            // });

            return true;
        } catch (error) {
            logger.error('Failed to send OTP', { error, phone });
            return false;
        }
    }

    /**
     * Store OTP in database
     */
    async storeOtp(userId: string, phone: string, otp: string): Promise<void> {
        const otpHash = this.hashOtp(otp);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await prisma.phoneOtpVerification.create({
            data: {
                userId,
                phone,
                otpHash,
                expiresAt,
            }
        });
    }

    /**
     * Verify OTP
     */
    async verifyOtp(phone: string, otp: string): Promise<{ success: boolean; userId?: string; message?: string }> {
        try {
            const otpHash = this.hashOtp(otp);

            // Find valid OTP
            const verification = await prisma.phoneOtpVerification.findFirst({
                where: {
                    phone,
                    otpHash,
                    expiresAt: { gt: new Date() },
                    usedAt: null,
                },
                orderBy: { createdAt: 'desc' }
            });

            if (!verification) {
                // Check if there were too many failed attempts
                const recentAttempts = await prisma.phoneOtpVerification.findMany({
                    where: {
                        phone,
                        createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) }
                    }
                });

                const totalAttempts = recentAttempts.reduce((sum, v) => sum + v.attempts, 0);
                
                if (totalAttempts >= 5) {
                    return { 
                        success: false, 
                        message: 'Too many failed attempts. Please request a new OTP.' 
                    };
                }

                // Increment attempt counter
                const latestVerification = recentAttempts[0];
                if (latestVerification) {
                    await prisma.phoneOtpVerification.update({
                        where: { id: latestVerification.id },
                        data: { attempts: { increment: 1 } }
                    });
                }

                return { success: false, message: 'Invalid or expired OTP' };
            }

            // Mark OTP as used
            await prisma.phoneOtpVerification.update({
                where: { id: verification.id },
                data: { usedAt: new Date() }
            });

            // Activate user account
            await prisma.user.update({
                where: { healthId: verification.userId },
                data: { 
                    status: 'active',
                    isVerified: true
                }
            });

            return { success: true, userId: verification.userId };

        } catch (error) {
            logger.error('OTP verification error', { error });
            return { success: false, message: 'Verification failed' };
        }
    }

    /**
     * Cleanup expired OTPs (call this periodically)
     */
    async cleanupExpiredOtps(): Promise<void> {
        await prisma.phoneOtpVerification.deleteMany({
            where: {
                expiresAt: { lt: new Date() }
            }
        });
    }
}

export default new OtpService();
