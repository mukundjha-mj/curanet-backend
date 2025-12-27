import express from 'express';
import { authenticateToken, requireAdmin } from '../middlewares/authMiddleware';
import admin, { 
  bootstrapAdmin,
  getAdminStats,
  getAdminLogs,
  getAdminUsers,
  updateUserStatus,
  updateUserRole,
  updateAdminSettings
} from '../controllers/admin.controller';

const router = express.Router();

// Phase 6: Analytics & Dashboard Routes
router.get('/stats', authenticateToken, requireAdmin, getAdminStats);
router.get('/logs', authenticateToken, requireAdmin, getAdminLogs);

// Phase 6: Enhanced User Management Routes
router.get('/users', authenticateToken, requireAdmin, getAdminUsers);
router.put('/users/:id/status', authenticateToken, requireAdmin, updateUserStatus);
router.put('/users/:id/role', authenticateToken, requireAdmin, updateUserRole);

// Phase 6: System Settings Routes
router.post('/settings', authenticateToken, requireAdmin, updateAdminSettings);

// Original Provider management routes (Phase 1-5)
router.post('/providers/pending', authenticateToken, requireAdmin, admin.listPendingProviders);
router.post('/providers/approve/:healthId', authenticateToken, requireAdmin, admin.approveProvider);
router.post('/providers/reject/:healthId', authenticateToken, requireAdmin, admin.rejectProvider);

// Original User management routes (Phase 1-5)
router.get('/users', authenticateToken, requireAdmin, admin.getAllUsers);
router.get('/users/:healthId', authenticateToken, requireAdmin, admin.getUserDetails);
router.post('/users/:healthId/suspend', authenticateToken, requireAdmin, admin.suspendUser);
router.post('/users/:healthId/reactivate', authenticateToken, requireAdmin, admin.reactivateUser);

// Dev-only admin bootstrap (no auth, token-protected)
router.post('/bootstrap', bootstrapAdmin);

export default router;
