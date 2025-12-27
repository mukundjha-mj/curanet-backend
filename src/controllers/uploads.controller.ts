import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import multer from 'multer';
import crypto from 'crypto';
import CryptoJS from 'crypto-js';
import fs from 'fs';
import path from 'path';
import AuditService from '../services/audit.service';

interface AuthenticatedRequest extends Request {
  user?: {
    healthId: string;
    email: string | null;
    role: string;
    status: string;
    tokenId: string;
  };
}

// Create uploads directory if it doesn't exist
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename while preserving extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `file-${uniqueSuffix}${ext}`);
  }
});

// File filter for security
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Allowed file types for healthcare documents
  const allowedMimeTypes = [
    // Images
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'text/markdown',
    'text/md',
    // Common fallback types
    'application/octet-stream', // Allow for files with unclear MIME types
    // Medical imaging (basic support)
    'application/dicom',
    'image/tiff'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 10 // Max 10 files per request
  }
});

export class UploadsController {
  /**
   * Initialize Upload
   * POST /api/uploads/init
   * Creates upload token and returns upload configuration
   */
  static async initUpload(req: AuthenticatedRequest, res: Response) {
    try {
      const { filename, mimeType, fileSize, recordId, description, tags } = req.body;
      const ownerHealthId = req.user?.healthId;

      if (!ownerHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!filename || !mimeType || !fileSize) {
        return res.status(400).json({
          error: 'Filename, MIME type, and file size are required'
        });
      }

      // Validate file size (50MB limit)
      if (fileSize > 50 * 1024 * 1024) {
        return res.status(400).json({
          error: 'File size exceeds 50MB limit'
        });
      }

      // Generate upload token
      const uploadToken = crypto.randomBytes(32).toString('hex');
      const storageKey = `${ownerHealthId}/${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;

      // Create file upload record
      const fileUpload = await prisma.fileUpload.create({
        data: {
          ownerHealthId,
          recordId,
          filename: `upload-${Date.now()}${path.extname(filename)}`,
          originalName: filename,
          mimeType,
          fileSize,
          storageKey,
          uploadToken,
          status: 'UPLOADING',
          description,
          tags: tags || null
        }
      });

      // Log upload initiation
      await AuditService.logAction({
        actorId: ownerHealthId,
        actorRole: req.user?.role || 'unknown',
        action: 'FILE_UPLOAD_INITIATED',
        resourceType: 'FileUpload',
        resourceId: fileUpload.id,
        patientHealthId: ownerHealthId,
        metadata: {
          filename,
          mimeType,
          fileSize,
          uploadToken: uploadToken.substring(0, 8) + '...'
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(201).json({
        success: true,
        data: {
          uploadId: fileUpload.id,
          uploadToken,
          storageKey,
          maxFileSize: 50 * 1024 * 1024,
          allowedTypes: [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'text/csv'
          ],
          chunkSize: 1024 * 1024 // 1MB chunks for large files
        }
      });

    } catch (error) {
      console.error('Error initializing upload:', error);
      res.status(500).json({ error: 'Failed to initialize upload' });
    }
  }

  /**
   * Upload File
   * POST /api/uploads/file
   * Handles actual file upload with multer
   */
  static uploadFile = [
    upload.single('file'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { uploadToken, description, tags, recordId } = req.body;
        const ownerHealthId = req.user?.healthId;
        const file = req.file;

        if (!ownerHealthId) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        if (!file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        if (!uploadToken) {
          return res.status(400).json({ error: 'Upload token required' });
        }

        // Find the upload record
        console.log('Looking for upload token:', uploadToken);
        console.log('Owner health ID:', ownerHealthId);
        
        const fileUpload = await prisma.fileUpload.findFirst({
          where: {
            uploadToken,
            ownerHealthId,
            status: 'UPLOADING'
          }
        });

        console.log('Found fileUpload record:', fileUpload);

        if (!fileUpload) {
          // Clean up uploaded file
          fs.unlinkSync(file.path);
          return res.status(404).json({ error: 'Invalid upload token or upload not found' });
        }

        console.log('Calculating checksum for file:', file.path);
        
        // Calculate file checksum
        const fileBuffer = fs.readFileSync(file.path);
        const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        console.log('Updating file record in database...');
        
        // Update file record with actual file info
        const updatedFile = await prisma.fileUpload.update({
          where: { id: fileUpload.id },
          data: {
            filename: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            checksum,
            storageKey: file.path,
            status: 'COMPLETED',
            uploadedAt: new Date(),
            uploadToken: null, // Clear token after use
            description: description || fileUpload.description,
            tags: tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : fileUpload.tags,
            recordId: recordId || fileUpload.recordId
          }
        });

        console.log('File record updated successfully:', updatedFile.id);

        // Log successful upload
        await AuditService.logAction({
          actorId: ownerHealthId,
          actorRole: req.user?.role || 'unknown',
          action: 'FILE_UPLOADED',
          resourceType: 'FileUpload',
          resourceId: updatedFile.id,
          patientHealthId: ownerHealthId,
          metadata: {
            filename: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            checksum
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        });

        console.log('Sending upload success response...');

        res.status(200).json({
          success: true,
          data: {
            fileId: updatedFile.id,
            filename: updatedFile.originalName,
            mimeType: updatedFile.mimeType,
            fileSize: updatedFile.fileSize,
            checksum: updatedFile.checksum,
            uploadedAt: updatedFile.uploadedAt,
            description: updatedFile.description,
            tags: updatedFile.tags
          },
          message: 'File uploaded successfully'
        });

      } catch (error) {
        console.error('Error uploading file:', error);

        // Clean up file if upload failed
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        if (error instanceof multer.MulterError) {
          if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds 50MB limit' });
          }
          if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files. Maximum 10 files allowed' });
          }
        }

        res.status(500).json({ error: 'Failed to upload file' });
      }
    }
  ];

  /**
   * Complete Upload
   * PUT /api/uploads/complete
   * Confirms upload completion and registers file reference
   */
  static async completeUpload(req: AuthenticatedRequest, res: Response) {
    try {
      const { uploadToken, uploadId, recordId, description, tags } = req.body;
      const ownerHealthId = req.user?.healthId;

      if (!ownerHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!uploadId && !uploadToken) {
        return res.status(400).json({ error: 'Upload ID or upload token required' });
      }

      // Find the upload record by uploadId (since uploadToken is cleared after upload)
      let fileUpload;
      if (uploadId) {
        fileUpload = await prisma.fileUpload.findFirst({
          where: {
            id: uploadId,
            ownerHealthId,
            status: 'COMPLETED'
          }
        });
      } else if (uploadToken) {
        // Fallback: try to find by token (in case token wasn't cleared yet)
        fileUpload = await prisma.fileUpload.findFirst({
          where: {
            uploadToken,
            ownerHealthId
          }
        });
      }

      if (!fileUpload) {
        return res.status(404).json({ error: 'Upload not found or not completed' });
      }

      // Update with additional metadata
      const updatedFile = await prisma.fileUpload.update({
        where: { id: uploadId },
        data: {
          recordId: recordId || fileUpload.recordId,
          description: description || fileUpload.description,
          tags: tags || fileUpload.tags
        }
      });

      // Log upload completion
      await AuditService.logAction({
        actorId: ownerHealthId,
        actorRole: req.user?.role || 'unknown',
        action: 'FILE_UPLOAD_COMPLETED',
        resourceType: 'FileUpload',
        resourceId: updatedFile.id,
        patientHealthId: ownerHealthId,
        metadata: {
          recordId,
          description,
          tags
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        data: {
          fileId: updatedFile.id,
          recordId: updatedFile.recordId,
          description: updatedFile.description,
          tags: updatedFile.tags
        },
        message: 'Upload completed and registered successfully'
      });

    } catch (error) {
      console.error('Error completing upload:', error);
      res.status(500).json({ error: 'Failed to complete upload' });
    }
  }

  /**
   * Get File Metadata
   * GET /api/uploads/:fileId
   * Returns file metadata with access control
   */
  static async getFileMetadata(req: AuthenticatedRequest, res: Response) {
    try {
      const { fileId } = req.params;
      const userId = req.user?.healthId;
      const userRole = req.user?.role;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const fileUpload = await prisma.fileUpload.findUnique({
        where: { id: fileId },
        include: {
          owner: {
            include: { healthProfile: true }
          }
        }
      });

      if (!fileUpload) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Check access permissions
      const canAccess = await UploadsController.checkFileAccess(userId, userRole || 'unknown', fileUpload);
      if (!canAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Log file access
      // await this.logFileAccess(fileId, userId, 'METADATA_VIEW', req);

      res.status(200).json({
        success: true,
        data: {
          id: fileUpload.id,
          filename: fileUpload.originalName,
          mimeType: fileUpload.mimeType,
          fileSize: fileUpload.fileSize,
          description: fileUpload.description,
          tags: fileUpload.tags,
          uploadedAt: fileUpload.uploadedAt,
          ownerName: fileUpload.owner.healthProfile ? 
            `${fileUpload.owner.healthProfile.firstName} ${fileUpload.owner.healthProfile.lastName}` : 
            'Unknown',
          recordId: fileUpload.recordId,
          status: fileUpload.status
        }
      });

    } catch (error) {
      console.error('Error getting file metadata:', error);
      res.status(500).json({ error: 'Failed to get file metadata' });
    }
  }

  /**
   * Download File
   * GET /api/uploads/:fileId/download
   * Serves file for download with access control
   */
  static async downloadFile(req: AuthenticatedRequest, res: Response) {
    try {
      const { fileId } = req.params;
      const userId = req.user?.healthId;
      const userRole = req.user?.role;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const fileUpload = await prisma.fileUpload.findUnique({
        where: { id: fileId }
      });

      if (!fileUpload || fileUpload.status !== 'COMPLETED') {
        return res.status(404).json({ error: 'File not found or not available' });
      }

      // Check access permissions
      const canAccess = await UploadsController.checkFileAccess(userId, userRole || 'unknown', fileUpload);
      if (!canAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check if file exists on disk
      if (!fs.existsSync(fileUpload.storageKey)) {
        return res.status(404).json({ error: 'File not found on storage' });
      }

      // Log file download (temporarily disabled)
      // await this.logFileAccess(fileId, userId, 'DOWNLOAD', req);

      // Set appropriate headers
      res.setHeader('Content-Type', fileUpload.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileUpload.originalName}"`);
      res.setHeader('Content-Length', fileUpload.fileSize.toString());

      // Stream file to response
      const fileStream = fs.createReadStream(fileUpload.storageKey);
      fileStream.pipe(res);

    } catch (error) {
      console.error('Error downloading file:', error);
      res.status(500).json({ error: 'Failed to download file' });
    }
  }

  /**
   * View File (in-browser)
   * GET /api/uploads/:fileId/view
   * Serves file for viewing in browser
   */
  static async viewFile(req: AuthenticatedRequest, res: Response) {
    try {
      const { fileId } = req.params;
      const userId = req.user?.healthId;
      const userRole = req.user?.role;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const fileUpload = await prisma.fileUpload.findUnique({
        where: { id: fileId }
      });

      if (!fileUpload || fileUpload.status !== 'COMPLETED') {
        return res.status(404).json({ error: 'File not found or not available' });
      }

      // Check access permissions
      const canAccess = await UploadsController.checkFileAccess(userId, userRole || 'unknown', fileUpload);
      if (!canAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check if file exists on disk
      if (!fs.existsSync(fileUpload.storageKey)) {
        return res.status(404).json({ error: 'File not found on storage' });
      }

      // Log file view (temporarily disabled)
      // await this.logFileAccess(fileId, userId, 'VIEW', req);

      // Set appropriate headers for inline viewing
      res.setHeader('Content-Type', fileUpload.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${fileUpload.originalName}"`);
      res.setHeader('Content-Length', fileUpload.fileSize.toString());

      // Stream file to response
      const fileStream = fs.createReadStream(fileUpload.storageKey);
      fileStream.pipe(res);

    } catch (error) {
      console.error('Error viewing file:', error);
      res.status(500).json({ error: 'Failed to view file' });
    }
  }

  /**
   * List User Files
   * GET /api/uploads/my-files
   * Lists files owned by the authenticated user
   */
  static async listUserFiles(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.healthId;
      const { recordId, mimeType, limit = 20, page = 1 } = req.query;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const skip = (Number(page) - 1) * Number(limit);

      const files = await prisma.fileUpload.findMany({
        where: {
          ownerHealthId: userId,
          status: 'COMPLETED',
          ...(recordId && { recordId: recordId as string }),
          ...(mimeType && { mimeType: { startsWith: mimeType as string } })
        },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          fileSize: true,
          description: true,
          tags: true,
          uploadedAt: true,
          recordId: true
        },
        orderBy: { uploadedAt: 'desc' },
        skip,
        take: Number(limit)
      });

      const totalCount = await prisma.fileUpload.count({
        where: {
          ownerHealthId: userId,
          status: 'COMPLETED',
          ...(recordId && { recordId: recordId as string }),
          ...(mimeType && { mimeType: { startsWith: mimeType as string } })
        }
      });

      res.status(200).json({
        success: true,
        data: {
          files,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: totalCount,
            pages: Math.ceil(totalCount / Number(limit))
          }
        }
      });

    } catch (error) {
      console.error('Error listing user files:', error);
      res.status(500).json({ error: 'Failed to list files' });
    }
  }

  /**
   * Delete File
   * DELETE /api/uploads/:fileId
   * Deletes file and metadata
   */
  static async deleteFile(req: AuthenticatedRequest, res: Response) {
    try {
      const { fileId } = req.params;
      const userId = req.user?.healthId;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const fileUpload = await prisma.fileUpload.findFirst({
        where: {
          id: fileId,
          ownerHealthId: userId
        }
      });

      if (!fileUpload) {
        return res.status(404).json({ error: 'File not found or access denied' });
      }

      // Delete physical file
      if (fs.existsSync(fileUpload.storageKey)) {
        fs.unlinkSync(fileUpload.storageKey);
      }

      // Update status to deleted (soft delete)
      await prisma.fileUpload.update({
        where: { id: fileId },
        data: { status: 'DELETED' }
      });

      // Log file deletion
      await AuditService.logAction({
        actorId: userId,
        actorRole: req.user?.role || 'unknown',
        action: 'FILE_DELETED',
        resourceType: 'FileUpload',
        resourceId: fileId,
        patientHealthId: userId,
        metadata: {
          filename: fileUpload.originalName,
          mimeType: fileUpload.mimeType
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        message: 'File deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting file:', error);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  }

  /**
   * Check if user can access file
   * Private helper method
   */
  private static async checkFileAccess(userId: string, userRole: string, fileUpload: any): Promise<boolean> {
    // Owner can always access
    if (fileUpload.ownerHealthId === userId) {
      return true;
    }

    // Admin can access all files
    if (userRole === 'admin') {
      return true;
    }

    // For healthcare providers, check if they have consent to access patient's files
    if (userRole === 'doctor' && fileUpload.recordId) {
      // This would integrate with the consent system
      // For now, we'll implement basic logic
      const consent = await prisma.consent.findFirst({
        where: {
          patientId: fileUpload.ownerHealthId,
          providerId: userId,
          status: 'ACTIVE',
          expiresAt: {
            gt: new Date()
          }
        }
      });

      return consent !== null;
    }

    return false;
  }

  /**
   * Log file access
   * Private helper method
   */
  private static async logFileAccess(fileId: string, accessorId: string, action: string, req: AuthenticatedRequest): Promise<void> {
    try {
      // Create file access record
      await prisma.fileAccess.create({
        data: {
          fileId,
          accessorId,
          action,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      // Also log in audit trail
      const fileUpload = await prisma.fileUpload.findUnique({
        where: { id: fileId }
      });

      if (fileUpload) {
        await AuditService.logAction({
          actorId: accessorId,
          actorRole: req.user?.role || 'unknown',
          action: `FILE_${action}`,
          resourceType: 'FileUpload',
          resourceId: fileId,
          patientHealthId: fileUpload.ownerHealthId,
          metadata: {
            filename: fileUpload.originalName,
            action
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        });
      }
    } catch (error) {
      console.error('Error logging file access:', error);
    }
  }
}