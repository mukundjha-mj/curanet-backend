import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import { requireConsentAndLog } from '../middlewares/consentMiddleware';
import ctrl from '../controllers/records.controller';

const router = express.Router();

// Encounters - with consent enforcement and audit logging
router.post('/encounters/create', 
  authenticateToken, 
  ...requireConsentAndLog('encounter', ['WRITE_NOTES'], 'RECORD_CREATE'),
  ctrl.createEncounter
);
router.post('/encounters/get/:id', 
  authenticateToken, 
  ...requireConsentAndLog('encounter', ['READ_MEDICAL'], 'RECORD_READ'),
  ctrl.getEncounter
);
router.post('/encounters/list', 
  authenticateToken, 
  ctrl.listEncounters
);

// Observations - with consent enforcement and audit logging
router.post('/observations/create', 
  authenticateToken, 
  ...requireConsentAndLog('observation', ['WRITE_NOTES'], 'RECORD_CREATE'),
  ctrl.createObservation
);
router.post('/observations/get/:id', 
  authenticateToken, 
  ...requireConsentAndLog('observation', ['READ_LAB', 'READ_MEDICAL'], 'RECORD_READ'),
  ctrl.getObservation
);
router.post('/observations/list', 
  authenticateToken, 
  ctrl.listObservations
);

export default router;
