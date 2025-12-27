import express from 'express';
import { authenticateToken, requirePatient, requireDoctor, requirePharmacy, requireHealthProvider } from '../middlewares/authMiddleware';
import consent from '../controllers/consent.controller';

const router = express.Router();

// Consent request routes (only doctors and pharmacies can request consent)
router.post('/request', authenticateToken, requireHealthProvider, consent.requestConsent);
router.get('/requests', authenticateToken, consent.getConsentRequests);
router.post('/requests/reject', authenticateToken, requirePatient, consent.rejectConsentRequest);

// Consent management routes (only patients can grant/revoke consent)
router.post('/grant', authenticateToken, requirePatient, consent.grantConsent);
router.post('/revoke', authenticateToken, requirePatient, consent.revokeConsent);
router.get('/', authenticateToken, consent.listConsents);
router.get('/:id', authenticateToken, consent.getConsentDetails);

// Development utility routes
router.post('/dev/refresh-expired', authenticateToken, consent.refreshExpiredRequests);

export default router;