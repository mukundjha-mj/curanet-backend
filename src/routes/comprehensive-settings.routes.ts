/**
 * Comprehensive Settings Routes
 * Routes for all user settings management
 */

import express from 'express';
import comprehensiveSettingsController from '../controllers/comprehensive-settings.controller';
import notificationSettingsController from '../controllers/notification-settings.controller';
import appearanceSettingsController from '../controllers/appearance-settings.controller';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Comprehensive settings routes
router.get('/all', comprehensiveSettingsController.getAllSettings);
router.put('/all', comprehensiveSettingsController.updateAllSettings);

// Notification settings routes
router.get('/notifications', notificationSettingsController.getNotificationSettings);
router.put('/notifications', notificationSettingsController.updateNotificationSettings);
router.post('/notifications/reset', notificationSettingsController.resetNotificationSettings);

// Appearance settings routes
router.get('/appearance', appearanceSettingsController.getAppearanceSettings);
router.put('/appearance', appearanceSettingsController.updateAppearanceSettings);
router.post('/appearance/reset', appearanceSettingsController.resetAppearanceSettings);

export default router;