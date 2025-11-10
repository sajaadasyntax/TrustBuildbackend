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

export default router;

