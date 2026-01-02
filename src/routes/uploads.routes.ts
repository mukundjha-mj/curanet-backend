import express from 'express';
import multer from 'multer';
import { UploadsController } from '../controllers/uploads.controller';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Legacy endpoint alias
router.get('/my-files', authenticateToken, UploadsController.listFiles);

// File upload (supports both FormData and JSON base64)
router.post('/file', authenticateToken, upload.single('file'), UploadsController.uploadFile);

// File download endpoint
router.get('/file/:fileId', authenticateToken, UploadsController.downloadFile);

// File management
router.get('/files', authenticateToken, UploadsController.listFiles);
router.get('/file/:fileId/metadata', authenticateToken, UploadsController.getFileMetadata);
router.delete('/file/:fileId', authenticateToken, UploadsController.deleteFile);

// File access history
router.get('/file/:fileId/access-history', authenticateToken, UploadsController.getFileAccessHistory);

export default router;