import express from 'express';
import healthIdController from '../controllers/healthId.controller';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = express.Router();

// All Health ID routes require authentication
router.use(authenticateToken);

// Search patient by Health ID - for doctors, pharmacies, admins
router.get('/patient/:healthId', healthIdController.searchPatientByHealthId);

// Update patient information - for doctors, pharmacies with consent
router.put('/patient/:healthId', healthIdController.updatePatientInfo);

// Add medical record - for doctors only
router.post('/patient/:healthId/records', healthIdController.addMedicalRecord);

// Get patient medical history - for doctors, pharmacies with consent
router.get('/patient/:healthId/history', healthIdController.getPatientHistory);

export default router;