import express from 'express';
import * as ctrl from '../controllers/enhanced-encounters.controller';
import { authenticateToken } from '../middlewares/authMiddleware';
import { requireConsentAndLog } from '../middlewares/consentMiddleware';

const router = express.Router();

// Complete Encounter-Centered Workflow Routes - Per Your Specification
// These work with existing database structure using JSON fields for extended data
// Note: All routes are mounted at /api/encounters in index.ts

// POST /api/encounters — create encounter (fields above). Returns encounter object.
router.post('/', 
  authenticateToken,
  ...requireConsentAndLog('encounter', ['WRITE_NOTES'], 'RECORD_CREATE'),
  ctrl.createEnhancedEncounter
);

// PATCH /api/encounters/:id — update (status, notes, end_time).
router.patch('/:id', 
  authenticateToken,
  ...requireConsentAndLog('encounter', ['WRITE_NOTES'], 'RECORD_UPDATE'),
  ctrl.updateEnhancedEncounter
);

// GET /api/encounters/:id — fetch encounter and embedded observations/prescriptions.
router.get('/:id', 
  authenticateToken,
  ...requireConsentAndLog('encounter', ['READ_MEDICAL'], 'RECORD_READ'),
  ctrl.getEnhancedEncounter
);

// GET /api/patients/:healthId/encounters — list with pagination, filters (date, type).
router.post('/patients/:healthId/encounters', 
  authenticateToken,
  ...requireConsentAndLog('encounter', ['READ_MEDICAL'], 'RECORD_READ'),
  ctrl.listPatientEncounters
);

// POST /api/appointments/:id/convert-to-encounter — convenience: convert approved appointment → encounter.
router.post('/appointments/:id/convert-to-encounter', 
  authenticateToken,
  ...requireConsentAndLog('encounter', ['WRITE_NOTES'], 'RECORD_CREATE'),
  ctrl.convertAppointmentToEncounter
);

// Additional workflow endpoints
// POST /api/encounters/:encounterId/observations — add observation to encounter
router.post('/:encounterId/observations', 
  authenticateToken,
  ...requireConsentAndLog('encounter', ['WRITE_NOTES'], 'RECORD_CREATE'),
  ctrl.addObservationToEncounter
);

// Prescription Management (using observations table)
router.post('/:encounterId/prescriptions', 
  authenticateToken,
  ...requireConsentAndLog('observation', ['WRITE_NOTES'], 'RECORD_CREATE'),
  ctrl.createEncounterPrescription
);

router.get('/:encounterId/prescriptions', 
  authenticateToken,
  ...requireConsentAndLog('observation', ['READ_MEDICAL'], 'RECORD_READ'),
  ctrl.getEncounterPrescriptions
);

router.get('/patients/:patientId/prescriptions', 
  authenticateToken,
  ...requireConsentAndLog('observation', ['READ_MEDICAL'], 'RECORD_READ'),
  ctrl.getPatientPrescriptions
);

export default router;