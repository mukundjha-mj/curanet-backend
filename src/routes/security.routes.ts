import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
  changePassword,
  listSessions,
  revokeSession,
  revokeAllOtherSessions,
  getRecoveryOptions,
  updateRecoveryOptions,
  getSecuritySettings
} from '../controllers/security.controller';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Password management
router.post('/change-password', changePassword);

// Session management
router.get('/sessions', listSessions);
router.delete('/sessions/:sessionId', revokeSession);
router.post('/sessions/revoke-all', revokeAllOtherSessions);

// Recovery options
router.get('/recovery-options', getRecoveryOptions);
router.put('/recovery-options', updateRecoveryOptions);

// Security settings
router.get('/settings', getSecuritySettings);

export default router;
