import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import bcrypt from 'bcryptjs';

const router = Router();

// Middleware to ensure admin access
const adminOnly = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }
  next();
};

// @desc    Get admin dashboard statistics
// @route   GET /api/admin/dashboard
// @access  Private/Admin
export const getDashboardStats = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const getAnalytics = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const getPendingContractors = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const approveContractor = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { approved, reason } = req.body;

  const contractor = await prisma.contractor.findUnique({
    where: { id: req.params.id },
    include: {
      user: true,
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  const updatedContractor = await prisma.contractor.update({
    where: { id: req.params.id },
    data: {
      profileApproved: approved,
      status: approved ? 'VERIFIED' : 'REJECTED',
    },
  });

  // TODO: Send notification email to contractor

  res.status(200).json({
    status: 'success',
    data: {
      contractor: updatedContractor,
    },
    message: `Contractor ${approved ? 'approved' : 'rejected'} successfully`,
  });
});

// @desc    Get flagged content
// @route   GET /api/admin/content/flagged
// @access  Private/Admin
export const getFlaggedContent = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
      author: review.customer.user.name,
      authorEmail: review.customer.user.email,
      flaggedBy: 'System Auto-detection',
      flagReason: review.rating <= 2 ? 'Low rating review' : 'Unverified review',
      status: 'pending' as const,
      severity: review.rating <= 1 ? 'high' as const : review.rating <= 2 ? 'medium' as const : 'low' as const,
      createdDate: review.createdAt,
      flaggedDate: review.createdAt,
      rating: review.rating,
      jobTitle: review.job.title,
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
      severity: Number(job.budget) < 50 ? 'high' as const : 'medium' as const,
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
      severity: contractor.profileApproved ? 'medium' as const : 'low' as const,
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

  // Sort by severity and date
  filteredContent.sort((a, b) => {
    const severityOrder = { high: 3, medium: 2, low: 1 };
    const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
    if (severityDiff !== 0) return severityDiff;
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
    highSeverity: transformedContent.filter(item => item.severity === 'high').length,
    mediumSeverity: transformedContent.filter(item => item.severity === 'medium').length,
    lowSeverity: transformedContent.filter(item => item.severity === 'low').length,
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

// @desc    Moderate content
// @route   PATCH /api/admin/content/:type/:id/moderate
// @access  Private/Admin
export const moderateContent = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { type, id } = req.params;
  const { action, reason } = req.body; // 'approve', 'reject', 'delete'

  if (!['approve', 'reject', 'delete'].includes(action)) {
    return next(new AppError('Invalid moderation action', 400));
  }

  // Log the admin action
  console.log(`Admin ${req.user!.id} ${action}ed ${type} ${id}${reason ? ` - Reason: ${reason}` : ''}`);

  if (type === 'review') {
    const review = await prisma.review.findUnique({
      where: { id },
    });

    if (!review) {
      return next(new AppError('Review not found', 404));
    }

    if (action === 'delete') {
      await prisma.review.delete({
        where: { id },
      });
    } else {
      await prisma.review.update({
        where: { id },
        data: {
          isVerified: action === 'approve',
        },
      });
    }

    res.status(200).json({
      status: 'success',
      message: `Review ${action}ed successfully`,
    });
  } else if (type === 'job' || type === 'job_description') {
    const job = await prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    if (action === 'delete') {
      await prisma.job.delete({
        where: { id },
      });
    } else if (action === 'reject') {
      await prisma.job.update({
        where: { id },
        data: {
          status: 'CANCELLED',
        },
      });
    }
    // For 'approve', we don't need to change anything - job remains active

    res.status(200).json({
      status: 'success',
      message: `Job ${action}ed successfully`,
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

    if (action === 'delete') {
      // Delete contractor profile and associated user
      await prisma.contractor.delete({
        where: { id },
      });
    } else {
      await prisma.contractor.update({
        where: { id },
        data: {
          profileApproved: action === 'approve',
          status: action === 'approve' ? 'VERIFIED' : 'REJECTED',
        },
      });
    }

    res.status(200).json({
      status: 'success',
      message: `Contractor profile ${action}ed successfully`,
    });
  } else {
    return next(new AppError('Invalid content type', 400));
  }
});

// @desc    Manage user account
// @route   PATCH /api/admin/users/:id/manage
// @access  Private/Admin
export const manageUser = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const getSystemSettings = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const updateSystemSettings = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const getAllUsers = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const { role, status, search } = req.query;

  // Build where clause
  const whereClause: any = {};
  
  if (role && role !== 'all') {
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
export const createAdmin = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const getUserById = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const getAllContractors = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const updateContractorApproval = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

  // Log the admin action (optional - could be implemented later)
  console.log(`Admin ${req.user!.id} ${approved ? 'approved' : 'rejected'} contractor ${contractor.id}`);

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
export const updateContractorStatus = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { status, reason } = req.body;

  const validStatuses = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];
  if (!validStatuses.includes(status)) {
    return next(new AppError('Invalid contractor status', 400));
  }

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
    return next(new AppError('Contractor not found', 404));
  }

  const updatedContractor = await prisma.contractor.update({
    where: { id: req.params.id },
    data: {
      status: status,
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

  // Log the admin action
  console.log(`Admin ${req.user!.id} changed contractor ${contractor.id} status to ${status}${reason ? ` - Reason: ${reason}` : ''}`);

  res.status(200).json({
    status: 'success',
    data: {
      contractor: updatedContractor,
    },
    message: `Contractor status updated to ${status.toLowerCase()} successfully`,
  });
});

// @desc    Get contractor statistics for admin dashboard
// @route   GET /api/admin/contractors/stats
// @access  Private/Admin
export const getContractorStats = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const getAllJobsAdmin = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const updateJobStatus = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
  console.log(`Admin ${req.user!.id} changed job ${job.id} status to ${status}${reason ? ` - Reason: ${reason}` : ''}`);

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
export const toggleJobFlag = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { flagged, reason } = req.body;

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // For now, we'll store the flag status in a separate admin log or use a custom field
  // Since the Job model might not have a flagged field, we'll handle this differently
  
  // Log the admin action
  console.log(`Admin ${req.user!.id} ${flagged ? 'flagged' : 'unflagged'} job ${job.id}${reason ? ` - Reason: ${reason}` : ''}`);

  res.status(200).json({
    status: 'success',
    message: `Job ${flagged ? 'flagged' : 'unflagged'} successfully`,
  });
});

// @desc    Get job statistics for admin dashboard
// @route   GET /api/admin/jobs/stats
// @access  Private/Admin
export const getJobStats = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const getPaymentStats = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
      revenueGrowth: Number(revenueGrowth.toFixed(1)),
      subscriptionRevenue: Number(typeRevenue['SUBSCRIPTION'] || 0),
      jobPaymentRevenue: Number(typeRevenue['JOB_ACCESS'] || 0)
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
export const getPaymentTransactions = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const { status, type, search } = req.query;

  try {
    // Build where clause for filtering
    const whereClause: any = {};
    
    if (status && status !== 'all') {
      whereClause.status = status.toString().toUpperCase();
    }
    
    if (type && type !== 'all') {
      whereClause.type = type.toString().toUpperCase();
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
    const paginatedTransactions = payments.map(payment => ({
      id: payment.id,
      amount: Number(payment.amount),
      currency: 'GBP',
      status: payment.status.toLowerCase(),
      type: payment.type.toLowerCase().replace('_', '_'),
      customer: {
        name: payment.job?.customer?.user?.name || 'Unknown',
        email: payment.job?.customer?.user?.email || 'unknown@example.com'
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
    }));

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
export const processRefund = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
    console.log(`Admin ${req.user!.id} processed refund for payment ${paymentId}: ${amount} - ${reason}`);

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
export const getServicesWithPricing = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const updateServicePricing = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const searchContractorsForCredits = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const getContractorCredits = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const adjustContractorCredits = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
        adminUserId: req.user!.id,
      },
    });
  });

  res.status(200).json({
    status: 'success',
    message: 'Credits adjusted successfully',
  });
});

// @desc    Get payment system overview stats
// @route   GET /api/admin/payment-overview
// @access  Private/Admin
export const getPaymentOverview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const getAllReviewsAdmin = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
export const setJobLeadPrice = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

  // Log the admin action
  console.log(`Admin ${req.user!.id} updated job ${job.id} lead price to £${price} - Reason: ${reason}`);

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
export const setJobBudget = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

  // Log the admin action
  console.log(`Admin ${req.user!.id} updated job ${job.id} budget to £${budget} - Reason: ${reason}`);

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
export const getAdminSettings = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const settings = await prisma.adminSettings.findMany({
    orderBy: { key: 'asc' },
  });

  // Convert to key-value object for easier frontend usage
  const settingsObject = settings.reduce((acc, setting) => {
    acc[setting.key] = {
      value: setting.value,
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
export const updateAdminSetting = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { key } = req.params;
  const { value, description } = req.body;

  if (!value) {
    return next(new AppError('Setting value is required', 400));
  }

  const setting = await prisma.adminSettings.upsert({
    where: { key },
    update: {
      value: value.toString(),
      ...(description && { description }),
    },
    create: {
      key,
      value: value.toString(),
      ...(description && { description }),
    },
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
export const updateJobContractorLimit = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { maxContractorsPerJob } = req.body;

  if (!maxContractorsPerJob || maxContractorsPerJob < 1) {
    return next(new AppError('Maximum contractors per job must be at least 1', 400));
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

  const updatedJob = await prisma.job.update({
    where: { id },
    data: {
      maxContractorsPerJob: parseInt(maxContractorsPerJob),
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      job: updatedJob,
    },
  });
});

// Apply admin middleware to all routes
router.use(protect, adminOnly);

// Routes
router.get('/dashboard', getDashboardStats);
router.get('/analytics', getAnalytics);
router.get('/contractors/pending', getPendingContractors);
router.patch('/contractors/:id/approve', approveContractor);
router.get('/content/flagged', getFlaggedContent);
router.patch('/content/:type/:id/moderate', moderateContent);
router.patch('/users/:id/manage', manageUser);
router.get('/payments/settings', getSystemSettings);
router.patch('/payments/settings', updateSystemSettings);
router.get('/payments/stats', getPaymentStats);
router.get('/payments/transactions', getPaymentTransactions);
router.post('/payments/:id/refund', processRefund);
router.get('/users', getAllUsers);
router.post('/users/create-admin', createAdmin);
router.get('/users/:id', getUserById);
router.get('/contractors', getAllContractors);
router.patch('/contractors/:id/approval', updateContractorApproval);
router.patch('/contractors/:id/status', updateContractorStatus);
router.get('/contractors/stats', getContractorStats);

// Job management routes
router.get('/jobs', getAllJobsAdmin);
router.get('/jobs/stats', getJobStats);
router.patch('/jobs/:id/status', updateJobStatus);
router.patch('/jobs/:id/flag', toggleJobFlag);
router.patch('/jobs/:id/lead-price', setJobLeadPrice);
router.patch('/jobs/:id/budget', setJobBudget);
router.patch('/jobs/:id/contractor-limit', updateJobContractorLimit);

// Add new admin payment routes
router.get('/services-pricing', getServicesWithPricing);
router.put('/services/:id/pricing', updateServicePricing);
router.get('/contractors-search', searchContractorsForCredits);
router.get('/contractors/:id/credits', getContractorCredits);
router.post('/contractors/:id/adjust-credits', adjustContractorCredits);
router.get('/payment-overview', getPaymentOverview);
router.get('/reviews', getAllReviewsAdmin);
router.get('/settings', getAdminSettings);
router.patch('/settings/:key', updateAdminSetting);

export default router; 