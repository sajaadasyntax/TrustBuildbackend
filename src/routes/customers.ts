import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { JobStatus } from '@prisma/client';

const router = Router();

// @desc    Get all customers (Admin only)
// @route   GET /api/customers
// @access  Private/Admin
export const getAllCustomers = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const customers = await prisma.customer.findMany({
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
      jobs: {
        select: {
          id: true,
          status: true,
        },
      },
      reviews: {
        select: {
          id: true,
          rating: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  const total = await prisma.customer.count();

  res.status(200).json({
    status: 'success',
    data: {
      customers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get single customer
// @route   GET /api/customers/:id
// @access  Private (Admin or Customer themselves)
export const getCustomer = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
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
      jobs: {
        include: {
          wonByContractor: {
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
      },
      reviews: {
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
          job: {
            select: {
              title: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!customer) {
    return next(new AppError('Customer not found', 404));
  }

  // Check authorization
  const isOwner = customer.userId === req.user!.id;
  const isAdmin = req.user?.role === 'ADMIN';

  if (!isOwner && !isAdmin) {
    return next(new AppError('Not authorized to access this customer profile', 403));
  }

  res.status(200).json({
    status: 'success',
    data: {
      customer,
    },
  });
});

// @desc    Create customer profile
// @route   POST /api/customers
// @access  Private
export const createCustomerProfile = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Check if user already has a customer profile
  const existingCustomer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (existingCustomer) {
    return next(new AppError('Customer profile already exists', 400));
  }

  const { phone, address, city, postcode } = req.body;

  const customer = await prisma.customer.create({
    data: {
      userId: req.user!.id,
      phone,
      address,
      city,
      postcode,
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

  res.status(201).json({
    status: 'success',
    data: {
      customer,
    },
  });
});

// @desc    Update customer profile
// @route   PATCH /api/customers/me
// @access  Private (Customer only)
export const updateMyProfile = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  const { phone, address, city, postcode } = req.body;

  const updatedCustomer = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      ...(phone && { phone }),
      ...(address && { address }),
      ...(city && { city }),
      ...(postcode && { postcode }),
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

  res.status(200).json({
    status: 'success',
    data: {
      customer: updatedCustomer,
    },
  });
});

// @desc    Get my customer profile
// @route   GET /api/customers/me
// @access  Private (Customer only)
export const getMyProfile = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Check if user is a customer
  if (req.user!.role !== 'CUSTOMER') {
    return next(new AppError('Access denied. Customer only.', 403));
  }
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      jobs: {
        include: {
          wonByContractor: {
            include: {
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
          applications: {
            select: {
              id: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      reviews: {
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
          job: {
            select: {
              title: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!customer) {
    // Check if user is actually a customer role
    if (req.user!.role !== 'CUSTOMER') {
      return next(new AppError('User is not a customer', 400));
    }
    
    // Create customer profile if it doesn't exist
    const newCustomer = await prisma.customer.create({
      data: {
        userId: req.user!.id,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        jobs: true,
        reviews: true,
      },
    });

    return res.status(200).json({
      status: 'success',
      data: {
        customer: newCustomer,
      },
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      customer,
    },
  });
});

// @desc    Delete customer profile
// @route   DELETE /api/customers/me
// @access  Private (Customer only)
export const deleteMyProfile = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
    include: {
      jobs: {
        where: {
          status: { in: ['POSTED', 'IN_PROGRESS'] },
        },
      },
    },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  // Check if customer has active jobs
  if (customer.jobs && customer.jobs.length > 0) {
    return next(new AppError('Cannot delete profile with active jobs', 400));
  }

  await prisma.customer.delete({
    where: { id: customer.id },
  });

  res.status(200).json({
    status: 'success',
    message: 'Customer profile deleted successfully',
  });
});

// @desc    Get customer statistics
// @route   GET /api/customers/me/stats
// @access  Private (Customer only)
export const getMyStats = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  const stats = await prisma.$transaction(async (tx) => {
    const totalJobs = await tx.job.count({
      where: { customerId: customer.id },
    });

    const activeJobs = await tx.job.count({
      where: {
        customerId: customer.id,
        status: { in: ['POSTED', 'IN_PROGRESS'] },
      },
    });

    const completedJobs = await tx.job.count({
      where: {
        customerId: customer.id,
        status: 'COMPLETED',
      },
    });

    const totalReviews = await tx.review.count({
      where: { customerId: customer.id },
    });

    const totalSpent = await tx.job.aggregate({
      where: {
        customerId: customer.id,
        status: 'COMPLETED',
      },
      _sum: { budget: true },
    });

    const averageJobBudget = await tx.job.aggregate({
      where: { customerId: customer.id },
      _avg: { budget: true },
    });

    return {
      totalJobs,
      activeJobs,
      completedJobs,
      totalReviews,
      totalSpent: totalSpent._sum.budget || 0,
      averageJobBudget: averageJobBudget._avg.budget || 0,
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      stats,
    },
  });
});

// @desc    Get customer dashboard data
// @route   GET /api/customers/me/dashboard
// @access  Private (Customer only)
export const getDashboardData = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      },
    },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  // Execute queries in parallel without transaction for better performance
  const [recentJobs, activeJobs, recentReviews, stats] = await Promise.all([
    // Recent jobs
    prisma.job.findMany({
      where: { customerId: customer.id },
      take: 5,
      include: {
        service: {
          select: {
            name: true,
          },
        },
        applications: {
          select: {
            id: true,
            status: true,
            contractor: {
              select: {
                user: {
                  select: {
                    name: true,
                  },
                },
                businessName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),

    // Active jobs (POSTED, IN_PROGRESS, WON - jobs that are not yet completed)
    prisma.job.findMany({
      where: {
        customerId: customer.id,
        status: { in: [JobStatus.POSTED, JobStatus.IN_PROGRESS, JobStatus.WON] },
      },
      include: {
        service: {
          select: {
            name: true,
          },
        },
        applications: {
          select: {
            id: true,
            status: true,
            contractor: {
              select: {
                user: {
                  select: {
                    name: true,
                  },
                },
                businessName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),

    // Recent reviews
    prisma.review.findMany({
      where: { customerId: customer.id },
      take: 3,
      include: {
        contractor: {
          select: {
            user: {
              select: {
                name: true,
              },
            },
            businessName: true,
          },
        },
        job: {
          select: {
            title: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),

    // Quick stats - run these counts and aggregations in parallel
    Promise.all([
      prisma.job.count({
        where: { customerId: customer.id },
      }),
      prisma.job.count({
        where: {
          customerId: customer.id,
          status: { in: ['POSTED', 'IN_PROGRESS'] },
        },
      }),
      prisma.job.count({
        where: {
          customerId: customer.id,
          status: 'COMPLETED',
        },
      }),
      prisma.review.count({
        where: { customerId: customer.id },
      }),
      // Use actual payment data instead of job budget
      prisma.payment.aggregate({
        where: {
          customerId: customer.id,
          status: 'COMPLETED',
        },
        _sum: { amount: true },
      }),
      // Calculate average based on actual payments made
      prisma.payment.aggregate({
        where: {
          customerId: customer.id,
          status: 'COMPLETED',
        },
        _avg: { amount: true },
      }),
    ]).then(([totalJobs, activeJobsCount, completedJobs, totalReviews, totalSpentAgg, averagePaymentAgg]) => ({
      totalJobs,
      activeJobs: activeJobsCount,
      completedJobs,
      totalReviews,
      totalSpent: totalSpentAgg._sum.amount || 0,
      averageJobBudget: averagePaymentAgg._avg.amount || 0,
    })),
  ]);

  const dashboardData = {
    customer,
    recentJobs,
    activeJobs,
    recentReviews,
    stats,
  };

  res.status(200).json({
    status: 'success',
    data: dashboardData,
  });
});

// @desc    Get customer payment summary
// @route   GET /api/customers/me/payment-summary
// @access  Private (Customer only)
export const getPaymentSummary = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  // Get payment data from the Payment model
  const [
    totalPayments,
    monthlyPayments,
    pendingPayments,
    completedPayments,
    jobCounts,
    averageJobCost
  ] = await Promise.all([
    // Total spent (all completed payments)
    prisma.payment.aggregate({
      where: {
        customerId: customer.id,
        status: 'COMPLETED'
      },
      _sum: { amount: true }
    }),
    
    // Monthly spending (this month)
    prisma.payment.aggregate({
      where: {
        customerId: customer.id,
        status: 'COMPLETED',
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        }
      },
      _sum: { amount: true }
    }),
    
    // Pending payments
    prisma.payment.aggregate({
      where: {
        customerId: customer.id,
        status: 'PENDING'
      },
      _sum: { amount: true }
    }),
    
    // Completed payments count
    prisma.payment.count({
      where: {
        customerId: customer.id,
        status: 'COMPLETED'
      }
    }),
    
    // Job counts
    prisma.job.aggregate({
      where: { customerId: customer.id },
      _count: {
        id: true
      }
    }),
    
    // Average job cost based on completed jobs
    prisma.job.aggregate({
      where: {
        customerId: customer.id,
        status: 'COMPLETED'
      },
      _avg: { budget: true }
    })
  ]);

  const activeJobsCount = await prisma.job.count({
    where: {
      customerId: customer.id,
      status: { in: ['POSTED', 'IN_PROGRESS'] }
    }
  });

  const completedJobsCount = await prisma.job.count({
    where: {
      customerId: customer.id,
      status: 'COMPLETED'
    }
  });

  const summary = {
    totalSpent: totalPayments._sum.amount || 0,
    monthlySpent: monthlyPayments._sum.amount || 0,
    pendingPayments: pendingPayments._sum.amount || 0,
    completedPayments: totalPayments._sum.amount || 0,
    activeJobs: activeJobsCount,
    completedJobs: completedJobsCount,
    averageJobCost: averageJobCost._avg.budget || 0,
    savedPaymentMethods: 0 // TODO: Implement when Stripe payment methods are added
  };

  res.status(200).json({
    status: 'success',
    data: { summary }
  });
});

// @desc    Get customer payment transactions
// @route   GET /api/customers/me/payments
// @access  Private (Customer only)
export const getPaymentTransactions = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const status = req.query.status as string;
  const type = req.query.type as string;
  const skip = (page - 1) * limit;

  // Build where clause
  const where: any = { customerId: customer.id };
  if (status && status !== 'all') {
    where.status = status.toUpperCase();
  }
  if (type && type !== 'all') {
    where.type = type.toUpperCase();
  }

  const [transactions, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        job: {
          select: {
            id: true,
            title: true,
            location: true
          }
        },
        contractor: {
          select: {
            businessName: true,
            user: {
              select: {
                name: true
              }
            }
          }
        },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.payment.count({ where })
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// @desc    Get customer invoices
// @route   GET /api/customers/me/invoices
// @access  Private (Customer only)
export const getCustomerInvoices = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        payments: {
        }
      },
      include: {
        payments: {
          select: {
            amount: true,
            status: true,
            type: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.invoice.count({
      where: {
        payments: {
        }
      }
    })
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      invoices,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// @desc    Get customer payment methods (Stripe)
// @route   GET /api/customers/me/payment-methods
// @access  Private (Customer only)
export const getPaymentMethods = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  // TODO: Implement Stripe customer payment methods retrieval
  // For now, return empty array
  const paymentMethods: any[] = [];

  res.status(200).json({
    status: 'success',
    data: { paymentMethods }
  });
});

// @desc    Add customer payment method (Stripe)
// @route   POST /api/customers/me/payment-methods
// @access  Private (Customer only)
export const addPaymentMethod = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  // TODO: Implement Stripe payment method creation
  const { paymentMethodId } = req.body;

  res.status(201).json({
    status: 'success',
    data: { 
      message: 'Payment method will be implemented with full Stripe integration'
    }
  });
});

// Routes
router.get('/', protect, getAllCustomers);
router.get('/me', protect, getMyProfile);
router.get('/me/stats', protect, getMyStats);
router.get('/me/dashboard', protect, getDashboardData);
router.post('/', protect, createCustomerProfile);
router.patch('/me', protect, updateMyProfile);
router.delete('/me', protect, deleteMyProfile);
router.get('/me/payment-summary', protect, getPaymentSummary);
router.get('/me/payments', protect, getPaymentTransactions);
router.get('/me/invoices', protect, getCustomerInvoices);
router.get('/me/payment-methods', protect, getPaymentMethods);
router.post('/me/payment-methods', protect, addPaymentMethod);
router.get('/:id', protect, getCustomer);

export default router; 
