import express from 'express';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middlewares/authMiddleware';
import FileService from '../services/file.service';

const router = express.Router();
const prisma = new PrismaClient();

interface AuthenticatedRequest extends Request {
  user?: {
    healthId: string;
    email: string | null;
    role: string;
    status: string;
    tokenId: string;
  };
}

/**
 * Get storage statistics (admin only)
 * GET /api/admin/files/stats
 */
router.get('/stats', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const stats = await FileService.getStorageStats();

    res.status(200).json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Error getting storage stats:', error);
    res.status(500).json({ error: 'Failed to get storage statistics' });
  }
});

/**
 * List all files (admin only)
 * GET /api/admin/files
 */
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    const { 
      status, 
      mimeType, 
      ownerHealthId, 
      limit = 50, 
      page = 1,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const skip = (Number(page) - 1) * Number(limit);

    const files = await prisma.fileUpload.findMany({
      where: {
        ...(status && { status: status as any }),
        ...(mimeType && { mimeType: { contains: mimeType as string } }),
        ...(ownerHealthId && { ownerHealthId: ownerHealthId as string })
      },
      include: {
        owner: {
          select: {
            healthId: true,
            email: true,
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
      orderBy: {
        [sortBy as string]: sortOrder as 'asc' | 'desc'
      },
      skip,
      take: Number(limit)
    });

    const totalCount = await prisma.fileUpload.count({
      where: {
        ...(status && { status: status as any }),
        ...(mimeType && { mimeType: { contains: mimeType as string } }),
        ...(ownerHealthId && { ownerHealthId: ownerHealthId as string })
      }
    });

    res.status(200).json({
      success: true,
      data: {
        files: files.map(file => ({
          id: file.id,
          filename: file.originalName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          status: file.status,
          description: file.description,
          uploadedAt: file.uploadedAt,
          createdAt: file.createdAt,
          owner: {
            healthId: file.owner.healthId,
            email: file.owner.email,
            role: file.owner.role,
            name: file.owner.healthProfile ? 
              `${file.owner.healthProfile.firstName} ${file.owner.healthProfile.lastName}` : 
              'Unknown'
          },
          recordId: file.recordId,
          tags: file.tags
        })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / Number(limit))
        }
      }
    });

  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

/**
 * Run cleanup tasks (admin only)
 * POST /api/admin/files/cleanup
 */
router.post('/cleanup', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    const { type = 'expired' } = req.body;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (type === 'expired') {
      await FileService.cleanupExpiredUploads();
    } else if (type === 'deleted') {
      await FileService.cleanupDeletedFiles();
    } else if (type === 'all') {
      await FileService.cleanupExpiredUploads();
      await FileService.cleanupDeletedFiles();
    } else {
      return res.status(400).json({ error: 'Invalid cleanup type. Use: expired, deleted, or all' });
    }

    res.status(200).json({
      success: true,
      message: 'Cleanup completed successfully'
    });

  } catch (error) {
    console.error('Error running cleanup:', error);
    res.status(500).json({ error: 'Failed to run cleanup' });
  }
});

/**
 * Delete file (admin only)
 * DELETE /api/admin/files/:fileId
 */
router.delete('/:fileId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    const { fileId } = req.params;
    const { permanent = false } = req.body;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const fileUpload = await prisma.fileUpload.findUnique({
      where: { id: fileId }
    });

    if (!fileUpload) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (permanent) {
      // Permanently delete from database and storage
      if (fileUpload.storageKey && require('fs').existsSync(fileUpload.storageKey)) {
        require('fs').unlinkSync(fileUpload.storageKey);
      }

      await prisma.fileUpload.delete({
        where: { id: fileId }
      });
    } else {
      // Soft delete (mark as deleted)
      await prisma.fileUpload.update({
        where: { id: fileId },
        data: { status: 'DELETED' }
      });
    }

    res.status(200).json({
      success: true,
      message: permanent ? 'File permanently deleted' : 'File marked as deleted'
    });

  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;