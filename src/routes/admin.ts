import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protectAdmin, requirePermission, AdminAuthRequest, hasPermission, getClientIp, getClientUserAgent } from '../middleware/adminAuth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { AdminPermission } from '../config/permissions';
import { logActivity } from '../services/auditService';
import * as adminNotificationService from '../services/adminNotificationService';
import { deleteFromCloudinary } from '../config/cloudinary';
import bcrypt from 'bcryptjs';
import { UserRole, Message } from '@prisma/client';

const router = Router();

// @desc    Get admin dashboard statistics
// @route   GET /api/admin/dashboard
// @access  Private/Admin
export const getDashboardStats = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  // Execute all queries in parallel for better performance
  const [
    totalUsers,
    activeUsers,
    totalCustomers,
    totalContractors,
    approvedContractors,
    pendingApprovals,
    totalJobs,
    activeJobs,
    completedJobs,
    totalReviews,
    flaggedReviews,
    totalApplications,
    pendingApplications,
    totalServices,
    activeServices,
    totalRevenue,
    recentUsers,
    recentJobs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({
      where: { isActive: true },
    }),
    prisma.customer.count(),
    prisma.contractor.count(),
    prisma.contractor.count({
      where: { profileApproved: true },
    }),
    prisma.contractor.count({
      where: { profileApproved: false },
    }),
    prisma.job.count(),
    prisma.job.count({
      where: { status: { in: ['DRAFT', 'POSTED'] } },
    }),
    prisma.job.count({
      where: { status: 'COMPLETED' },
    }),
    prisma.review.count(),
    prisma.review.count({
      where: { isVerified: false },
    }),
    prisma.jobApplication.count(),
    prisma.jobApplication.count({
      where: { status: 'PENDING' },
    }),
    prisma.service.count(),
    prisma.service.count({
      where: { isActive: true },
    }),
    // Get actual revenue from completed payments (not job budgets)
    prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
    }),
    prisma.user.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    }),
    prisma.job.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          include: {
            user: {
              select: {
                name: true,
              },
            },
          },
        },
        service: {
          select: {
            name: true,
          },
        },
      },
    }),
  ]);

  const stats = {
    users: {
      total: totalUsers,
      active: activeUsers,
      inactive: totalUsers - activeUsers,
    },
    contractors: {
      total: totalContractors,
      approved: approvedContractors,
      pending: pendingApprovals,
    },
    customers: {
      total: totalCustomers,
    },
    jobs: {
      total: totalJobs,
      active: activeJobs,
      completed: completedJobs,
    },
    reviews: {
      total: totalReviews,
      flagged: flaggedReviews,
    },
    applications: {
      total: totalApplications,
      pending: pendingApplications,
    },
    services: {
      total: totalServices,
      active: activeServices,
    },
    revenue: {
      total: Number(totalRevenue._sum.amount || 0),
    },
    recent: {
      users: recentUsers,
      jobs: recentJobs,
    },
  };

  res.status(200).json({
    status: 'success',
    data: { stats },
  });
});

// @desc    Get platform analytics
// @route   GET /api/admin/analytics
// @access  Private/Admin
export const getAnalytics = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { period = '30' } = req.query; // days
  const days = parseInt(period as string);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const analytics = await prisma.$transaction(async (tx) => {
    // User growth
    const userGrowth = await tx.user.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: { gte: startDate },
      },
      _count: { id: true },
    });

    // Job trends
    const jobTrends = await tx.job.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    // Popular services
    const popularServices = await tx.service.findMany({
      include: {
        _count: {
          select: {
            jobs: true,
            contractors: true,
          },
        },
      },
      orderBy: {
        jobs: {
          _count: 'desc',
        },
      },
      take: 10,
    });

    // Top contractors by rating
    const topContractors = await tx.contractor.findMany({
      where: {
        reviewCount: { gte: 1 },
      },
      include: {
        user: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [
        { averageRating: 'desc' },
        { reviewCount: 'desc' },
      ],
      take: 10,
    });

    // Revenue by period
    const revenueByPeriod = await tx.job.groupBy({
      by: ['createdAt'],
      where: {
        status: 'COMPLETED',
        createdAt: { gte: startDate },
      },
      _sum: { budget: true },
    });

    return {
      userGrowth,
      jobTrends,
      popularServices,
      topContractors,
      revenueByPeriod,
    };
  });

  res.status(200).json({
    status: 'success',
    data: { analytics },
  });
});

// @desc    Get pending contractor approvals
// @route   GET /api/admin/contractors/pending
// @access  Private/Admin
export const getPendingContractors = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const contractors = await prisma.contractor.findMany({
    where: { profileApproved: false },
    skip,
    take: limit,
    include: {
      user: {
        select: {
          name: true,
          email: true,
          createdAt: true,
        },
      },
      services: true,
      documents: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const total = await prisma.contractor.count({
    where: { profileApproved: false },
  });

  res.status(200).json({
    status: 'success',
    data: {
      contractors,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Approve/reject contractor
// @route   PATCH /api/admin/contractors/:id/approve
// @access  Private/Admin
export const approveContractor = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { approved, reason, bypassKyc } = req.body;

  const contractor = await prisma.contractor.findUnique({
    where: { id: req.params.id },
    include: {
      user: true,
      kyc: true,
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  // Prepare update data
  const updateData: any = {
    profileApproved: approved,
    status: approved ? 'VERIFIED' : 'REJECTED',
  };

  // If bypassing KYC (manual approval), activate account immediately
  if (approved && bypassKyc) {
    if (!reason) {
      return next(new AppError('Reason is required for manual approval bypassing KYC', 400));
    }
    updateData.accountStatus = 'ACTIVE';
    updateData.manuallyApprovedBy = req.admin!.id;
    updateData.manualApprovalReason = reason;
    updateData.manualApprovalDate = new Date();
  } else if (approved) {
    // Regular approval - keep account PAUSED until KYC verification
    updateData.accountStatus = 'PAUSED';
  } else {
    // Rejection
    updateData.accountStatus = 'SUSPENDED';
  }

  const updatedContractor = await prisma.contractor.update({
    where: { id: req.params.id },
    data: updateData,
  });

  // If approving the contractor (and not bypassing KYC), create/update KYC record with 14-day deadline
  let kycDeadline: Date | undefined;
  if (approved && !bypassKyc) {
    kycDeadline = new Date();
    kycDeadline.setDate(kycDeadline.getDate() + 14); // 14 days from now

    if (contractor.kyc) {
      // Update existing KYC record
      await prisma.contractorKyc.update({
        where: { contractorId: contractor.id },
        data: {
          status: 'PENDING',
          dueBy: kycDeadline,
        },
      });
    } else {
      // Create new KYC record
      await prisma.contractorKyc.create({
        data: {
          contractorId: contractor.id,
          status: 'PENDING',
          dueBy: kycDeadline,
        },
      });
    }

    // Send approval email to contractor with KYC instructions
    try {
      const { sendContractorApprovalEmail } = await import('../services/emailNotificationService');
      await sendContractorApprovalEmail({
        name: contractor.user.name,
        email: contractor.user.email,
        businessName: contractor.businessName || undefined,
        kycDeadline: kycDeadline,
      });
      console.log(`✅ Sent approval email to contractor: ${contractor.user.email}`);
    } catch (error) {
      console.error(`❌ Failed to send approval email to contractor ${contractor.user.email}:`, error);
      // Don't fail the approval if email fails - log it for manual follow-up
    }

    // Send in-app notification to contractor
    try {
      const { createNotification } = await import('../services/notificationService');
      await createNotification({
        userId: contractor.user.id,
        title: 'Profile Approved',
        message: `Your contractor profile has been approved!${bypassKyc ? ' Your account is now active.' : ' Please complete KYC verification to activate your account.'}`,
        type: 'SUCCESS',
        actionLink: bypassKyc ? '/dashboard/contractor' : '/dashboard/kyc',
        actionText: bypassKyc ? 'Go to Dashboard' : 'Complete KYC',
        metadata: {
          contractorId: contractor.id,
          approved: true,
          bypassKyc,
        },
      });
    } catch (error) {
      console.error('Failed to send approval notification:', error);
    }
  } else {
    // Contractor rejected - send notification
    try {
      const { createNotification } = await import('../services/notificationService');
      await createNotification({
        userId: contractor.user.id,
        title: 'Profile Rejected',
        message: `Your contractor profile has been rejected.${reason ? ` Reason: ${reason}` : ''} Please contact support for more information.`,
        type: 'ERROR',
        actionLink: '/dashboard/contractor',
        actionText: 'View Dashboard',
        metadata: {
          contractorId: contractor.id,
          approved: false,
          reason,
        },
      });
    } catch (error) {
      console.error('Failed to send rejection notification:', error);
    }
  }

  // If manual approval (bypassing KYC), send different email
  if (approved && bypassKyc) {
    try {
      const { createEmailService, createServiceEmail } = await import('../services/emailService');
      const emailService = createEmailService();
      
      const emailContent = createServiceEmail({
        to: contractor.user.email,
        subject: '✅ Account Approved - TrustBuild',
        heading: 'Your Account Has Been Approved!',
        body: `
          <p>Hi ${contractor.user.name},</p>
          <p>Great news! Your contractor account has been manually approved by our admin team.</p>
          <p>Your account is now fully active and you can start accessing job opportunities.</p>
          <p>Welcome to TrustBuild!</p>
        `,
        ctaText: 'Go to Dashboard',
        ctaUrl: `${process.env.FRONTEND_URL}/dashboard`,
      });

      await emailService.sendMail(emailContent);
      console.log(`✅ Sent manual approval email to contractor: ${contractor.user.email}`);
    } catch (error) {
      console.error(`❌ Failed to send manual approval email to contractor ${contractor.user.email}:`, error);
      // Don't fail the approval if email fails
    }
  }

  // Log the admin action to activity log
  const approvalType = bypassKyc ? 'MANUALLY_APPROVED_BYPASS_KYC' : 'APPROVED';
  await logActivity({
    adminId: req.admin!.id,
    action: approved ? `CONTRACTOR_${approvalType}` : 'CONTRACTOR_REJECTED',
    entityType: 'Contractor',
    entityId: contractor.id,
    description: `Contractor ${contractor.businessName || contractor.user.name} ${approved ? (bypassKyc ? 'manually approved (bypassing KYC)' : 'approved - 14-day KYC deadline set') : 'rejected'}${reason ? `: ${reason}` : ''}`,
    diff: {
      before: { 
        profileApproved: contractor.profileApproved, 
        status: contractor.status, 
        accountStatus: contractor.accountStatus 
      },
      after: { 
        profileApproved: approved, 
        status: approved ? 'VERIFIED' : 'REJECTED', 
        accountStatus: updateData.accountStatus,
        manualApproval: bypassKyc ? { by: req.admin!.id, reason, date: new Date() } : undefined
      },
      reason,
      bypassKyc,
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });

  const message = approved 
    ? (bypassKyc 
        ? 'Contractor manually approved and account activated. KYC verification bypassed.' 
        : 'Contractor approved and notified via email. Account will remain PAUSED until KYC verification is complete')
    : 'Contractor rejected successfully';

  res.status(200).json({
    status: 'success',
    data: {
      contractor: updatedContractor,
    },
    message,
  });
});

// @desc    Get flagged content
// @route   GET /api/admin/content/flagged
// @access  Private/Admin
export const getFlaggedContent = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;
  const { type, status, severity, search } = req.query;

  // Get flagged reviews
  const flaggedReviews = await prisma.review.findMany({
    where: { 
      isVerified: false,
      ...(search && {
        OR: [
          { comment: { contains: search as string, mode: 'insensitive' } },
          { customer: { user: { name: { contains: search as string, mode: 'insensitive' } } } },
          { contractor: { user: { name: { contains: search as string, mode: 'insensitive' } } } },
        ]
      })
    },
    include: {
      customer: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
              contractor: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      job: {
        select: {
          id: true,
          title: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip: type === 'review' || !type ? skip : 0,
    take: type === 'review' || !type ? limit : 50,
  });

  // Get suspicious jobs (potential spam or inappropriate content)
  const suspiciousJobs = await prisma.job.findMany({
    where: {
      OR: [
        { title: { contains: 'cash only', mode: 'insensitive' } },
        { title: { contains: 'no questions', mode: 'insensitive' } },
        { description: { contains: 'cash only', mode: 'insensitive' } },
        { description: { contains: 'no questions', mode: 'insensitive' } },
        { description: { contains: 'urgent', mode: 'insensitive' } },
        { budget: { lt: 50 } }, // Suspiciously low budget
      ],
      ...(search && {
        OR: [
          { title: { contains: search as string, mode: 'insensitive' } },
          { description: { contains: search as string, mode: 'insensitive' } },
          { customer: { user: { name: { contains: search as string, mode: 'insensitive' } } } },
        ]
      })
    },
    include: {
      customer: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      service: {
        select: {
          id: true,
          name: true,
          category: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip: type === 'job' || !type ? skip : 0,
    take: type === 'job' || !type ? limit : 20,
  });

  // Get contractors with potential issues
  const suspiciousContractors = await prisma.contractor.findMany({
    where: {
      OR: [
        { profileApproved: false },
        { description: { contains: 'best in town', mode: 'insensitive' } },
        { description: { contains: 'guaranteed', mode: 'insensitive' } },
        { description: { contains: 'licensed', mode: 'insensitive' } },
      ],
      ...(search && {
        OR: [
          { businessName: { contains: search as string, mode: 'insensitive' } },
          { description: { contains: search as string, mode: 'insensitive' } },
          { user: { name: { contains: search as string, mode: 'insensitive' } } },
        ]
      })
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip: type === 'profile' || !type ? skip : 0,
    take: type === 'profile' || !type ? limit : 10,
  });

  // Transform data to match frontend expectations
  const transformedContent = [
    ...flaggedReviews.map(review => ({
      id: review.id,
      type: 'review' as const,
      title: `Review for ${review.contractor.user.name}`,
      content: review.comment || 'No comment provided',
      author: review.customer?.user?.name || 'Unknown',
      authorEmail: review.customer?.user?.email || 'unknown@example.com',
      flaggedBy: 'System Auto-detection',
      flagReason: review.rating <= 2 ? 'Low rating review' : 'Unverified review',
      status: 'pending' as const,
      severity: 'flagged' as const,
      createdDate: review.createdAt,
      flaggedDate: review.createdAt,
      rating: review.rating,
      jobTitle: review.job?.title || 'Unknown Job',
      contractorName: review.contractor.user.name,
    })),
    ...suspiciousJobs.map(job => ({
      id: job.id,
      type: 'job_description' as const,
      title: job.title,
      content: job.description,
      author: job.customer.user.name,
      authorEmail: job.customer.user.email,
      flaggedBy: 'System Auto-detection',
      flagReason: Number(job.budget) < 50 ? 'Suspiciously low budget' : 'Potential spam content',
      status: 'pending' as const,
      severity: 'flagged' as const,
      createdDate: job.createdAt,
      flaggedDate: job.createdAt,
      budget: job.budget,
      location: job.location,
      serviceCategory: job.service.category,
    })),
    ...suspiciousContractors.map(contractor => ({
      id: contractor.id,
      type: 'profile' as const,
      title: `Contractor Profile: ${contractor.businessName || contractor.user.name}`,
      content: contractor.description || 'No description provided',
      author: contractor.user.name,
      authorEmail: contractor.user.email,
      flaggedBy: contractor.profileApproved ? 'System Auto-detection' : 'Admin Review Required',
      flagReason: contractor.profileApproved ? 'Potentially misleading claims' : 'Pending approval',
      status: 'pending' as const,
      severity: 'flagged' as const,
      createdDate: contractor.createdAt,
      flaggedDate: contractor.createdAt,
      businessName: contractor.businessName,
      profileApproved: contractor.profileApproved,
    })),
  ];

  // Apply filters
  let filteredContent = transformedContent;
  
  if (type && type !== 'all') {
    filteredContent = filteredContent.filter(item => item.type === type);
  }
  
  if (status && status !== 'all') {
    filteredContent = filteredContent.filter(item => item.status === status);
  }
  
  if (severity && severity !== 'all') {
    filteredContent = filteredContent.filter(item => item.severity === severity);
  }

  // Sort by date (most recent first)
  filteredContent.sort((a, b) => {
    return new Date(b.flaggedDate).getTime() - new Date(a.flaggedDate).getTime();
  });

  // Paginate
  const total = filteredContent.length;
  const paginatedContent = filteredContent.slice(skip, skip + limit);

  // Calculate stats
  const stats = {
    totalFlagged: transformedContent.length,
    pendingReview: transformedContent.filter(item => item.status === 'pending').length,
    approved: 0, // All items are currently pending - this would be updated when moderation is implemented
    rejected: 0, // All items are currently pending - this would be updated when moderation is implemented
    flaggedCount: transformedContent.length,
    reviewCount: flaggedReviews.length,
    jobCount: suspiciousJobs.length,
    profileCount: suspiciousContractors.length,
  };

  res.status(200).json({
    status: 'success',
    data: {
      content: paginatedContent,
      stats,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Flag content (review, job, etc.)
// @route   POST /api/admin/content/:type/:id/flag
// @access  Private/Admin
export const flagContent = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { type, id } = req.params;
  const { reason } = req.body;

  if (!reason || reason.trim().length === 0) {
    return next(new AppError('Reason for flagging is required', 400));
  }

  if (type === 'review') {
    const review = await prisma.review.findUnique({
      where: { id },
      include: {
        customer: {
          include: { user: { select: { name: true, email: true } } }
        },
        contractor: {
          include: { user: { select: { name: true } } }
        },
      },
    });

    if (!review) {
      return next(new AppError('Review not found', 404));
    }

    // Store the flag reason directly on the review
    await prisma.review.update({
      where: { id },
      data: {
        isVerified: false, // Unverify flagged reviews
        flagReason: reason, // Store the flag reason
      },
    });

    // Log the admin action
    await logActivity({
      adminId: req.admin!.id,
      action: 'REVIEW_FLAGGED',
      entityType: 'Review',
      entityId: id,
      description: `Review by ${review.customer?.user?.name} for ${review.contractor?.user?.name} flagged: ${reason}`,
      diff: {
        before: { isVerified: review.isVerified },
        after: { isVerified: false },
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Review flagged successfully',
    });
  } else if (type === 'job') {
    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        customer: {
          include: { user: { select: { name: true } } }
        },
      },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    // Flag the job
    await prisma.job.update({
      where: { id },
      data: {
        isFlagged: true,
        flaggedAt: new Date(),
        flaggedBy: req.admin!.id,
        flagReason: reason,
      },
    });

    // Log the admin action
    await logActivity({
      adminId: req.admin!.id,
      action: 'JOB_FLAGGED',
      entityType: 'Job',
      entityId: id,
      description: `Job "${job.title}" by ${job.customer?.user?.name} flagged: ${reason}`,
      diff: {
        before: { isFlagged: job.isFlagged },
        after: { isFlagged: true },
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Job flagged successfully',
    });
  } else if (type === 'profile') {
    const contractor = await prisma.contractor.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true } }
      },
    });

    if (!contractor) {
      return next(new AppError('Contractor not found', 404));
    }

    // Suspend or flag the contractor profile
    await prisma.contractor.update({
      where: { id },
      data: {
        status: 'SUSPENDED',
      },
    });

    // Log the admin action
    await logActivity({
      adminId: req.admin!.id,
      action: 'CONTRACTOR_FLAGGED',
      entityType: 'Contractor',
      entityId: id,
      description: `Contractor ${contractor.businessName || contractor.user.name} flagged: ${reason}`,
      diff: {
        before: { status: contractor.status },
        after: { status: 'SUSPENDED' },
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Contractor profile flagged successfully',
    });
  } else {
    return next(new AppError('Invalid content type', 400));
  }
});

// @desc    Moderate content
// @route   PATCH /api/admin/content/:type/:id/moderate
// @access  Private/Admin
export const moderateContent = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { type, id } = req.params;
  const { action, reason } = req.body; // 'approve', 'reject', 'delete', 'remove'

  // Accept both 'delete' and 'remove' as the same action
  const normalizedAction = action === 'remove' ? 'delete' : action;

  if (!['approve', 'reject', 'delete'].includes(normalizedAction)) {
    return next(new AppError('Invalid moderation action', 400));
  }

  if (type === 'review') {
    const review = await prisma.review.findUnique({
      where: { id },
      include: {
        customer: {
          include: { user: { select: { name: true } } }
        },
        contractor: {
          include: { user: { select: { name: true } } }
        },
      },
    });

    if (!review) {
      return next(new AppError('Review not found', 404));
    }

    if (normalizedAction === 'delete') {
      await prisma.review.delete({
        where: { id },
      });
    } else {
      await prisma.review.update({
        where: { id },
        data: {
          isVerified: normalizedAction === 'approve',
          flagReason: null, // Clear flag reason when moderated
        },
      });
    }

    // Log the admin action to activity log
    await logActivity({
      adminId: req.admin!.id,
      action: normalizedAction === 'delete' ? 'REVIEW_DELETED' : normalizedAction === 'approve' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
      entityType: 'Review',
      entityId: id,
      description: `Review by ${review.customer?.user?.name} for ${review.contractor?.user?.name} ${normalizedAction}ed${reason ? `: ${reason}` : ''}`,
      diff: {
        before: { isVerified: review.isVerified },
        after: normalizedAction === 'delete' ? null : { isVerified: normalizedAction === 'approve' },
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: `Review ${normalizedAction}ed successfully`,
    });
  } else if (type === 'job' || type === 'job_description') {
    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        customer: {
          include: { user: { select: { name: true } } }
        },
      },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    const oldStatus = job.status;

    if (normalizedAction === 'delete') {
      await prisma.job.delete({
        where: { id },
      });
    } else if (normalizedAction === 'reject') {
      await prisma.job.update({
        where: { id },
        data: {
          status: 'CANCELLED',
        },
      });
    } else if (normalizedAction === 'approve') {
      // For 'approve', ensure job status is POSTED if it was flagged
      await prisma.job.update({
        where: { id },
        data: {
          status: oldStatus === 'DRAFT' ? 'POSTED' : oldStatus,
        },
      });
    }

    // Log the admin action to activity log
    try {
      await logActivity({
        adminId: req.admin!.id,
        action: normalizedAction === 'delete' ? 'JOB_DELETED' : normalizedAction === 'approve' ? 'JOB_APPROVED' : 'JOB_REJECTED',
        entityType: 'Job',
        entityId: id,
        description: `Job "${job.title}" by ${job.customer?.user?.name || 'Unknown'} ${normalizedAction}ed${reason ? `: ${reason}` : ''}`,
        diff: {
          before: { status: oldStatus },
          after: normalizedAction === 'delete' ? null : normalizedAction === 'reject' ? { status: 'CANCELLED' } : { status: oldStatus },
          reason,
        },
        ipAddress: getClientIp(req),
        userAgent: getClientUserAgent(req),
      });
    } catch (logError) {
      console.error('Failed to log activity:', logError);
    }

    res.status(200).json({
      status: 'success',
      message: `Job ${normalizedAction}ed successfully`,
    });
  } else if (type === 'profile') {
    const contractor = await prisma.contractor.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });

    if (!contractor) {
      return next(new AppError('Contractor profile not found', 404));
    }

    const oldData = { profileApproved: contractor.profileApproved, status: contractor.status };

    if (normalizedAction === 'delete') {
      // Delete contractor profile and associated user
      await prisma.contractor.delete({
        where: { id },
      });
    } else {
      await prisma.contractor.update({
        where: { id },
        data: {
          profileApproved: normalizedAction === 'approve',
          status: normalizedAction === 'approve' ? 'VERIFIED' : 'REJECTED',
        },
      });
    }

    // Log the admin action to activity log
    await logActivity({
      adminId: req.admin!.id,
      action: normalizedAction === 'delete' ? 'CONTRACTOR_DELETED' : normalizedAction === 'approve' ? 'CONTRACTOR_APPROVED' : 'CONTRACTOR_REJECTED',
      entityType: 'Contractor',
      entityId: id,
      description: `Contractor ${contractor.businessName || contractor.user.name} ${normalizedAction}ed from flagged content${reason ? `: ${reason}` : ''}`,
      diff: {
        before: oldData,
        after: normalizedAction === 'delete' ? null : { profileApproved: normalizedAction === 'approve', status: normalizedAction === 'approve' ? 'VERIFIED' : 'REJECTED' },
        reason,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: `Contractor profile ${normalizedAction}ed successfully`,
    });
  } else {
    return next(new AppError('Invalid content type', 400));
  }
});

// @desc    Manage user account
// @route   PATCH /api/admin/users/:id/manage
// @access  Private/Admin
export const manageUser = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { action } = req.body; // 'activate', 'deactivate', 'delete'

  if (!['activate', 'deactivate', 'delete'].includes(action)) {
    return next(new AppError('Invalid user management action', 400));
  }

  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  if (action === 'delete') {
    await prisma.user.delete({
      where: { id: req.params.id },
    });
  } else {
    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        isActive: action === 'activate',
      },
    });
  }

  res.status(200).json({
    status: 'success',
    message: `User ${action}ed successfully`,
  });
});

// @desc    Get payment settings and Stripe configuration
// @route   GET /api/admin/payments/settings
// @access  Private/Admin
export const getSystemSettings = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const settings = await prisma.adminSettings.findMany({
    orderBy: { key: 'asc' },
  });

  const settingsMap = settings.reduce((acc, setting) => {
    acc[setting.key] = setting.value;
    return acc;
  }, {} as Record<string, string>);

  res.status(200).json({
    status: 'success',
    data: { settings: settingsMap },
  });
});

// @desc    Update payment settings and Stripe configuration
// @route   PATCH /api/admin/payments/settings
// @access  Private/Admin
export const updateSystemSettings = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { settings } = req.body;

  if (!settings || typeof settings !== 'object') {
    return next(new AppError('Invalid settings format', 400));
  }

  const promises = Object.entries(settings).map(([key, value]) =>
    prisma.adminSettings.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    })
  );

  await Promise.all(promises);

  res.status(200).json({
    status: 'success',
    message: 'Settings updated successfully',
  });
});

// @desc    Get all users with filtering and pagination
// @route   GET /api/admin/users
// @access  Private/Admin
export const getAllUsers = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const { role, status, search } = req.query;

  // Build where clause
  const whereClause: any = {};
  
  // Regular ADMINs cannot see SUPER_ADMIN users
  if (req.admin?.role !== 'SUPER_ADMIN') {
    whereClause.role = { not: 'SUPER_ADMIN' };
  }
  
  if (role && role !== 'all') {
    // Regular ADMIN trying to filter SUPER_ADMIN - deny
    if (role === 'SUPER_ADMIN' && req.admin?.role !== 'SUPER_ADMIN') {
      return next(new AppError('Access denied. Cannot view SUPER_ADMIN users.', 403));
    }
    whereClause.role = role;
  }
  
  if (status && status !== 'all') {
    whereClause.isActive = status === 'active';
  }
  
  if (search) {
    whereClause.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: whereClause,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        customer: {
          select: {
            id: true,
            phone: true,
            city: true,
            postcode: true,
          },
        },
        contractor: {
          select: {
            id: true,
            businessName: true,
            profileApproved: true,
            status: true,
            averageRating: true,
            reviewCount: true,
            jobsCompleted: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where: whereClause }),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Create new admin user
// @route   POST /api/admin/users/create-admin
// @access  Private/Admin
export const createAdmin = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return next(new AppError('Please provide name, email, and password', 400));
  }

  if (password.length < 8) {
    return next(new AppError('Password must be at least 8 characters long', 400));
  }

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return next(new AppError('User with this email already exists', 400));
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create admin user
  const newAdmin = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: 'ADMIN',
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  res.status(201).json({
    status: 'success',
    data: {
      user: newAdmin,
    },
    message: 'Admin user created successfully',
  });
});

// @desc    Get user details by ID
// @route   GET /api/admin/users/:id
// @access  Private/Admin
export const getUserById = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      customer: {
        select: {
          id: true,
          phone: true,
          address: true,
          city: true,
          postcode: true,
          _count: {
            select: {
              jobs: true,
              reviews: true,
            },
          },
        },
      },
      contractor: {
        select: {
          id: true,
          businessName: true,
          description: true,
          businessAddress: true,
          city: true,
          postcode: true,
          phone: true,
          website: true,
          instagramHandle: true,
          operatingArea: true,
          servicesProvided: true,
          yearsExperience: true,
          profileApproved: true,
          status: true,
          averageRating: true,
          reviewCount: true,
          jobsCompleted: true,
          _count: {
            select: {
              applications: true,
              reviews: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { user },
  });
});

// @desc    Get all contractors with filtering
// @route   GET /api/admin/contractors
// @access  Private/Admin
export const getAllContractors = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const { status, approved, search } = req.query;

  // Build where clause
  const whereClause: any = {};
  
  if (status && status !== 'all') {
    whereClause.status = status;
  }
  
  if (approved && approved !== 'all') {
    whereClause.profileApproved = approved === 'true';
  }
  
  if (search) {
    whereClause.OR = [
      { businessName: { contains: search as string, mode: 'insensitive' } },
      { user: { name: { contains: search as string, mode: 'insensitive' } } },
      { user: { email: { contains: search as string, mode: 'insensitive' } } },
    ];
  }

  const [contractors, total] = await Promise.all([
    prisma.contractor.findMany({
      where: whereClause,
      skip,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
            createdAt: true,
          },
        },
        services: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
        subscription: {
          select: {
            id: true,
            status: true,
            plan: true,
            isActive: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            monthlyPrice: true,
            stripeSubscriptionId: true,
          },
        },
        commissionPayments: {
          where: {
            status: { in: ['PENDING', 'OVERDUE'] }
          },
          select: {
            id: true,
            jobId: true,
            commissionAmount: true,
            totalAmount: true,
            dueDate: true,
            status: true,
            job: {
              select: {
                title: true,
              },
            },
          },
          orderBy: { dueDate: 'asc' },
        },
        _count: {
          select: {
            applications: true,
            reviews: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contractor.count({ where: whereClause }),
  ]);

  // Transform contractors to include unpaid commission summary
  const contractorsWithPayments = contractors.map((contractor: any) => {
    const unpaidCommissions = contractor.commissionPayments?.map((cp: any) => ({
      id: cp.id,
      jobId: cp.jobId,
      jobTitle: cp.job?.title,
      commissionAmount: typeof cp.commissionAmount?.toNumber === 'function' ? cp.commissionAmount.toNumber() : Number(cp.commissionAmount),
      totalAmount: typeof cp.totalAmount?.toNumber === 'function' ? cp.totalAmount.toNumber() : Number(cp.totalAmount),
      dueDate: cp.dueDate,
      status: cp.status,
    })) || [];

    const totalOutstandingAmount = unpaidCommissions.reduce(
      (sum: number, cp: any) => sum + (cp.totalAmount || 0), 
      0
    );

    return {
      ...contractor,
      unpaidCommissions,
      totalOutstandingAmount,
      commissionPayments: undefined, // Remove raw data
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      contractors: contractorsWithPayments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Approve or reject contractor with detailed response
// @route   PATCH /api/admin/contractors/:id/approval
// @access  Private/Admin
export const updateContractorApproval = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { approved, reason, notes } = req.body;

  if (typeof approved !== 'boolean') {
    return next(new AppError('Approval status must be true or false', 400));
  }

  const contractor = await prisma.contractor.findUnique({
    where: { id: req.params.id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  // Update contractor approval status
  const updatedContractor = await prisma.contractor.update({
    where: { id: req.params.id },
    data: {
      profileApproved: approved,
      status: approved ? 'VERIFIED' : 'REJECTED',
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  // Log the admin action to activity log
  await logActivity({
    adminId: req.admin!.id,
    action: approved ? 'CONTRACTOR_APPROVED' : 'CONTRACTOR_REJECTED',
    entityType: 'Contractor',
    entityId: contractor.id,
    description: `Contractor ${contractor.businessName || contractor.user.name} ${approved ? 'approved' : 'rejected'}${reason ? `: ${reason}` : ''}`,
    diff: {
      before: { profileApproved: contractor.profileApproved, status: contractor.status },
      after: { profileApproved: approved, status: approved ? 'VERIFIED' : 'REJECTED' },
      reason,
      notes,
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });

  // Notify all admins about contractor decision
  await adminNotificationService.notifyAdminsContractorDecision(
    contractor.id,
    contractor.businessName || contractor.user.name,
    approved,
    req.admin!.name
  );

  res.status(200).json({
    status: 'success',
    data: {
      contractor: updatedContractor,
    },
    message: `Contractor ${approved ? 'approved' : 'rejected'} successfully`,
  });
});

// @desc    Update contractor status (activate/suspend)
// @route   PATCH /api/admin/contractors/:id/status
// @access  Private/Admin
export const updateContractorStatus = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, reason } = req.body;



    // Map frontend statuses to database enum values
    // Frontend sends: ACTIVE, SUSPENDED, INACTIVE
    // Database has: VERIFIED, SUSPENDED, PENDING, REJECTED
    const statusMapping: { [key: string]: string } = {
      'ACTIVE': 'VERIFIED',  // Active means verified and active
      'SUSPENDED': 'SUSPENDED',
      'INACTIVE': 'PENDING',  // Inactive can be mapped to pending
    };

    const validStatuses = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];
    if (!validStatuses.includes(status)) {
      console.error('[updateContractorStatus] Invalid status:', status);
      return next(new AppError('Invalid contractor status', 400));
    }

    const dbStatus = statusMapping[status];

    const contractor = await prisma.contractor.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (!contractor) {
      console.error('[updateContractorStatus] Contractor not found:', req.params.id);
      return next(new AppError('Contractor not found', 404));
    }



    const updatedContractor = await prisma.contractor.update({
      where: { id: req.params.id },
      data: {
        status: dbStatus as any,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Notify contractor about account status change
    try {
      const { createNotification } = await import('../services/notificationService');
      let title = '';
      let message = '';
      let notificationType: 'SUCCESS' | 'WARNING' | 'ERROR' | 'INFO' = 'INFO';

      if (status === 'ACTIVE') {
        title = 'Account Activated';
        message = `Your contractor account has been activated. You can now access all platform features.${reason ? ` Reason: ${reason}` : ''}`;
        notificationType = 'SUCCESS';
      } else if (status === 'SUSPENDED') {
        title = 'Account Suspended';
        message = `Your contractor account has been suspended.${reason ? ` Reason: ${reason}` : ''} Please contact support for assistance.`;
        notificationType = 'ERROR';
      } else if (status === 'INACTIVE') {
        title = 'Account Deactivated';
        message = `Your contractor account has been deactivated.${reason ? ` Reason: ${reason}` : ''}`;
        notificationType = 'WARNING';
      }

      await createNotification({
        userId: updatedContractor.user.id,
        title,
        message,
        type: notificationType,
        actionLink: '/dashboard/contractor',
        actionText: 'View Dashboard',
        metadata: {
          contractorId: req.params.id,
          status,
          reason,
        },
      });
    } catch (error) {
      console.error('Failed to send account status change notification:', error);
    }

    // Log the admin action to activity log
    try {
      await logActivity({
        adminId: req.admin!.id,
        action: status === 'SUSPENDED' ? 'CONTRACTOR_SUSPENDED' : status === 'ACTIVE' ? 'CONTRACTOR_ACTIVATED' : 'CONTRACTOR_DEACTIVATED',
        entityType: 'Contractor',
        entityId: contractor.id,
        description: `Contractor ${contractor.businessName || contractor.user?.name || 'Unknown'} status changed to ${status}${reason ? `: ${reason}` : ''}`,
        diff: {
          before: contractor.status,
          after: dbStatus,
          reason,
        },
        ipAddress: getClientIp(req),
        userAgent: getClientUserAgent(req),
      });

    } catch (logError: any) {
      console.error('[updateContractorStatus] Failed to log activity:', logError.message);
      // Continue even if logging fails
    }

    res.status(200).json({
      status: 'success',
      data: {
        contractor: updatedContractor,
      },
      message: `Contractor status updated to ${status.toLowerCase()} successfully`,
    });
  } catch (error: any) {
    console.error('[updateContractorStatus] Error:', error.message, error.stack);
    return next(new AppError(error.message || 'Failed to update contractor status', 500));
  }
});

// @desc    Get contractor statistics for admin dashboard
// @route   GET /api/admin/contractors/stats
// @access  Private/Admin
export const getContractorStats = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  try {
    // Use separate queries instead of a long transaction to avoid timeout
    const totalContractors = await prisma.contractor.count();
    const activeContractors = await prisma.contractor.count({ where: { status: 'VERIFIED' } });
    const suspendedContractors = await prisma.contractor.count({ where: { status: 'SUSPENDED' } });
    const pendingApproval = await prisma.contractor.count({ where: { profileApproved: false } });
    const verifiedContractors = await prisma.contractor.count({ where: { profileApproved: true } });
    
    // Get contractors by tier
    const premiumContractors = await prisma.contractor.count({ where: { tier: 'PREMIUM' } });
    const standardContractors = await prisma.contractor.count({ where: { tier: 'STANDARD' } });
    
    // Get recent contractors (simplified query)
    const recentContractors = await prisma.contractor.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    // Get top-rated contractors (simplified query)
    const topRatedContractors = await prisma.contractor.findMany({
      where: {
        averageRating: { gte: 4.5 },
      },
      take: 5,
      orderBy: { averageRating: 'desc' },
      include: {
        user: {
          select: {
            name: true,
          },
        },
      },
    });

    // Get basic job statistics for completion rate
    const totalJobsCount = await prisma.job.count();
    const completedJobsCount = await prisma.job.count({ where: { status: 'COMPLETED' } });
    
    // Calculate basic completion rate (simplified)
    const completionRate = totalJobsCount > 0 ? (completedJobsCount / totalJobsCount) * 100 : 0;
    const approvalRate = totalContractors > 0 ? ((verifiedContractors / totalContractors) * 100) : 0;

    const stats = {
      totalContractors,
      activeContractors,
      suspendedContractors,
      pendingApproval,
      verifiedContractors,
      premiumContractors,
      standardContractors,
      completionRate,
      recentContractors,
      topRatedContractors,
      approvalRate,
    };

    res.status(200).json({
      status: 'success',
      data: { stats },
    });
  } catch (error) {
    console.error('Error in getContractorStats:', error);
    return next(new AppError('Failed to fetch contractor statistics', 500));
  }
});

// @desc    Get all jobs for admin management
// @route   GET /api/admin/jobs
// @access  Private/Admin
export const getAllJobsAdmin = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const { status, search, category, flagged } = req.query;

  // Build where clause
  const whereClause: any = {};
  
  if (status && status !== 'all') {
    whereClause.status = status.toString().toUpperCase();
  }
  
  if (category && category !== 'all') {
    whereClause.service = {
      category: { contains: category as string, mode: 'insensitive' }
    };
  }
  
  if (flagged !== undefined && flagged !== 'all') {
    whereClause.isFlagged = flagged === 'true' || flagged === 'TRUE';
  }
  
  if (search) {
    whereClause.OR = [
      { title: { contains: search as string, mode: 'insensitive' } },
      { description: { contains: search as string, mode: 'insensitive' } },
      { location: { contains: search as string, mode: 'insensitive' } },
      { customer: { user: { name: { contains: search as string, mode: 'insensitive' } } } },
    ];
  }

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where: whereClause,
      include: {
        customer: {
          select: {
            id: true,
            phone: true,
            userId: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
              },
            },
          },
        },
        service: {
          select: {
            id: true,
            name: true,
            category: true,
            smallJobPrice: true,
            mediumJobPrice: true,
            largeJobPrice: true,
          },
        },
        applications: {
          include: {
            contractor: {
              include: {
                user: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
        jobAccess: {
          include: {
            contractor: {
              select: {
                id: true,
                businessName: true,
                jobsCompleted: true,
                averageRating: true,
                reviewCount: true,
                user: {
                  select: {
                    name: true,
                  },
                },
                reviews: {
                  select: {
                    rating: true,
                  },
                },
              },
            },
          },
          orderBy: { accessedAt: 'desc' },
        },
        wonByContractor: {
          include: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.job.count({ where: whereClause }),
  ]);

  // Calculate current lead price and transform jobAccess to purchasedBy for each job
  const jobsWithPricing = jobs.map(job => {
    let currentLeadPrice = 0;
    
    // Use override price if set
    if (job.leadPrice && typeof job.leadPrice.toNumber === 'function') {
      currentLeadPrice = job.leadPrice.toNumber();
    } else if (job.service) {
      // Calculate based on job size and service pricing
      switch (job.jobSize) {
        case 'SMALL':
          currentLeadPrice = job.service.smallJobPrice ? job.service.smallJobPrice.toNumber() : 0;
          break;
        case 'MEDIUM':
          currentLeadPrice = job.service.mediumJobPrice ? job.service.mediumJobPrice.toNumber() : 0;
          break;
        case 'LARGE':
          currentLeadPrice = job.service.largeJobPrice ? job.service.largeJobPrice.toNumber() : 0;
          break;
      }
    }

    // Transform jobAccess to purchasedBy format with contractor details
    const purchasedBy = (job.jobAccess || []).map((access: any) => {
      const contractor = access.contractor;
      const reviews = contractor.reviews || [];
      const reviewCount = contractor.reviewCount || reviews.length;
      // Use contractor's averageRating if available, otherwise calculate from reviews
      const averageRating = contractor.averageRating !== null && contractor.averageRating !== undefined
        ? Number(contractor.averageRating)
        : (reviewCount > 0
          ? reviews.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / reviewCount
          : 0);

      return {
        contractorId: contractor.id,
        contractorName: contractor.businessName || contractor.user?.name || 'Unknown',
        purchasedAt: access.accessedAt.toISOString(),
        method: access.accessMethod,
        paidAmount: access.paidAmount ? Number(access.paidAmount) : undefined,
        averageRating: averageRating > 0 ? averageRating : undefined,
        reviewCount: reviewCount > 0 ? reviewCount : 0,
        jobsCompleted: contractor.jobsCompleted || 0,
      };
    });

    return {
      ...job,
      currentLeadPrice,
      contractorsWithAccess: job.jobAccess?.length || 0,
      purchasedBy,
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      jobs: jobsWithPricing,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Update job status (admin only)
// @route   PATCH /api/admin/jobs/:id/status
// @access  Private/Admin
export const updateJobStatus = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { status, reason } = req.body;

  const validStatuses = ['DRAFT', 'POSTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  if (!validStatuses.includes(status)) {
    return next(new AppError('Invalid job status', 400));
  }

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  const updatedJob = await prisma.job.update({
    where: { id: req.params.id },
    data: {
      status: status,
      ...(status === 'COMPLETED' && { completionDate: new Date() }),
    },
    include: {
      customer: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      service: {
        select: {
          name: true,
          category: true,
        },
      },
    },
  });

  // Log the admin action


  res.status(200).json({
    status: 'success',
    data: {
      job: updatedJob,
    },
    message: `Job status updated to ${status.toLowerCase()} successfully`,
  });
});

// @desc    Flag/unflag job for review
// @route   PATCH /api/admin/jobs/:id/flag
// @access  Private/Admin
export const toggleJobFlag = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { flagged, reason } = req.body;

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Update the job flagged status
  const updatedJob = await prisma.job.update({
    where: { id: req.params.id },
    data: {
      isFlagged: flagged,
      flaggedAt: flagged ? new Date() : null,
      flaggedBy: flagged ? req.admin!.id : null,
      flagReason: flagged ? reason : null,
    },
  });
  
  // Log the admin action
  await prisma.adminAction.create({
    data: {
      action: flagged ? 'JOB_FLAGGED' : 'JOB_UNFLAGGED',
      description: `${flagged ? 'Flagged' : 'Unflagged'} job: ${job.title}${reason ? ` - Reason: ${reason}` : ''}`,
      performedBy: req.admin!.id,
      metadata: { flagged, reason, jobTitle: job.title, jobId: job.id },
    },
  });

  res.status(200).json({
    status: 'success',
    message: `Job ${flagged ? 'flagged' : 'unflagged'} successfully`,
    data: {
      job: updatedJob,
    },
  });
});

// @desc    Get job statistics for admin dashboard
// @route   GET /api/admin/jobs/stats
// @access  Private/Admin
export const getJobStats = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const stats = await prisma.$transaction(async (tx) => {
    const totalJobs = await tx.job.count();
    const postedJobs = await tx.job.count({ where: { status: 'POSTED' } });
    const inProgressJobs = await tx.job.count({ where: { status: 'IN_PROGRESS' } });
    const completedJobs = await tx.job.count({ where: { status: 'COMPLETED' } });
    const cancelledJobs = await tx.job.count({ where: { status: 'CANCELLED' } });
    
    const totalValue = await tx.job.aggregate({
      _sum: { budget: true },
    });
    
    const completedValue = await tx.job.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { budget: true },
    });

    // Get recent jobs
    const recentJobs = await tx.job.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          include: {
            user: {
              select: {
                name: true,
              },
            },
          },
        },
        service: {
          select: {
            name: true,
            category: true,
          },
        },
      },
    });

    return {
      totalJobs,
      postedJobs,
      inProgressJobs,
      completedJobs,
      cancelledJobs,
      totalValue: totalValue._sum.budget || 0,
      completedValue: completedValue._sum.budget || 0,
      successRate: totalJobs > 0 ? ((completedJobs / totalJobs) * 100) : 0,
      recentJobs,
    };
  });

  res.status(200).json({
    status: 'success',
    data: { stats },
  });
});

// @desc    Get payment statistics and metrics
// @route   GET /api/admin/payments/stats
// @access  Private/Admin
export const getPaymentStats = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  try {
    // Get current month start
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Fetch real payment statistics from database
    const [
      totalPayments,
      totalRevenue,
      monthlyPayments,
      monthlyRevenue,
      lastMonthRevenue,
      averageTransaction,
      statusCounts,
      typeCounts
    ] = await Promise.all([
      // Total payment count
      prisma.payment.count(),
      
      // Total revenue from completed payments
      prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true }
      }),
      
      // Monthly payment count
      prisma.payment.count({
        where: {
          createdAt: { gte: monthStart }
        }
      }),
      
      // Monthly revenue
      prisma.payment.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: monthStart }
        },
        _sum: { amount: true }
      }),
      
      // Last month revenue for growth calculation
      prisma.payment.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: {
            gte: lastMonthStart,
            lt: monthStart
          }
        },
        _sum: { amount: true }
      }),
      
      // Average transaction value
      prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _avg: { amount: true }
      }),
      
      // Payment status counts
      prisma.payment.groupBy({
        by: ['status'],
        _count: { status: true }
      }),
      
      // Payment type counts with revenue
      prisma.payment.groupBy({
        by: ['type'],
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
        _count: { type: true }
      })
    ]);

    // Calculate growth
    const currentMonthRevenue = Number(monthlyRevenue._sum.amount || 0);
    const lastMonthRevenueAmount = Number(lastMonthRevenue._sum.amount || 0);
    const revenueGrowth = lastMonthRevenueAmount > 0 
      ? ((currentMonthRevenue - lastMonthRevenueAmount) / lastMonthRevenueAmount) * 100 
      : 0;

    // Process status counts
    const statusMap = statusCounts.reduce((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {} as Record<string, number>);

    // Process type revenue
    const typeRevenue = typeCounts.reduce((acc, item) => {
      acc[item.type] = Number(item._sum.amount || 0);
      return acc;
    }, {} as Record<string, number>);

    const stats = {
      totalRevenue: Number(totalRevenue._sum.amount || 0),
      monthlyRevenue: currentMonthRevenue,
      totalTransactions: totalPayments,
      successfulPayments: statusMap['COMPLETED'] || 0,
      failedPayments: statusMap['FAILED'] || 0,
      pendingPayments: statusMap['PENDING'] || 0,
      averageTransactionValue: Number(averageTransaction._avg.amount || 0),
      revenueGrowth: isNaN(revenueGrowth) ? 0 : Number(revenueGrowth.toFixed(1)),
      subscriptionRevenue: Number(typeRevenue['SUBSCRIPTION'] || 0),
      jobPaymentRevenue: Number((typeRevenue['JOB_PAYMENT'] || 0) + (typeRevenue['LEAD_ACCESS'] || 0) + (typeRevenue['COMMISSION'] || 0))
    };

    res.status(200).json({
      status: 'success',
      data: { stats },
    });
  } catch (error) {
    console.error('Error in getPaymentStats:', error);
    return next(new AppError('Failed to fetch payment statistics', 500));
  }
});

// @desc    Get payment transactions
// @route   GET /api/admin/payments/transactions
// @access  Private/Admin
export const getPaymentTransactions = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const { status, type, search, dateFilter } = req.query;

  try {
    // Build where clause for filtering
    const whereClause: any = {};
    
    if (status && status !== 'all') {
      // Map frontend status names to backend enum values
      let mappedStatus = status.toString().toUpperCase();
      if (mappedStatus === 'SUCCEEDED') {
        mappedStatus = 'COMPLETED';
      }
      whereClause.status = mappedStatus;
    }
    
    if (type && type !== 'all') {
      // Map frontend type names to backend enum values
      let mappedType = type.toString().toUpperCase();
      if (mappedType === 'JOB_UNLOCK') {
        mappedType = 'LEAD_ACCESS';
      }
      whereClause.type = mappedType;
    }

    // Date filtering
    if (dateFilter && dateFilter !== 'all') {
      const now = new Date();
      let startDate: Date;

      switch (dateFilter) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          whereClause.createdAt = { gte: startDate };
          break;
        case 'week':
          // Get start of week (Monday)
          const dayOfWeek = now.getDay();
          const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToMonday);
          startDate.setHours(0, 0, 0, 0);
          whereClause.createdAt = { gte: startDate };
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          whereClause.createdAt = { gte: startDate };
          break;
        case 'quarter':
          // Get start of current quarter
          const currentQuarter = Math.floor(now.getMonth() / 3);
          startDate = new Date(now.getFullYear(), currentQuarter * 3, 1);
          whereClause.createdAt = { gte: startDate };
          break;
      }
    }

    // Search functionality
    if (search) {
      whereClause.OR = [
        {
          contractor: {
            user: {
              name: { contains: search.toString(), mode: 'insensitive' }
            }
          }
        },
        {
          contractor: {
            user: {
              email: { contains: search.toString(), mode: 'insensitive' }
            }
          }
        },
        {
          job: {
            title: { contains: search.toString(), mode: 'insensitive' }
          }
        },
        {
          stripePaymentId: { contains: search.toString(), mode: 'insensitive' }
        },
        {
          description: { contains: search.toString(), mode: 'insensitive' }
        }
      ];
    }

    // Get total count for pagination
    const total = await prisma.payment.count({ where: whereClause });

    // Fetch transactions with relations
    const payments = await prisma.payment.findMany({
      where: whereClause,
      include: {
        contractor: {
          include: {
            user: {
              select: {
                name: true,
                email: true
              }
            }
          }
        },
        job: {
          include: {
            customer: {
              include: {
                user: {
                  select: {
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    });

    // Transform to match frontend interface
    const paginatedTransactions = payments.map(payment => {
      // Map backend payment types to frontend display types
      let displayType = payment.type.toLowerCase();
      if (payment.type === 'LEAD_ACCESS') {
        displayType = 'job_unlock';
      }
      
      return {
        id: payment.id,
        amount: Number(payment.amount),
        currency: 'GBP',
        status: payment.status === 'COMPLETED' ? 'succeeded' : payment.status.toLowerCase(),
        type: displayType,
        customer: {
          name: payment.job?.customer?.user?.name || payment.contractor?.user?.name || 'Unknown',
          email: payment.job?.customer?.user?.email || payment.contractor?.user?.email || 'unknown@example.com'
        },
        contractor: payment.contractor ? {
          businessName: payment.contractor.businessName || 'Unknown Business',
          user: {
            name: payment.contractor.user.name
          }
        } : undefined,
        description: payment.description || `${payment.type} payment`,
        createdAt: payment.createdAt.toISOString(),
        stripePaymentId: payment.stripePaymentId || payment.id
      };
    });

    res.status(200).json({
      status: 'success',
      data: {
        transactions: paginatedTransactions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Error in getPaymentTransactions:', error);
    return next(new AppError('Failed to fetch payment transactions', 500));
  }
});

// @desc    Process refund for a payment
// @route   POST /api/admin/payments/:id/refund
// @access  Private/Admin
export const processRefund = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { amount, reason } = req.body;
  const paymentId = req.params.id;

  if (!reason || !reason.trim()) {
    return next(new AppError('A reason for the refund is required', 400));
  }

  // 1. Look up the payment record
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      contractor: {
        include: { user: { select: { name: true, email: true } } },
      },
      job: { select: { id: true, title: true } },
    },
  });

  if (!payment) {
    return next(new AppError('Payment not found', 404));
  }

  if (payment.status === 'REFUNDED') {
    return next(new AppError('This payment has already been refunded', 400));
  }

  if (payment.status !== 'COMPLETED') {
    return next(new AppError(`Cannot refund a payment with status "${payment.status}". Only completed payments can be refunded.`, 400));
  }

  if (!payment.stripePaymentId) {
    return next(new AppError('This payment does not have a Stripe payment ID and cannot be refunded through Stripe', 400));
  }

  // 2. Determine refund amount (full or partial)
  const paymentAmount = typeof (payment.amount as any)?.toNumber === 'function'
    ? (payment.amount as any).toNumber()
    : Number(payment.amount);

  const refundAmount = amount && Number(amount) > 0
    ? Math.min(Number(amount), paymentAmount)  // Partial refund capped at payment amount
    : paymentAmount;                            // Full refund

  if (refundAmount <= 0) {
    return next(new AppError('Refund amount must be greater than zero', 400));
  }

  // 3. Call Stripe Refunds API
  let stripeRefund;
  try {
    const Stripe = (await import('stripe')).default;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return next(new AppError('Stripe is not configured', 500));
    }
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    stripeRefund = await stripe.refunds.create({
      payment_intent: payment.stripePaymentId,
      amount: Math.round(refundAmount * 100), // Stripe expects pence/cents
      reason: 'requested_by_customer',
      metadata: {
        adminId: req.admin!.id,
        adminName: req.admin!.name,
        internalReason: reason,
        originalPaymentId: payment.id,
      },
    });
  } catch (stripeError: any) {
    console.error('Stripe refund error:', stripeError);
    return next(new AppError(`Stripe refund failed: ${stripeError.message}`, 400));
  }

  // 4. Update the local payment record
  const isFullRefund = refundAmount >= paymentAmount;

  const updatedPayment = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: isFullRefund ? 'REFUNDED' : 'COMPLETED', // Keep COMPLETED for partial
      description: isFullRefund
        ? `${payment.description} [REFUNDED: ${reason}]`
        : `${payment.description} [PARTIAL REFUND £${refundAmount.toFixed(2)}: ${reason}]`,
    },
  });

  // 5. Log the admin action in the activity log
  await logActivity({
    adminId: req.admin!.id,
    action: 'PAYMENT_REFUND',
    entityType: 'Payment',
    entityId: payment.id,
    description: `${isFullRefund ? 'Full' : 'Partial'} refund of £${refundAmount.toFixed(2)} processed for payment ${payment.id}. Reason: ${reason}. Stripe refund: ${stripeRefund.id}`,
    diff: {
      before: { status: payment.status, amount: paymentAmount },
      after: { status: updatedPayment.status, refundAmount, stripeRefundId: stripeRefund.id },
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });

  // 6. Send notification to the contractor (best-effort)
  try {
    if (payment.contractor?.user) {
      const { createNotification } = await import('../services/notificationService');
      const contractorUserId = await prisma.contractor.findUnique({
        where: { id: payment.contractorId! },
        select: { userId: true },
      });
      if (contractorUserId) {
        await createNotification({
          userId: contractorUserId.userId,
          title: 'Payment Refunded',
          message: `A refund of £${refundAmount.toFixed(2)} has been issued for: ${payment.description}. Reason: ${reason}`,
          type: 'INFO',
          actionLink: '/dashboard/contractor/invoices',
          actionText: 'View Invoices',
        });
      }
    }
  } catch (notifError) {
    console.error('Failed to send refund notification:', notifError);
  }

  res.status(200).json({
    status: 'success',
    message: `${isFullRefund ? 'Full' : 'Partial'} refund of £${refundAmount.toFixed(2)} processed successfully`,
    data: {
      refund: {
        id: stripeRefund.id,
        paymentId: payment.id,
        amount: refundAmount,
        reason,
        status: stripeRefund.status,
        isFullRefund,
        stripeRefundId: stripeRefund.id,
        processedBy: req.admin!.name,
        createdAt: new Date().toISOString(),
      },
    },
  });
});

// @desc    Get all services with pricing
// @route   GET /api/admin/services-pricing
// @access  Private/Admin
export const getServicesWithPricing = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const services = await prisma.service.findMany({
    select: {
      id: true,
      name: true,
      category: true,
      smallJobPrice: true,
      mediumJobPrice: true,
      largeJobPrice: true,
      isActive: true,
      _count: {
        select: {
          jobs: true,
        },
      },
    },
    orderBy: [
      { category: 'asc' },
      { name: 'asc' },
    ],
  });

  res.status(200).json({
    status: 'success',
    data: { services },
  });
});

// @desc    Update service pricing
// @route   PUT /api/admin/services/:id/pricing
// @access  Private/Admin
export const updateServicePricing = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { smallJobPrice, mediumJobPrice, largeJobPrice } = req.body;

  // Parse and validate pricing values - handle string, number, undefined
  const parsedSmallJobPrice = smallJobPrice !== undefined && smallJobPrice !== null && smallJobPrice !== '' 
    ? Number(smallJobPrice) 
    : undefined;
  const parsedMediumJobPrice = mediumJobPrice !== undefined && mediumJobPrice !== null && mediumJobPrice !== '' 
    ? Number(mediumJobPrice) 
    : undefined;
  const parsedLargeJobPrice = largeJobPrice !== undefined && largeJobPrice !== null && largeJobPrice !== '' 
    ? Number(largeJobPrice) 
    : undefined;

  // Check if at least one price is provided
  if (parsedSmallJobPrice === undefined && parsedMediumJobPrice === undefined && parsedLargeJobPrice === undefined) {
    return next(new AppError('At least one price must be provided', 400));
  }

  // Validate that provided prices are valid numbers and not negative
  if (parsedSmallJobPrice !== undefined && (isNaN(parsedSmallJobPrice) || parsedSmallJobPrice < 0)) {
    return next(new AppError('Small job price must be a valid non-negative number', 400));
  }
  if (parsedMediumJobPrice !== undefined && (isNaN(parsedMediumJobPrice) || parsedMediumJobPrice < 0)) {
    return next(new AppError('Medium job price must be a valid non-negative number', 400));
  }
  if (parsedLargeJobPrice !== undefined && (isNaN(parsedLargeJobPrice) || parsedLargeJobPrice < 0)) {
    return next(new AppError('Large job price must be a valid non-negative number', 400));
  }

  // Check if service exists
  const existingService = await prisma.service.findUnique({
    where: { id },
  });

  if (!existingService) {
    return next(new AppError('Service not found', 404));
  }

  // Build update data - only include prices that were provided
  const updateData: any = {};
  if (parsedSmallJobPrice !== undefined) updateData.smallJobPrice = parsedSmallJobPrice;
  if (parsedMediumJobPrice !== undefined) updateData.mediumJobPrice = parsedMediumJobPrice;
  if (parsedLargeJobPrice !== undefined) updateData.largeJobPrice = parsedLargeJobPrice;

  const service = await prisma.service.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      smallJobPrice: true,
      mediumJobPrice: true,
      largeJobPrice: true,
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Service pricing updated successfully',
    data: { service },
  });
});

// @desc    Create a new service
// @route   POST /api/admin/services
// @access  Private/Admin
export const createService = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { name, description, category, isActive, smallJobPrice, mediumJobPrice, largeJobPrice } = req.body;

  // Validate required fields
  if (!name || !name.trim()) {
    return next(new AppError('Service name is required', 400));
  }

  // Check if service already exists
  const existingService = await prisma.service.findUnique({
    where: { name: name.trim() },
  });

  if (existingService) {
    return next(new AppError('Service with this name already exists', 400));
  }

  // Validate pricing values if provided
  const finalSmallPrice = smallJobPrice !== undefined ? parseFloat(smallJobPrice) : 15.00;
  const finalMediumPrice = mediumJobPrice !== undefined ? parseFloat(mediumJobPrice) : 30.00;
  const finalLargePrice = largeJobPrice !== undefined ? parseFloat(largeJobPrice) : 50.00;

  if (finalSmallPrice < 0 || finalMediumPrice < 0 || finalLargePrice < 0) {
    return next(new AppError('Prices cannot be negative', 400));
  }

  const service = await prisma.service.create({
    data: {
      name: name.trim(),
      description: description || '',
      category: category || '',
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      smallJobPrice: finalSmallPrice,
      mediumJobPrice: finalMediumPrice,
      largeJobPrice: finalLargePrice,
    },
  });

  res.status(201).json({
    status: 'success',
    message: 'Service created successfully',
    data: { service },
  });
});

// @desc    Update service details (name, description, category, isActive, pricing)
// @route   PATCH /api/admin/services/:id
// @access  Private/Admin
export const updateService = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { name, description, category, isActive, smallJobPrice, mediumJobPrice, largeJobPrice } = req.body;

  // Check if service exists
  const existingService = await prisma.service.findUnique({
    where: { id },
  });

  if (!existingService) {
    return next(new AppError('Service not found', 404));
  }

  // If name is being changed, check for uniqueness
  if (name && name !== existingService.name) {
    const nameExists = await prisma.service.findUnique({
      where: { name },
    });

    if (nameExists) {
      return next(new AppError('Service name already exists', 400));
    }
  }

  // Validate pricing values if provided
  if (smallJobPrice !== undefined && smallJobPrice < 0) {
    return next(new AppError('Small job price cannot be negative', 400));
  }
  if (mediumJobPrice !== undefined && mediumJobPrice < 0) {
    return next(new AppError('Medium job price cannot be negative', 400));
  }
  if (largeJobPrice !== undefined && largeJobPrice < 0) {
    return next(new AppError('Large job price cannot be negative', 400));
  }

  // Build update data object
  const updateData: any = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (category !== undefined) updateData.category = category;
  if (isActive !== undefined) updateData.isActive = Boolean(isActive);
  if (smallJobPrice !== undefined) updateData.smallJobPrice = parseFloat(smallJobPrice);
  if (mediumJobPrice !== undefined) updateData.mediumJobPrice = parseFloat(mediumJobPrice);
  if (largeJobPrice !== undefined) updateData.largeJobPrice = parseFloat(largeJobPrice);

  const service = await prisma.service.update({
    where: { id },
    data: updateData,
  });

  res.status(200).json({
    status: 'success',
    message: 'Service updated successfully',
    data: { service },
  });
});

// @desc    Search contractors for credit management
// @route   GET /api/admin/contractors-search
// @access  Private/Admin
export const searchContractorsForCredits = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { query } = req.query;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (query) {
    where.OR = [
      { businessName: { contains: query as string, mode: 'insensitive' } },
      { user: { name: { contains: query as string, mode: 'insensitive' } } },
      { user: { email: { contains: query as string, mode: 'insensitive' } } },
    ];
  }

  const contractors = await prisma.contractor.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
  });

  const total = await prisma.contractor.count({ where });

  res.status(200).json({
    status: 'success',
    data: {
      contractors,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get contractor credit details
// @route   GET /api/admin/contractors/:id/credits
// @access  Private/Admin
export const getContractorCredits = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const contractor = await prisma.contractor.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
      creditTransactions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { contractor },
  });
});

// @desc    Adjust contractor credits
// @route   POST /api/admin/contractors/:id/adjust-credits
// @access  Private/Admin
export const adjustContractorCredits = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { amount, reason, type } = req.body;

  if (!amount || !reason || !type) {
    return next(new AppError('Amount, reason, and type are required', 400));
  }

  if (!['ADDITION', 'DEDUCTION'].includes(type)) {
    return next(new AppError('Type must be ADDITION or DEDUCTION', 400));
  }

  const contractor = await prisma.contractor.findUnique({
    where: { id },
    select: { id: true, creditsBalance: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  // Check if deduction would result in negative balance
  if (type === 'DEDUCTION' && contractor.creditsBalance < amount) {
    return next(new AppError('Insufficient credits for deduction', 400));
  }

  const oldBalance = contractor.creditsBalance;
  const newBalance = type === 'ADDITION' 
    ? oldBalance + amount 
    : oldBalance - amount;

  await prisma.$transaction(async (tx) => {
    // Update contractor balance
    await tx.contractor.update({
      where: { id },
      data: {
        creditsBalance: type === 'ADDITION' 
          ? { increment: amount }
          : { decrement: amount },
      },
    });

    // Create transaction record
    await tx.creditTransaction.create({
      data: {
        contractorId: id,
        type,
        amount,
        description: `Admin adjustment: ${reason}`,
        adminUserId: req.admin!.id,
      },
    });
  });

  // Log the admin action to activity log
  await logActivity({
    adminId: req.admin!.id,
    action: type === 'ADDITION' ? 'CONTRACTOR_CREDITS_ADDED' : 'CONTRACTOR_CREDITS_DEDUCTED',
    entityType: 'Contractor',
    entityId: id,
    description: `${type === 'ADDITION' ? 'Added' : 'Deducted'} ${amount} credits: ${reason}`,
    diff: {
      before: oldBalance,
      after: newBalance,
      amount,
      type,
      reason,
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });

  // Send notification to contractor about credit adjustment
  try {
    const contractorWithUser = await prisma.contractor.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    if (contractorWithUser?.user) {
      const { createNotification } = await import('../services/notificationService');
      await createNotification({
        userId: contractorWithUser.user.id,
        title: type === 'ADDITION' ? '🎁 Bonus Credits Added!' : 'Credits Adjusted',
        message: type === 'ADDITION' 
          ? `You received ${amount} bonus credit${amount > 1 ? 's' : ''}! New balance: ${newBalance} credits. Reason: ${reason}`
          : `${amount} credit${amount > 1 ? 's' : ''} ${amount > 1 ? 'were' : 'was'} deducted from your account. New balance: ${newBalance} credits. Reason: ${reason}`,
        type: type === 'ADDITION' ? 'SUCCESS' : 'INFO',
        actionLink: '/dashboard/contractor',
        actionText: 'View Dashboard',
      });
    }
  } catch (error) {
    console.error('Failed to send credit notification:', error);
  }

  res.status(200).json({
    status: 'success',
    message: 'Credits adjusted successfully',
  });
});

// @desc    Get payment system overview stats
// @route   GET /api/admin/payment-overview
// @access  Private/Admin
export const getPaymentOverview = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const [
    totalServices,
    totalContractors,
    totalCreditsInCirculation,
    totalPayments,
    totalRevenue,
    recentPayments,
    creditTransactions,
  ] = await Promise.all([
    prisma.service.count(),
    prisma.contractor.count(),
    prisma.contractor.aggregate({
      _sum: { creditsBalance: true },
    }),
    prisma.payment.count(),
    prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
    }),
    prisma.payment.findMany({
      include: {
        contractor: {
          include: {
            user: { select: { name: true } },
          },
        },
        job: {
          select: { title: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.creditTransaction.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
    }),
  ]);

  const stats = {
    totalServices,
    totalContractors,
    totalCreditsInCirculation: totalCreditsInCirculation._sum.creditsBalance || 0,
    totalPayments,
    totalRevenue: totalRevenue._sum.amount || 0,
    recentPayments,
    weeklyTransactions: creditTransactions,
  };

  res.status(200).json({
    status: 'success',
    data: { stats },
  });
});

// @desc    Get all reviews (Admin only)
// @route   GET /api/admin/reviews
// @access  Private/Admin
export const getAllReviewsAdmin = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;
  const { status, rating, search } = req.query;

  const where: any = {};
  if (status === 'approved') where.isVerified = true;
  if (status === 'pending') where.isVerified = false;
  if (rating) where.rating = parseInt(rating as string);
  if (search) {
    where.OR = [
      { comment: { contains: search as string, mode: 'insensitive' } },
      { customer: { user: { name: { contains: search as string, mode: 'insensitive' } } } },
      { contractor: { user: { name: { contains: search as string, mode: 'insensitive' } } } },
    ];
  }

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      skip,
      take: limit,
      include: {
        customer: { include: { user: true } },
        contractor: { include: { user: true } },
        job: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.review.count({ where }),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      reviews,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// Helper function to update contractor rating after review verification
// Counts all PUBLISHED reviews (not flagged) for reviewCount and averageRating.
async function updateContractorRating(contractorId: string) {
  // Get all published (unflagged) reviews for the contractor
  const publishedReviews = await prisma.review.findMany({
    where: {
      contractorId,
      flagReason: null, // only published / not-flagged reviews
    },
    select: {
      rating: true,
    },
  });

  // Calculate average rating from published reviews
  const totalRating = publishedReviews.reduce((sum, review) => sum + review.rating, 0);
  const averageRating = publishedReviews.length > 0 ? totalRating / publishedReviews.length : 0;

  // Count verified (and published) reviews separately
  const verifiedReviews = await prisma.review.count({
    where: {
      contractorId,
      isVerified: true,
      flagReason: null,
    },
  });

  // Also compute live completed jobs count so the stale column stays in sync
  const completedJobs = await prisma.job.count({
    where: {
      status: 'COMPLETED',
      OR: [
        { wonByContractorId: contractorId },
        { jobAccess: { some: { contractorId } } },
      ],
    },
  });

  // Update contractor aggregate columns
  await prisma.contractor.update({
    where: { id: contractorId },
    data: {
      averageRating,
      reviewCount: publishedReviews.length,
      verifiedReviews,
      jobsCompleted: completedJobs,
    },
  });
}

// @desc    Verify/approve a review (Admin only)
// @route   PATCH /api/admin/reviews/:id/verify
// @access  Private/Admin
export const verifyReviewAdmin = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  // Get review
  const review = await prisma.review.findUnique({
    where: { id },
  });

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  // Update review to verified
  const updatedReview = await prisma.review.update({
    where: { id },
    data: {
      isVerified: true,
    },
    include: {
      customer: { include: { user: true } },
      contractor: { include: { user: true } },
      job: { select: { title: true } },
    },
  });

  // Update contractor rating and verified reviews count
  await updateContractorRating(review.contractorId);

  res.status(200).json({
    status: 'success',
    data: {
      review: updatedReview,
    },
  });
});

// @desc    Reject/unverify a review (Admin only)
// @route   PATCH /api/admin/reviews/:id/reject
// @access  Private/Admin
export const rejectReviewAdmin = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { reason } = req.body;

  // Get review
  const review = await prisma.review.findUnique({
    where: { id },
  });

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  // Update review to rejected (unverified with flag reason)
  const updatedReview = await prisma.review.update({
    where: { id },
    data: {
      isVerified: false,
      flagReason: reason || 'Rejected by admin',
    },
    include: {
      customer: { include: { user: true } },
      contractor: { include: { user: true } },
      job: { select: { title: true } },
    },
  });

  // Update contractor rating (in case review was previously verified)
  await updateContractorRating(review.contractorId);

  res.status(200).json({
    status: 'success',
    data: {
      review: updatedReview,
    },
  });
});

// @desc    Update job lead price
// @route   PATCH /api/admin/jobs/:id/lead-price
// @access  Private/Admin
export const setJobLeadPrice = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { price, reason } = req.body;

  // Validate price
  if (price < 0) {
    return next(new AppError('Lead price cannot be negative', 400));
  }

  if (!reason || reason.trim().length === 0) {
    return next(new AppError('Reason for price adjustment is required', 400));
  }

  // Check if job exists
  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      customer: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      service: {
        select: {
          name: true,
          category: true,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  const oldPrice = job.leadPrice ? (typeof job.leadPrice.toNumber === 'function' ? job.leadPrice.toNumber() : job.leadPrice) : 0;

  // Update job lead price
  const updatedJob = await prisma.job.update({
    where: { id },
    data: {
      leadPrice: price,
      updatedAt: new Date(),
    },
    include: {
      customer: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      service: {
        select: {
          name: true,
          category: true,
        },
      },
    },
  });

  // Log the admin action to activity log
  await logActivity({
    adminId: req.admin!.id,
    action: 'JOB_LEAD_PRICE_UPDATE',
    entityType: 'Job',
    entityId: job.id,
    description: reason,
    diff: {
      before: oldPrice,
      after: price,
      reason,
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });



  res.status(200).json({
    status: 'success',
    data: {
      job: updatedJob,
    },
    message: `Job lead price updated to £${price} successfully`,
  });
});

// @desc    Update job budget
// @route   PATCH /api/admin/jobs/:id/budget
// @access  Private/Admin
export const setJobBudget = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { budget, reason } = req.body;

  // Validate budget
  if (budget < 0) {
    return next(new AppError('Job budget cannot be negative', 400));
  }

  if (!reason || reason.trim().length === 0) {
    return next(new AppError('Reason for budget adjustment is required', 400));
  }

  // Check if job exists
  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      customer: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      service: {
        select: {
          name: true,
          category: true,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  const oldBudget = job.budget ? (typeof job.budget.toNumber === 'function' ? job.budget.toNumber() : job.budget) : 0;

  // Update job budget
  const updatedJob = await prisma.job.update({
    where: { id },
    data: {
      budget: budget,
      updatedAt: new Date(),
    },
    include: {
      customer: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      service: {
        select: {
          name: true,
          category: true,
        },
      },
    },
  });

  // Log the admin action to activity log
  await logActivity({
    adminId: req.admin!.id,
    action: 'JOB_BUDGET_UPDATE',
    entityType: 'Job',
    entityId: job.id,
    description: reason,
    diff: {
      before: oldBudget,
      after: budget,
      reason,
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });



  res.status(200).json({
    status: 'success',
    data: {
      job: updatedJob,
    },
    message: `Job budget updated to £${budget} successfully`,
  });
});

// @desc    Get admin settings
// @route   GET /api/admin/settings
// @access  Private (Admin only)
export const getAdminSettings = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const settings = await prisma.adminSettings.findMany({
    orderBy: { key: 'asc' },
  });

  // Convert to key-value object for easier frontend usage
  const settingsObject = settings.reduce((acc, setting) => {
    // Try to parse JSON values, otherwise use as-is
    let parsedValue;
    try {
      parsedValue = JSON.parse(setting.value);
    } catch {
      // If parsing fails, use the raw string value
      parsedValue = setting.value;
    }

    acc[setting.key] = {
      value: parsedValue,
      description: setting.description,
      updatedAt: setting.updatedAt,
    };
    return acc;
  }, {} as Record<string, any>);

  res.status(200).json({
    status: 'success',
    data: {
      settings: settingsObject,
    },
  });
});

// @desc    Update admin setting
// @route   PATCH /api/admin/settings/:key
// @access  Private (Admin only)
export const updateAdminSetting = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { key } = req.params;
  const { value, description } = req.body;

  if (!value) {
    return next(new AppError('Setting value is required', 400));
  }

  // Convert value to string - if it's an object, stringify it as JSON
  const valueString = typeof value === 'object' ? JSON.stringify(value) : value.toString();

  const setting = await prisma.adminSettings.upsert({
    where: { key },
    update: {
      value: valueString,
      ...(description && { description }),
    },
    create: {
      key,
      value: valueString,
      ...(description && { description }),
    },
  });

  // Log the activity
  await logActivity({
    adminId: req.admin!.id,
    action: 'SETTINGS_UPDATE',
    entityType: 'AdminSettings',
    entityId: setting.id,
    description: `Updated setting: ${key}`,
    diff: {
      key,
      value: valueString,
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });

  res.status(200).json({
    status: 'success',
    data: {
      setting,
    },
  });
});

// @desc    Update job contractor limit
// @route   PATCH /api/admin/jobs/:id/contractor-limit
// @access  Private (Admin only)
export const updateJobContractorLimit = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { maxContractorsPerJob, reason } = req.body;

  if (!maxContractorsPerJob || maxContractorsPerJob < 1) {
    return next(new AppError('Maximum contractors per job must be at least 1', 400));
  }

  if (!reason || reason.trim().length === 0) {
    return next(new AppError('Reason for contractor limit adjustment is required', 400));
  }

  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      jobAccess: true,
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if reducing the limit would conflict with existing purchases
  if (maxContractorsPerJob < job.jobAccess.length) {
    return next(new AppError(`Cannot set limit to ${maxContractorsPerJob} as ${job.jobAccess.length} contractors have already purchased this job`, 400));
  }

  const oldLimit = job.maxContractorsPerJob || 5;

  const updatedJob = await prisma.job.update({
    where: { id },
    data: {
      maxContractorsPerJob: parseInt(maxContractorsPerJob),
    },
  });

  // Log the admin action to activity log
  await logActivity({
    adminId: req.admin!.id,
    action: 'JOB_CONTRACTOR_LIMIT_UPDATE',
    entityType: 'Job',
    entityId: job.id,
    description: reason,
    diff: {
      before: oldLimit,
      after: parseInt(maxContractorsPerJob),
      reason,
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });

  res.status(200).json({
    status: 'success',
    data: {
      job: updatedJob,
    },
  });
});

// @desc    Get all conversations (grouped by participants)
// @route   GET /api/admin/messages/conversations
// @access  Private/Admin
export const getAllConversations = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  // Map the authenticated admin to a corresponding User (by email) to align with messages sender/recipient relations
  const adminEmail = req.admin!.email;
  const adminUser = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true, role: true, email: true },
  });

  if (!adminUser) {
    return next(new AppError('Admin user mapping not found for messaging. Ensure an ADMIN user exists with this email.', 500));
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const skip = (page - 1) * limit;
  const { role, search } = req.query;

  // Build where clause - only messages involving this admin
  const adminId = adminUser.id;
  const whereClause: any = {
    OR: [
      { senderId: adminId },
      { recipientId: adminId },
    ],
  };
  
  if (role && role !== 'all') {
    // Add role filter while keeping admin filter
    const roleFilter: any = {
      OR: [
        { senderId: adminId, recipientRole: role as UserRole },
        { recipientId: adminId, senderRole: role as UserRole },
      ],
    };
    whereClause.AND = [whereClause.OR, roleFilter];
    delete whereClause.OR;
  }

  if (search) {
    const searchFilter: any = {
      OR: [
        { sender: { name: { contains: search as string, mode: 'insensitive' } } },
        { sender: { email: { contains: search as string, mode: 'insensitive' } } },
        { recipient: { name: { contains: search as string, mode: 'insensitive' } } },
        { recipient: { email: { contains: search as string, mode: 'insensitive' } } },
        { content: { contains: search as string, mode: 'insensitive' } },
      ],
    };
    if (whereClause.AND) {
      whereClause.AND.push(searchFilter);
    } else {
      whereClause.AND = [whereClause.OR, searchFilter];
      delete whereClause.OR;
    }
  }

  // Get all messages with pagination
  const [messagesData, total] = await Promise.all([
    prisma.message.findMany({
      where: whereClause,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            customer: {
              select: {
                id: true,
                phone: true,
              },
            },
            contractor: {
              select: {
                id: true,
                businessName: true,
              },
            },
          },
        },
        recipient: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            customer: {
              select: {
                id: true,
                phone: true,
              },
            },
            contractor: {
              select: {
                id: true,
                businessName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.message.count({ where: whereClause }),
  ]);

  // Group messages by conversation (unique pairs of admin and user)
  // Each admin has separate conversations with each user
  const conversationMap = new Map<string, any>();
  
  messagesData.forEach((message: Message & { sender: any; recipient: any }) => {
    const senderId = message.senderId;
    const recipientId = message.recipientId;
    
    // Determine which is the admin and which is the user
    const isAdminSender = message.sender.role === 'ADMIN' || message.sender.role === 'SUPER_ADMIN';
    const isAdminRecipient = message.recipient.role === 'ADMIN' || message.recipient.role === 'SUPER_ADMIN';
    
    // Only include messages where current admin is involved
    if ((isAdminSender && senderId === adminId) || (isAdminRecipient && recipientId === adminId)) {
      // Get the other user (not admin)
      const otherUserId = isAdminSender ? recipientId : senderId;
      
      // Create a unique key: adminId-userId (ensures each admin has separate conversations)
      const conversationKey = `${adminId}-${otherUserId}`;
      
      if (!conversationMap.has(conversationKey)) {
        const otherUser = isAdminSender ? message.recipient : message.sender;
        
        conversationMap.set(conversationKey, {
          id: conversationKey,
          adminId: adminId,
          userId: otherUserId,
          participant1: message.sender,
          participant2: message.recipient,
          otherUser: otherUser,
          lastMessage: message,
          messageCount: 1,
          unreadCount: 0,
          lastMessageAt: message.createdAt,
        });
      } else {
        const conversation = conversationMap.get(conversationKey);
        conversation.messageCount += 1;
        if (!message.isRead && message.recipientId === adminId) {
          conversation.unreadCount += 1;
        }
        // Update last message if this one is newer
        if (message.createdAt > conversation.lastMessageAt) {
          conversation.lastMessage = message;
          conversation.lastMessageAt = message.createdAt;
        }
      }
    }
  });

  // Convert map to array and sort by last message time
  const conversations = Array.from(conversationMap.values())
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  res.status(200).json({
    status: 'success',
    data: {
      conversations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get conversation with a specific user
// @route   GET /api/admin/messages/conversation/:userId
// @access  Private/Admin
export const getConversationWithUser = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  // Map the authenticated admin to a corresponding User (by email)
  const adminEmail = req.admin!.email;
  const adminUser = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true, role: true, email: true },
  });

  if (!adminUser) {
    return next(new AppError('Admin user mapping not found for messaging. Ensure an ADMIN user exists with this email.', 500));
  }

  const adminId = adminUser.id;
  const userId = req.params.userId;

  // Get user details
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      customer: {
        select: {
          id: true,
          phone: true,
          address: true,
          city: true,
        },
      },
      contractor: {
        select: {
          id: true,
          businessName: true,
          businessAddress: true,
        },
      },
    },
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Get all messages between admin and this user
  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: adminId, recipientId: userId },
        { senderId: userId, recipientId: adminId },
      ],
    },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
      recipient: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Mark messages as read if admin is viewing them
  await prisma.message.updateMany({
    where: {
      recipientId: adminId,
      senderId: userId,
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      user,
      messages,
    },
  });
});

// @desc    Get users (customers and contractors) for starting new conversations
// @route   GET /api/admin/messages/users
// @access  Private/Admin
export const getUsersForChat = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { search, role } = req.query;
  const limit = parseInt(req.query.limit as string) || 50;

  const whereClause: any = {
    role: { in: ['CUSTOMER', 'CONTRACTOR'] },
    isActive: true,
  };

  if (role && role !== 'all') {
    whereClause.role = role as UserRole;
  }

  if (search) {
    whereClause.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
      { contractor: { businessName: { contains: search as string, mode: 'insensitive' } } },
    ];
  }

  const users = await prisma.user.findMany({
    where: whereClause,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      customer: {
        select: {
          id: true,
          phone: true,
        },
      },
      contractor: {
        select: {
          id: true,
          businessName: true,
        },
      },
    },
    take: limit,
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json({
    status: 'success',
    data: { users },
  });
});

// @desc    Broadcast notification to selected users
// @route   POST /api/admin/notifications/broadcast
// @access  Private/Admin
export const broadcastNotification = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { title, message, userIds, role, type, actionLink, actionText } = req.body;

  if (!title || !message) {
    return next(new AppError('Title and message are required', 400));
  }

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return next(new AppError('At least one user must be selected', 400));
  }

  // Verify all users exist and are active
  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      isActive: true,
      role: role ? (role as UserRole) : { in: ['CUSTOMER', 'CONTRACTOR'] },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  });

  if (users.length === 0) {
    return next(new AppError('No valid users found to send notification to', 400));
  }

  // Create notifications for all selected users
  const { createBulkNotifications } = await import('../services/notificationService');
  
  const notifications = users.map(user => ({
    userId: user.id,
    title,
    message,
    type: type || 'INFO',
    actionLink,
    actionText,
    metadata: {
      broadcast: true,
      sentBy: req.admin!.id,
      sentByAdmin: req.admin!.name,
    },
  }));

  await createBulkNotifications(notifications);

  // Log the broadcast action
  await logActivity({
    adminId: req.admin!.id,
    action: 'BROADCAST_NOTIFICATION',
    entityType: 'Notification',
    entityId: undefined,
    description: `Broadcast notification "${title}" to ${users.length} user(s)`,
    diff: {
      title,
      message,
      recipientCount: users.length,
      roles: [...new Set(users.map(u => u.role))],
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });

  res.status(200).json({
    status: 'success',
    message: `Notification sent to ${users.length} user(s)`,
    data: {
      sentCount: users.length,
      recipients: users.map(u => ({ id: u.id, name: u.name, email: u.email })),
    },
  });
});

// @desc    Send message as admin
// @route   POST /api/admin/messages/send
// @access  Private/Admin
export const sendMessageAsAdmin = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { recipientId, subject, content, relatedJobId, attachmentUrls } = req.body;
  // Map the authenticated admin to a corresponding User (by email)
  const adminEmail = req.admin!.email;
  const adminUserRecord = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true, role: true, name: true },
  });

  if (!adminUserRecord) {
    return next(new AppError('Admin user mapping not found for messaging. Ensure an ADMIN user exists with this email.', 500));
  }

  const adminId = adminUserRecord.id;

  if (!recipientId || !content) {
    return next(new AppError('Recipient and message content are required', 400));
  }

  // Get recipient information
  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { id: true, role: true, email: true, name: true },
  });

  if (!recipient) {
    return next(new AppError('Recipient not found', 404));
  }

  // Verify recipient is a customer or contractor (not another admin)
  if (recipient.role === 'ADMIN' || recipient.role === 'SUPER_ADMIN') {
    return next(new AppError('Cannot send messages to other admins', 403));
  }

  // Create the message
  const message = await prisma.message.create({
    data: {
      senderId: adminId,
      senderRole: adminUserRecord.role as UserRole,
      recipientId,
      recipientRole: recipient.role as UserRole,
      subject: subject || `Message from ${adminUserRecord.name}`,
      content,
      relatedJobId,
      attachmentUrls: attachmentUrls || [],
    },
  });

  // Create notification for recipient
  const { createNotification } = await import('../services/notificationService');
  
  // Set correct actionLink based on recipient role
  let actionLink: string;
  if (recipient.role === 'CONTRACTOR') {
    // Contractor recipients go to contractor messages page
    actionLink = `/dashboard/contractor/messages`;
  } else if (recipient.role === 'CUSTOMER') {
    // Customer recipients go to customer messages page
    actionLink = `/dashboard/client/messages`;
  } else {
    // Fallback (shouldn't happen as we check for admin recipients above)
    actionLink = `/messages/${message.id}`;
  }
  
  await createNotification({
    userId: recipientId,
    title: subject || 'New Message',
    message: `You have a new message from ${adminUserRecord.name}`,
    type: 'MESSAGE_RECEIVED',
    actionLink,
    actionText: 'View Message',
  });

  res.status(201).json({
    status: 'success',
    message: 'Message sent successfully',
    data: { message },
  });
});

// Apply admin middleware to all routes
router.use(protectAdmin);

// Routes with Permission Checks
// Dashboard - available to all admins
router.get('/dashboard', getDashboardStats);
router.get('/analytics', getAnalytics);

// Contractors Management
router.get('/contractors/pending', requirePermission(AdminPermission.CONTRACTORS_READ), getPendingContractors);
router.patch('/contractors/:id/approve', requirePermission(AdminPermission.CONTRACTORS_APPROVE), approveContractor);
router.get('/contractors', requirePermission(AdminPermission.CONTRACTORS_READ), getAllContractors);
router.patch('/contractors/:id/approval', requirePermission(AdminPermission.CONTRACTORS_APPROVE), updateContractorApproval);
router.patch('/contractors/:id/status', requirePermission(AdminPermission.CONTRACTORS_WRITE), updateContractorStatus);

// Delete contractor
router.delete('/contractors/:id', requirePermission(AdminPermission.CONTRACTORS_WRITE), catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { reason } = req.body;

  // Find contractor with user info
  const contractor = await prisma.contractor.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  // Store contractor info for logging
  const contractorName = contractor.businessName || contractor.user.name;
  const contractorEmail = contractor.user.email;

  // Delete related records first (foreign key constraints)
  await prisma.$transaction(async (tx) => {
    // Delete credit transactions
    await tx.creditTransaction.deleteMany({ where: { contractorId: id } });
    
    // Delete job applications
    await tx.jobApplication.deleteMany({ where: { contractorId: id } });
    
    // Delete job access records
    await tx.jobAccess.deleteMany({ where: { contractorId: id } });
    
    // Delete portfolio items
    await tx.portfolioItem.deleteMany({ where: { contractorId: id } });
    
    // Delete payments
    await tx.payment.deleteMany({ where: { contractorId: id } });
    
    // Delete notifications for contractor user
    await tx.notification.deleteMany({ where: { userId: contractor.user.id } });
    
    // Delete reviews where contractor is the subject
    await tx.review.deleteMany({ where: { contractorId: id } });
    
    // Delete KYC records
    await tx.contractorKyc.deleteMany({ where: { contractorId: id } });
    
    // Delete subscription
    await tx.subscription.deleteMany({ where: { contractorId: id } });
    
    // Delete the contractor profile
    await tx.contractor.delete({ where: { id } });
    
    // Optionally deactivate the user account (instead of deleting)
    await tx.user.update({
      where: { id: contractor.user.id },
      data: { isActive: false },
    });
  });

  // Log the admin action
  await logActivity({
    adminId: req.admin!.id,
    action: 'CONTRACTOR_DELETED',
    entityType: 'Contractor',
    entityId: id,
    description: `Deleted contractor ${contractorName} (${contractorEmail})${reason ? `: ${reason}` : ''}`,
    diff: {
      contractorName,
      contractorEmail,
      reason,
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });

  res.status(200).json({
    status: 'success',
    message: `Contractor ${contractorName} has been deleted successfully`,
  });
}));
router.patch('/contractors/:id/featured', requirePermission(AdminPermission.CONTRACTORS_WRITE), catchAsync(async (req: AdminAuthRequest, res: Response) => {
  const { id } = req.params;
  const { featuredContractor } = req.body;

  // Validate input
  if (typeof featuredContractor !== 'boolean') {
    return res.status(400).json({
      status: 'error',
      message: 'featuredContractor must be a boolean value'
    });
  }

  // Update contractor featured status
  const contractor = await prisma.contractor.update({
    where: { id },
    data: { featuredContractor },
    include: {
      user: {
        select: {
          name: true,
          email: true
        }
      }
    }
  });

  // Log the activity
  await logActivity({
    adminId: req.admin!.id,
    action: featuredContractor ? 'CONTRACTOR_FEATURED' : 'CONTRACTOR_UNFEATURED',
    entityType: 'Contractor',
    entityId: contractor.id,
    description: `Contractor ${contractor.businessName || contractor.user.name} ${featuredContractor ? 'marked as featured' : 'removed from featured'}`,
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });

  res.json({
    status: 'success',
    data: { contractor }
  });
}));
router.get('/contractors/stats', requirePermission(AdminPermission.CONTRACTORS_READ), getContractorStats);
router.get('/contractors-search', requirePermission(AdminPermission.CONTRACTORS_READ), searchContractorsForCredits);
router.get('/contractors/:id/credits', requirePermission(AdminPermission.CONTRACTORS_READ), getContractorCredits);
router.post('/contractors/:id/adjust-credits', requirePermission(AdminPermission.CONTRACTORS_WRITE), adjustContractorCredits);

// Contractor completed jobs and reviews
router.get('/contractors/:id/completed-jobs', requirePermission(AdminPermission.CONTRACTORS_READ), catchAsync(async (req: AdminAuthRequest, res: Response) => {
  const { id } = req.params;
  
  const jobs = await prisma.job.findMany({
    where: {
      wonByContractorId: id,
      status: 'COMPLETED',
    },
    select: {
      id: true,
      title: true,
      location: true,
      completionDate: true,
      finalAmount: true,
      createdAt: true,
      customer: {
        select: {
          user: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: { completionDate: 'desc' },
    take: 50,
  });
  
  res.status(200).json({
    status: 'success',
    data: { jobs },
  });
}));

router.get('/contractors/:id/reviews', requirePermission(AdminPermission.CONTRACTORS_READ), catchAsync(async (req: AdminAuthRequest, res: Response) => {
  const { id } = req.params;
  
  const reviews = await prisma.review.findMany({
    where: {
      contractorId: id,
    },
    include: {
      customer: {
        select: {
          user: {
            select: {
              name: true,
            },
          },
        },
      },
      job: {
        select: {
          title: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  
  res.status(200).json({
    status: 'success',
    data: { reviews },
  });
}));

// ======================================
// Contractor Media / Portfolio Management
// ======================================

// @desc    Get all portfolio items for a contractor
// @route   GET /api/admin/contractors/:id/portfolio
// @access  Private (Admin with contractors:read permission)
router.get('/contractors/:id/portfolio', requirePermission(AdminPermission.CONTRACTORS_READ), catchAsync(async (req: AdminAuthRequest, res: Response) => {
  const { id } = req.params;

  // Verify contractor exists
  const contractor = await prisma.contractor.findUnique({
    where: { id },
    select: { id: true, businessName: true },
  });

  if (!contractor) {
    return res.status(404).json({ status: 'error', message: 'Contractor not found' });
  }

  const portfolioItems = await prisma.portfolioItem.findMany({
    where: { contractorId: id },
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json({
    status: 'success',
    data: {
      contractor: { id: contractor.id, businessName: contractor.businessName },
      portfolioItems,
      total: portfolioItems.length,
    },
  });
}));

// @desc    Delete a contractor's portfolio item (removes from Cloudinary + DB)
// @route   DELETE /api/admin/contractors/:contractorId/portfolio/:itemId
// @access  Private (Admin with contractors:write permission)
router.delete('/contractors/:contractorId/portfolio/:itemId', requirePermission(AdminPermission.CONTRACTORS_WRITE), catchAsync(async (req: AdminAuthRequest, res: Response) => {
  const { contractorId, itemId } = req.params;
  const { reason } = req.body || {};

  // Find the portfolio item
  const portfolioItem = await prisma.portfolioItem.findFirst({
    where: {
      id: itemId,
      contractorId,
    },
  });

  if (!portfolioItem) {
    return res.status(404).json({ status: 'error', message: 'Portfolio item not found' });
  }

  // Delete from Cloudinary if cloudinaryId exists
  if (portfolioItem.cloudinaryId) {
    try {
      await deleteFromCloudinary(portfolioItem.cloudinaryId);
    } catch (cloudinaryError) {
      console.error('Failed to delete from Cloudinary:', cloudinaryError);
      // Continue with DB deletion even if Cloudinary fails
    }
  }

  // Delete from database
  await prisma.portfolioItem.delete({
    where: { id: itemId },
  });

  // Audit log
  await logActivity({
    adminId: req.admin!.id,
    adminName: req.admin!.name,
    action: 'DELETE_PORTFOLIO_ITEM',
    resourceType: 'PORTFOLIO_ITEM',
    resourceId: itemId,
    details: {
      contractorId,
      title: portfolioItem.title,
      imageUrl: portfolioItem.imageUrl,
      cloudinaryId: portfolioItem.cloudinaryId,
      reason: reason || 'Admin removed inappropriate/unwanted content',
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });

  // Notify the contractor
  try {
    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
      select: { userId: true, businessName: true },
    });

    if (contractor) {
      const { createNotification } = await import('../services/notificationService');
      await createNotification({
        userId: contractor.userId,
        type: 'SYSTEM',
        title: 'Portfolio Image Removed',
        message: `Your portfolio image "${portfolioItem.title}" has been removed by an administrator.${reason ? ` Reason: ${reason}` : ''}`,
      });
    }
  } catch (notifError) {
    console.error('Failed to send portfolio deletion notification:', notifError);
  }

  res.status(200).json({
    status: 'success',
    message: 'Portfolio item deleted successfully',
    data: {
      deletedItem: {
        id: portfolioItem.id,
        title: portfolioItem.title,
      },
    },
  });
}));

// Content Management
router.get('/content/flagged', requirePermission(AdminPermission.CONTENT_READ), getFlaggedContent);
router.post('/content/:type/:id/flag', requirePermission(AdminPermission.CONTENT_WRITE), flagContent);
router.patch('/content/:type/:id/moderate', requirePermission(AdminPermission.CONTENT_WRITE), moderateContent);

// Users Management
router.patch('/users/:id/manage', requirePermission(AdminPermission.USERS_WRITE), manageUser);
router.get('/users', requirePermission(AdminPermission.USERS_READ), getAllUsers);
router.post('/users/create-admin', createAdmin); // Keep SUPER_ADMIN only (handled in function)
router.get('/users/:id', requirePermission(AdminPermission.USERS_READ), getUserById);

// Payments Management
router.get('/payments/settings', requirePermission(AdminPermission.SETTINGS_READ), getSystemSettings);
router.patch('/payments/settings', requirePermission(AdminPermission.SETTINGS_WRITE), updateSystemSettings);
router.get('/payments/stats', requirePermission(AdminPermission.PAYMENTS_READ), getPaymentStats);
router.get('/payments/transactions', requirePermission(AdminPermission.PAYMENTS_READ), getPaymentTransactions);
router.post('/payments/:id/refund', requirePermission(AdminPermission.PAYMENTS_REFUND), processRefund);
router.get('/payment-overview', requirePermission(AdminPermission.PAYMENTS_READ), getPaymentOverview);

// Job Management
router.get('/jobs', requirePermission(AdminPermission.JOBS_READ), getAllJobsAdmin);
router.get('/jobs/stats', requirePermission(AdminPermission.JOBS_READ), getJobStats);
router.patch('/jobs/:id/status', requirePermission(AdminPermission.JOBS_WRITE), updateJobStatus);
router.patch('/jobs/:id/flag', requirePermission(AdminPermission.JOBS_WRITE), toggleJobFlag);

// Messages/Chat Management
router.get('/messages/conversations', requirePermission(AdminPermission.SUPPORT_READ), getAllConversations);
router.get('/messages/conversation/:userId', requirePermission(AdminPermission.SUPPORT_READ), getConversationWithUser);
router.get('/messages/users', requirePermission(AdminPermission.SUPPORT_READ), getUsersForChat);

// Broadcast Notifications
router.post('/notifications/broadcast', requirePermission(AdminPermission.SUPPORT_WRITE), broadcastNotification);

// Admin Message Sending
router.post('/messages/send', requirePermission(AdminPermission.SUPPORT_WRITE), sendMessageAsAdmin);
router.patch('/jobs/:id/lead-price', requirePermission(AdminPermission.PRICING_WRITE), setJobLeadPrice);
router.patch('/jobs/:id/budget', requirePermission(AdminPermission.JOBS_WRITE), setJobBudget);
router.patch('/jobs/:id/contractor-limit', requirePermission(AdminPermission.JOBS_WRITE), updateJobContractorLimit);

// @desc    Get unpaid commissions
// @route   GET /api/admin/unpaid-commissions
// @access  Private (Admin with payments:read permission)
export const getUnpaidCommissions = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const commissions = await prisma.commissionPayment.findMany({
    where: {
      status: {
        in: ['PENDING', 'OVERDUE']
      }
    },
    include: {
      contractor: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          }
        }
      },
      job: {
        select: {
          id: true,
          title: true,
        }
      },
      invoice: {
        select: {
          invoiceNumber: true,
        }
      }
    },
    orderBy: {
      dueDate: 'asc'
    }
  });

  res.status(200).json({
    status: 'success',
    data: {
      commissions,
    },
  });
});

router.get('/unpaid-commissions', requirePermission(AdminPermission.PAYMENTS_READ), getUnpaidCommissions);

// @desc    Manual override — mark a commission as Paid/Completed without a gateway transaction
// @route   POST /api/admin/commissions/:id/manual-override
// @access  Private (Admin with payments:write permission)
export const manualOverrideCommission = catchAsync(async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  const commissionId = req.params.id;
  const { reason, notes } = req.body;

  if (!reason || !reason.trim()) {
    return next(new AppError('A reason for the manual override is required', 400));
  }

  // 1. Look up the commission payment
  const commission = await prisma.commissionPayment.findUnique({
    where: { id: commissionId },
    include: {
      contractor: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      job: { select: { id: true, title: true } },
      invoice: { select: { invoiceNumber: true } },
    },
  });

  if (!commission) {
    return next(new AppError('Commission payment not found', 404));
  }

  if (commission.status === 'PAID') {
    return next(new AppError('This commission has already been marked as paid', 400));
  }

  if (commission.status === 'WAIVED') {
    return next(new AppError('This commission has been waived and cannot be marked as paid', 400));
  }

  // 2. Perform all DB updates in a transaction to keep data consistent
  const totalAmount = typeof (commission.totalAmount as any)?.toNumber === 'function'
    ? (commission.totalAmount as any).toNumber()
    : Number(commission.totalAmount);

  await prisma.$transaction(async (tx) => {
    // 2a. Update commission payment status to PAID
    await tx.commissionPayment.update({
      where: { id: commissionId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        // stripePaymentId intentionally left null — this is a manual override
      },
    });

    // 2b. Mark the related job as commission paid
    await tx.job.update({
      where: { id: commission.jobId },
      data: { commissionPaid: true },
    });

    // 2c. Create a Payment record so it shows in the transactions ledger
    await tx.payment.create({
      data: {
        contractorId: commission.contractorId,
        amount: commission.totalAmount,
        type: 'COMMISSION',
        status: 'COMPLETED',
        // No stripePaymentId — manual override
        description: `Commission for job: ${commission.job.title} [MANUAL OVERRIDE by ${req.admin!.name}: ${reason}]`,
      },
    });
  });

  // 3. Log the admin action in the audit log
  await logActivity({
    adminId: req.admin!.id,
    action: 'COMMISSION_MANUAL_OVERRIDE',
    entityType: 'CommissionPayment',
    entityId: commissionId,
    description: `Commission ${commissionId} for ${commission.contractor.user.name} (${commission.contractor.businessName || 'N/A'}) manually marked as Paid by ${req.admin!.name}. Amount: £${totalAmount.toFixed(2)}. Reason: ${reason}${notes ? '. Notes: ' + notes : ''}`,
    diff: {
      before: { status: commission.status },
      after: { status: 'PAID', manualOverride: true },
      reason,
      notes: notes || null,
    },
    ipAddress: getClientIp(req),
    userAgent: getClientUserAgent(req),
  });

  // 4. Notify the contractor (best-effort)
  try {
    const { createNotification } = await import('../services/notificationService');
    await createNotification({
      userId: commission.contractor.user.id,
      title: 'Commission Marked as Paid',
      message: `Your commission of £${totalAmount.toFixed(2)} for "${commission.job.title}" has been marked as paid by an administrator.`,
      type: 'SUCCESS',
      actionLink: '/dashboard/contractor/commissions',
      actionText: 'View Commissions',
    });
  } catch (notifError) {
    console.error('Failed to send manual override notification:', notifError);
  }

  res.status(200).json({
    status: 'success',
    message: `Commission of £${totalAmount.toFixed(2)} manually marked as Paid`,
    data: {
      commissionId,
      status: 'PAID',
      amount: totalAmount,
      processedBy: req.admin!.name,
      reason,
      notes: notes || null,
      createdAt: new Date().toISOString(),
    },
  });
});

router.post('/commissions/:id/manual-override', requirePermission(AdminPermission.PAYMENTS_WRITE), manualOverrideCommission);

// Pricing Management
router.get('/services', requirePermission(AdminPermission.PRICING_READ), getServicesWithPricing);
router.get('/services-pricing', requirePermission(AdminPermission.PRICING_READ), getServicesWithPricing); // Alias for backward compatibility
router.post('/services', requirePermission(AdminPermission.PRICING_WRITE), createService);
router.patch('/services/:id/pricing', requirePermission(AdminPermission.PRICING_WRITE), updateServicePricing);
router.put('/services/:id/pricing', requirePermission(AdminPermission.PRICING_WRITE), updateServicePricing); // Alias for backward compatibility
router.patch('/services/:id', requirePermission(AdminPermission.PRICING_WRITE), updateService);

// Reviews Management
router.get('/reviews', requirePermission(AdminPermission.REVIEWS_READ), getAllReviewsAdmin);
router.patch('/reviews/:id/verify', requirePermission(AdminPermission.REVIEWS_WRITE), verifyReviewAdmin);
router.patch('/reviews/:id/reject', requirePermission(AdminPermission.REVIEWS_WRITE), rejectReviewAdmin);

// Settings Management
router.get('/settings', requirePermission(AdminPermission.SETTINGS_READ), getAdminSettings);
router.patch('/settings/:key', requirePermission(AdminPermission.SETTINGS_WRITE), updateAdminSetting);

export default router; 
