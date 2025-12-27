import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import analyticsController from '../controllers/analytics.controller';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * @route GET /api/analytics/doctor/:doctorId/overview
 * @desc Get doctor analytics overview
 * @access Doctor (own data) or Admin
 * @query {
 *   from?: string (YYYY-MM-DD),
 *   to?: string (YYYY-MM-DD)
 * }
 */
router.get('/doctor/:doctorId/overview', analyticsController.getDoctorOverview);

/**
 * @route GET /api/analytics/admin/overview
 * @desc Get admin analytics overview
 * @access Admin only
 * @query {
 *   from?: string (YYYY-MM-DD),
 *   to?: string (YYYY-MM-DD)
 * }
 */
router.get('/admin/overview', analyticsController.getAdminOverview);

/**
 * @route GET /api/analytics/population/trend
 * @desc Get population trend for a specific metric
 * @access Doctor or Admin
 * @query {
 *   metric: string (required),
 *   from?: string (YYYY-MM-DD),
 *   to?: string (YYYY-MM-DD)
 * }
 */
router.get('/population/trend', analyticsController.getPopulationTrend);

/**
 * @route GET /api/analytics/export
 * @desc Export analytics data as CSV
 * @access Doctor or Admin
 * @query {
 *   type: 'critical_alerts' | 'daily_encounters' (required),
 *   from?: string (YYYY-MM-DD),
 *   to?: string (YYYY-MM-DD)
 * }
 */
router.get('/export', analyticsController.exportAnalytics);

export default router;