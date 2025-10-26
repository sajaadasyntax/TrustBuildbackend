import { Router, Response } from 'express';
import { PrismaClient, DisputeStatus, DisputeResolution } from '@prisma/client';
import { protectAdmin, requirePermission, AdminAuthRequest } from '../middleware/adminAuth';
import { AdminPermission } from '../config/permissions';
import { disputeService } from '../services/disputeService';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
const prisma = new PrismaClient();

// Configure multer for file uploads to disk
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'disputes');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'admin-dispute-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images and documents
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only images and documents are allowed'));
    }
  }
});

// Middleware to check dispute permissions
const requireDisputeRead = [protectAdmin, requirePermission(AdminPermission.DISPUTES_READ)];
const requireDisputeWrite = [protectAdmin, requirePermission(AdminPermission.DISPUTES_WRITE)];
const requireDisputeResolve = [protectAdmin, requirePermission(AdminPermission.DISPUTES_RESOLVE)];

/**
 * Get all disputes with filters
 * GET /api/admin/disputes
 */
router.get('/', requireDisputeRead, async (req: AdminAuthRequest, res: Response) => {
  try {
    const { status, type, priority, search } = req.query;

    const disputes = await disputeService.getDisputesForAdmin({
      status: status as DisputeStatus | undefined,
      type: type as any,
      priority: priority as string | undefined,
      search: search as string | undefined,
    });

    res.json(disputes);
  } catch (error: any) {
    console.error('Error fetching disputes:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch disputes' });
  }
});

/**
 * Get dispute statistics
 * GET /api/admin/disputes/stats
 */
router.get('/stats', requireDisputeRead, async (req: AdminAuthRequest, res: Response) => {
  try {
    const stats = await disputeService.getDisputeStats();
    res.json(stats);
  } catch (error: any) {
    console.error('Error fetching dispute stats:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch dispute stats' });
  }
});

/**
 * Get a single dispute with full details
 * GET /api/admin/disputes/:id
 */
router.get('/:id', requireDisputeRead, async (req: AdminAuthRequest, res: Response) => {
  try {
    const disputeId = req.params.id;

    const dispute = await disputeService.getDisputeDetails(disputeId);
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    res.json(dispute);
  } catch (error: any) {
    console.error('Error fetching dispute:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch dispute' });
  }
});

/**
 * Update dispute status
 * PATCH /api/admin/disputes/:id/status
 */
router.patch('/:id/status', requireDisputeWrite, async (req: AdminAuthRequest, res: Response) => {
  try {
    const disputeId = req.params.id;
    const { status } = req.body;

    if (!status || !Object.values(DisputeStatus).includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const dispute = await disputeService.updateDisputeStatus(disputeId, status);

    // Log admin action
    await prisma.activityLog.create({
      data: {
        adminId: req.admin!.id,
        action: 'DISPUTE_STATUS_UPDATE',
        entityType: 'Dispute',
        entityId: disputeId,
        description: `Updated dispute status to ${status}`,
        diff: {
          status: { old: dispute.status, new: status },
        },
      },
    });

    res.json(dispute);
  } catch (error: any) {
    console.error('Error updating dispute status:', error);
    res.status(500).json({ error: error.message || 'Failed to update dispute status' });
  }
});

/**
 * Update dispute priority
 * PATCH /api/admin/disputes/:id/priority
 */
router.patch('/:id/priority', requireDisputeWrite, async (req: AdminAuthRequest, res: Response) => {
  try {
    const disputeId = req.params.id;
    const { priority } = req.body;

    if (!priority || !['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority' });
    }

    const dispute = await prisma.dispute.update({
      where: { id: disputeId },
      data: { priority },
    });

    // Log admin action
    await prisma.activityLog.create({
      data: {
        adminId: req.admin!.id,
        action: 'DISPUTE_PRIORITY_UPDATE',
        entityType: 'Dispute',
        entityId: disputeId,
        description: `Updated dispute priority to ${priority}`,
      },
    });

    res.json(dispute);
  } catch (error: any) {
    console.error('Error updating dispute priority:', error);
    res.status(500).json({ error: error.message || 'Failed to update dispute priority' });
  }
});

/**
 * Add admin response/note to dispute
 * POST /api/admin/disputes/:id/responses
 */
router.post('/:id/responses', requireDisputeWrite, upload.array('attachments', 5), async (req: AdminAuthRequest, res: Response) => {
  try {
    const disputeId = req.params.id;
    const { message, isInternal } = req.body;
    const adminId = req.admin!.id;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get uploaded file URLs from local storage
    const attachments: string[] = [];
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        // Files are already saved to disk by multer
        const fileUrl = `/uploads/disputes/${file.filename}`;
        attachments.push(fileUrl);
      }
    }

    const response = await disputeService.addResponse({
      disputeId,
      userId: adminId,
      userRole: 'ADMIN' as any,
      message,
      attachments,
      isInternal: isInternal === 'true' || isInternal === true,
    });

    // Log admin action
    await prisma.activityLog.create({
      data: {
        adminId,
        action: 'DISPUTE_RESPONSE_ADDED',
        entityType: 'Dispute',
        entityId: disputeId,
        description: `Added ${isInternal ? 'internal' : 'public'} response to dispute`,
      },
    });

    res.status(201).json(response);
  } catch (error: any) {
    console.error('Error adding response:', error);
    res.status(500).json({ error: error.message || 'Failed to add response' });
  }
});

/**
 * Resolve a dispute
 * POST /api/admin/disputes/:id/resolve
 */
router.post('/:id/resolve', requireDisputeResolve, async (req: AdminAuthRequest, res: Response) => {
  try {
    const disputeId = req.params.id;
    const adminId = req.admin!.id;
    const {
      resolution,
      resolutionNotes,
      refundCredits,
      creditAmount,
      adjustCommission,
      commissionAmount,
      completeJob,
    } = req.body;

    // Validate resolution
    if (!resolution || !Object.values(DisputeResolution).includes(resolution)) {
      return res.status(400).json({ error: 'Invalid resolution' });
    }

    if (!resolutionNotes) {
      return res.status(400).json({ error: 'Resolution notes are required' });
    }

    // Resolve dispute
    const dispute = await disputeService.resolveDispute({
      disputeId,
      adminId,
      resolution,
      resolutionNotes,
      refundCredits: refundCredits === true,
      creditAmount: creditAmount ? parseInt(creditAmount) : undefined,
      adjustCommission: adjustCommission === true,
      commissionAmount: commissionAmount ? parseFloat(commissionAmount) : undefined,
      completeJob: completeJob === true,
    });

    // Log admin action
    await prisma.activityLog.create({
      data: {
        adminId,
        action: 'DISPUTE_RESOLVED',
        entityType: 'Dispute',
        entityId: disputeId,
        description: `Resolved dispute with resolution: ${resolution}`,
        diff: {
          resolution,
          refundCredits,
          creditAmount,
          adjustCommission,
          commissionAmount,
          completeJob,
        },
      },
    });

    res.json(dispute);
  } catch (error: any) {
    console.error('Error resolving dispute:', error);
    res.status(500).json({ error: error.message || 'Failed to resolve dispute' });
  }
});

/**
 * Update admin notes on a dispute
 * PATCH /api/admin/disputes/:id/notes
 */
router.patch('/:id/notes', requireDisputeWrite, async (req: AdminAuthRequest, res: Response) => {
  try {
    const disputeId = req.params.id;
    const { adminNotes } = req.body;

    const dispute = await prisma.dispute.update({
      where: { id: disputeId },
      data: { adminNotes },
    });

    // Log admin action
    await prisma.activityLog.create({
      data: {
        adminId: req.admin!.id,
        action: 'DISPUTE_NOTES_UPDATE',
        entityType: 'Dispute',
        entityId: disputeId,
        description: 'Updated admin notes on dispute',
      },
    });

    res.json(dispute);
  } catch (error: any) {
    console.error('Error updating admin notes:', error);
    res.status(500).json({ error: error.message || 'Failed to update admin notes' });
  }
});

/**
 * Close a dispute without resolution
 * POST /api/admin/disputes/:id/close
 */
router.post('/:id/close', requireDisputeWrite, async (req: AdminAuthRequest, res: Response) => {
  try {
    const disputeId = req.params.id;
    const { reason } = req.body;

    const dispute = await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.CLOSED,
        resolutionNotes: reason,
      },
    });

    // Update job status back to previous state
    await prisma.job.update({
      where: { id: dispute.jobId },
      data: {
        status: 'IN_PROGRESS' as any,
      },
    });

    // Log admin action
    await prisma.activityLog.create({
      data: {
        adminId: req.admin!.id,
        action: 'DISPUTE_CLOSED',
        entityType: 'Dispute',
        entityId: disputeId,
        description: `Closed dispute: ${reason}`,
      },
    });

    res.json(dispute);
  } catch (error: any) {
    console.error('Error closing dispute:', error);
    res.status(500).json({ error: error.message || 'Failed to close dispute' });
  }
});

export default router;

