import express from 'express';
import { UploadsController } from '../controllers/uploads.controller';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = express.Router();

// Upload initialization
router.post('/init', authenticateToken, UploadsController.initUpload);

// File upload endpoint
router.post('/file', authenticateToken, ...UploadsController.uploadFile);

// Complete upload
router.put('/complete', authenticateToken, UploadsController.completeUpload);

// File management
router.get('/my-files', authenticateToken, UploadsController.listUserFiles);
router.get('/:fileId', authenticateToken, UploadsController.getFileMetadata);
router.delete('/:fileId', authenticateToken, UploadsController.deleteFile);

// File access endpoints
router.get('/:fileId/download', authenticateToken, UploadsController.downloadFile);
router.get('/:fileId/view', authenticateToken, UploadsController.viewFile);

export default router;