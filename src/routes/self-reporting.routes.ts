import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import selfReportingController from '../controllers/self-reporting.controller';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * @route POST /api/self-reporting/observations
 * @desc Create a new self-reported observation
 * @access Patient only
 * @body {
 *   type: string,
 *   value: string,
 *   unit?: string,
 *   notes?: string,
 *   takenAt?: string,
 *   deviceInfo?: object
 * }
 */
router.post('/observations', selfReportingController.createSelfReportedObservation);

/**
 * @route GET /api/self-reporting/observations
 * @desc Get patient's self-reported observations
 * @access Patient (own data) or Doctor
 * @query {
 *   patientId?: string (required for doctors),
 *   status?: 'pending' | 'verified' | 'flagged',
 *   limit?: number,
 *   offset?: number,
 *   startDate?: string,
 *   endDate?: string
 * }
 */
router.get('/observations', selfReportingController.getSelfReportedObservations);

/**
 * @route PUT /api/self-reporting/observations/:id/verify
 * @desc Verify a self-reported observation
 * @access Doctor only
 * @params { id: string }
 * @body {
 *   status: 'verified' | 'flagged',
 *   notes?: string
 * }
 */
router.put('/observations/:id/verify', selfReportingController.verifyObservation);

/**
 * @route GET /api/self-reporting/unverified
 * @desc Get all unverified self-reported observations for doctor review
 * @access Doctor only
 * @query {
 *   limit?: number,
 *   offset?: number,
 *   priority?: 'critical' | 'high' | 'normal'
 * }
 */
router.get('/unverified', selfReportingController.getUnverifiedObservations);

export default router;