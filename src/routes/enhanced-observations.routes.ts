import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import { requireConsentAndLog } from '../middlewares/consentMiddleware';
import enhancedObsCtrl from '../controllers/enhanced-observations.controller';

const router = express.Router();

// Enhanced Observations Routes with comprehensive clinical features

// Create enhanced observation with clinical data
router.post('/create', 
  authenticateToken, 
  ...requireConsentAndLog('observation', ['WRITE_NOTES'], 'RECORD_CREATE'),
  enhancedObsCtrl.createEnhancedObservation
);

// Get observations by category with advanced filtering
router.post('/by-category', 
  authenticateToken, 
  enhancedObsCtrl.getObservationsByCategory
);

// Get observation trends and analytics
router.post('/trends', 
  authenticateToken, 
  enhancedObsCtrl.getObservationTrends
);

// Get comprehensive observation analytics
router.post('/analytics', 
  authenticateToken, 
  enhancedObsCtrl.getObservationAnalytics
);

// Add prescription to observation (doctors only)
router.post('/:observationId/prescription', 
  authenticateToken, 
  ...requireConsentAndLog('observation', ['WRITE_NOTES'], 'RECORD_UPDATE'),
  enhancedObsCtrl.addPrescriptionToObservation
);

// Update observation status and clinical notes
router.put('/:id/status', 
  authenticateToken, 
  ...requireConsentAndLog('observation', ['WRITE_NOTES'], 'RECORD_UPDATE'),
  enhancedObsCtrl.updateObservationStatus
);

// Get critical observations (emergency flags)
router.post('/critical', 
  authenticateToken, 
  enhancedObsCtrl.getCriticalObservations
);

// Get detailed audit trail
router.post('/audit-trail', 
  authenticateToken, 
  enhancedObsCtrl.getObservationAuditTrail
);

// Export observations (JSON, FHIR, CSV)
router.post('/export', 
  authenticateToken, 
  ...requireConsentAndLog('observation', ['READ_LAB', 'READ_MEDICAL'], 'RECORD_READ'),
  enhancedObsCtrl.exportObservations
);

export default router;