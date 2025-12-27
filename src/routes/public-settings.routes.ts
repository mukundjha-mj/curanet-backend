import { Router } from 'express';
import { AdminSettingsController } from '../controllers/admin-settings.controller';

const router = Router();

// Public settings endpoints (no authentication required)
router.get('/maintenance', AdminSettingsController.getMaintenanceStatus);
router.get('/file-limits', AdminSettingsController.getFileUploadSettings);

export default router;