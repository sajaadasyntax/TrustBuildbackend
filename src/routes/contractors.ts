import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';

const router = Router();

// @desc    Get all contractors (public)
// @route   GET /api/contractors
// @access  Public
export const getAllContractors = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  
  const { city, service, rating, search, tier, featured } = req.query;

  // Build filter conditions
  const where: any = {
    profileApproved: true,
    user: { isActive: true },
  };

  if (city) {
    where.city = { contains: city as string, mode: 'insensitive' };
  }

  if (service) {
    where.services = {
      some: {
        name: { contains: service as string, mode: 'insensitive' },
      },
    };
  }

  if (rating) {
    where.averageRating = { gte: parseFloat(rating as string) };
  }

  if (search) {
    where.OR = [
      { businessName: { contains: search as string, mode: 'insensitive' } },
      { description: { contains: search as string, mode: 'insensitive' } },
      { user: { name: { contains: search as string, mode: 'insensitive' } } },
    ];
  }

  if (tier) {
    where.tier = tier as string;
  }

  if (featured === 'true') {
    where.featuredContractor = true;
  }

  const contractors = await prisma.contractor.findMany({
    where,
    skip,
    take: limit,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      services: true,
      portfolio: {
        take: 3,
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: [
      { featuredContractor: 'desc' },
      { averageRating: 'desc' },
      { createdAt: 'desc' },
    ],
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

// @desc    Get single contractor
// @route   GET /api/contractors/:id
// @access  Public
export const getContractor = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { id: req.params.id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      },
      services: true,
      portfolio: {
        orderBy: { createdAt: 'desc' },
      },
      reviews: {
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
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      contractor,
    },
  });
});

// @desc    Create contractor profile
// @route   POST /api/contractors
// @access  Private
export const createContractorProfile = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Check if user already has a contractor profile
  const existingContractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (existingContractor) {
    return next(new AppError('Contractor profile already exists', 400));
  }

  const {
    businessName,
    description,
    businessAddress,
    city,
    postcode,
    phone,
    website,
    instagramHandle,
    operatingArea,
    servicesProvided,
    yearsExperience,
    workSetup,
    providesWarranty,
    warrantyPeriod,
    unsatisfiedCustomers,
    preferredClients,
    usesContracts,
    services,
  } = req.body;

  // Create contractor profile
  const contractor = await prisma.contractor.create({
    data: {
      userId: req.user!.id,
      businessName,
      description,
      businessAddress,
      city,
      postcode,
      phone,
      website,
      instagramHandle,
      operatingArea,
      servicesProvided,
      yearsExperience,
      workSetup,
      providesWarranty,
      warrantyPeriod,
      unsatisfiedCustomers,
      preferredClients,
      usesContracts,
      services: services ? {
        connect: services.map((serviceId: string) => ({ id: serviceId })),
      } : undefined,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      services: true,
    },
  });

  res.status(201).json({
    status: 'success',
    data: {
      contractor,
    },
  });
});

// @desc    Update contractor profile
// @route   PATCH /api/contractors/me
// @access  Private (Contractor only)
export const updateMyProfile = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const {
    businessName,
    description,
    businessAddress,
    city,
    postcode,
    phone,
    website,
    instagramHandle,
    operatingArea,
    servicesProvided,
    yearsExperience,
    workSetup,
    providesWarranty,
    warrantyPeriod,
    unsatisfiedCustomers,
    preferredClients,
    usesContracts,
    services,
  } = req.body;

  const updatedContractor = await prisma.contractor.update({
    where: { id: contractor.id },
    data: {
      ...(businessName && { businessName }),
      ...(description && { description }),
      ...(businessAddress && { businessAddress }),
      ...(city && { city }),
      ...(postcode && { postcode }),
      ...(phone && { phone }),
      ...(website && { website }),
      ...(instagramHandle && { instagramHandle }),
      ...(operatingArea && { operatingArea }),
      ...(servicesProvided && { servicesProvided }),
      ...(yearsExperience && { yearsExperience }),
      ...(workSetup && { workSetup }),
      ...(providesWarranty !== undefined && { providesWarranty }),
      ...(warrantyPeriod && { warrantyPeriod }),
      ...(unsatisfiedCustomers && { unsatisfiedCustomers }),
      ...(preferredClients && { preferredClients }),
      ...(usesContracts !== undefined && { usesContracts }),
      ...(services && {
        services: {
          set: services.map((serviceId: string) => ({ id: serviceId })),
        },
      }),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      services: true,
      portfolio: true,
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      contractor: updatedContractor,
    },
  });
});

// @desc    Get my contractor profile
// @route   GET /api/contractors/me
// @access  Private (Contractor only)
export const getMyProfile = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      services: true,
      portfolio: {
        orderBy: { createdAt: 'desc' },
      },
      applications: {
        include: {
          job: {
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
            },
          },
        },
        orderBy: { appliedAt: 'desc' },
      },
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      contractor,
    },
  });
});

// @desc    Get contractor earnings summary
// @route   GET /api/contractors/me/earnings
// @access  Private (Contractor only)
export const getMyEarnings = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
    select: { 
      id: true, 
      creditsBalance: true, 
      weeklyCreditsLimit: true, 
      lastCreditReset: true,
      subscription: true
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Calculate earnings from job payments
  const [
    totalEarnings,
    monthlyEarnings,
    pendingPayments,
    completedJobs,
    averageJobValue,
    totalWithdrawn,
    recentPayments
  ] = await Promise.all([
    // Total earnings from completed job payments
    prisma.payment.aggregate({
      where: {
        contractorId: contractor.id,
        type: 'JOB_PAYMENT',
        status: 'COMPLETED'
      },
      _sum: { amount: true }
    }),
    
    // Monthly earnings (current month)
    prisma.payment.aggregate({
      where: {
        contractorId: contractor.id,
        type: 'JOB_PAYMENT',
        status: 'COMPLETED',
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        }
      },
      _sum: { amount: true }
    }),
    
    // Pending job payments
    prisma.payment.aggregate({
      where: {
        contractorId: contractor.id,
        type: 'JOB_PAYMENT',
        status: 'PENDING'
      },
      _sum: { amount: true }
    }),
    
    // Count of completed jobs (from job applications that were accepted and jobs completed)
    prisma.jobApplication.count({
      where: {
        contractorId: contractor.id,
        status: 'ACCEPTED',
        job: {
          status: 'COMPLETED'
        }
      }
    }),
    
    // Average job value
    prisma.payment.aggregate({
      where: {
        contractorId: contractor.id,
        type: 'JOB_PAYMENT',
        status: 'COMPLETED'
      },
      _avg: { amount: true }
    }),
    
    // Total withdrawn (negative subscription payments)
    prisma.payment.aggregate({
      where: {
        contractorId: contractor.id,
        type: 'SUBSCRIPTION',
        status: 'COMPLETED'
      },
      _sum: { amount: true }
    }),
    
    // Recent payments for activity
    prisma.payment.findMany({
      where: {
        contractorId: contractor.id
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        job: {
          select: { id: true, title: true }
        }
      }
    })
  ]);

  // Calculate next credit reset date (weekly reset)
  const nextCreditReset = contractor.lastCreditReset 
    ? new Date(contractor.lastCreditReset.getTime() + 7 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const totalEarningsAmount = totalEarnings._sum.amount ? Number(totalEarnings._sum.amount) : 0;
  const totalWithdrawnAmount = totalWithdrawn._sum.amount ? Number(totalWithdrawn._sum.amount) : 0;

  const earnings = {
    totalEarnings: totalEarningsAmount,
    monthlyEarnings: monthlyEarnings._sum.amount ? Number(monthlyEarnings._sum.amount) : 0,
    pendingPayments: pendingPayments._sum.amount ? Number(pendingPayments._sum.amount) : 0,
    availableBalance: totalEarningsAmount - totalWithdrawnAmount,
    totalWithdrawn: totalWithdrawnAmount,
    jobsCompleted: completedJobs,
    averageJobValue: averageJobValue._avg.amount ? Number(averageJobValue._avg.amount) : 0,
    creditsBalance: contractor.creditsBalance,
    weeklyCreditsLimit: contractor.weeklyCreditsLimit,
    nextCreditReset: nextCreditReset.toISOString(),
    subscription: contractor.subscription,
    recentActivity: recentPayments
  };

  res.status(200).json({
    status: 'success',
    data: { earnings },
  });
});

// @desc    Delete contractor profile
// @route   DELETE /api/contractors/me
// @access  Private (Contractor only)
export const deleteMyProfile = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  await prisma.contractor.delete({
    where: { id: contractor.id },
  });

  res.status(200).json({
    status: 'success',
    message: 'Contractor profile deleted successfully',
  });
});

// @desc    Add portfolio item
// @route   POST /api/contractors/me/portfolio
// @access  Private (Contractor only)
export const addPortfolioItem = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const { title, description, imageUrl, projectDate } = req.body;

  const portfolioItem = await prisma.portfolioItem.create({
    data: {
      contractorId: contractor.id,
      title,
      description,
      imageUrl,
      projectDate: projectDate ? new Date(projectDate) : undefined,
    },
  });

  res.status(201).json({
    status: 'success',
    data: {
      portfolioItem,
    },
  });
});

// @desc    Update portfolio item
// @route   PATCH /api/contractors/me/portfolio/:itemId
// @access  Private (Contractor only)
export const updatePortfolioItem = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const portfolioItem = await prisma.portfolioItem.findFirst({
    where: {
      id: req.params.itemId,
      contractorId: contractor.id,
    },
  });

  if (!portfolioItem) {
    return next(new AppError('Portfolio item not found', 404));
  }

  const { title, description, imageUrl, projectType, completedAt } = req.body;

  const updatedItem = await prisma.portfolioItem.update({
    where: { id: req.params.itemId },
    data: {
      ...(title && { title }),
      ...(description && { description }),
      ...(imageUrl && { imageUrl }),
      ...(projectType && { projectType }),
      ...(completedAt && { completedAt: new Date(completedAt) }),
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      portfolioItem: updatedItem,
    },
  });
});

// @desc    Delete portfolio item
// @route   DELETE /api/contractors/me/portfolio/:itemId
// @access  Private (Contractor only)
export const deletePortfolioItem = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const portfolioItem = await prisma.portfolioItem.findFirst({
    where: {
      id: req.params.itemId,
      contractorId: contractor.id,
    },
  });

  if (!portfolioItem) {
    return next(new AppError('Portfolio item not found', 404));
  }

  await prisma.portfolioItem.delete({
    where: { id: req.params.itemId },
  });

  res.status(200).json({
    status: 'success',
    message: 'Portfolio item deleted successfully',
  });
});

// @desc    Approve contractor (Admin only)
// @route   PATCH /api/contractors/:id/approve
// @access  Private/Admin
export const approveContractor = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }

  const contractor = await prisma.contractor.update({
    where: { id: req.params.id },
    data: { profileApproved: true, status: 'VERIFIED' },
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

  res.status(200).json({
    status: 'success',
    data: {
      contractor,
    },
  });
});

// @desc    Reset weekly credits for all contractors
// @route   POST /api/contractors/reset-weekly-credits
// @access  Private/Admin or System
export const resetWeeklyCredits = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Get contractors who need credit reset (7 days or more since last reset)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const contractorsToReset = await prisma.contractor.findMany({
      where: {
        OR: [
          { lastCreditReset: null },
          { lastCreditReset: { lt: oneWeekAgo } }
        ]
      }
    });

    let resetCount = 0;

    for (const contractor of contractorsToReset) {
      await prisma.contractor.update({
        where: { id: contractor.id },
        data: {
          creditsBalance: contractor.weeklyCreditsLimit, // Reset to weekly limit (3)
          lastCreditReset: new Date()
        }
      });

      // Log the credit reset
      await prisma.creditTransaction.create({
        data: {
          contractorId: contractor.id,
          type: 'WEEKLY_ALLOCATION',
          amount: contractor.weeklyCreditsLimit,
          description: 'Weekly credit reset'
        }
      });

      resetCount++;
    }

    console.log(`🔄 Reset credits for ${resetCount} contractors`);

    res.status(200).json({
      status: 'success',
      data: {
        resetCount,
        message: `Credits reset for ${resetCount} contractors`
      }
    });
  } catch (error) {
    console.error('Error resetting weekly credits:', error);
    return next(new AppError('Failed to reset weekly credits', 500));
  }
});

// @desc    Check and auto-reset credits for a specific contractor
// @route   POST /api/contractors/me/check-credit-reset
// @access  Private (Contractor only)
export const checkAndResetCredits = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Check if credits need to be reset
  const now = new Date();
  const lastReset = contractor.lastCreditReset;
  let shouldReset = false;

  if (!lastReset) {
    shouldReset = true; // First time, reset immediately
  } else {
    const daysSinceReset = Math.floor((now.getTime() - lastReset.getTime()) / (1000 * 60 * 60 * 24));
    shouldReset = daysSinceReset >= 7;
  }

  if (shouldReset) {
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        creditsBalance: contractor.weeklyCreditsLimit,
        lastCreditReset: now
      }
    });

    // Log the credit reset
    await prisma.creditTransaction.create({
      data: {
        contractorId: contractor.id,
        type: 'WEEKLY_ALLOCATION',
        amount: contractor.weeklyCreditsLimit,
        description: 'Weekly credit reset'
      }
    });

    res.status(200).json({
      status: 'success',
      data: {
        creditsReset: true,
        newBalance: contractor.weeklyCreditsLimit,
        message: 'Credits have been reset for this week'
      }
    });
  } else {
    const nextResetDate = new Date(lastReset!);
    nextResetDate.setDate(nextResetDate.getDate() + 7);

    res.status(200).json({
      status: 'success',
      data: {
        creditsReset: false,
        currentBalance: contractor.creditsBalance,
        nextResetDate: nextResetDate.toISOString(),
        message: 'Credits do not need reset yet'
      }
    });
  }
});

// Routes
router.get('/', getAllContractors);
router.get('/me', protect, getMyProfile);
router.post('/', protect, createContractorProfile);
router.patch('/me', protect, updateMyProfile);
router.delete('/me', protect, deleteMyProfile);
router.post('/me/portfolio', protect, addPortfolioItem);
router.patch('/me/portfolio/:itemId', protect, updatePortfolioItem);
router.delete('/me/portfolio/:itemId', protect, deletePortfolioItem);
router.patch('/:id/approve', protect, approveContractor);
router.get('/:id', getContractor);
router.post('/reset-weekly-credits', protect, resetWeeklyCredits);
router.post('/me/check-credit-reset', protect, checkAndResetCredits);
router.get('/me/earnings', protect, getMyEarnings);

export default router; 