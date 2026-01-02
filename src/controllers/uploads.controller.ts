import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import crypto from 'crypto';
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

export class UploadsController {
  /**
   * Upload File (Supports both FormData and Base64 JSON)
   * POST /api/uploads/file
   * Stores file directly in database as base64
   */
  static async uploadFile(req: AuthenticatedRequest, res: Response) {
    try {
      let filename: string;
      let fileData: string; // base64
      let mimeType: string;
      let fileSizeBytes: number;
      const { recordId, description, tags, uploadToken } = req.body;
      
      const ownerHealthId = req.user?.healthId;

      if (!ownerHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Check if this is FormData upload (legacy) or JSON upload (new)
      if (req.file) {
        // Legacy FormData upload - convert buffer to base64
        filename = req.file.originalname;
        mimeType = req.file.mimetype;
        fileSizeBytes = req.file.size;
        fileData = req.file.buffer.toString('base64');
        
        logger.info('Legacy FormData upload received', {
          filename,
          mimeType,
          size: fileSizeBytes
        });
      } else {
        // New JSON upload with base64
        filename = req.body.filename;
        fileData = req.body.fileData;
        mimeType = req.body.mimeType;

        if (!filename || !fileData || !mimeType) {
          return res.status(400).json({
            error: 'Filename, file data, and MIME type are required'
          });
        }

        fileSizeBytes = Buffer.from(fileData, 'base64').length;
      }

      // Validate file size (50MB limit)
      if (fileSizeBytes > 50 * 1024 * 1024) {
        return res.status(400).json({
          error: 'File size exceeds 50MB limit'
        });
      }

      // Validate MIME type
      const allowedMimeTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'text/csv', 'text/markdown'
      ];

      if (!allowedMimeTypes.includes(mimeType)) {
        return res.status(400).json({
          error: `File type ${mimeType} not allowed`,
          allowedTypes: allowedMimeTypes
        });
      }

      // Calculate checksum
      const fileBuffer = Buffer.from(fileData, 'base64');
      const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // Create file upload record with base64 data
      const fileUpload = await prisma.fileUpload.create({
        data: {
          ownerHealthId,
          recordId: recordId || null,
          filename: `file-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`,
          originalName: filename,
          mimeType,
          fileSize: fileSizeBytes,
          checksum,
          fileData, // Store base64 directly in DB
          status: 'COMPLETED',
          description: description || null,
          tags: tags || null,
          uploadedAt: new Date()
        }
      });

      // Log successful upload
      await AuditService.logAction({
        actorId: ownerHealthId,
        actorRole: req.user?.role || 'unknown',
        action: 'FILE_UPLOADED',
        resourceType: 'FileUpload',
        resourceId: fileUpload.id,
        patientHealthId: ownerHealthId,
        metadata: {
          filename,
          mimeType,
          fileSize: fileSizeBytes,
          checksum
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      logger.info('File uploaded successfully', {
        fileId: fileUpload.id,
        ownerHealthId,
        filename,
        fileSize: fileSizeBytes
      });

      res.status(200).json({
        success: true,
        data: {
          fileId: fileUpload.id,
          filename: fileUpload.originalName,
          mimeType: fileUpload.mimeType,
          fileSize: fileUpload.fileSize,
          checksum: fileUpload.checksum,
          uploadedAt: fileUpload.uploadedAt,
          description: fileUpload.description,
          tags: fileUpload.tags
        },
        message: 'File uploaded successfully'
      });

    } catch (error) {
      logger.error('Error uploading file:', error);
      res.status(500).json({ error: 'Failed to upload file' });
    }
  }

  /**
   * Download File
   * GET /api/uploads/file/:fileId
   * Returns file as base64 or raw buffer
   */
  static async downloadFile(req: AuthenticatedRequest, res: Response) {
    try {
      const { fileId } = req.params;
      const ownerHealthId = req.user?.healthId;
      const asBase64 = req.query.base64 === 'true';

      if (!ownerHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Fetch file
      const fileUpload = await prisma.fileUpload.findFirst({
        where: {
          id: fileId,
          ownerHealthId // Only allow owner to download
        }
      });

      if (!fileUpload) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Log file access
      await AuditService.logAction({
        actorId: ownerHealthId,
        actorRole: req.user?.role || 'unknown',
        action: 'FILE_DOWNLOADED',
        resourceType: 'FileUpload',
        resourceId: fileUpload.id,
        patientHealthId: ownerHealthId,
        metadata: {
          filename: fileUpload.originalName,
          mimeType: fileUpload.mimeType,
          fileSize: fileUpload.fileSize
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Record file access
      await prisma.fileAccess.create({
        data: {
          fileId: fileUpload.id,
          accessorId: ownerHealthId,
          action: 'DOWNLOAD',
          ipAddress: req.ip || null,
          userAgent: req.get('User-Agent') || null
        }
      });

      if (asBase64) {
        // Return as JSON with base64 data
        return res.json({
          success: true,
          data: {
            fileId: fileUpload.id,
            filename: fileUpload.originalName,
            mimeType: fileUpload.mimeType,
            fileSize: fileUpload.fileSize,
            fileData: fileUpload.fileData,
            uploadedAt: fileUpload.uploadedAt
          }
        });
      } else {
        // Return as raw file buffer
        const fileBuffer = Buffer.from(fileUpload.fileData, 'base64');
        
        res.setHeader('Content-Type', fileUpload.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileUpload.originalName}"`);
        res.setHeader('Content-Length', fileBuffer.length);
        
        return res.send(fileBuffer);
      }

    } catch (error) {
      logger.error('Error downloading file:', error);
      res.status(500).json({ error: 'Failed to download file' });
    }
  }

  /**
   * List Files
   * GET /api/uploads/files
   * Lists all files for authenticated user
   */
  static async listFiles(req: AuthenticatedRequest, res: Response) {
    try {
      const ownerHealthId = req.user?.healthId;

      if (!ownerHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { recordId, mimeType, limit = 50, offset = 0 } = req.query;

      const where: any = {
        ownerHealthId,
        status: 'COMPLETED'
      };

      if (recordId) {
        where.recordId = recordId as string;
      }

      if (mimeType) {
        where.mimeType = mimeType as string;
      }

      const files = await prisma.fileUpload.findMany({
        where,
        select: {
          id: true,
          filename: true,
          originalName: true,
          mimeType: true,
          fileSize: true,
          checksum: true,
          description: true,
          tags: true,
          uploadedAt: true,
          createdAt: true,
          recordId: true
          // Don't include fileData in list view
        },
        orderBy: { uploadedAt: 'desc' },
        take: Number(limit),
        skip: Number(offset)
      });

      const total = await prisma.fileUpload.count({ where });

      res.json({
        success: true,
        files: files,
        data: files, // For backward compatibility
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
          hasMore: total > Number(offset) + Number(limit)
        }
      });

    } catch (error) {
      logger.error('Error listing files:', error);
      res.status(500).json({ error: 'Failed to list files' });
    }
  }

  /**
   * Delete File
   * DELETE /api/uploads/file/:fileId
   * Deletes a file from database
   */
  static async deleteFile(req: AuthenticatedRequest, res: Response) {
    try {
      const { fileId } = req.params;
      const ownerHealthId = req.user?.healthId;

      if (!ownerHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Check if file exists and belongs to user
      const fileUpload = await prisma.fileUpload.findFirst({
        where: {
          id: fileId,
          ownerHealthId
        }
      });

      if (!fileUpload) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Delete file record (cascade will delete FileAccess records)
      await prisma.fileUpload.delete({
        where: { id: fileId }
      });

      // Log file deletion
      await AuditService.logAction({
        actorId: ownerHealthId,
        actorRole: req.user?.role || 'unknown',
        action: 'FILE_DELETED',
        resourceType: 'FileUpload',
        resourceId: fileId,
        patientHealthId: ownerHealthId,
        metadata: {
          filename: fileUpload.originalName,
          mimeType: fileUpload.mimeType,
          fileSize: fileUpload.fileSize
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      logger.info('File deleted successfully', {
        fileId,
        ownerHealthId,
        filename: fileUpload.originalName
      });

      res.json({
        success: true,
        message: 'File deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting file:', error);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  }

  /**
   * Get File Metadata
   * GET /api/uploads/file/:fileId/metadata
   * Returns file metadata without file data
   */
  static async getFileMetadata(req: AuthenticatedRequest, res: Response) {
    try {
      const { fileId } = req.params;
      const ownerHealthId = req.user?.healthId;

      if (!ownerHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const fileUpload = await prisma.fileUpload.findFirst({
        where: {
          id: fileId,
          ownerHealthId
        },
        select: {
          id: true,
          filename: true,
          originalName: true,
          mimeType: true,
          fileSize: true,
          checksum: true,
          description: true,
          tags: true,
          uploadedAt: true,
          createdAt: true,
          updatedAt: true,
          recordId: true,
          status: true
        }
      });

      if (!fileUpload) {
        return res.status(404).json({ error: 'File not found' });
      }

      res.json({
        success: true,
        data: fileUpload
      });

    } catch (error) {
      logger.error('Error fetching file metadata:', error);
      res.status(500).json({ error: 'Failed to fetch file metadata' });
    }
  }

  /**
   * Get File Access History
   * GET /api/uploads/file/:fileId/access-history
   * Returns access history for a file
   */
  static async getFileAccessHistory(req: AuthenticatedRequest, res: Response) {
    try {
      const { fileId } = req.params;
      const ownerHealthId = req.user?.healthId;

      if (!ownerHealthId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Verify file ownership
      const fileUpload = await prisma.fileUpload.findFirst({
        where: {
          id: fileId,
          ownerHealthId
        }
      });

      if (!fileUpload) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Get access history
      const accessHistory = await prisma.fileAccess.findMany({
        where: { fileId },
        include: {
          accessor: {
            select: {
              healthId: true,
              role: true,
              healthProfile: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        },
        orderBy: { accessedAt: 'desc' },
        take: 100
      });

      res.json({
        success: true,
        data: accessHistory
      });

    } catch (error) {
      logger.error('Error fetching file access history:', error);
      res.status(500).json({ error: 'Failed to fetch access history' });
    }
  }
}

export default UploadsController;
