import { Router } from 'express';
import { PrismaClient, DisputeType, UserRole } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';
import { disputeService } from '../services/disputeService';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';

const router = Router();
const prisma = new PrismaClient();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

/**
 * Create a new dispute
 * POST /api/disputes
 */
router.post('/', authenticateToken, upload.array('evidence', 10), async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { jobId, type, title, description, priority } = req.body;

    // Validate required fields
    if (!jobId || !type || !title || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify user has access to this job
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        customer: true,
        contractor: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        customer: true,
        wonByContractor: true,
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Check if user is involved in this job
    const isCustomer = user.customer && job.customerId === user.customer.id;
    const isContractor = user.contractor && job.wonByContractorId === user.contractor.id;

    if (!isCustomer && !isContractor) {
      return res.status(403).json({ error: 'You are not involved in this job' });
    }

    // Upload evidence files to Cloudinary
    const evidenceUrls: string[] = [];
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        const result = await new Promise<any>((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'disputes',
              resource_type: 'auto',
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          uploadStream.end(file.buffer);
        });

        evidenceUrls.push(result.secure_url);
      }
    }

    // Create dispute
    const dispute = await disputeService.createDispute({
      jobId,
      raisedByUserId: userId,
      raisedByRole: isCustomer ? UserRole.CUSTOMER : UserRole.CONTRACTOR,
      type: type as DisputeType,
      title,
      description,
      evidenceUrls,
      priority: priority || 'MEDIUM',
    });

    res.status(201).json(dispute);
  } catch (error: any) {
    console.error('Error creating dispute:', error);
    res.status(500).json({ error: error.message || 'Failed to create dispute' });
  }
});

/**
 * Get all disputes for the current user
 * GET /api/disputes
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const disputes = await disputeService.getDisputesForUser(userId);
    res.json(disputes);
  } catch (error: any) {
    console.error('Error fetching disputes:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch disputes' });
  }
});

/**
 * Get a single dispute
 * GET /api/disputes/:id
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const disputeId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const dispute = await disputeService.getDisputeDetails(disputeId);
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    // Verify user has access to this dispute
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        customer: true,
        contractor: true,
      },
    });

    const isCustomer = user?.customer && dispute.job.customerId === user.customer.id;
    const isContractor = user?.contractor && dispute.job.wonByContractorId === user.contractor.id;

    if (!isCustomer && !isContractor) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Filter out internal responses
    const filteredDispute = {
      ...dispute,
      responses: dispute.responses.filter(r => !r.isInternal),
    };

    res.json(filteredDispute);
  } catch (error: any) {
    console.error('Error fetching dispute:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch dispute' });
  }
});

/**
 * Add a response to a dispute
 * POST /api/disputes/:id/responses
 */
router.post('/:id/responses', authenticateToken, upload.array('attachments', 5), async (req, res) => {
  try {
    const userId = req.user?.userId;
    const disputeId = req.params.id;
    const { message } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Verify user has access to this dispute
    const dispute = await disputeService.getDisputeDetails(disputeId);
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        customer: true,
        contractor: true,
      },
    });

    const isCustomer = user?.customer && dispute.job.customerId === user.customer.id;
    const isContractor = user?.contractor && dispute.job.wonByContractorId === user.contractor.id;

    if (!isCustomer && !isContractor) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Upload attachments
    const attachments: string[] = [];
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        const result = await new Promise<any>((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'dispute-responses',
              resource_type: 'auto',
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          uploadStream.end(file.buffer);
        });

        attachments.push(result.secure_url);
      }
    }

    // Add response
    const response = await disputeService.addResponse({
      disputeId,
      userId,
      userRole: isCustomer ? UserRole.CUSTOMER : UserRole.CONTRACTOR,
      message,
      attachments,
    });

    res.status(201).json(response);
  } catch (error: any) {
    console.error('Error adding response:', error);
    res.status(500).json({ error: error.message || 'Failed to add response' });
  }
});

export default router;

