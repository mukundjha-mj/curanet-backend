import express from 'express';
import { EmergencyController } from '../controllers/emergency.controller';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = express.Router();

// Emergency card endpoint (authenticated)
router.get('/card', authenticateToken, EmergencyController.getEmergencyCard);

// Create emergency share link (authenticated, patient only)
router.post('/share', authenticateToken, EmergencyController.createEmergencyShare);

// List patient's emergency shares (authenticated)
router.get('/shares', authenticateToken, EmergencyController.listEmergencyShares);

// Get access logs for a specific share (authenticated)
router.get('/share/:shareId/logs', authenticateToken, EmergencyController.getShareAccessLogs);

// Revoke emergency share (authenticated)
router.delete('/share/:shareId', authenticateToken, EmergencyController.revokeEmergencyShare);

export default router;