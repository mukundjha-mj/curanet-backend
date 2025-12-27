import express from 'express';
import { authenticateToken, requireAdmin, requirePatient } from '../middlewares/authMiddleware';
import audit from '../controllers/audit.controller';

const router = express.Router();

// Internal audit entry creation (for services)
router.post('/', authenticateToken, audit.createAuditEntry);

// Admin access - filter by actorId / resourceId / action / date range / patientId
router.get('/', authenticateToken, requireAdmin, audit.getAuditEntries);

// Export audit entries (admin only)
router.get('/export', authenticateToken, requireAdmin, audit.exportAuditEntries);

// Patient-only view (limited to their data)
router.get('/patient/:healthId', authenticateToken, audit.getPatientAuditEntries);

export default router;