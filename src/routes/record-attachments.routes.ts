import express from 'express';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middlewares/authMiddleware';

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
 * Get attachments for a specific record
 * GET /api/records/:recordId/attachments
 */
router.get('/:recordId/attachments', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { recordId } = req.params;
    const userId = req.user?.healthId;
    const userRole = req.user?.role;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get files associated with the record
    const attachments = await prisma.fileUpload.findMany({
      where: {
        recordId,
        status: 'COMPLETED'
      },
      include: {
        owner: {
          select: {
            healthId: true,
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
        uploadedAt: 'desc'
      }
    });

    // Filter attachments based on access permissions
    const accessibleAttachments = [];

    for (const attachment of attachments) {
      // Owner can always see their files
      if (attachment.ownerHealthId === userId) {
        accessibleAttachments.push(attachment);
        continue;
      }

      // Admin can see all files
      if (userRole === 'admin') {
        accessibleAttachments.push(attachment);
        continue;
      }

      // Healthcare providers need consent to access patient files
      if (userRole === 'doctor') {
        const consent = await prisma.consent.findFirst({
          where: {
            patientId: attachment.ownerHealthId,
            providerId: userId,
            status: 'ACTIVE',
            expiresAt: {
              gt: new Date()
            }
          }
        });

        if (consent) {
          accessibleAttachments.push(attachment);
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        recordId,
        attachments: accessibleAttachments.map(att => ({
          id: att.id,
          filename: att.originalName,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
          description: att.description,
          tags: att.tags,
          uploadedAt: att.uploadedAt,
          uploader: {
            healthId: att.owner.healthId,
            name: att.owner.healthProfile ? 
              `${att.owner.healthProfile.firstName} ${att.owner.healthProfile.lastName}` : 
              'Unknown'
          },
          isViewable: isViewableInBrowser(att.mimeType),
          category: getFileCategory(att.mimeType)
        })),
        count: accessibleAttachments.length
      }
    });

  } catch (error) {
    console.error('Error getting record attachments:', error);
    res.status(500).json({ error: 'Failed to get record attachments' });
  }
});

/**
 * Add attachment to record
 * POST /api/records/:recordId/attachments
 */
router.post('/:recordId/attachments', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { recordId } = req.params;
    const { fileId, description } = req.body;
    const userId = req.user?.healthId;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!fileId) {
      return res.status(400).json({ error: 'File ID required' });
    }

    // Verify file ownership
    const fileUpload = await prisma.fileUpload.findFirst({
      where: {
        id: fileId,
        ownerHealthId: userId,
        status: 'COMPLETED'
      }
    });

    if (!fileUpload) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    // Update file to link it to the record
    const updatedFile = await prisma.fileUpload.update({
      where: { id: fileId },
      data: {
        recordId,
        description: description || fileUpload.description
      }
    });

    res.status(200).json({
      success: true,
      data: {
        fileId: updatedFile.id,
        recordId: updatedFile.recordId,
        description: updatedFile.description
      },
      message: 'File attached to record successfully'
    });

  } catch (error) {
    console.error('Error attaching file to record:', error);
    res.status(500).json({ error: 'Failed to attach file to record' });
  }
});

/**
 * Remove attachment from record
 * DELETE /api/records/:recordId/attachments/:fileId
 */
router.delete('/:recordId/attachments/:fileId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { recordId, fileId } = req.params;
    const userId = req.user?.healthId;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify file ownership and record association
    const fileUpload = await prisma.fileUpload.findFirst({
      where: {
        id: fileId,
        ownerHealthId: userId,
        recordId,
        status: 'COMPLETED'
      }
    });

    if (!fileUpload) {
      return res.status(404).json({ error: 'File not found or not attached to this record' });
    }

    // Remove record association (but keep the file)
    await prisma.fileUpload.update({
      where: { id: fileId },
      data: {
        recordId: null
      }
    });

    res.status(200).json({
      success: true,
      message: 'File detached from record successfully'
    });

  } catch (error) {
    console.error('Error detaching file from record:', error);
    res.status(500).json({ error: 'Failed to detach file from record' });
  }
});

// Helper methods (would typically be in a service class)
function isViewableInBrowser(mimeType: string): boolean {
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

function getFileCategory(mimeType: string): string {
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

export default router;