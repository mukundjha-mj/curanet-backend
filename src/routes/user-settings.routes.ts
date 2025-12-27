/**
 * User Settings Routes
 * Routes for managing user consent settings, privacy preferences, and emergency contacts
 */

import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
  getUserConsentSettings,
  updateUserConsentSettings,
  updateUserPrivacySettings,
  getEmergencyContacts,
  createEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
  getUserDashboardData,
  deleteUserData,
} from '../controllers/user-settings.controller';

const router = Router();

// Consent and privacy settings routes
router.get('/consent-settings', authenticateToken, getUserConsentSettings);
router.put('/consent-settings', authenticateToken, updateUserConsentSettings);
router.put('/privacy-settings', authenticateToken, updateUserPrivacySettings);

// Emergency contacts routes
router.get('/emergency-contacts', authenticateToken, getEmergencyContacts);
router.post('/emergency-contacts', authenticateToken, createEmergencyContact);
router.put('/emergency-contacts/:id', authenticateToken, updateEmergencyContact);
router.delete('/emergency-contacts/:id', authenticateToken, deleteEmergencyContact);

// Dashboard and data management routes
router.get('/dashboard', authenticateToken, getUserDashboardData);
router.delete('/delete-data', authenticateToken, deleteUserData);

export default router;