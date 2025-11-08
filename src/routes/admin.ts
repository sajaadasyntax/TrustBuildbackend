import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protectAdmin, requirePermission, AdminAuthRequest, hasPermission, getClientIp, getClientUserAgent } from '../middleware/adminAuth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { AdminPermission } from '../config/permissions';
import { logActivity } from '../services/auditService';
import bcrypt from 'bcryptjs';

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
    prisma.job.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { budget: true },
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
      total: totalRevenue._sum.budget || 0,
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
            currentPeriodEnd: true,
            stripeSubscriptionId: true,
          },
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
          include: {
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
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.job.count({ where: whereClause }),
  ]);

  // Calculate current lead price for each job
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

    return {
      ...job,
      currentLeadPrice,
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
      whereClause.status = status.toString().toUpperCase();
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
        status: payment.status.toLowerCase(),
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

  try {
    // Mock refund processing - replace with actual Stripe API calls
    const refund = {
      id: `re_${Date.now()}`,
      paymentId,
      amount,
      reason,
      status: 'succeeded',
      createdAt: new Date().toISOString()
    };

    // Log the admin action


    res.status(200).json({
      status: 'success',
      data: { refund },
      message: 'Refund processed successfully',
    });
  } catch (error) {
    console.error('Error in processRefund:', error);
    return next(new AppError('Failed to process refund', 500));
  }
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

  // Validate pricing values
  if (smallJobPrice < 0 || mediumJobPrice < 0 || largeJobPrice < 0) {
    return next(new AppError('Prices cannot be negative', 400));
  }

  const service = await prisma.service.update({
    where: { id },
    data: {
      smallJobPrice: parseFloat(smallJobPrice),
      mediumJobPrice: parseFloat(mediumJobPrice),
      largeJobPrice: parseFloat(largeJobPrice),
    },
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
router.patch('/jobs/:id/lead-price', requirePermission(AdminPermission.PRICING_WRITE), setJobLeadPrice);
router.patch('/jobs/:id/budget', requirePermission(AdminPermission.JOBS_WRITE), setJobBudget);
router.patch('/jobs/:id/contractor-limit', requirePermission(AdminPermission.JOBS_WRITE), updateJobContractorLimit);

// Pricing Management
router.get('/services', requirePermission(AdminPermission.PRICING_READ), getServicesWithPricing);
router.get('/services-pricing', requirePermission(AdminPermission.PRICING_READ), getServicesWithPricing); // Alias for backward compatibility
router.patch('/services/:id/pricing', requirePermission(AdminPermission.PRICING_WRITE), updateServicePricing);
router.put('/services/:id/pricing', requirePermission(AdminPermission.PRICING_WRITE), updateServicePricing); // Alias for backward compatibility

// Reviews Management
router.get('/reviews', requirePermission(AdminPermission.REVIEWS_READ), getAllReviewsAdmin);

// Settings Management
router.get('/settings', requirePermission(AdminPermission.SETTINGS_READ), getAdminSettings);
router.patch('/settings/:key', requirePermission(AdminPermission.SETTINGS_WRITE), updateAdminSetting);

export default router; 
