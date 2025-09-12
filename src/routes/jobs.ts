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
    // Check if contractor has purchased access to this job via JobAccess record
    // Contractors MUST have a JobAccess record regardless of subscription status
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
      maxContractorsPerJob: 10, // Allow up to 10 contractors to purchase access
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

  // Just update the application status to ACCEPTED - don't mark as winner yet
  // Customer will separately select their preferred contractor via selectContractor endpoint
  await prisma.jobApplication.update({
      where: { id: req.params.applicationId },
      data: { status: 'ACCEPTED' },
  });

  res.status(200).json({
    status: 'success',
    message: 'Application accepted successfully. You can now select this contractor to start work.',
  });
});

// @desc    Start work on job (customer confirms contractor can begin)
// @route   PATCH /api/jobs/:id/start-work
// @access  Private (Customer who owns the job)
export const startWork = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
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
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  if (job.customer.userId !== req.user!.id) {
    return next(new AppError('Not authorized to start work on this job', 403));
  }

  if (job.status !== 'POSTED') {
    return next(new AppError('Job is not in a state where work can be started', 400));
  }

  if (!job.wonByContractorId) {
    return next(new AppError('No contractor has been selected for this job yet', 400));
  }

  // Update job status to IN_PROGRESS and reject other pending applications
  await prisma.$transaction([
    prisma.job.update({
      where: { id: req.params.id },
      data: {
        status: 'IN_PROGRESS',
      },
    }),
    // Now reject other pending applications since work has officially started
    prisma.jobApplication.updateMany({
      where: {
        jobId: req.params.id,
        status: 'PENDING',
      },
      data: { status: 'REJECTED' },
    }),
  ]);

  res.status(200).json({
    status: 'success',
    message: `Work started with ${job.wonByContractor?.user?.name}. Other applications have been closed.`,
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

  // Create application and mark as accepted, but keep job status as POSTED
  // Customer must still confirm before work can begin
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
    // Set the contractor as winner but keep status POSTED until customer confirms
    prisma.job.update({
      where: { id: req.params.id },
      data: {
        wonByContractorId: contractor.id,
        // status remains POSTED - customer must confirm to change to IN_PROGRESS
      },
    }),
  ]);

  res.status(201).json({
    status: 'success',
    message: 'Job accepted successfully. Waiting for customer confirmation to start work.',
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

  // Check if contractor is assigned to this job (either through old application system or new wonBy system)
  const isAssignedViaApplications = job.applications && job.applications.length > 0;
  const isWonByContractor = job.wonByContractorId === contractor.id;
  
  if (!isAssignedViaApplications && !isWonByContractor) {
    return next(new AppError('You are not assigned to this job', 403));
  }

  const { status } = req.body;
  
  // Validate status transition
  const validStatuses = ['IN_PROGRESS', 'COMPLETED'];
  if (!validStatuses.includes(status)) {
    return next(new AppError('Invalid status', 400));
  }

  // IMPORTANT: Prevent contractors from setting status to IN_PROGRESS unless already IN_PROGRESS
  // Only customers can transition from POSTED to IN_PROGRESS via confirmContractorStart
  if (status === 'IN_PROGRESS' && job.status !== 'IN_PROGRESS') {
    return next(new AppError('Only customers can approve the start of work. Wait for customer confirmation.', 403));
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

  // Get contractor profile with subscription
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { 
      id: true, 
      creditsBalance: true,
      subscription: {
        select: {
          isActive: true,
          status: true,
          plan: true
        }
      }
    },
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
  
  // Check if contractor has active subscription (provides access but still requires using a lead access point)
  const hasActiveSubscription = contractor.subscription && 
                               contractor.subscription.isActive && 
                               contractor.subscription.status === 'active';

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
      // Access is granted ONLY if contractor has existing access record
      hasAccess: !!existingAccess,
      hasSubscription: hasActiveSubscription,
      subscriptionPlan: hasActiveSubscription ? contractor.subscription?.plan : null,
      creditsBalance: contractor.creditsBalance,
      leadPrice: leadPrice, // Show actual lead price for all contractors
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
  let hasSubscription = false;
  let subscriptionPlan = null;
  
  if (req.user && req.user.role === 'CONTRACTOR') {
    const contractor = await prisma.contractor.findUnique({
      where: { userId: req.user.id },
      select: { 
        id: true,
        subscription: {
          select: {
            isActive: true,
            status: true,
            plan: true
          }
        }
      },
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
      
      // Check for active subscription (pricing benefits but still requires access record)
      hasSubscription = !!contractor.subscription && 
                        !!contractor.subscription.isActive && 
                        contractor.subscription.status === 'active';
      
      if (hasSubscription && contractor.subscription) {
        subscriptionPlan = contractor.subscription.plan;
      }
      
      // Access is granted ONLY if the contractor has purchased access through a JobAccess record
      // Subscription does not automatically grant access - contractor must still use a lead access point
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
      
      // Subscribers can choose to pay lead price or use credits
      // leadPrice remains the same for all contractors
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

// @desc    Express interest in job (contractor)
// @route   POST /api/jobs/:id/express-interest
// @access  Private (Contractor who purchased access)
export const expressInterest = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const jobId = req.params.id;
  const userId = req.user!.id;
  const { message } = req.body;

  const contractor = await prisma.contractor.findUnique({
    where: { userId },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      jobAccess: true,
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if contractor has purchased access
  const hasAccess = job.jobAccess.find(access => access.contractorId === contractor.id);
  if (!hasAccess) {
    return next(new AppError('You must purchase access to this job before expressing interest', 403));
  }

  // Check if contractor already expressed interest
  const existingInterest = await prisma.jobInterest.findUnique({
    where: {
      jobId_contractorId: {
        jobId,
        contractorId: contractor.id,
      },
    },
  });

  if (existingInterest) {
    return next(new AppError('You have already expressed interest in this job', 400));
  }

  // Create interest record
  await prisma.jobInterest.create({
    data: {
      jobId,
      contractorId: contractor.id,
      message: message || 'I am interested in taking on this job.',
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Interest expressed successfully',
  });
});

// @desc    Select contractor for job (customer only)
// @route   PATCH /api/jobs/:id/select-contractor
// @access  Private (Customer who owns the job)
export const selectContractor = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

  // Only customer can select contractor
  if (job.customer.userId !== userId) {
    return next(new AppError('Only the job owner can select a contractor', 403));
  }

  if (job.status !== 'POSTED') {
    return next(new AppError('Job is not available for contractor selection', 400));
  }

  // Verify the contractor has purchased access to this job
  const hasAccess = job.jobAccess.find(access => access.contractorId === contractorId);
  if (!hasAccess) {
    return next(new AppError('The selected contractor has not purchased access to this job', 400));
  }

  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      wonByContractorId: contractorId,
      // Keep status as POSTED until customer explicitly confirms contractor can start
      // Status will be changed to IN_PROGRESS when customer confirms the selection
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
    message: 'Contractor selected successfully',
    data: {
      job: updatedJob,
    },
  });
});

// @desc    Mark job as won by contractor (DEPRECATED - use selectContractor instead)
// @route   PATCH /api/jobs/:id/mark-won
// @access  Private (Customer only)
export const markJobAsWon = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Redirect to selectContractor for backward compatibility
  return selectContractor(req, res, next);
});

// @desc    Complete job with final amount (contractor only)
// @route   PATCH /api/jobs/:id/complete-with-amount
// @access  Private (Contractor who won the job)
export const completeJobWithAmount = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const jobId = req.params.id;
  const userId = req.user!.id;

  console.log(`🔍 COMPLETE JOB WITH AMOUNT - Received data:`);
  console.log(`🔍 Job ID: ${jobId}`);
  console.log(`🔍 User ID: ${userId}`);
  console.log(`🔍 Request body:`, req.body);

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

  // Use job budget as final amount automatically
  const finalAmount = job.budget?.toNumber() || 0;
  
  if (finalAmount <= 0) {
    console.log(`❌ Job budget validation failed - budget: ${job.budget}`);
    return next(new AppError('Job budget is not set or invalid', 400));
  }

  console.log(`✅ Using job budget as final amount: ${finalAmount} (from budget: ${job.budget})`);

  // Get winning contractor with subscription details for commission calculation
  const winningContractor = await prisma.contractor.findUnique({
    where: { id: job.wonByContractorId || '' },
    include: {
      subscription: true,
      user: true,
    }
  });

  // Check how contractor accessed the job
  const jobAccess = await prisma.jobAccess.findFirst({
    where: {
      jobId: job.id,
      contractorId: job.wonByContractorId || '',
    }
  });

  // Only charge commission if accessed via CREDIT (not if they paid lead price)
  const accessedViaSubscription = jobAccess && jobAccess.accessMethod === 'CREDIT';

  console.log(`🔍 Commission Debug (completeJobWithAmount) - Job: ${job.id}`);
  console.log(`🔍 WinningContractor: ${!!winningContractor}, ID: ${winningContractor?.id}`);
  console.log(`🔍 JobAccess: ${!!jobAccess}, Method: ${jobAccess?.accessMethod}`);
  console.log(`🔍 AccessedViaSubscription: ${accessedViaSubscription}`);
  console.log(`🔍 Job.commissionPaid: ${job.commissionPaid}`);

  let commissionPayment = null;
  let commissionAmount = 0;

  // Commission will be created when customer confirms completion
  // This ensures commission is only created once and only after customer confirmation
  console.log(`ℹ️ Commission will be created when customer confirms completion - Contractor: ${!!winningContractor}, AccessedViaSubscription: ${accessedViaSubscription}, AlreadyPaid: ${job.commissionPaid}`);
  console.log(`💾 Saving final amount - Job: ${jobId}, finalAmount: ${finalAmount}, type: ${typeof finalAmount}`);

  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      finalAmount: finalAmount,
      completionDate: new Date(),
      // commissionPaid will be set when customer confirms completion
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

  console.log(`✅ Final amount saved - Job: ${jobId}, saved finalAmount: ${updatedJob.finalAmount}, type: ${typeof updatedJob.finalAmount}`);

  res.status(200).json({
    status: 'success',
    message: `Job completed with amount £${finalAmount} (from job budget). Waiting for customer confirmation.`,
    data: {
      job: updatedJob,
      commissionCharged: 0, // Commission will be charged when customer confirms
      commissionPayment: null,
      finalAmount: finalAmount,
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
        include: {
          contractor: {
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

  console.log(`🔍 DEBUG - Job ID: ${job.id}`);
  console.log(`🔍 DEBUG - Job Status: ${job.status}`);
  console.log(`🔍 DEBUG - Final Amount: ${job.finalAmount}`);
  console.log(`🔍 DEBUG - Final Amount Type: ${typeof job.finalAmount}`);
  console.log(`🔍 DEBUG - Customer Confirmed: ${job.customerConfirmed}`);
  console.log(`🔍 DEBUG - Won By Contractor ID: ${job.wonByContractorId}`);
  
  if (!job.finalAmount || job.finalAmount.toNumber() <= 0) {
    console.log(`❌ Final amount validation failed - finalAmount: ${job.finalAmount}`);
    return next(new AppError('No final amount has been set by contractor', 400));
  }

  // Get winning contractor with subscription details
  // Use the contractor ID from the user session to ensure consistency with dashboard queries
  const winningContractor = await prisma.contractor.findUnique({
    where: { id: job.wonByContractorId || '' },
    include: {
      subscription: true,
      user: true,
    }
  });

  // Use the winning contractor ID for commission creation
  // This ensures commission is created with the same ID that the contractor's dashboard will query
  const commissionContractorId = job.wonByContractorId!;
  
  console.log(`🔍 Commission Contractor ID: ${commissionContractorId}`);
  console.log(`🔍 Job Won By Contractor ID: ${job.wonByContractorId}`);
  console.log(`🔍 IDs Match: ${commissionContractorId === job.wonByContractorId}`);

  let commissionAmount = 0;
  let commissionPayment = null;

  // Check if contractor accessed the job via subscription or credits (both indicate subscription status)
  // Subscription holders pay 5% commission, non-subscribers pay full upfront (no commission)
  const jobAccess = await prisma.jobAccess.findFirst({
    where: {
      jobId: job.id,
      contractorId: job.wonByContractorId || '',
    }
  });

  // Only charge commission if accessed via CREDIT (not if they paid lead price)
  const accessedViaSubscription = jobAccess && jobAccess.accessMethod === 'CREDIT';

  console.log(`🔍 Commission Check - Job: ${job.id}, Contractor: ${job.wonByContractorId}, AccessedViaSubscription: ${accessedViaSubscription}, HasJobAccess: ${!!jobAccess}`);
  console.log(`🔍 JobAccess Details:`, jobAccess ? {
    accessMethod: jobAccess.accessMethod,
    contractorId: jobAccess.contractorId,
    jobId: jobAccess.jobId
  } : 'No jobAccess found');
  console.log(`🔍 Contractor Subscription:`, winningContractor ? {
    hasSubscription: !!winningContractor.subscription,
    isActive: winningContractor.subscription?.isActive,
    status: winningContractor.subscription?.status
  } : 'No contractor found');

  // Only charge commission if contractor has subscription (accessed via subscription or credits)
  console.log(`🔍 Commission Condition Check:`, {
    hasWinningContractor: !!winningContractor,
    accessedViaSubscription,
    commissionNotPaid: !job.commissionPaid,
    willCreateCommission: !!(winningContractor && accessedViaSubscription && !job.commissionPaid)
  });
  
  if (winningContractor && accessedViaSubscription && !job.commissionPaid) {
    commissionAmount = job.finalAmount.toNumber() * 0.05; // 5% commission
    
    console.log(`💰 Creating commission: ${commissionAmount} (5% of ${job.finalAmount})`);
    
    // No additional VAT calculation - commission amount already includes VAT
    const vatAmount = 0; // No additional VAT
    const totalAmount = commissionAmount; // Total is just the commission amount
    
    // Create commission payment record (the main record that commissions page looks for)
    console.log(`🔍 DEBUG Commission Creation:`);
    console.log(`  - Job ID: ${job.id}`);
    console.log(`  - Won By Contractor ID: ${job.wonByContractorId}`);
    console.log(`  - Commission Contractor ID: ${commissionContractorId}`);
    console.log(`  - Customer ID: ${job.customerId}`);
    console.log(`  - Commission Amount: ${commissionAmount}`);
    
    commissionPayment = await prisma.commissionPayment.create({
      data: {
        jobId: job.id,
        contractorId: commissionContractorId, // Use consistent contractor ID from user session
        customerId: job.customerId,
        finalJobAmount: job.finalAmount.toNumber(),
        commissionRate: 5.0,
        commissionAmount: commissionAmount,
        vatAmount: vatAmount,
        totalAmount: totalAmount,
        status: 'PENDING',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Due in 7 days
      },
    });
    
    console.log(`✅ Commission Payment Created: ID=${commissionPayment.id}, ContractorID=${commissionPayment.contractorId}`);
    
    // Create commission invoice linked to the commission payment
    const commissionInvoice = await prisma.commissionInvoice.create({
      data: {
        commissionPaymentId: commissionPayment.id,
        invoiceNumber: `COMM-${Date.now()}-${commissionContractorId.slice(-6)}`,
        contractorName: winningContractor.businessName || winningContractor.user.name || 'Unknown Contractor',
        contractorEmail: winningContractor.user.email || 'unknown@contractor.com',
        jobTitle: job.title,
        finalJobAmount: job.finalAmount.toNumber(),
        commissionAmount: commissionAmount,
        vatAmount: vatAmount,
        totalAmount: totalAmount,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    console.log(`✅ Commission created: Invoice ${commissionInvoice.invoiceNumber}, Payment ${commissionPayment.id}`);

    // Send notification to contractor about commission due
    try {
      const { createCommissionDueNotification } = await import('../services/notificationService');
      await createCommissionDueNotification(
        winningContractor.user.id, 
        commissionPayment.id, 
        job.title, 
        totalAmount, 
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Due in 7 days
      );
      console.log(`📧 Commission notification sent to contractor ${winningContractor.user.id}`);
    } catch (notificationError) {
      console.error('Failed to send commission notification:', notificationError);
    }
  } else {
    console.log(`ℹ️ No commission charged - Contractor: ${!!winningContractor}, AccessedViaSubscription: ${accessedViaSubscription}, AlreadyPaid: ${job.commissionPaid}`);
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

// @desc    Test commission creation for debugging
// @route   POST /api/jobs/:id/test-commission
// @access  Private (Admin only)
export const testCommissionCreation = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const jobId = req.params.id;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      wonByContractor: {
        include: {
          subscription: true,
          user: true,
        }
      },
      jobAccess: true,
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  if (!job.wonByContractorId) {
    return next(new AppError('No contractor assigned to this job', 400));
  }

  const jobAccess = await prisma.jobAccess.findFirst({
    where: {
      jobId: job.id,
      contractorId: job.wonByContractorId,
    }
  });

  const accessedViaSubscription = jobAccess && (
    jobAccess.accessMethod === 'SUBSCRIPTION' ||
    jobAccess.accessMethod === 'CREDIT' ||
    (job.wonByContractor?.subscription?.isActive === true) ||
    (job.wonByContractor?.subscription?.status === 'active')
  );

  res.status(200).json({
    status: 'success',
    data: {
      job: {
        id: job.id,
        title: job.title,
        status: job.status,
        finalAmount: job.finalAmount,
        wonByContractorId: job.wonByContractorId,
        commissionPaid: job.commissionPaid,
      },
      contractor: {
        id: job.wonByContractor?.id,
        hasSubscription: !!job.wonByContractor?.subscription,
        subscriptionActive: job.wonByContractor?.subscription?.isActive,
        subscriptionStatus: job.wonByContractor?.subscription?.status,
      },
      jobAccess: jobAccess ? {
        id: jobAccess.id,
        accessMethod: jobAccess.accessMethod,
        contractorId: jobAccess.contractorId,
        jobId: jobAccess.jobId,
      } : null,
      accessedViaSubscription,
      shouldCreateCommission: !!(job.wonByContractor && accessedViaSubscription && !job.commissionPaid),
    }
  });
});

// @desc    Mark job as won by contractor (DISABLED - only customers can select contractors)
// @route   PATCH /api/jobs/:id/contractor-mark-won
// @access  Private (Contractor who has access to the job)
export const contractorMarkJobAsWon = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // This endpoint is now disabled to prevent contractors from auto-selecting themselves
  return next(new AppError('This feature has been disabled. Only customers can select contractors for jobs.', 403));
});

// @desc    Customer confirms contractor selection and allows work to start
// @route   PATCH /api/jobs/:id/confirm-contractor-start
// @access  Private (Customer who owns the job)
export const confirmContractorStart = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

  // Only customer can confirm contractor start
  if (job.customer.userId !== userId) {
    return next(new AppError('Only the job owner can confirm contractor start', 403));
  }

  // Check if contractor has been selected
  if (!job.wonByContractorId) {
    return next(new AppError('No contractor has been selected for this job', 400));
  }

  // Check if job is still posted (awaiting confirmation)
  if (job.status !== 'POSTED') {
    return next(new AppError('Job is not awaiting contractor confirmation', 400));
  }

  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'IN_PROGRESS',
      startDate: new Date(),
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
    message: 'Contractor confirmed and work can now begin',
    data: {
      job: updatedJob,
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
    return next(new AppError('Contractor profile not found', 404));
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
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

  // Send notification to customer
  try {
    const { createReviewRequestNotification } = await import('../services/notificationService');
    await createReviewRequestNotification(
      job.customer.user.id,
      job.id,
      job.title,
      contractor.user?.name || 'Your contractor'
    );
    console.log(`Review request notification sent to customer ${job.customer.user.id} for job ${job.id}`);
  } catch (error) {
    console.error('Failed to send review request notification:', error);
    // Don't throw error, continue with success response
  }

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
router.patch('/:id/start-work', protect, startWork);
router.patch('/:id/status', protect, updateJobStatus);
router.patch('/:id/complete', protect, completeJob);
router.get('/:id/access', protect, checkJobAccess);
router.patch('/:id/mark-won', protect, markJobAsWon);
router.patch('/:id/select-contractor', protect, selectContractor);
router.patch('/:id/contractor-mark-won', protect, contractorMarkJobAsWon);
router.patch('/:id/confirm-contractor-start', protect, confirmContractorStart);
router.post('/:id/express-interest', protect, expressInterest);
router.patch('/:id/complete-with-amount', protect, completeJobWithAmount);
router.patch('/:id/confirm-completion', protect, confirmJobCompletion);
router.post('/:id/test-commission', protect, testCommissionCreation);
router.post('/:id/request-review', protect, requestReview);

// Milestone routes
router.get('/:id/milestones', protect, getJobMilestones);
router.post('/:id/milestones', protect, createJobMilestone);
router.patch('/:id/milestones/:milestoneId', protect, updateJobMilestone);
router.delete('/:id/milestones/:milestoneId', protect, deleteJobMilestone);

export default router; 