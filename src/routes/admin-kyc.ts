import express, { Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { catchAsync } from '../middleware/errorHandler';
import {
  protectAdmin,
  requirePermission,
  getClientIp,
  getClientUserAgent,
  AdminAuthRequest,
} from '../middleware/adminAuth';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { logActivity } from '../services/auditService';
import { prisma } from '../config/database';
import { createServiceEmail, createEmailService } from '../services/emailService';

const router = express.Router();

// Configure multer for KYC document uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const contractorId = (req as any).user?.contractor?.id || 'unknown';
    const uploadPath = path.join('uploads', 'kyc', contractorId);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = file.fieldname;
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  },
});

// File filter for KYC documents
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = /jpeg|jpg|png|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only .png, .jpg, .jpeg, and .pdf files are allowed!'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
});

// Contractor uploads KYC documents
router.post(
  '/upload',
  protect,
  upload.fields([
    { name: 'idDocument', maxCount: 1 },
    { name: 'utilityBill', maxCount: 1 },
  ]),
  catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyNumber } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    if (!files.idDocument || !files.utilityBill) {
      return res.status(400).json({
        status: 'error',
        message: 'Both ID document and utility bill are required',
      });
    }

    // Get contractor
    const contractor = await prisma.contractor.findUnique({
      where: { userId: req.user!.id },
    });

    if (!contractor) {
      return res.status(404).json({
        status: 'error',
        message: 'Contractor profile not found',
      });
    }

    // Get KYC deadline setting
    const kycSetting = await prisma.setting.findUnique({
      where: { key: 'KYC_DEADLINE_DAYS' },
    });

    const deadlineDays = (kycSetting?.value as any)?.days || 14;
    const dueBy = new Date();
    dueBy.setDate(dueBy.getDate() + deadlineDays);

    // Create or update KYC record
    const kyc = await prisma.contractorKyc.upsert({
      where: { contractorId: contractor.id },
      update: {
        idDocPath: files.idDocument[0].path,
        utilityDocPath: files.utilityBill[0].path,
        companyNumber,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        dueBy,
      },
      create: {
        contractorId: contractor.id,
        idDocPath: files.idDocument[0].path,
        utilityDocPath: files.utilityBill[0].path,
        companyNumber,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        dueBy,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'KYC documents uploaded successfully',
      data: {
        kyc: {
          id: kyc.id,
          status: kyc.status,
          submittedAt: kyc.submittedAt,
          dueBy: kyc.dueBy,
        },
      },
    });
  })
);

// Get KYC queue for admin review
router.get(
  '/queue',
  protectAdmin,
  requirePermission('kyc:read'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { status = 'SUBMITTED', page = '1', limit = '20' } = req.query;

    const where: any = {};
    if (status) where.status = status;

    const [kycRecords, total] = await Promise.all([
      prisma.contractorKyc.findMany({
        where,
        include: {
          contractor: {
            include: {
              user: {
                select: {
                  email: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: { submittedAt: 'asc' },
        take: parseInt(limit as string),
        skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      }),
      prisma.contractorKyc.count({ where }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        kycRecords,
        total,
        page: parseInt(page as string),
        totalPages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  })
);

// Get specific KYC record
router.get(
  '/:kycId',
  protectAdmin,
  requirePermission('kyc:read'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { kycId } = req.params;

    const kyc = await prisma.contractorKyc.findUnique({
      where: { id: kycId },
      include: {
        contractor: {
          include: {
            user: {
              select: {
                email: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!kyc) {
      return res.status(404).json({
        status: 'error',
        message: 'KYC record not found',
      });
    }

    res.status(200).json({
      status: 'success',
      data: { kyc },
    });
  })
);

// Approve KYC
router.post(
  '/:kycId/approve',
  protectAdmin,
  requirePermission('kyc:approve'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { kycId } = req.params;
    const { notes } = req.body;

    const kyc = await prisma.contractorKyc.findUnique({
      where: { id: kycId },
      include: {
        contractor: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!kyc) {
      return res.status(404).json({
        status: 'error',
        message: 'KYC record not found',
      });
    }

    await prisma.contractorKyc.update({
      where: { id: kycId },
      data: {
        status: 'APPROVED',
        reviewedBy: req.admin!.id,
        reviewedAt: new Date(),
        notes,
      },
    });

    // Update contractor status
    await prisma.contractor.update({
      where: { id: kyc.contractorId },
      data: {
        status: 'VERIFIED',
      },
    });

    // Send approval email
    const emailService = createEmailService();
    const emailContent = createServiceEmail({
      to: kyc.contractor.user.email,
      subject: '✅ KYC Verification Approved - TrustBuild',
      heading: 'KYC Verification Approved',
      body: `
        <p>Dear ${kyc.contractor.user.name},</p>
        <p>We're pleased to inform you that your KYC verification has been approved!</p>
        <p>Your contractor account is now fully verified and you can access all platform features.</p>
        ${notes ? `<p><strong>Notes from our team:</strong><br/>${notes}</p>` : ''}
        <p>Thank you for completing the verification process.</p>
      `,
      ctaText: 'Go to Dashboard',
      ctaUrl: `${process.env.FRONTEND_URL}/dashboard`,
    });

    await emailService.sendMail(emailContent);

    await logActivity({
      adminId: req.admin!.id,
      action: 'KYC_DECISION',
      entityType: 'ContractorKyc',
      entityId: kycId,
      description: `Approved KYC for contractor: ${kyc.contractor.user.email}`,
      diff: { decision: 'APPROVED', notes },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'KYC approved successfully',
    });
  })
);

// Reject KYC
router.post(
  '/:kycId/reject',
  protectAdmin,
  requirePermission('kyc:reject'),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { kycId } = req.params;
    const { reason, notes } = req.body;

    if (!reason) {
      return res.status(400).json({
        status: 'error',
        message: 'Rejection reason is required',
      });
    }

    const kyc = await prisma.contractorKyc.findUnique({
      where: { id: kycId },
      include: {
        contractor: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!kyc) {
      return res.status(404).json({
        status: 'error',
        message: 'KYC record not found',
      });
    }

    await prisma.contractorKyc.update({
      where: { id: kycId },
      data: {
        status: 'REJECTED',
        reviewedBy: req.admin!.id,
        reviewedAt: new Date(),
        rejectionReason: reason,
        notes,
      },
    });

    // Pause contractor account
    await prisma.contractor.update({
      where: { id: kyc.contractorId },
      data: {
        accountStatus: 'PAUSED',
      },
    });

    // Send rejection email
    const emailService = createEmailService();
    const emailContent = createServiceEmail({
      to: kyc.contractor.user.email,
      subject: '❌ KYC Verification - Action Required - TrustBuild',
      heading: 'KYC Verification Update',
      body: `
        <p>Dear ${kyc.contractor.user.name},</p>
        <p>We've reviewed your KYC documents and unfortunately we need additional information.</p>
        <p><strong>Reason:</strong><br/>${reason}</p>
        ${notes ? `<p><strong>Additional notes:</strong><br/>${notes}</p>` : ''}
        <p>Please re-submit your documents with the required corrections.</p>
      `,
      ctaText: 'Re-submit Documents',
      ctaUrl: `${process.env.FRONTEND_URL}/dashboard/kyc`,
    });

    await emailService.sendMail(emailContent);

    await logActivity({
      adminId: req.admin!.id,
      action: 'KYC_DECISION',
      entityType: 'ContractorKyc',
      entityId: kycId,
      description: `Rejected KYC for contractor: ${kyc.contractor.user.email}`,
      diff: { decision: 'REJECTED', reason, notes },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'KYC rejected successfully',
    });
  })
);

export default router;

