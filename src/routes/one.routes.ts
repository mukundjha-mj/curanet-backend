import express from 'express';
import { EmergencyController } from '../controllers/emergency.controller';

const router = express.Router();

// Public emergency access endpoint - no authentication required
// GET /one/:token
router.get('/:token', EmergencyController.accessEmergencyShare);

export default router;