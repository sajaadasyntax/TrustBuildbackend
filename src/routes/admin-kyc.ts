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
import { AdminPermission } from '../config/permissions';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { logActivity } from '../services/auditService';
import * as adminNotificationService from '../services/adminNotificationService';
import { prisma } from '../config/database';
import { createServiceEmail, createEmailService } from '../services/emailService';

const router = express.Router();

// Serve KYC documents
router.get('/documents/:path(*)', (req, res) => {
  // The path parameter should be relative to uploads/kyc (e.g., "contractorId/filename.jpg")
  // But it might also be a full path from old records, so we handle both cases
  let filePath: string;
  let receivedPath = req.params.path;
  
  // Decode URL-encoded path
  try {
    receivedPath = decodeURIComponent(receivedPath);
  } catch (e) {
    // If decoding fails, use the original path
  }
  
  // Check if it's an absolute path (legacy data)
  // Absolute paths might look like: /var/www/.../uploads/kyc/contractorId/file.jpg
  // Or they might be relative paths like: kyc/contractorId/file.jpg
  if (path.isAbsolute(receivedPath)) {
    // It's an absolute path - use it directly
    filePath = receivedPath;
  } else {
    // It's a relative path - check if it already includes 'kyc/' or if we need to add it
    if (receivedPath.startsWith('kyc/')) {
      // Path already includes 'kyc/', so construct from uploads/
      filePath = path.join(process.cwd(), 'uploads', receivedPath);
    } else {
      // Path is relative to uploads/kyc (e.g., "contractorId/filename.jpg")
      filePath = path.join(process.cwd(), 'uploads', 'kyc', receivedPath);
    }
  }

  // Normalize the path to prevent directory traversal
  const normalizedPath = path.normalize(filePath);
  const uploadsDir = path.join(process.cwd(), 'uploads');
  
  // Ensure the file is within the uploads directory
  if (!normalizedPath.startsWith(uploadsDir)) {
    return res.status(403).json({
      status: 'fail',
      message: 'Access denied',
    });
  }

  if (fs.existsSync(normalizedPath)) {
    res.sendFile(normalizedPath);
  } else {
    res.status(404).json({
      status: 'fail',
      message: `Can't find ${receivedPath} on this server!`,
    });
  }
});

// Configure multer for KYC document uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const contractorId = (req as any).user?.contractor?.id || 'unknown';
    const uploadPath = path.join(process.cwd(), 'uploads', 'kyc', contractorId);
    
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

// Contractor gets their own KYC status
router.get(
  '/my-status',
  protect,
  catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const contractor = await prisma.contractor.findUnique({
      where: { userId: req.user!.id },
    });

    if (!contractor) {
      return res.status(404).json({
        status: 'error',
        message: 'Contractor profile not found',
      });
    }

    let kyc = await prisma.contractorKyc.findUnique({
      where: { contractorId: contractor.id },
    });

    // If no KYC record exists, create one with a 14-day deadline
    if (!kyc) {
      const kycDeadline = new Date();
      kycDeadline.setDate(kycDeadline.getDate() + 14); // 14 days from now

      kyc = await prisma.contractorKyc.create({
        data: {
          contractorId: contractor.id,
          status: 'PENDING',
          dueBy: kycDeadline,
        },
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        kyc: {
          id: kyc.id,
          status: kyc.status,
          dueBy: kyc.dueBy,
          submittedAt: kyc.submittedAt,
          reviewedAt: kyc.reviewedAt,
          rejectionReason: kyc.rejectionReason,
          hasIdDocument: !!kyc.idDocPath,
          hasUtilityBill: !!kyc.utilityDocPath,
          hasInsurance: !!kyc.insuranceDocPath,
          hasCompanyDoc: !!kyc.companyDocPath,
          companyNumber: kyc.companyNumber,
        },
      },
    });
  })
);

// Contractor uploads KYC documents
router.post(
  '/upload',
  protect,
  upload.fields([
    { name: 'idDocument', maxCount: 1 },
    { name: 'utilityBill', maxCount: 1 },
    { name: 'insuranceDoc', maxCount: 1 },
    { name: 'companyDoc', maxCount: 1 },
  ]),
  catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyNumber } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    // ID document and utility bill are mandatory
    if (!files.idDocument || !files.utilityBill) {
      return res.status(400).json({
        status: 'error',
        message: 'ID document and utility bill (proof of address) are required',
      });
    }

    // Insurance document is now mandatory for contractor verification
    if (!files.insuranceDoc) {
      return res.status(400).json({
        status: 'error',
        message: 'Public liability insurance certificate is required',
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

    // Helper function to convert absolute path to relative path
    const getRelativePath = (filePath: string): string => {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      const relativePath = path.relative(uploadsDir, filePath);
      // Normalize path separators to forward slashes for URLs
      return relativePath.replace(/\\/g, '/');
    };

    // Create or update KYC record
    const kyc = await prisma.contractorKyc.upsert({
      where: { contractorId: contractor.id },
      update: {
        idDocPath: getRelativePath(files.idDocument[0].path),
        utilityDocPath: getRelativePath(files.utilityBill[0].path),
        insuranceDocPath: files.insuranceDoc?.[0]?.path ? getRelativePath(files.insuranceDoc[0].path) : null,
        companyDocPath: files.companyDoc?.[0]?.path ? getRelativePath(files.companyDoc[0].path) : null,
        companyNumber,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        dueBy,
      },
      create: {
        contractorId: contractor.id,
        idDocPath: getRelativePath(files.idDocument[0].path),
        utilityDocPath: getRelativePath(files.utilityBill[0].path),
        insuranceDocPath: files.insuranceDoc?.[0]?.path ? getRelativePath(files.insuranceDoc[0].path) : null,
        companyDocPath: files.companyDoc?.[0]?.path ? getRelativePath(files.companyDoc[0].path) : null,
        companyNumber,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        dueBy,
      },
    });

    // Keep account PAUSED until admin approves KYC
    // Only update status to indicate KYC is under review
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        status: 'PENDING', // Pending admin KYC review
        accountStatus: 'PAUSED', // Remains paused until KYC approval
      },
    });

    // Send email notification to admin
    try {
      const emailService = createEmailService();
      const emailContent = createServiceEmail({
        to: process.env.ADMIN_EMAIL || 'admin@trustbuild.uk',
        subject: '📋 New KYC Submission - TrustBuild Admin',
        heading: 'New KYC Document Submission',
        body: `
          <p>A contractor has submitted KYC documents for review.</p>
          <p><strong>Contractor:</strong> ${contractor.businessName || req.user!.name}</p>
          <p><strong>Email:</strong> ${req.user!.email}</p>
          <p><strong>Company Number:</strong> ${companyNumber || 'Not provided'}</p>
          <p>Please review the submission in the admin panel.</p>
        `,
        ctaText: 'Review KYC',
        ctaUrl: `${process.env.FRONTEND_URL}/admin/kyc`,
      });

      await emailService.sendMail(emailContent);
    } catch (error) {
      console.error('Failed to send admin email notification:', error);
    }

    // Send in-app notification to all admins
    try {
      await adminNotificationService.notifyAdminsNewKYC(
        kyc.id,
        contractor.businessName || req.user!.name,
        req.user!.id
      );
    } catch (error) {
      console.error('Failed to send admin in-app notification:', error);
    }

    res.status(200).json({
      status: 'success',
      message: 'KYC documents uploaded successfully. Our team will review your documents and notify you once approved. Your account will be activated after KYC approval.',
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
  requirePermission(AdminPermission.KYC_READ),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { status = 'SUBMITTED', page = '1', limit = '100' } = req.query;

    const where: any = {};
    
    // Support multiple statuses separated by comma
    if (status) {
      const statuses = (status as string).split(',').map(s => s.trim());
      if (statuses.length > 1) {
        where.status = { in: statuses };
      } else {
        where.status = status;
      }
    }

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
        orderBy: [
          { status: 'asc' }, // Sort by status first  
          { dueBy: 'asc' },  // Then by due date
        ],
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
  requirePermission(AdminPermission.KYC_READ),
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
  requirePermission(AdminPermission.KYC_APPROVE),
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

    // Update contractor status - fully activate account
    await prisma.contractor.update({
      where: { id: kyc.contractorId },
      data: {
        status: 'VERIFIED',
        profileApproved: true,
        accountStatus: 'ACTIVE',
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
        
        <h3>What's Next?</h3>
        <p>To start accessing job leads, you'll need to subscribe to one of our plans:</p>
        <ul>
          <li><strong>Standard Plan:</strong> 3 weekly credit points</li>
          <li><strong>Premium Plan:</strong> 6 weekly credit points</li>
          <li><strong>Enterprise Plan:</strong> Unlimited credit points</li>
        </ul>
        <p><strong>Note:</strong> Credit points are allocated through active subscriptions only. No free credits are provided automatically.</p>
        
        <p>Thank you for completing the verification process.</p>
      `,
      ctaText: 'Go to Dashboard',
      ctaUrl: `${process.env.FRONTEND_URL}/dashboard`,
    });

    await emailService.sendMail(emailContent);

    // Send in-app notification to contractor
    try {
      const { createNotification } = await import('../services/notificationService');
      await createNotification({
        userId: kyc.contractor.user.id,
        title: 'KYC Verification Approved',
        message: `Your KYC verification has been approved! Your account is now fully verified and you can access all platform features.`,
        type: 'SUCCESS',
        actionLink: '/dashboard/contractor',
        actionText: 'Go to Dashboard',
        metadata: {
          kycId: kycId,
          status: 'APPROVED',
        },
      });
    } catch (error) {
      console.error('Failed to send KYC approval notification:', error);
    }

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

    // Notify all admins about KYC decision
    await adminNotificationService.notifyAdminsKYCDecision(
      kycId,
      kyc.contractor.user.name,
      true,
      req.admin!.name
    );

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
  requirePermission(AdminPermission.KYC_WRITE),
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

    // Send in-app notification to contractor
    try {
      const { createNotification } = await import('../services/notificationService');
      await createNotification({
        userId: kyc.contractor.user.id,
        title: 'KYC Verification Rejected',
        message: `Your KYC verification has been rejected. Reason: ${reason}. Please re-submit your documents with the required corrections.`,
        type: 'WARNING',
        actionLink: '/dashboard/kyc',
        actionText: 'Re-submit Documents',
        metadata: {
          kycId: kycId,
          status: 'REJECTED',
          reason,
        },
      });
    } catch (error) {
      console.error('Failed to send KYC rejection notification:', error);
    }

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

    // Notify all admins about KYC decision
    await adminNotificationService.notifyAdminsKYCDecision(
      kycId,
      kyc.contractor.user.name,
      false,
      req.admin!.name
    );

    res.status(200).json({
      status: 'success',
      message: 'KYC rejected successfully',
    });
  })
);

export default router;

