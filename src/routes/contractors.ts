import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, restrictTo, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';

const router = Router();

// @desc    Get all contractors (public)
// @route   GET /api/contractors
// @access  Public (but restricted for CUSTOMER role)
export const getAllContractors = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Block CUSTOMER role from browsing all contractors
  // They should only see contractors who applied to their jobs
  if (req.user && req.user.role === 'CUSTOMER') {
    return next(new AppError('Customers cannot browse all contractors. You can view contractors who apply to your jobs.', 403));
  }

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
        where: { flagReason: null }, // Only published/unflagged reviews
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

  // ── Live counts: replace stale aggregate columns with real DB queries ──
  const [publishedReviewAgg, publishedReviewCount, liveCompletedJobs] = await Promise.all([
    prisma.review.aggregate({
      where: { contractorId: contractor.id, flagReason: null },
      _avg: { rating: true },
    }),
    prisma.review.count({
      where: { contractorId: contractor.id, flagReason: null },
    }),
    prisma.job.count({
      where: {
        status: 'COMPLETED',
        OR: [
          { wonByContractorId: contractor.id },
          { jobAccess: { some: { contractorId: contractor.id } } },
        ],
      },
    }),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      contractor: {
        ...contractor,
        jobsCompleted: liveCompletedJobs,
        reviewCount: publishedReviewCount,
        averageRating: publishedReviewAgg._avg.rating ?? 0,
      },
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
    logoUrl,
    workSetup,
    providesWarranty,
    warrantyPeriod,
    unsatisfiedCustomers,
    preferredClients,
    usesContracts,
    services,
  } = req.body;

  // Get free job allocation from admin settings (default: 1)
  const { getFreeJobAllocation } = await import('../services/settingsService');
  const freeCredits = await getFreeJobAllocation();

  // Create contractor profile with free credits from admin setting
  // STANDARD tier contractors don't get weekly credits (weeklyCreditsLimit = 0)
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
      logoUrl,
      workSetup,
      providesWarranty,
      warrantyPeriod,
      unsatisfiedCustomers,
      preferredClients,
      usesContracts,
      creditsBalance: freeCredits, // Use admin setting for free credits
      weeklyCreditsLimit: 0, // Non-subscribed contractors don't get weekly credits
      lastCreditReset: null,
      hasUsedFreeTrial: false, // Track if they've used their free credits
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

  // Create credit transaction record for the free trial credits
  if (freeCredits > 0) {
    await prisma.creditTransaction.create({
      data: {
        contractorId: contractor.id,
        amount: freeCredits,
        type: 'BONUS',
        description: `Free trial credit${freeCredits > 1 ? 's' : ''} - new contractor welcome bonus (valid for small jobs only)`,
      },
    });
  }

  res.status(201).json({
    status: 'success',
    data: {
      contractor,
    },
    message: `Contractor profile created successfully. You have received ${freeCredits} free credit${freeCredits > 1 ? 's' : ''} to try the platform (valid for small jobs only).`,
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
    logoUrl,
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
      ...(businessName !== undefined && { businessName }),
      ...(description !== undefined && { description }),
      ...(businessAddress !== undefined && { businessAddress }),
      ...(city !== undefined && { city }),
      ...(postcode !== undefined && { postcode }),
      ...(phone !== undefined && { phone }),
      ...(website !== undefined && { website }),
      ...(instagramHandle !== undefined && { instagramHandle }),
      ...(operatingArea !== undefined && { operatingArea }),
      ...(servicesProvided !== undefined && { servicesProvided }),
      ...(yearsExperience !== undefined && { yearsExperience }),
      ...(logoUrl !== undefined && { logoUrl }),
      ...(workSetup !== undefined && { workSetup }),
      ...(providesWarranty !== undefined && { providesWarranty }),
      ...(warrantyPeriod !== undefined && { warrantyPeriod }),
      ...(unsatisfiedCustomers !== undefined && { unsatisfiedCustomers }),
      ...(preferredClients !== undefined && { preferredClients }),
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
      subscription: true,
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
              service: {
                select: {
                  id: true,
                  name: true,
                  category: true,
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

  // ── Live counts: replace stale aggregate columns with real DB queries ──

  // Live completed jobs: COUNT where status = 'COMPLETED' and contractor has access or was assigned
  const liveCompletedJobs = await prisma.job.count({
    where: {
      status: 'COMPLETED',
      OR: [
        { wonByContractorId: contractor.id },
        { jobAccess: { some: { contractorId: contractor.id } } },
      ],
    },
  });

  // Live review stats: only published reviews (not flagged)
  const [publishedReviewAgg, publishedReviewCount, verifiedReviewCount] = await Promise.all([
    prisma.review.aggregate({
      where: {
        contractorId: contractor.id,
        flagReason: null, // published = not flagged
      },
      _avg: { rating: true },
    }),
    prisma.review.count({
      where: {
        contractorId: contractor.id,
        flagReason: null,
      },
    }),
    prisma.review.count({
      where: {
        contractorId: contractor.id,
        isVerified: true,
        flagReason: null,
      },
    }),
  ]);

  // Filter location data for applications where contractor doesn't have access
  const contractorWithFilteredApps = {
    ...contractor,
    // Override stale aggregate columns with live values
    jobsCompleted: liveCompletedJobs,
    reviewCount: publishedReviewCount,
    averageRating: publishedReviewAgg._avg.rating ?? 0,
    verifiedReviews: verifiedReviewCount,
    applications: contractor.applications?.map((app: any) => ({
      ...app,
      job: {
        ...app.job,
        // Show only postcode for jobs without purchased access
        location: app.job.postcode ? `${app.job.postcode} area` : 'Area details available after purchase',
        // Limit description preview
        description: app.job.description.substring(0, 300) + '...',
        customer: {
          ...app.job.customer,
          user: {
            name: app.job.customer.user.name,
          },
          // Remove sensitive customer data
          phone: undefined,
        }
      }
    })) || []
  };

  res.status(200).json({
    status: 'success',
    data: {
      contractor: contractorWithFilteredApps,
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
    
    // Live count of completed jobs (via access or direct assignment)
    prisma.job.count({
      where: {
        status: 'COMPLETED',
        OR: [
          { wonByContractorId: contractor.id },
          { jobAccess: { some: { contractorId: contractor.id } } },
        ],
      },
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
    include: {
      portfolio: true,
    },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Enforce maximum of 20 portfolio items (work photos)
  if (contractor.portfolio.length >= 20) {
    return next(new AppError('Maximum of 20 portfolio items allowed. Please delete some existing items before adding new ones.', 400));
  }

  const { title, description, imageUrl, cloudinaryId, projectDate } = req.body;

  const portfolioItem = await prisma.portfolioItem.create({
    data: {
      contractorId: contractor.id,
      title,
      description,
      imageUrl,
      cloudinaryId,
      projectDate: projectDate ? new Date(projectDate) : undefined,
    },
  });

  res.status(201).json({
    status: 'success',
    data: {
      portfolioItem,
    },
    message: `Portfolio item added successfully. You have ${contractor.portfolio.length + 1} of 20 items.`,
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
        AND: [
          {
            OR: [
              { lastCreditReset: null },
              { lastCreditReset: { lt: oneWeekAgo } }
            ]
          },
          {
            subscription: {
              isActive: true,
              status: 'active'
            }
          },
          {
            // Only reset for contractors with weekly credits limit > 0
            weeklyCreditsLimit: { gt: 0 }
          }
        ]
      },
      include: {
        subscription: true
      }
    });

    let resetCount = 0;

    for (const contractor of contractorsToReset) {
      // Get current balance before reset
      const currentBalance = contractor.creditsBalance;
      
      // Reset credits to weekly limit
      const updatedContractor = await prisma.contractor.update({
        where: { id: contractor.id },
        data: {
          creditsBalance: contractor.weeklyCreditsLimit, // Reset to weekly limit (3)
          lastCreditReset: new Date()
        }
      });



      // Calculate the actual amount added (to handle cases where contractor already had some credits)
      const amountAdded = Math.max(0, contractor.weeklyCreditsLimit - currentBalance);
      
      if (amountAdded > 0) {
        // Only create a transaction if credits were actually added
        await prisma.creditTransaction.create({
          data: {
            contractorId: contractor.id,
            type: 'WEEKLY_ALLOCATION',
            amount: amountAdded, // Only log the net increase
            description: 'Weekly credit reset'
          }
        });
      }

      resetCount++;
    }



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
    include: {
      subscription: true
    }
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Check if contractor has an active subscription
  const hasActiveSubscription = contractor.subscription && 
                              contractor.subscription.isActive && 
                              contractor.subscription.status === 'active';

  // Check if contractor has weekly credits
  if (contractor.weeklyCreditsLimit === 0) {
    return res.status(200).json({
      status: 'success',
      data: {
        creditsReset: false,
        currentBalance: contractor.creditsBalance,
        message: 'Weekly credits are not available. Please contact support.'
      }
    });
  }

  if (!hasActiveSubscription) {
    return res.status(200).json({
      status: 'success',
      data: {
        creditsReset: false,
        currentBalance: contractor.creditsBalance,
        message: 'Credits are only available for subscribers. Please subscribe to access credit features.'
      }
    });
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
    // Get current balance before reset for logging
    const currentBalance = contractor.creditsBalance;
    
    // Reset credits to weekly limit
    const updatedContractor = await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        creditsBalance: contractor.weeklyCreditsLimit,
        lastCreditReset: now
      }
    });



    // Calculate the actual amount added (to handle cases where contractor already had some credits)
    const amountAdded = Math.max(0, contractor.weeklyCreditsLimit - currentBalance);
    
    if (amountAdded > 0) {
      // Only create a transaction if credits were actually added
      await prisma.creditTransaction.create({
        data: {
          contractorId: contractor.id,
          type: 'WEEKLY_ALLOCATION',
          amount: amountAdded, // Only log the net increase
          description: 'Weekly credit reset'
        }
      });
    }

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

// @desc    Initialize credits for contractors without proper setup (Admin only)
// @route   POST /api/contractors/admin/initialize-credits
// @access  Private (Admin only)
export const initializeContractorCredits = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Find contractors with 0 credits and no lastCreditReset who have active subscriptions
  const contractorsNeedingCredits = await prisma.contractor.findMany({
    where: {
      AND: [
        {
          OR: [
            { creditsBalance: 0 },
            { lastCreditReset: null }
          ]
        },
        {
          subscription: {
            isActive: true,
            status: 'active'
          }
        }
      ]
    },
    select: {
      id: true,
      userId: true,
      creditsBalance: true,
      weeklyCreditsLimit: true,
      lastCreditReset: true,
      user: {
        select: {
          name: true,
          email: true
        }
      },
      subscription: {
        select: {
          isActive: true,
          status: true
        }
      }
    }
  });

  const updates = [];
  
  for (const contractor of contractorsNeedingCredits) {
    // Update contractor with initial credits
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        creditsBalance: contractor.weeklyCreditsLimit,
        lastCreditReset: new Date()
      }
    });

    // Create credit transaction record
    await prisma.creditTransaction.create({
      data: {
        contractorId: contractor.id,
        type: 'WEEKLY_ALLOCATION',
        amount: contractor.weeklyCreditsLimit,
        description: 'Credit initialization - admin fix'
      }
    });

    updates.push({
      contractorId: contractor.id,
      email: contractor.user.email,
      creditsGiven: contractor.weeklyCreditsLimit
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      message: `Initialized credits for ${updates.length} contractors`,
      updates
    }
  });
});

// @desc    Get featured contractors (optimized for customer dashboard)
// @route   GET /api/contractors/featured
// @access  Public
export const getFeaturedContractors = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const { city, service } = req.query;

  // Build filter conditions
  const where: any = {
    featuredContractor: true,
    profileApproved: true,
    accountStatus: 'ACTIVE', // Use accountStatus instead of status
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

  const contractors = await prisma.contractor.findMany({
    where,
    take: limit,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      services: {
        select: {
          name: true,
        },
      },
      portfolio: {
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          imageUrl: true,
          title: true,
        },
      },
    },
    orderBy: [
      { averageRating: 'desc' },
      { jobsCompleted: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  // Transform contractors to match frontend expected format
  const transformedContractors = contractors.map((contractor) => ({
    id: contractor.id,
    name: contractor.user.name,
    email: contractor.user.email,
    rating: contractor.averageRating || 0,
    completedJobs: contractor.jobsCompleted || 0,
    specialties: contractor.services?.map((s: any) => s.name) || [],
    location: contractor.city || contractor.operatingArea || 'Not specified',
    joinedDate: contractor.createdAt.toISOString(),
    revenue: 0, // Revenue not tracked at contractor level
    businessName: contractor.businessName,
    avatarUrl: contractor.logoUrl,
  }));

  res.status(200).json({
    status: 'success',
    data: transformedContractors,
  });
});

// Routes
router.get('/featured', getFeaturedContractors); // Must be before '/:id' route
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
router.post('/admin/initialize-credits', protect, restrictTo('ADMIN'), initializeContractorCredits);
router.get('/me/earnings', protect, getMyEarnings);

export default router; 
