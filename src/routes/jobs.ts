import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';

const router = Router();

// @desc    Get all jobs (public)
// @route   GET /api/jobs
// @access  Public
export const getAllJobs = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  
  const { category, location, budget, status, search, urgent } = req.query;

  // Build filter conditions
  const where: any = {
    status: { in: ['DRAFT', 'POSTED', 'IN_PROGRESS'] },
  };

  if (category) {
    where.category = category as string;
  }

  if (location) {
    where.location = { contains: location as string, mode: 'insensitive' };
  }

  if (budget) {
    const [min, max] = (budget as string).split('-').map(Number);
    where.budget = {
      ...(min && { gte: min }),
      ...(max && { lte: max }),
    };
  }

  if (status) {
    where.status = status as string;
  }

  if (search) {
    where.OR = [
      { title: { contains: search as string, mode: 'insensitive' } },
      { description: { contains: search as string, mode: 'insensitive' } },
      { location: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  if (urgent === 'true') {
    where.isUrgent = true;
  }

  const jobs = await prisma.job.findMany({
    where: where,
    skip,
    take: limit,
    include: {
      customer: {
        include: {
          user: {
            select: {
              id: true,
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
          smallJobPrice: true,
          mediumJobPrice: true,
          largeJobPrice: true,
        },
      },
      applications: {
        select: {
          id: true,
          status: true,
        },
      },
    },
    orderBy: [
      { isUrgent: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  const total = await prisma.job.count({ where });

  // Filter sensitive data for contractors
  const filteredJobs = req.user?.role === 'CONTRACTOR' 
    ? jobs.map(job => ({
        ...job,
        location: job.postcode ? `${job.postcode} area` : 'Area details available after purchase',
        description: job.description.substring(0, 300) + '...',
        customer: {
          ...job.customer,
          user: {
            name: job.customer.user.name,
          },
          // Remove sensitive customer data
          phone: undefined,
        }
      }))
    : jobs;

  res.status(200).json({
    status: 'success',
    data: {
      jobs: filteredJobs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get single job
// @route   GET /api/jobs/:id
// @access  Public
export const getJob = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
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
              services: true,
            },
          },
        },
        orderBy: { appliedAt: 'desc' },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Apply access control and data filtering based on user role
  let filteredJob = job;

  // If user is not authenticated or is a contractor, filter sensitive data
  if (!req.user || req.user.role === 'CONTRACTOR') {
    // Check if contractor has purchased access to this job
    const hasAccess = req.user?.role === 'CONTRACTOR' ? await prisma.jobAccess.findUnique({
      where: {
        jobId_contractorId: {
          jobId: job.id,
          contractorId: req.user.id,
        },
      },
    }) : null;

    if (!hasAccess) {
      // Filter sensitive data for contractors without access
      filteredJob = {
        ...job,
        location: job.postcode ? `${job.postcode} area` : 'Area details available after purchase',
        description: job.description.substring(0, 300) + '...',
        customer: {
          ...job.customer,
          user: {
            id: job.customer.user.id,
            name: job.customer.user.name,
            createdAt: job.customer.user.createdAt,
          },
          // Remove sensitive customer data
          phone: null,
        },
        // Hide applications from contractors without access
        applications: [],
      };
    }
  }

  res.status(200).json({
    status: 'success',
    data: filteredJob,
  });
});

// @desc    Create new job
// @route   POST /api/jobs
// @access  Private (Customer only)
export const createJob = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const {
    title,
    description,
    category,
    location,
    budget,
    urgent,
    serviceId,
    jobSize,
    postcode,
    phone,
    email,
    urgency,
    timeline,
    requirements,
  } = req.body;

  // Get or create customer profile
  let customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        userId: req.user!.id,
        phone: phone,
      },
    });
  } else if (phone) {
    // Update customer contact info if provided
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        phone: phone,
      },
    });
  }

  // Note: Email is not updated when posting a job - it should remain unchanged
  // The email field in the job form is for contact purposes only, not for updating user account

  // If serviceId is not provided, try to find a service by category name
  let finalServiceId = serviceId;
  if (!finalServiceId && category) {
    const service = await prisma.service.findFirst({
      where: {
        name: { contains: category, mode: 'insensitive' }
      }
    });
    if (service) {
      finalServiceId = service.id;
    }
  }

  // If still no serviceId, create or find a default service
  if (!finalServiceId) {
    let defaultService = await prisma.service.findFirst({
      where: { name: 'General Construction' }
    });
    
    if (!defaultService) {
      defaultService = await prisma.service.create({
        data: {
          name: category || 'General Construction',
          category: 'Construction',
          isActive: true,
        }
      });
    }
    finalServiceId = defaultService.id;
  }

  const job = await prisma.job.create({
    data: {
      customerId: customer.id,
      serviceId: finalServiceId,
      title,
      description,
      budget,
      location,
      postcode,
      jobSize: jobSize || 'MEDIUM',
      urgency: urgency || 'flexible',
      isUrgent: urgent || false,
      requiresQuote: !budget || budget === 0,
      status: 'POSTED', // Automatically post the job when created
    },
    include: {
      customer: {
        include: {
          user: {
            select: {
              id: true,
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

  res.status(201).json({
    status: 'success',
    data: {
      job,
    },
  });
});

// @desc    Update job
// @route   PATCH /api/jobs/:id
// @access  Private (Customer who owns the job)
export const updateJob = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  if (job.customer.userId !== req.user!.id) {
    return next(new AppError('Not authorized to update this job', 403));
  }

  if (job.status === 'COMPLETED') {
    return next(new AppError('Cannot update completed job', 400));
  }

  const {
    title,
    description,
    category,
    location,
    budget,
    urgent,
    images,
    requirements,
    timeline,
    contactPreference,
    status,
  } = req.body;

  const updatedJob = await prisma.job.update({
    where: { id: req.params.id },
    data: {
      ...(title && { title }),
      ...(description && { description }),
      ...(category && { category }),
      ...(location && { location }),
      ...(budget && { budget }),
      ...(urgent !== undefined && { urgent }),
      ...(images && { images }),
      ...(requirements && { requirements }),
      ...(timeline && { timeline }),
      ...(contactPreference && { contactPreference }),
      ...(status && { status }),
    },
    include: {
      customer: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      applications: {
        where: {
          status: 'ACCEPTED',
        },
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
  });

  res.status(200).json({
    status: 'success',
    data: {
      job: updatedJob,
    },
  });
});

// @desc    Delete job
// @route   DELETE /api/jobs/:id
// @access  Private (Customer who owns the job)
export const deleteJob = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  if (job.customer.userId !== req.user!.id) {
    return next(new AppError('Not authorized to delete this job', 403));
  }

  if (job.status === 'IN_PROGRESS') {
    return next(new AppError('Cannot delete job that is in progress', 400));
  }

  await prisma.job.delete({
    where: { id: req.params.id },
  });

  res.status(200).json({
    status: 'success',
    message: 'Job deleted successfully',
  });
});

// @desc    Apply for job
// @route   POST /api/jobs/:id/apply
// @access  Private (Contractor only)
export const applyForJob = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  if (!contractor.profileApproved) {
    return next(new AppError('Your profile must be approved before applying for jobs', 400));
  }

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  if (job.status !== 'POSTED' && job.status !== 'DRAFT') {
    return next(new AppError('Job is not available for applications', 400));
  }

  // Check if contractor has purchased access to this job
  const hasAccess = await prisma.jobAccess.findUnique({
    where: {
      jobId_contractorId: {
        jobId: req.params.id,
        contractorId: contractor.id,
      },
    },
  });

  if (!hasAccess) {
    return next(new AppError('You must purchase access to this job before applying', 403));
  }

  // Check if already applied
  const existingApplication = await prisma.jobApplication.findFirst({
    where: {
      jobId: req.params.id,
      contractorId: contractor.id,
    },
  });

  if (existingApplication) {
    return next(new AppError('You have already applied for this job', 400));
  }

  const { proposal, estimatedCost, timeline, questions } = req.body;

  // Validate that a quote is provided
  if (!estimatedCost || estimatedCost <= 0) {
    return next(new AppError('Please provide a valid quote for this job', 400));
  }

  // For quote-on-request jobs (no budget specified), ensure quote is provided
  if ((!job.budget || job.budget.toNumber() <= 0) && !estimatedCost) {
    return next(new AppError('This is a quote-on-request job. Please provide your quote.', 400));
  }

  // Validate proposal is provided
  if (!proposal || proposal.trim().length === 0) {
    return next(new AppError('Please provide a proposal or cover letter', 400));
  }

  const application = await prisma.jobApplication.create({
    data: {
      jobId: req.params.id,
      contractorId: contractor.id,
      coverLetter: proposal,
      proposedRate: estimatedCost,
      timeline,
    },
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
          budget: true,
          requiresQuote: true,
        },
      },
    },
  });

  res.status(201).json({
    status: 'success',
    data: {
      application,
    },
    message: job.budget ? 'Application submitted successfully' : 'Quote submitted successfully',
  });
});

// @desc    Get job applications
// @route   GET /api/jobs/:id/applications
// @access  Private (Customer who owns the job)
export const getJobApplications = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  if (job.customer.userId !== req.user!.id) {
    return next(new AppError('Not authorized to view these applications', 403));
  }

  const applications = await prisma.jobApplication.findMany({
    where: { jobId: req.params.id },
    include: {
      contractor: {
        include: {
          user: {
            select: {
              name: true,
            },
          },
          services: true,
        },
      },
    },
    orderBy: { appliedAt: 'desc' },
  });

  res.status(200).json({
    status: 'success',
    data: {
      applications,
    },
  });
});

// @desc    Accept job application
// @route   PATCH /api/jobs/:id/applications/:applicationId/accept
// @access  Private (Customer who owns the job)
export const acceptApplication = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  if (job.customer.userId !== req.user!.id) {
    return next(new AppError('Not authorized to accept applications for this job', 403));
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: req.params.applicationId },
    include: {
      contractor: true,
    },
  });

  if (!application) {
    return next(new AppError('Application not found', 404));
  }

  if (application.jobId !== req.params.id) {
    return next(new AppError('Application does not belong to this job', 400));
  }

  // Update application status and job
  await prisma.$transaction([
    prisma.jobApplication.update({
      where: { id: req.params.applicationId },
      data: { status: 'ACCEPTED' },
    }),
    prisma.job.update({
      where: { id: req.params.id },
      data: {
        status: 'IN_PROGRESS',
      },
    }),
    // Reject other applications
    prisma.jobApplication.updateMany({
      where: {
        jobId: req.params.id,
        id: { not: req.params.applicationId },
      },
      data: { status: 'REJECTED' },
    }),
  ]);

  res.status(200).json({
    status: 'success',
    message: 'Application accepted successfully',
  });
});

// @desc    Get my jobs (customer)
// @route   GET /api/jobs/my/posted
// @access  Private (Customer only)
export const getMyPostedJobs = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  const jobs = await prisma.job.findMany({
    where: { customerId: customer.id },
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
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json({
    status: 'success',
    data: {
      jobs,
    },
  });
});

// @desc    Get my applied jobs (contractor)
// @route   GET /api/jobs/my/applications
// @access  Private (Contractor only)
export const getMyApplications = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const applications = await prisma.jobApplication.findMany({
    where: { contractorId: contractor.id },
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
  });

  res.status(200).json({
    status: 'success',
    data: {
      applications,
    },
  });
});

// @desc    Accept job directly (contractor)
// @route   POST /api/jobs/:id/accept
// @access  Private (Contractor only)
export const acceptJobDirectly = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  if (!contractor.profileApproved) {
    return next(new AppError('Your profile must be approved before accepting jobs', 400));
  }

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      applications: {
        where: { status: 'ACCEPTED' },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  if (job.status !== 'POSTED') {
    return next(new AppError('Job is not available for acceptance', 400));
  }

  // Check if job already has an accepted contractor
  if (job.applications.length > 0) {
    return next(new AppError('This job has already been accepted by another contractor', 400));
  }

  // Check if contractor has already applied
  const existingApplication = await prisma.jobApplication.findFirst({
    where: {
      jobId: req.params.id,
      contractorId: contractor.id,
    },
  });

  if (existingApplication) {
    return next(new AppError('You have already applied for this job', 400));
  }

  let { proposal, estimatedCost, timeline } = req.body;

  // For quote-on-request jobs, direct acceptance is not allowed
  if (!job.budget || job.budget.toNumber() <= 0) {
    return next(new AppError('This is a quote-on-request job. Please apply with your quote instead of direct acceptance.', 400));
  }

  // Validate estimated cost for fixed-budget jobs
  if (!estimatedCost) {
    // Use job budget as default for direct acceptance
    estimatedCost = job.budget.toNumber();
  }

  // Create application and immediately accept it
  await prisma.$transaction([
    prisma.jobApplication.create({
      data: {
        jobId: req.params.id,
        contractorId: contractor.id,
        coverLetter: proposal || 'Direct job acceptance',
        proposedRate: estimatedCost,
        timeline: timeline || 'As discussed',
        status: 'ACCEPTED',
      },
    }),
    prisma.job.update({
      where: { id: req.params.id },
      data: {
        status: 'IN_PROGRESS',
      },
    }),
  ]);

  res.status(201).json({
    status: 'success',
    message: 'Job accepted successfully',
  });
});

// @desc    Complete job
// @route   PATCH /api/jobs/:id/complete
// @access  Private (Assigned contractor only)
export const completeJob = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      applications: {
        where: {
          contractorId: contractor.id,
          status: 'ACCEPTED',
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  if (job.applications.length === 0) {
    return next(new AppError('Not authorized to complete this job', 403));
  }

  if (job.status !== 'IN_PROGRESS') {
    return next(new AppError('Job is not in progress', 400));
  }

  const updatedJob = await prisma.job.update({
    where: { id: req.params.id },
    data: {
      status: 'COMPLETED',
      completionDate: new Date(),
    },
    include: {
      service: {
        select: {
          name: true,
        },
      },
      customer: {
        include: {
          user: {
            select: {
              name: true,
            },
          },
        },
      },
      applications: {
        where: {
          status: 'ACCEPTED',
        },
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
  });

  // Update contractor stats
  await prisma.contractor.update({
    where: { id: contractor.id },
    data: {
      jobsCompleted: { increment: 1 },
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      job: updatedJob,
    },
  });
});

// @desc    Update job status/phase (contractor)
// @route   PATCH /api/jobs/:id/status
// @access  Private (Contractor working on the job)
export const updateJobStatus = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      applications: {
        where: {
          contractorId: contractor.id,
          status: 'ACCEPTED',
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if contractor is assigned to this job
  if (!job.applications || job.applications.length === 0) {
    return next(new AppError('You are not assigned to this job', 403));
  }

  const { status } = req.body;
  
  // Validate status transition
  const validStatuses = ['IN_PROGRESS', 'COMPLETED'];
  if (!validStatuses.includes(status)) {
    return next(new AppError('Invalid status', 400));
  }

  // Update job status
  const updatedJob = await prisma.job.update({
    where: { id: req.params.id },
    data: { 
      status,
      ...(status === 'COMPLETED' && { completionDate: new Date() })
    },
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
  });

  // Update contractor stats if completing job
  if (status === 'COMPLETED') {
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        jobsCompleted: { increment: 1 },
      },
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      job: updatedJob,
    },
  });
});

// @desc    Check if contractor has access to job details
// @route   GET /api/jobs/:id/access
// @access  Private (Contractor only)
export const checkJobAccess = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const jobId = req.params.id;
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true, creditsBalance: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Check if contractor already has access to this job
  const existingAccess = await prisma.jobAccess.findUnique({
    where: {
      jobId_contractorId: {
        jobId,
        contractorId: contractor.id,
      },
    },
  });

  // Get job with pricing info
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      service: {
        select: {
          smallJobPrice: true,
          mediumJobPrice: true,
          largeJobPrice: true,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Calculate lead price
  let leadPrice = 0;
  if (job.service) {
    switch (job.jobSize) {
      case 'SMALL':
        leadPrice = job.service.smallJobPrice ? job.service.smallJobPrice.toNumber() : 0;
        break;
      case 'MEDIUM':
        leadPrice = job.service.mediumJobPrice ? job.service.mediumJobPrice.toNumber() : 0;
        break;
      case 'LARGE':
        leadPrice = job.service.largeJobPrice ? job.service.largeJobPrice.toNumber() : 0;
        break;
    }
  }

  // Use override price if set
  if (job.leadPrice && job.leadPrice.toNumber() > 0) {
    leadPrice = job.leadPrice.toNumber();
  }

  res.status(200).json({
    status: 'success',
    data: {
      hasAccess: !!existingAccess,
      creditsBalance: contractor.creditsBalance,
      leadPrice,
      jobSize: job.jobSize,
      estimatedValue: job.estimatedValue,
    },
  });
});

// Update the existing getJob function to include access check
const originalGetJob = getJob;
export const getJobWithAccess = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
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
              services: true,
            },
          },
        },
        orderBy: { appliedAt: 'desc' },
      },
      jobAccess: {
        include: {
          contractor: {
            include: {
              user: {
                select: {
                  name: true,
                },
              },
              portfolio: {
                take: 3,
                orderBy: { createdAt: 'desc' },
              },
              reviews: {
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
            },
          },
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if user is a contractor and has access
  let hasAccess = false;
  let leadPrice = 0;
  
  if (req.user && req.user.role === 'CONTRACTOR') {
    const contractor = await prisma.contractor.findUnique({
      where: { userId: req.user.id },
      select: { id: true },
    });

    if (contractor) {
      const existingAccess = await prisma.jobAccess.findUnique({
        where: {
          jobId_contractorId: {
            jobId: job.id,
            contractorId: contractor.id,
          },
        },
      });
      hasAccess = !!existingAccess;

      // Calculate lead price
      if (job.service) {
        switch (job.jobSize) {
          case 'SMALL':
            leadPrice = job.service.smallJobPrice ? job.service.smallJobPrice.toNumber() : 0;
            break;
          case 'MEDIUM':
            leadPrice = job.service.mediumJobPrice ? job.service.mediumJobPrice.toNumber() : 0;
            break;
          case 'LARGE':
            leadPrice = job.service.largeJobPrice ? job.service.largeJobPrice.toNumber() : 0;
            break;
        }
      }

      // Use override price if set
      if (job.leadPrice && job.leadPrice.toNumber() > 0) {
        leadPrice = job.leadPrice.toNumber();
      }
    }
  } else {
    // Non-contractors (customers, admins) have full access
    hasAccess = true;
  }

  // For contractors without access, return heavily filtered data
  if (req.user?.role === 'CONTRACTOR' && !hasAccess) {
    const filteredJob = {
      id: job.id,
      title: 'Job Available',
      description: 'Full job description available after purchase',
      postcode: job.postcode,
      jobSize: job.jobSize,
      status: job.status,
      service: job.service ? {
        id: job.service.id,
        name: job.service.name,
        category: job.service.category,
      } : null,
      customer: {
        id: job.customer.id,
        user: {
          id: job.customer.user.id,
        },
      },
      hasAccess,
      leadPrice,
      currentLeadPrice: leadPrice,
      accessCount: job.jobAccess?.length || 0,
      contractorsWithAccess: job.jobAccess?.length || 0,
      spotsRemaining: job.maxContractorsPerJob - (job.jobAccess?.length || 0),
      maxContractorsPerJob: job.maxContractorsPerJob,
      applications: [],
      reviews: [],
      milestones: [],
      jobAccess: [],
      purchasedBy: [],
    };

    return res.status(200).json({
      status: 'success',
      data: filteredJob,
    });
  }

  const jobWithAccess = {
    ...job,
    hasAccess,
    leadPrice,
    currentLeadPrice: leadPrice,
    accessCount: job.jobAccess?.length || 0,
    contractorsWithAccess: job.jobAccess?.length || 0,
    spotsRemaining: job.maxContractorsPerJob - (job.jobAccess?.length || 0),
    purchasedBy: job.jobAccess?.map(access => ({
      contractorId: access.contractor.id,
      contractorName: access.contractor.user.name,
      purchasedAt: access.accessedAt.toISOString(),
      method: access.accessMethod,
      paidAmount: access.paidAmount?.toNumber() || 0,
      // Include contractor details for customers
      ...(req.user?.role === 'CUSTOMER' && {
        portfolio: access.contractor.portfolio,
        reviews: access.contractor.reviews,
        averageRating: access.contractor.averageRating,
        reviewCount: access.contractor.reviewCount,
        jobsCompleted: access.contractor.jobsCompleted,
      }),
    })) || [],
  };

  res.status(200).json({
    status: 'success',
    data: jobWithAccess,
  });
});

// @desc    Get job milestones
// @route   GET /api/jobs/:id/milestones
// @access  Private (job owner or assigned contractor)
export const getJobMilestones = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const userId = req.user?.id;

  // Verify job access
  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      customer: { include: { user: true } },
      applications: {
        where: { status: 'ACCEPTED' },
        include: { contractor: { include: { user: true } } }
      }
    }
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if user has access (job owner or assigned contractor)
  const isJobOwner = job.customer.user.id === userId;
  const assignedContractor = job.applications.find(app => app.status === 'ACCEPTED')?.contractor;
  const isAssignedContractor = assignedContractor?.user.id === userId;

  if (!isJobOwner && !isAssignedContractor) {
    return next(new AppError('Access denied', 403));
  }

  const milestones = await prisma.milestone.findMany({
    where: { jobId: id },
    orderBy: { createdAt: 'asc' }
  });

  res.status(200).json({
    status: 'success',
    data: milestones
  });
});

// @desc    Create job milestone
// @route   POST /api/jobs/:id/milestones
// @access  Private (job owner or assigned contractor)
export const createJobMilestone = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { title, description, dueDate } = req.body;
  const userId = req.user?.id;

  // Verify job access
  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      customer: { include: { user: true } },
      applications: {
        where: { status: 'ACCEPTED' },
        include: { contractor: { include: { user: true } } }
      }
    }
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if user has access (job owner or assigned contractor)
  const isJobOwner = job.customer.user.id === userId;
  const assignedContractor = job.applications.find(app => app.status === 'ACCEPTED')?.contractor;
  const isAssignedContractor = assignedContractor?.user.id === userId;

  if (!isJobOwner && !isAssignedContractor) {
    return next(new AppError('Access denied', 403));
  }

  if (!title) {
    return next(new AppError('Milestone title is required', 400));
  }

  const milestone = await prisma.milestone.create({
    data: {
      jobId: id,
      title,
      description,
      dueDate: dueDate ? new Date(dueDate) : null
    }
  });

  res.status(201).json({
    status: 'success',
    data: milestone
  });
});

// @desc    Update milestone
// @route   PATCH /api/jobs/:id/milestones/:milestoneId
// @access  Private (job owner or assigned contractor)
export const updateJobMilestone = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id, milestoneId } = req.params;
  const { title, description, status, dueDate } = req.body;
  const userId = req.user?.id;

  // Verify job access
  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      customer: { include: { user: true } },
      applications: {
        where: { status: 'ACCEPTED' },
        include: { contractor: { include: { user: true } } }
      }
    }
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if user has access (job owner or assigned contractor)
  const isJobOwner = job.customer.user.id === userId;
  const assignedContractor = job.applications.find(app => app.status === 'ACCEPTED')?.contractor;
  const isAssignedContractor = assignedContractor?.user.id === userId;

  if (!isJobOwner && !isAssignedContractor) {
    return next(new AppError('Access denied', 403));
  }

  // Verify milestone exists and belongs to this job
  const existingMilestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, jobId: id }
  });

  if (!existingMilestone) {
    return next(new AppError('Milestone not found', 404));
  }

  // Prepare update data
  const updateData: any = {};
  if (title !== undefined) updateData.title = title;
  if (description !== undefined) updateData.description = description;
  if (status !== undefined) {
    updateData.status = status;
    if (status === 'COMPLETED') {
      updateData.completedAt = new Date();
    } else if (status !== 'COMPLETED' && existingMilestone.status === 'COMPLETED') {
      updateData.completedAt = null;
    }
  }
  if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;

  const milestone = await prisma.milestone.update({
    where: { id: milestoneId },
    data: updateData
  });

  res.status(200).json({
    status: 'success',
    data: milestone
  });
});

// @desc    Delete milestone
// @route   DELETE /api/jobs/:id/milestones/:milestoneId
// @access  Private (job owner or assigned contractor)
export const deleteJobMilestone = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id, milestoneId } = req.params;
  const userId = req.user?.id;

  // Verify job access
  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      customer: { include: { user: true } },
      applications: {
        where: { status: 'ACCEPTED' },
        include: { contractor: { include: { user: true } } }
      }
    }
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if user has access (job owner or assigned contractor)
  const isJobOwner = job.customer.user.id === userId;
  const assignedContractor = job.applications.find(app => app.status === 'ACCEPTED')?.contractor;
  const isAssignedContractor = assignedContractor?.user.id === userId;

  if (!isJobOwner && !isAssignedContractor) {
    return next(new AppError('Access denied', 403));
  }

  // Verify milestone exists and belongs to this job
  const existingMilestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, jobId: id }
  });

  if (!existingMilestone) {
    return next(new AppError('Milestone not found', 404));
  }

  await prisma.milestone.delete({
    where: { id: milestoneId }
  });

  res.status(204).json({
    status: 'success',
    data: null
  });
});

// @desc    Mark job as won by contractor
// @route   PATCH /api/jobs/:id/mark-won
// @access  Private (Customer or Contractor who purchased access)
export const markJobAsWon = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { contractorId } = req.body;
  const jobId = req.params.id;
  const userId = req.user!.id;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      customer: true,
      jobAccess: {
        include: {
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
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check authorization - either customer or contractor who has access can mark as won
  const isCustomer = job.customer.userId === userId;
  const contractorAccess = job.jobAccess.find(access => access.contractor.user.id === userId);
  
  if (!isCustomer && !contractorAccess) {
    return next(new AppError('Not authorized to mark this job as won', 403));
  }

  // If contractor is marking as won, use their contractor ID
  let winningContractorId = contractorId;
  if (contractorAccess && !contractorId) {
    const contractor = await prisma.contractor.findUnique({
      where: { userId },
    });
    winningContractorId = contractor?.id;
  }

  // Verify the contractor has purchased access to this job
  const hasAccess = job.jobAccess.find(access => access.contractorId === winningContractorId);
  if (!hasAccess) {
    return next(new AppError('The selected contractor has not purchased access to this job', 400));
  }

  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      wonByContractorId: winningContractorId,
      status: 'IN_PROGRESS',
    },
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
  });

  res.status(200).json({
    status: 'success',
    message: 'Job marked as won successfully',
    data: {
      job: updatedJob,
    },
  });
});

// @desc    Complete job with final amount (contractor only)
// @route   PATCH /api/jobs/:id/complete-with-amount
// @access  Private (Contractor who won the job)
export const completeJobWithAmount = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { finalAmount } = req.body;
  const jobId = req.params.id;
  const userId = req.user!.id;

  if (!finalAmount || finalAmount <= 0) {
    return next(new AppError('Please provide a valid final amount', 400));
  }

  const contractor = await prisma.contractor.findUnique({
    where: { userId },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      wonByContractor: true,
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

  // Check if this contractor won the job
  if (job.wonByContractorId !== contractor.id) {
    return next(new AppError('You are not authorized to complete this job', 403));
  }

  if (job.status !== 'IN_PROGRESS') {
    return next(new AppError('Job is not in progress', 400));
  }

  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      finalAmount: finalAmount,
      completionDate: new Date(),
    },
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
  });

  res.status(200).json({
    status: 'success',
    message: 'Job completed. Waiting for customer confirmation.',
    data: {
      job: updatedJob,
    },
  });
});

// @desc    Customer confirm job completion and amount
// @route   PATCH /api/jobs/:id/confirm-completion
// @access  Private (Customer only)
export const confirmJobCompletion = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const jobId = req.params.id;
  const userId = req.user!.id;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      customer: true,
      wonByContractor: {
        include: {
          user: {
            select: {
              name: true,
            },
          },
        },
      },
      jobAccess: {
        where: {
          contractorId: {
            not: null,
          },
        },
        include: {
          contractor: true,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if user is the customer
  if (job.customer.userId !== userId) {
    return next(new AppError('Not authorized to confirm this job', 403));
  }

  if (job.status !== 'COMPLETED') {
    return next(new AppError('Job has not been marked as completed by contractor', 400));
  }

  if (job.customerConfirmed) {
    return next(new AppError('Job completion already confirmed', 400));
  }

  if (!job.finalAmount) {
    return next(new AppError('No final amount has been set by contractor', 400));
  }

  // Check if the winning contractor used credits for access (for commission calculation)
  const winningContractorAccess = job.jobAccess.find(
    access => access.contractorId === job.wonByContractorId
  );

  let commissionAmount = 0;
  let commissionPayment = null;

  // Only charge commission if contractor used credits
  if (winningContractorAccess && winningContractorAccess.creditUsed && !job.commissionPaid) {
    commissionAmount = job.finalAmount.toNumber() * 0.05; // 5% commission
    
    // Create commission payment record
    commissionPayment = await prisma.payment.create({
      data: {
        contractorId: job.wonByContractorId!,
        amount: commissionAmount,
        type: 'JOB_PAYMENT',
        status: 'COMPLETED',
        description: `5% commission for job: ${job.title} (£${job.finalAmount})`,
        jobId: job.id,
      },
    });
  }

  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      customerConfirmed: true,
      commissionPaid: commissionAmount > 0,
    },
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
  });

  res.status(200).json({
    status: 'success',
    message: 'Job completion confirmed successfully',
    data: {
      job: updatedJob,
      commissionCharged: commissionAmount,
      commissionPayment,
    },
  });
});

// @desc    Request review (contractor only, after customer confirmation)
// @route   POST /api/jobs/:id/request-review
// @access  Private (Contractor who won the job)
export const requestReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const jobId = req.params.id;
  const userId = req.user!.id;

  const contractor = await prisma.contractor.findUnique({
    where: { userId },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
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

  // Check if this contractor won the job
  if (job.wonByContractorId !== contractor.id) {
    return next(new AppError('You are not authorized to request review for this job', 403));
  }

  if (!job.customerConfirmed) {
    return next(new AppError('Customer must confirm job completion before requesting review', 400));
  }

  // Check if review already exists
  const existingReview = await prisma.review.findUnique({
    where: {
      jobId_customerId: {
        jobId: job.id,
        customerId: job.customerId,
      },
    },
  });

  if (existingReview) {
    return next(new AppError('Review has already been submitted for this job', 400));
  }

  // Here you would typically send a notification to the customer
  // For now, we'll just return success

  res.status(200).json({
    status: 'success',
    message: 'Review request sent to customer',
    data: {
      customerEmail: job.customer.user.email,
      customerName: job.customer.user.name,
    },
  });
});

// Routes
router.get('/', getAllJobs);
router.get('/my/posted', protect, getMyPostedJobs);
router.get('/my/applications', protect, getMyApplications);
router.post('/', protect, createJob);
router.get('/:id', getJobWithAccess);
router.patch('/:id', protect, updateJob);
router.delete('/:id', protect, deleteJob);
router.post('/:id/apply', protect, applyForJob);
router.post('/:id/accept', protect, acceptJobDirectly);
router.get('/:id/applications', protect, getJobApplications);
router.patch('/:id/applications/:applicationId/accept', protect, acceptApplication);
router.patch('/:id/status', protect, updateJobStatus);
router.patch('/:id/complete', protect, completeJob);
router.get('/:id/access', protect, checkJobAccess);
router.patch('/:id/mark-won', protect, markJobAsWon);
router.patch('/:id/complete-with-amount', protect, completeJobWithAmount);
router.patch('/:id/confirm-completion', protect, confirmJobCompletion);
router.post('/:id/request-review', protect, requestReview);

// Milestone routes
router.get('/:id/milestones', protect, getJobMilestones);
router.post('/:id/milestones', protect, createJobMilestone);
router.patch('/:id/milestones/:milestoneId', protect, updateJobMilestone);
router.delete('/:id/milestones/:milestoneId', protect, deleteJobMilestone);

export default router; 