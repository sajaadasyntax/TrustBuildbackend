import express, { Response } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import {
  protectAdmin,
  requirePermission,
  getClientIp,
  getClientUserAgent,
  AdminAuthRequest,
} from '../middleware/adminAuth';
import { logActivity } from '../services/auditService';
import { prisma } from '../config/database';
import { processCommissionForJob } from '../services/commissionService';

const router = express.Router();

// Update job value before commission calculation
router.patch(
  '/:jobId/value',
  protectAdmin,
  requirePermission('jobs:update_value'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { jobId } = req.params;
    const { value, reason } = req.body;

    if (!value || value <= 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid job value is required',
      });
    }

    // Get current job
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        commissionPayment: true,
      },
    });

    if (!job) {
      return res.status(404).json({
        status: 'error',
        message: 'Job not found',
      });
    }

    const oldValue = job.finalAmount || job.contractorProposedAmount || job.budget;

    // Update job value
    await prisma.job.update({
      where: { id: jobId },
      data: {
        finalAmount: value,
      },
    });

    // If commission already exists, recalculate it
    if (job.commissionPayment) {
      const { getCommissionRate } = await import('../services/settingsService');
      const rate = await getCommissionRate();
      const commissionAmount = (value * rate) / 100;
      const vatAmount = 0; // No additional VAT - commission amount already includes VAT
      const totalAmount = commissionAmount;

      await prisma.commissionPayment.update({
        where: { id: job.commissionPayment.id },
        data: {
          finalJobAmount: value,
          commissionAmount,
          vatAmount,
          totalAmount,
        },
      });
    }

    await logActivity({
      adminId: req.admin!.id,
      action: 'JOB_VALUE_ADJUST',
      entityType: 'Job',
      entityId: jobId,
      description: reason || 'Job value adjusted by admin',
      diff: {
        before: oldValue,
        after: value,
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Job value updated successfully',
      data: {
        oldValue,
        newValue: value,
      },
    });
  })
);

// Cancel job
router.post(
  '/:jobId/cancel',
  protectAdmin,
  requirePermission('jobs:cancel'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { jobId } = req.params;
    const { reason } = req.body;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return res.status(404).json({
        status: 'error',
        message: 'Job not found',
      });
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'CANCELLED',
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'JOB_CANCEL',
      entityType: 'Job',
      entityId: jobId,
      description: reason || 'Job cancelled by admin',
      diff: {
        previousStatus: job.status,
        newStatus: 'CANCELLED',
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Job cancelled successfully',
    });
  })
);

// Reassign job to different contractor
router.post(
  '/:jobId/reassign',
  protectAdmin,
  requirePermission('jobs:reassign'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { jobId } = req.params;
    const { contractorId, reason } = req.body;

    if (!contractorId) {
      return res.status(400).json({
        status: 'error',
        message: 'Contractor ID is required',
      });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return res.status(404).json({
        status: 'error',
        message: 'Job not found',
      });
    }

    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
    });

    if (!contractor) {
      return res.status(404).json({
        status: 'error',
        message: 'Contractor not found',
      });
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        wonByContractorId: contractorId,
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'JOB_REASSIGN',
      entityType: 'Job',
      entityId: jobId,
      description: reason || 'Job reassigned by admin',
      diff: {
        previousContractor: job.wonByContractorId,
        newContractor: contractorId,
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Job reassigned successfully',
    });
  })
);

// Freeze contractor account
router.post(
  '/contractors/:contractorId/freeze',
  protectAdmin,
  requirePermission('contractors:freeze'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { contractorId } = req.params;
    const { reason } = req.body;

    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
      include: { user: true },
    });

    if (!contractor) {
      return res.status(404).json({
        status: 'error',
        message: 'Contractor not found',
      });
    }

    await prisma.contractor.update({
      where: { id: contractorId },
      data: {
        accountStatus: 'FROZEN',
        frozenAt: new Date(),
        frozenBy: req.admin!.id,
        frozenReason: reason,
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'CONTRACTOR_FREEZE',
      entityType: 'Contractor',
      entityId: contractorId,
      description: `Contractor account frozen: ${contractor.user.email}`,
      diff: { reason },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Contractor account frozen successfully',
    });
  })
);

// Unfreeze contractor account
router.post(
  '/contractors/:contractorId/unfreeze',
  protectAdmin,
  requirePermission('contractors:unfreeze'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { contractorId } = req.params;

    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
      include: { user: true },
    });

    if (!contractor) {
      return res.status(404).json({
        status: 'error',
        message: 'Contractor not found',
      });
    }

    await prisma.contractor.update({
      where: { id: contractorId },
      data: {
        accountStatus: 'ACTIVE',
        frozenAt: null,
        frozenBy: null,
        frozenReason: null,
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'CONTRACTOR_UNFREEZE',
      entityType: 'Contractor',
      entityId: contractorId,
      description: `Contractor account unfrozen: ${contractor.user.email}`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Contractor account unfrozen successfully',
    });
  })
);

// Update contractor limits
router.patch(
  '/contractors/:contractorId/limits',
  protectAdmin,
  requirePermission('contractors:update_limits'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { contractorId } = req.params;
    const { freeJobAllocation, weeklyCreditsLimit } = req.body;

    const updateData: any = {};
    if (freeJobAllocation !== undefined) updateData.freeJobAllocation = freeJobAllocation;
    if (weeklyCreditsLimit !== undefined) updateData.weeklyCreditsLimit = weeklyCreditsLimit;

    const contractor = await prisma.contractor.update({
      where: { id: contractorId },
      data: updateData,
      include: { user: true },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'CONTRACTOR_LIMITS_UPDATE',
      entityType: 'Contractor',
      entityId: contractorId,
      description: `Updated limits for contractor: ${contractor.user.email}`,
      diff: updateData,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Contractor limits updated successfully',
      data: { contractor },
    });
  })
);

// Admin override: Approve contractor winner
router.patch(
  '/:jobId/approve-winner',
  protectAdmin,
  requirePermission('jobs:write'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { jobId } = req.params;
    const { contractorId, reason } = req.body;

    if (!contractorId) {
      return res.status(400).json({
        status: 'error',
        message: 'Contractor ID is required',
      });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        applications: {
          where: {
            contractorId: contractorId,
          },
          include: {
            contractor: {
              include: {
                user: true,
              },
            },
          },
        },
        customer: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!job) {
      return res.status(404).json({
        status: 'error',
        message: 'Job not found',
      });
    }

    if (job.applications.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Contractor has not applied for this job',
      });
    }

    const contractor = job.applications[0].contractor;

    // Update job: set winner, change status to IN_PROGRESS
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'IN_PROGRESS',
        wonByContractorId: contractorId,
        wonAt: new Date(),
        startDate: new Date(),
      },
      include: {
        wonByContractor: {
          include: {
            user: true,
          },
        },
      },
    });

    // Send notification to contractor
    const { createNotification } = await import('../services/notificationService');
      await createNotification({
        userId: contractor.userId,
        title: 'You Won the Job! (Admin Approved)',
        message: `An admin has approved you as the winner for the job: ${job.title}. You can now start working.`,
        type: 'JOB_STARTED',
        actionLink: `/dashboard/contractor/jobs/${jobId}`,
        actionText: 'View Job',
      });

    await logActivity({
      adminId: req.admin!.id,
      action: 'JOB_WINNER_APPROVED',
      entityType: 'Job',
      entityId: jobId,
      description: reason || 'Contractor approved as winner by admin',
      diff: {
        contractorId,
        previousStatus: job.status,
        newStatus: 'IN_PROGRESS',
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Contractor approved as winner successfully',
      data: {
        job: updatedJob,
      },
    });
  })
);

// Admin override: Lock/unlock job
router.patch(
  '/:jobId/lock',
  protectAdmin,
  requirePermission('jobs:write'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { jobId } = req.params;
    const { locked, reason } = req.body;

    if (typeof locked !== 'boolean') {
      return res.status(400).json({
        status: 'error',
        message: 'Locked status (boolean) is required',
      });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return res.status(404).json({
        status: 'error',
        message: 'Job not found',
      });
    }

    // For now, we'll use the isFlagged field to represent locked status
    // In production, you might want to add a dedicated isLocked field
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        isFlagged: locked,
        flaggedAt: locked ? new Date() : null,
        flaggedBy: locked ? req.admin!.id : null,
        flagReason: locked ? (reason || 'Job locked by admin') : null,
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: locked ? 'JOB_LOCKED' : 'JOB_UNLOCKED',
      entityType: 'Job',
      entityId: jobId,
      description: reason || (locked ? 'Job locked by admin' : 'Job unlocked by admin'),
      diff: {
        locked,
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: locked ? 'Job locked successfully' : 'Job unlocked successfully',
      data: {
        job: updatedJob,
      },
    });
  })
);

// Admin override: Mark job as completed
router.patch(
  '/:jobId/mark-completed',
  protectAdmin,
  requirePermission('jobs:write'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { jobId } = req.params;
    const { finalAmount, reason } = req.body;

    if (!finalAmount || finalAmount <= 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Final amount is required and must be greater than 0',
      });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        wonByContractor: {
          include: {
            user: true,
          },
        },
        customer: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!job) {
      return res.status(404).json({
        status: 'error',
        message: 'Job not found',
      });
    }

    // Update job to completed
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        finalAmount: finalAmount,
        completionDate: new Date(),
        customerConfirmed: true,
        adminOverrideAt: new Date(),
        adminOverrideBy: req.admin!.id,
      },
    });

    // Process commission if needed
    if (job.wonByContractorId && !job.commissionPaid && finalAmount) {
      try {
        await processCommissionForJob(jobId, Number(finalAmount));
      } catch (error) {
        console.error('Failed to process commission:', error);
        // Continue even if commission processing fails
      }
    }

    // Send notification to contractor
    if (job.wonByContractor) {
      const { createNotification } = await import('../services/notificationService');
      await createNotification({
        userId: job.wonByContractor.userId,
        title: 'Job Completed (Admin Override)',
        message: `An admin has marked the job "${job.title}" as completed with final amount £${finalAmount}.`,
        type: 'JOB_COMPLETED',
        actionLink: `/dashboard/contractor/jobs/${jobId}`,
        actionText: 'View Job',
      });
    }

    await logActivity({
      adminId: req.admin!.id,
      action: 'JOB_MARKED_COMPLETED',
      entityType: 'Job',
      entityId: jobId,
      description: reason || 'Job marked as completed by admin',
      diff: {
        finalAmount,
        previousStatus: job.status,
        newStatus: 'COMPLETED',
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Job marked as completed successfully',
      data: {
        job: updatedJob,
      },
    });
  })
);

// Admin override: Allow contractor to request review
router.patch(
  '/:jobId/allow-review-request',
  protectAdmin,
  requirePermission('jobs:write'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { jobId } = req.params;
    const { reason } = req.body;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        wonByContractor: {
          include: {
            user: true,
          },
        },
        customer: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!job) {
      return res.status(404).json({
        status: 'error',
        message: 'Job not found',
      });
    }

    if (!job.wonByContractorId) {
      return res.status(400).json({
        status: 'error',
        message: 'No contractor assigned to this job',
      });
    }

    // Mark job as customer confirmed so contractor can request review
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        customerConfirmed: true,
        adminOverrideAt: new Date(),
        adminOverrideBy: req.admin!.id,
      },
    });

    // Send notification to contractor
    const { createNotification } = await import('../services/notificationService');
      await createNotification({
        userId: job.wonByContractor!.userId,
        title: 'You Can Now Request a Review',
        message: `An admin has enabled review requests for the job "${job.title}". You can now request a review from the customer.`,
        type: 'JOB_COMPLETED',
        actionLink: `/dashboard/contractor/jobs/${jobId}`,
        actionText: 'View Job',
      });

    await logActivity({
      adminId: req.admin!.id,
      action: 'REVIEW_REQUEST_ENABLED',
      entityType: 'Job',
      entityId: jobId,
      description: reason || 'Review request enabled by admin',
      diff: {
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Contractor can now request review',
      data: {
        job: updatedJob,
      },
    });
  })
);

export default router;

