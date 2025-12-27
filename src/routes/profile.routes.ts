import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import { ProfileController } from '../controllers/profile.controller';

const router = express.Router();

// Profile routes
router.get('/', authenticateToken, ProfileController.getProfile);
router.post('/', authenticateToken, ProfileController.createOrUpdateProfile);
router.delete('/', authenticateToken, ProfileController.deleteProfile);

// Email OTP routes
router.post('/send-email-otp', authenticateToken, ProfileController.sendEmailOtp);
router.post('/verify-email-otp', authenticateToken, ProfileController.verifyEmailOtp);

export default router;