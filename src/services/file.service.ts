import prisma from '../utils/prisma';
import logger from '../utils/logger';
import crypto from 'crypto';

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
  warnings?: string[];
}

export class FileService {
  private static readonly MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  private static readonly ALLOWED_MIME_TYPES = [
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
    // Medical imaging
    'application/dicom',
    'image/tiff'
  ];

  /**
   * Validate file before upload
   */
  static validateFile(filename: string, mimeType: string, fileSize: number): FileValidationResult {
    const warnings: string[] = [];

    // Check file size
    if (fileSize > this.MAX_FILE_SIZE) {
      return {
        isValid: false,
        error: `File size ${(fileSize / 1024 / 1024).toFixed(2)}MB exceeds maximum allowed size of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`
      };
    }

    // Check MIME type
    if (!this.ALLOWED_MIME_TYPES.includes(mimeType)) {
      return {
        isValid: false,
        error: `File type '${mimeType}' is not allowed. Allowed types: ${this.ALLOWED_MIME_TYPES.join(', ')}`
      };
    }

    // Check filename for security
    const sanitizedFilename = this.sanitizeFilename(filename);
    if (sanitizedFilename !== filename) {
      warnings.push(`Filename was sanitized from '${filename}' to '${sanitizedFilename}'`);
    }

    // Warn about large files
    if (fileSize > 10 * 1024 * 1024) { // 10MB
      warnings.push(`Large file detected (${(fileSize / 1024 / 1024).toFixed(2)}MB). Upload may take longer.`);
    }

    // Warn about potentially risky file types
    const riskyTypes = ['application/msword', 'application/vnd.ms-excel'];
    if (riskyTypes.includes(mimeType)) {
      warnings.push('Office documents may contain macros. Please ensure they are from trusted sources.');
    }

    return {
      isValid: true,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Sanitize filename for security
   */
  static sanitizeFilename(filename: string): string {
    // Remove path separators and other dangerous characters
    return filename
      .replace(/[<>:"/\\|?*]/g, '_') // Replace dangerous characters
      .replace(/\.\./g, '_') // Replace double dots
      .replace(/^\.+/, '') // Remove leading dots
      .trim()
      .substring(0, 255); // Limit length
  }

  /**
   * Clean up expired uploads
   * Should be called periodically by a cron job
   */
  static async cleanupExpiredUploads(): Promise<void> {
    try {
      logger.info('Starting cleanup of expired uploads');

      // Find uploads that are still in UPLOADING status and older than 1 hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      const expiredUploads = await prisma.fileUpload.findMany({
        where: {
          status: 'UPLOADING',
          createdAt: {
            lt: oneHourAgo
          }
        }
      });

      let cleanedCount = 0;

      for (const upload of expiredUploads) {
        try {
          // Update status to expired (file data stored in database as base64)
          await prisma.fileUpload.update({
            where: { id: upload.id },
            data: { status: 'EXPIRED' }
          });

          cleanedCount++;
        } catch (error) {
          logger.error('Error cleaning up upload', { uploadId: upload.id, error });
        }
      }

      logger.info('Upload cleanup completed', { cleanedCount });
    } catch (error) {
      logger.error('Error during upload cleanup', { error });
    }
  }

  /**
   * Clean up deleted files
   * Remove files marked as DELETED from storage
   */
  static async cleanupDeletedFiles(): Promise<void> {
    try {
      logger.info('Starting cleanup of deleted files');

      const deletedFiles = await prisma.fileUpload.findMany({
        where: {
          status: 'DELETED'
        }
      });

      let cleanedCount = 0;

      for (const file of deletedFiles) {
        try {
          // File data is stored in database as base64, no filesystem cleanup needed
          cleanedCount++;
        } catch (error) {
          logger.error('Error processing deleted file', { fileId: file.id, error });
        }
      }

      logger.info('Deleted file cleanup completed', { cleanedCount });
    } catch (error) {
      logger.error('Error during deleted file cleanup', { error });
    }
  }

  /**
   * Get storage statistics
   */
  static async getStorageStats(): Promise<any> {
    try {
      const stats = await prisma.fileUpload.groupBy({
        by: ['status'],
        _count: {
          id: true
        },
        _sum: {
          fileSize: true
        }
      });

      const totalFiles = await prisma.fileUpload.count();
      const totalSize = await prisma.fileUpload.aggregate({
        _sum: {
          fileSize: true
        }
      });

      return {
        totalFiles,
        totalSize: totalSize._sum.fileSize || 0,
        byStatus: stats.reduce((acc, stat) => {
          acc[stat.status] = {
            count: stat._count.id,
            size: stat._sum.fileSize || 0
          };
          return acc;
        }, {} as any)
      };
    } catch (error) {
      console.error('Error getting storage stats:', error);
      return null;
    }
  }

  /**
   * Check if file type is viewable in browser
   */
  static isViewableInBrowser(mimeType: string): boolean {
    const viewableTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'text/plain',
      'text/csv'
    ];

    return viewableTypes.includes(mimeType);
  }

  /**
   * Get file type category
   */
  static getFileCategory(mimeType: string): string {
    if (mimeType.startsWith('image/')) {
      return 'image';
    } else if (mimeType === 'application/pdf') {
      return 'pdf';
    } else if (mimeType.includes('word') || mimeType.includes('document')) {
      return 'document';
    } else if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
      return 'spreadsheet';
    } else if (mimeType.startsWith('text/')) {
      return 'text';
    } else if (mimeType === 'application/dicom') {
      return 'medical-imaging';
    } else {
      return 'other';
    }
  }

  /**
   * Generate file thumbnail (placeholder for future implementation)
   */
  static async generateThumbnail(fileData: string, mimeType: string): Promise<string | null> {
    // This would integrate with image processing libraries like Sharp
    // For now, return null (no thumbnail)
    return null;
  }

  /**
   * Calculate checksum from base64 data
   */
  static calculateChecksumFromBase64(base64Data: string): string {
    const buffer = Buffer.from(base64Data, 'base64');
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}

export default FileService;