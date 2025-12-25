import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { processCommissionForJob } from '../services/commissionService';

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
    // For contractors, exclude IN_PROGRESS jobs (they'll be shown separately if they're assigned)
    // For others, show DRAFT, POSTED, and IN_PROGRESS
    status: req.user?.role === 'CONTRACTOR' 
      ? { in: ['POSTED'] }  // Contractors only see POSTED jobs (available to apply)
      : { in: ['DRAFT', 'POSTED', 'IN_PROGRESS'] },
  };

  // For contractors, add additional filter to include IN_PROGRESS jobs they're assigned to
  if (req.user?.role === 'CONTRACTOR') {
    const contractor = await prisma.contractor.findUnique({
      where: { userId: req.user.id },
      select: { id: true }
    });

    if (contractor) {
      // Include POSTED jobs OR IN_PROGRESS jobs where this contractor won
      where.OR = [
        { status: 'POSTED' },
        { 
          AND: [
            { status: 'IN_PROGRESS' },
            { wonByContractorId: contractor.id }
          ]
        }
      ];
      delete where.status; // Remove the status filter since we're using OR
    }
  }

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
    // Preserve existing OR condition if it exists (from contractor filter)
    const searchConditions = [
      { title: { contains: search as string, mode: 'insensitive' } },
      { description: { contains: search as string, mode: 'insensitive' } },
      { location: { contains: search as string, mode: 'insensitive' } },
    ];
    
    if (where.OR) {
      // Combine with existing OR condition
      where.AND = [
        { OR: where.OR },
        { OR: searchConditions }
      ];
      delete where.OR;
    } else {
      where.OR = searchConditions;
    }
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

  // Filter sensitive data for contractors and add application count
  const filteredJobs = req.user?.role === 'CONTRACTOR' 
    ? jobs.map((job: any) => ({
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
        },
        applicationCount: job.applications ? job.applications.length : 0, // Show contractors how many have applied
      }))
    : jobs.map((job: any) => ({
        ...job,
        applicationCount: job.applications ? job.applications.length : 0, // Show application count to all users
      }));

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
                  id: true, // Include user id for matching applications to contractors
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
  let hasAccessFlag = null;

  // If user is not authenticated or is a contractor, filter sensitive data
  if (!req.user || req.user.role === 'CONTRACTOR') {
    // Get contractor profile once
    const contractor = req.user?.role === 'CONTRACTOR' ? await prisma.contractor.findUnique({
      where: { userId: req.user.id },
    }) : null;

    // Check if contractor has purchased access to this job via JobAccess record
    // Contractors MUST have a JobAccess record regardless of subscription status
    const hasAccess = contractor ? await prisma.jobAccess.findUnique({
      where: {
        jobId_contractorId: {
          jobId: job.id,
          contractorId: contractor.id,
        },
      },
    }) : null;

    hasAccessFlag = hasAccess;
    
    // Check if contractor has applied for this job - if so, show customer info
    const hasApplied = contractor ? await prisma.jobApplication.findFirst({
      where: {
        jobId: job.id,
        contractorId: contractor.id,
      },
    }) : null;

    if (!hasAccess && !hasApplied) {
      // Filter sensitive data for contractors without access or application
      filteredJob = {
        ...job,
        location: job.postcode ? `${job.postcode} area` : 'Area details available after purchase',
        description: job.description.substring(0, 300) + '...',
        customer: {
          ...job.customer,
          user: {
            id: job.customer.user.id,
            name: job.customer.user.name,
            email: job.customer.user.email,
            createdAt: job.customer.user.createdAt,
          },
          // Remove sensitive customer data
          phone: null,
        },
        // Hide applications from contractors without access
        applications: [],
      };
    } else {
      // Contractor has access or has applied - show all applications
      // Ensure the job object includes all applications from the original query
      filteredJob = {
        ...job,
        applications: job.applications || [],
      };
    }
  }

  // Add application count for contractors to see how many have applied
  const applicationCount = job.applications ? job.applications.length : 0;

  res.status(200).json({
    status: 'success',
    data: {
      ...filteredJob,
      applicationCount, // Show contractors how many have applied
      hasAccess: !!hasAccessFlag, // Flag for frontend to know if contractor has purchased access
    },
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

  // Validate budget if provided - it must be positive
  if (budget !== undefined && budget !== null && (Number(budget) <= 0 || isNaN(Number(budget)))) {
    return next(new AppError('Budget must be a positive number if provided', 400));
  }

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
      requiresQuote: false,
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
          id: true,
          name: true,
        },
      },
    },
  });

  // Notify subscribed contractors about new job posting
  try {
    const { createBulkNotifications } = await import('../services/notificationService');
    
    // Get all active subscribed contractors who provide this service
    const subscribedContractors = await prisma.contractor.findMany({
      where: {
        accountStatus: 'ACTIVE',
        profileApproved: true,
        subscription: {
          status: 'ACTIVE',
        },
        services: {
          some: {
            id: finalServiceId,
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
          },
        },
      },
    });

    if (subscribedContractors.length > 0) {
      const notifications = subscribedContractors.map((contractor) => ({
        userId: contractor.user.id,
        title: 'New Job Posted',
        message: `A new ${job.isUrgent ? 'urgent ' : ''}job has been posted: "${title}" (Budget: £${Number(budget).toFixed(2)})`,
        type: (job.isUrgent ? 'WARNING' : 'INFO') as 'WARNING' | 'INFO',
        actionLink: `/dashboard/contractor/jobs/${job.id}`,
        actionText: 'View Job',
        metadata: {
          jobId: job.id,
          jobTitle: title,
          isUrgent: job.isUrgent,
        },
      }));

      await createBulkNotifications(notifications);
    }
  } catch (error) {
    console.error('Failed to notify contractors about new job:', error);
  }

  res.status(201).json({
    status: 'success',
    message: 'Job created and posted successfully',
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
      customer: {
        include: {
          user: true,
        },
      },
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

  // Validate budget if provided - it must be positive
  if (budget !== undefined && (budget === null || Number(budget) <= 0)) {
    return next(new AppError('Budget must be a positive number', 400));
  }

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
      customer: {
        include: {
          user: true,
        },
      },
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
        },
      },
    },
  });

  // Notify customer about new application
  try {
    const { createNotification } = await import('../services/notificationService');
    await createNotification({
      userId: application.job.customer.userId,
      title: 'New Job Application',
      message: `${application.contractor.user.name} has applied for your job: "${application.job.title}". Quote: £${Number(estimatedCost).toFixed(2)}`,
      type: 'INFO',
      actionLink: `/dashboard/client/jobs/${req.params.id}`,
      actionText: 'View Application',
      metadata: {
        jobId: req.params.id,
        applicationId: application.id,
        contractorName: application.contractor.user.name,
      },
    });
  } catch (error) {
    console.error('Failed to send application notification:', error);
  }

  res.status(201).json({
    status: 'success',
    data: {
      application,
    },
    message: 'Application submitted successfully',
  });
});

// @desc    Get job applications
// @route   GET /api/jobs/:id/applications
// @access  Private (Customer who owns the job)
export const getJobApplications = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: {
        include: {
          user: true,
        },
      },
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
      customer: {
        include: {
          user: true,
        },
      },
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
      customer: {
        include: {
          user: true,
        },
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

  // Budget is optional - contractors can propose their own price
  // If no estimated cost provided, contractor must provide one
  if (!estimatedCost || estimatedCost <= 0) {
    return next(new AppError('Please provide your estimated cost for this job', 400));
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

// @desc    Mark job as Won (contractor selected for the job)
// @route   PATCH /api/jobs/:id/mark-won
// @access  Private (Contractor only)
export const markJobAsWon = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: {
        include: {
          user: true,
        },
      },
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

  // Verify contractor has been accepted for this job
  if (job.applications.length === 0) {
    return next(new AppError('You have not been accepted for this job', 403));
  }

  // Can only mark as won from POSTED or IN_PROGRESS status
  if (job.status !== 'POSTED' && job.status !== 'IN_PROGRESS') {
    return next(new AppError('Job cannot be marked as won from current status', 400));
  }

  // Update job status to IN_PROGRESS and set the contractor (WON status is deprecated)
  const updatedJob = await prisma.job.update({
    where: { id: req.params.id },
    data: {
      status: 'IN_PROGRESS',
      wonByContractorId: contractor.id,
    },
    include: {
      customer: {
        include: {
          user: true,
        },
      },
      wonByContractor: {
        include: {
          user: true,
        },
      },
    },
  });

  // Get contractor with user info for notification
  const contractorWithUser = await prisma.contractor.findUnique({
    where: { id: contractor.id },
    include: {
      user: {
        select: {
          name: true,
        },
      },
    },
  });

  // Send notification to customer
  const { createNotification } = await import('../services/notificationService');
  await createNotification({
    userId: job.customer.userId,
    title: 'Contractor Selected for Your Job',
    message: `${contractor.businessName || contractorWithUser?.user.name || 'A contractor'} has won your job: ${job.title}. They will mark it as completed once the work is done.`,
    type: 'CONTRACTOR_SELECTED',
    actionLink: `/jobs/${job.id}`,
    actionText: 'View Job',
  });

  res.status(200).json({
    status: 'success',
    message: 'Job marked as won successfully',
    data: {
      job: updatedJob,
    },
  });
});

// @desc    Mark job as completed with final amount
// @route   PATCH /api/jobs/:id/mark-completed
// @access  Private (Contractor who won the job)
export const markJobAsCompleted = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { finalAmount } = req.body;
  
  if (!finalAmount || finalAmount <= 0) {
    return next(new AppError('Final amount is required and must be greater than 0', 400));
  }

  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: {
        include: {
          user: true,
        },
      },
      wonByContractor: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Verify this contractor won the job
  if (job.wonByContractorId !== contractor.id) {
    return next(new AppError('You are not assigned to this job', 403));
  }

  // Can only mark as completed from IN_PROGRESS status (WON is deprecated, use IN_PROGRESS)
  if (job.status !== 'IN_PROGRESS') {
    return next(new AppError('Job cannot be marked as completed from current status', 400));
  }

  // Update job status to COMPLETED with final amount
  const updatedJob = await prisma.job.update({
    where: { id: req.params.id },
    data: {
      status: 'COMPLETED',
      finalAmount: finalAmount,
      completionDate: new Date(),
      customerConfirmed: false, // Waiting for customer confirmation
    },
  });

  // Send notification to customer asking for confirmation
  const { createNotification } = await import('../services/notificationService');
  await createNotification({
    userId: job.customer.userId,
    title: 'Job Completion Confirmation Required',
    message: `The contractor marked the job as completed for £${finalAmount}. Please confirm if this is correct and if the job has been completed satisfactorily.`,
    type: 'JOB_COMPLETED',
    actionLink: `/jobs/${job.id}/confirm-completion`,
    actionText: 'Review & Confirm',
  });

  res.status(200).json({
    status: 'success',
    message: 'Job marked as completed. Waiting for customer confirmation.',
    data: {
      job: updatedJob,
    },
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
        leadPrice = job.service.smallJobPrice ? Number(job.service.smallJobPrice) : 0;
        break;
      case 'MEDIUM':
        leadPrice = job.service.mediumJobPrice ? Number(job.service.mediumJobPrice) : 0;
        break;
      case 'LARGE':
        leadPrice = job.service.largeJobPrice ? Number(job.service.largeJobPrice) : 0;
        break;
    }
  }

  // Use override price if set
  if (job.leadPrice && Number(job.leadPrice) > 0) {
    leadPrice = Number(job.leadPrice);
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
                  id: true, // Include user id for matching applications to contractors
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

  // Prevent contractors from viewing IN_PROGRESS jobs they're not assigned to
  if (req.user && req.user.role === 'CONTRACTOR' && job.status === 'IN_PROGRESS') {
    const contractor = await prisma.contractor.findUnique({
      where: { userId: req.user.id },
      select: { id: true },
    });

    // If contractor is not the one assigned to this job, deny access
    if (!contractor || job.wonByContractorId !== contractor.id) {
      return next(new AppError('This job is no longer available', 404));
    }
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
      

      
      // Use unified subscription status check
      const { checkSubscriptionStatus } = await import('../services/subscriptionService');
      const subscriptionStatus = await checkSubscriptionStatus(contractor.id);
      hasSubscription = subscriptionStatus.hasActiveSubscription;
      
      if (hasSubscription && subscriptionStatus.subscription) {
        subscriptionPlan = subscriptionStatus.subscription.plan;
      }
      
      // Access is granted ONLY if the contractor has purchased access through a JobAccess record
      // Subscription does not automatically grant access - contractor must still use a lead access point
      hasAccess = !!existingAccess;

      // Calculate lead price
      if (job.service) {
        switch (job.jobSize) {
          case 'SMALL':
            leadPrice = job.service.smallJobPrice ? Number(job.service.smallJobPrice) : 0;
            break;
          case 'MEDIUM':
            leadPrice = job.service.mediumJobPrice ? Number(job.service.mediumJobPrice) : 0;
            break;
          case 'LARGE':
            leadPrice = job.service.largeJobPrice ? Number(job.service.largeJobPrice) : 0;
            break;
        }
      }

      // Use override price if set
      if (job.leadPrice && Number(job.leadPrice) > 0) {
        leadPrice = Number(job.leadPrice);
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
    purchasedBy: job.jobAccess?.map((access: any) => ({
      contractorId: access.contractor.id,
      contractorName: access.contractor.user.name,
      purchasedAt: access.accessedAt.toISOString(),
      method: access.accessMethod,
      // Don't expose paidAmount to customers - they shouldn't know how much contractors paid
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

  console.log('🔍 Job access details:', {
    hasCustomer: !!job.customer,
    customerName: job.customer?.user?.name,
    customerPhone: job.customer?.phone,
    customerEmail: job.customer?.user?.email,
    userRole: req.user?.role
  });

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
  const assignedContractor = job.applications.find((app: any) => app.status === 'ACCEPTED')?.contractor;
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
  const assignedContractor = job.applications.find((app: any) => app.status === 'ACCEPTED')?.contractor;
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
  const assignedContractor = job.applications.find((app: any) => app.status === 'ACCEPTED')?.contractor;
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
  const assignedContractor = job.applications.find((app: any) => app.status === 'ACCEPTED')?.contractor;
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
  const hasAccess = job.jobAccess.find((access: any) => access.contractorId === contractor.id);
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
      customer: {
        include: {
          user: true,
        },
      },
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
  const hasAccess = job.jobAccess.find((access: any) => access.contractorId === contractorId);
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

  // Send notification to customer about contractor selection
  try {
    const { createContractorSelectedNotification } = await import('../services/notificationService');
    await createContractorSelectedNotification(
      job.customer.userId,
      contractorId,
      jobId,
      job.title,
      hasAccess.contractor.user.name
    );

  } catch (error) {
    console.error('Failed to send contractor selection notification:', error);
  }

  res.status(200).json({
    status: 'success',
    message: 'Contractor selected successfully',
    data: {
      job: updatedJob,
    },
  });
});


// @desc    Mark job as won by contractor (DEPRECATED - use selectContractor instead)
// @route   PATCH /api/jobs/:id/mark-won-old
// @access  Private (Customer only)
export const markJobAsWonOld = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Redirect to selectContractor for backward compatibility
  return selectContractor(req, res, next);
});

// @desc    Propose final price for job completion (contractor only)
// @route   PATCH /api/jobs/:id/propose-final-price
// @access  Private (Contractor who won the job)
export const proposeFinalPrice = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const jobId = req.params.id;
  const userId = req.user!.id;
  const { finalPrice } = req.body;






  if (!finalPrice || finalPrice <= 0) {
    return next(new AppError('Please provide a valid final price', 400));
  }

  const contractor = await prisma.contractor.findUnique({
    where: { userId },
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
    return next(new AppError('Contractor profile not found', 404));
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      wonByContractor: {
        include: {
          user: true,
        },
      },
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
    return next(new AppError('You are not authorized to propose final price for this job', 403));
  }

  if (job.status !== 'IN_PROGRESS') {
    return next(new AppError('Job is not in progress', 400));
  }

  // Check if final price has already been proposed
  if (job.contractorProposedAmount) {
    return next(new AppError('Final price has already been proposed for this job', 400));
  }

  // Set timeout for customer response (7 days)
  const timeoutAt = new Date();
  timeoutAt.setDate(timeoutAt.getDate() + 7);

  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      contractorProposedAmount: finalPrice,
      finalPriceProposedAt: new Date(),
      finalPriceTimeoutAt: timeoutAt,
      status: 'AWAITING_FINAL_PRICE_CONFIRMATION',
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
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  // Send notification to customer about final price proposal
  try {
    const { createServiceEmail } = await import('../services/emailService');
    const emailService = (await import('../services/emailService')).createEmailService();
    
    const mailOptions = createServiceEmail({
      to: job.customer.user.email,
      subject: `Final Price Proposal for Job: ${job.title}`,
      heading: 'Final Price Proposal Received',
      body: `
        <p>Your contractor has completed the job and proposed a final price.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>Job Details</h3>
          <p><strong>Job Title:</strong> ${job.title}</p>
          <p><strong>Contractor:</strong> ${contractor.user.name}</p>
          <p><strong>Proposed Final Price:</strong> £${Number(finalPrice).toFixed(2)}</p>
          <p><strong>Original Budget:</strong> £${job.budget ? Number(job.budget).toFixed(2) : 'Not specified'}</p>
        </div>

        <p>Please review and confirm or reject this final price. You have 7 days to respond.</p>
      `,
      ctaText: 'Review Final Price',
      ctaUrl: `https://trustbuild.uk/dashboard/client/jobs/${jobId}`,
      footerText: 'Please respond within 7 days to avoid automatic processing.'
    });

    await emailService.sendMail(mailOptions);

  } catch (error) {
    console.error('Failed to send final price proposal notification:', error);
    // Don't fail the proposal if email fails
  }

  // Send in-app notification to customer
  try {
    const { createFinalPriceProposedNotification } = await import('../services/notificationService');
    await createFinalPriceProposedNotification(
      job.customer.userId,
      finalPrice,
      contractor.user.name,
      true // isCustomer
    );

  } catch (error) {
    console.error('Failed to send final price proposal in-app notification:', error);
  }

  res.status(200).json({
    status: 'success',
    message: `Final price of £${finalPrice} proposed successfully. Waiting for customer confirmation.`,
    data: {
      job: updatedJob,
      proposedAmount: finalPrice,
      timeoutAt: timeoutAt,
    },
  });
});

// @desc    Complete job with final amount (contractor only) - DEPRECATED
// @route   PATCH /api/jobs/:id/complete-with-amount
// @access  Private (Contractor who won the job)
export const completeJobWithAmount = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
      wonByContractor: {
        include: {
          user: true,
        },
      },
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
    return next(new AppError('You are not authorized to complete this job', 403));
  }

  if (job.status !== 'IN_PROGRESS') {
    return next(new AppError('Job is not in progress', 400));
  }

  // Use job budget as final amount automatically
  const finalAmount = job.budget?.toNumber() || 0;
  
  if (finalAmount <= 0) {

    return next(new AppError('Job budget is not set or invalid', 400));
  }



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







  let commissionPayment = null;
  let commissionAmount = 0;

  // Commission will be created when customer confirms completion
  // This ensures commission is only created once and only after customer confirmation



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

// @desc    Customer confirm or reject final price proposal
// @route   PATCH /api/jobs/:id/confirm-final-price
// @access  Private (Customer only)
export const confirmFinalPrice = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const jobId = req.params.id;
  const userId = req.user!.id;
  const { action, rejectionReason } = req.body; // action: 'confirm' or 'reject'

  if (!action || !['confirm', 'reject'].includes(action)) {
    return next(new AppError('Please specify action as "confirm" or "reject"', 400));
  }

  if (action === 'reject' && !rejectionReason) {
    return next(new AppError('Please provide a reason for rejecting the final price', 400));
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      customer: {
        include: {
          user: true,
        },
      },
      wonByContractor: {
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

  // Check if user is the customer
  if (job.customer.userId !== userId) {
    return next(new AppError('Not authorized to confirm this job', 403));
  }

  if (job.status !== 'AWAITING_FINAL_PRICE_CONFIRMATION') {
    return next(new AppError('Job is not awaiting final price confirmation', 400));
  }

  if (!job.contractorProposedAmount) {
    return next(new AppError('No final price has been proposed for this job', 400));
  }

  let updatedJob;

  if (action === 'confirm') {
    // Customer confirmed the final price
    updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        finalAmount: Number(job.contractorProposedAmount),
        finalPriceConfirmedAt: new Date(),
        status: 'COMPLETED',
        completionDate: new Date(),
        customerConfirmed: true,
      },
    });

    // Process commission if applicable
    await processCommissionForJob(jobId, Number(job.contractorProposedAmount));

    // Send confirmation email to contractor
    try {
      const { createServiceEmail } = await import('../services/emailService');
      const emailService = (await import('../services/emailService')).createEmailService();
      
      const mailOptions = createServiceEmail({
        to: job.wonByContractor?.user?.email || 'contractor@example.com',
        subject: `Final Price Confirmed for Job: ${job.title}`,
        heading: 'Final Price Confirmed',
        body: `
          <p>Great news! The customer has confirmed your final price proposal.</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Job Details</h3>
            <p><strong>Job Title:</strong> ${job.title}</p>
            <p><strong>Customer:</strong> ${job.customer?.user?.name || 'Customer'}</p>
            <p><strong>Confirmed Final Price:</strong> £${Number(job.contractorProposedAmount).toFixed(2)}</p>
          </div>

          <p>The job is now marked as completed and you can request a review from the customer.</p>
        `,
        ctaText: 'View Job Details',
        ctaUrl: `https://trustbuild.uk/dashboard/contractor/jobs/${jobId}`,
        footerText: 'Congratulations on completing the job!'
      });

      await emailService.sendMail(mailOptions);

    } catch (error) {
      console.error('Failed to send final price confirmation email:', error);
    }

    // Send in-app notifications for job completion
    try {
      const { 
        createJobCompletedNotification, 
        createJobStatusChangedNotification 
      } = await import('../services/notificationService');
      
      // Notify customer
      await createJobCompletedNotification(
        job.customer.userId,
        job.title,
        Number(job.contractorProposedAmount),
        true // isCustomer
      );
      
      // Notify contractor
      await createJobCompletedNotification(
        job.wonByContractor?.user?.id || '',
        job.title,
        Number(job.contractorProposedAmount),
        false // isCustomer
      );

      // Send status change notifications
      await createJobStatusChangedNotification(
        job.customer.userId,
        job.title,
        'AWAITING_FINAL_PRICE_CONFIRMATION',
        'COMPLETED',
        true // isCustomer
      );
      
      await createJobStatusChangedNotification(
        job.wonByContractor?.user?.id || '',
        job.title,
        'AWAITING_FINAL_PRICE_CONFIRMATION',
        'COMPLETED',
        false // isCustomer
      );


    } catch (error) {
      console.error('Failed to send job completion notifications:', error);
    }

  } else {
    // Customer rejected the final price
    updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        finalPriceRejectedAt: new Date(),
        finalPriceRejectionReason: rejectionReason,
        status: 'IN_PROGRESS', // Back to in progress for contractor to propose new price
        contractorProposedAmount: null, // Clear the proposed amount
        finalPriceProposedAt: null,
        finalPriceTimeoutAt: null,
      },
    });

    // Send rejection email to contractor
    try {
      const { createServiceEmail } = await import('../services/emailService');
      const emailService = (await import('../services/emailService')).createEmailService();
      
      const mailOptions = createServiceEmail({
        to: job.wonByContractor?.user?.email || 'contractor@example.com',
        subject: `Final Price Rejected for Job: ${job.title}`,
        heading: 'Final Price Rejected',
        body: `
          <p>The customer has rejected your final price proposal.</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Job Details</h3>
            <p><strong>Job Title:</strong> ${job.title}</p>
            <p><strong>Customer:</strong> ${job.customer?.user?.name || 'Customer'}</p>
            <p><strong>Rejected Price:</strong> £${Number(job.contractorProposedAmount).toFixed(2)}</p>
            <p><strong>Rejection Reason:</strong> ${rejectionReason}</p>
          </div>

          <p>You can propose a new final price for this job.</p>
        `,
        ctaText: 'Propose New Price',
        ctaUrl: `https://trustbuild.uk/dashboard/contractor/jobs/${jobId}`,
        footerText: 'Please review the feedback and propose a new price.'
      });

      await emailService.sendMail(mailOptions);

    } catch (error) {
      console.error('Failed to send final price rejection email:', error);
    }

    // Send in-app notification to contractor
    try {
      const { createNotification } = await import('../services/notificationService');
      await createNotification({
        userId: job.wonByContractor?.user?.id || '',
        title: 'Final Price Rejected',
        message: `The customer rejected your final price proposal for "${job.title}". Reason: ${rejectionReason}. You can propose a new price.`,
        type: 'WARNING',
        actionLink: `/dashboard/contractor/jobs/${jobId}`,
        actionText: 'Propose New Price',
        metadata: {
          jobId,
          jobTitle: job.title,
          rejectedPrice: Number(job.contractorProposedAmount),
          rejectionReason,
        },
      });
    } catch (error) {
      console.error('Failed to send final price rejection notification:', error);
    }
  }

  res.status(200).json({
    status: 'success',
    message: action === 'confirm' 
      ? 'Final price confirmed successfully. Job marked as completed.'
      : 'Final price rejected. Contractor can propose a new price.',
    data: {
      job: updatedJob,
      action: action,
    },
  });
});

// @desc    Customer confirm job completion (NEW WORKFLOW)
// @route   PATCH /api/jobs/:id/confirm-job-completion
// @access  Private (Customer only)
export const confirmNewJobCompletion = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const jobId = req.params.id;
  const userId = req.user!.id;
  const { confirmed, feedback } = req.body; // confirmed: true/false

  if (typeof confirmed !== 'boolean') {
    return next(new AppError('Please specify if the job is confirmed as complete', 400));
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      customer: {
        include: {
          user: true,
        },
      },
      wonByContractor: {
        include: {
          user: true,
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

  // Job must be in COMPLETED status (marked by contractor)
  if (job.status !== 'COMPLETED') {
    return next(new AppError('Job is not marked as completed by contractor', 400));
  }

  // Must have a final amount set
  if (!job.finalAmount || Number(job.finalAmount) <= 0) {
    return next(new AppError('No final amount set for this job', 400));
  }

  if (confirmed) {
    // Customer confirmed job completion - trigger commission
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        customerConfirmed: true,
        finalPriceConfirmedAt: new Date(),
      },
    });

    // AUTOMATICALLY PROCESS COMMISSION
    const { processCommissionForJob } = await import('../services/commissionService');
    await processCommissionForJob(jobId, Number(job.finalAmount));

    // Update contractor stats
    await prisma.contractor.update({
      where: { id: job.wonByContractorId! },
      data: {
        jobsCompleted: { increment: 1 },
      },
    });

    // Send notification to contractor
    const { createNotification } = await import('../services/notificationService');
    await createNotification({
      userId: job.wonByContractor!.user.id,
      title: 'Job Completion Confirmed',
      message: `The customer confirmed completion of your job: ${job.title}. Commission has been applied and will be invoiced.`,
      type: 'JOB_COMPLETED',
      actionLink: `/dashboard/contractor/jobs/${jobId}`,
      actionText: 'View Job',
    });

    res.status(200).json({
      status: 'success',
      message: 'Job completion confirmed. Commission has been processed.',
      data: {
        job: updatedJob,
      },
    });
  } else {
    // Customer disputed the completion
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'DISPUTED',
      },
    });

    // Send notification to contractor
    const { createNotification } = await import('../services/notificationService');
    await createNotification({
      userId: job.wonByContractor!.user.id,
      title: 'Job Completion Disputed',
      message: `The customer has disputed the completion of job: ${job.title}. ${feedback ? 'Feedback: ' + feedback : ''}`,
      type: 'WARNING',
      actionLink: `/dashboard/contractor/jobs/${jobId}`,
      actionText: 'View Details',
    });

    res.status(200).json({
      status: 'success',
      message: 'Job marked as disputed. Please contact support or the customer to resolve.',
      data: {
        job: updatedJob,
      },
    });
  }
});

// @desc    Customer confirm job completion and amount (DEPRECATED - use confirmFinalPrice)
// @route   PATCH /api/jobs/:id/confirm-completion
// @access  Private (Customer only)
export const confirmJobCompletion = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const jobId = req.params.id;
  const userId = req.user!.id;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      customer: {
        include: {
          user: true,
        },
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







  
  if (!job.finalAmount || Number(job.finalAmount) <= 0) {

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
  




  let commissionAmount = 0;
  let commissionPayment = null;

  // Check if contractor accessed the job using credits
  // Only charge commission if they used credits (not if they paid lead price)
  const jobAccess = await prisma.jobAccess.findFirst({
    where: {
      jobId: job.id,
      contractorId: job.wonByContractorId || '',
    }
  });

  // Only charge commission if they used credits (creditUsed = true)
  const accessedViaCredits = jobAccess && jobAccess.creditUsed === true;

  console.log('💳 Job access details:', jobAccess ? {
    accessMethod: jobAccess.accessMethod,
    creditUsed: jobAccess.creditUsed,
    contractorId: jobAccess.contractorId,
    jobId: jobAccess.jobId
  } : 'No jobAccess found');

  console.log('📊 Winning contractor subscription:', winningContractor ? {
    hasSubscription: !!winningContractor.subscription,
    isActive: winningContractor.subscription?.isActive,
    status: winningContractor.subscription?.status
  } : 'No contractor found');

  // Only charge commission if they used credits (not if they paid lead price)
  console.log('🔍 Commission check:', {
    hasWinningContractor: !!winningContractor,
    accessedViaCredits,
    commissionNotPaid: !job.commissionPaid,
    willCreateCommission: !!(winningContractor && accessedViaCredits && !job.commissionPaid)
  });
  
  if (winningContractor && accessedViaCredits && !job.commissionPaid) {
    // Get commission rate from settings
    const { getCommissionRate } = await import('../services/settingsService');
    const commissionRatePercent = await getCommissionRate();
    commissionAmount = (Number(job.finalAmount) * commissionRatePercent) / 100;
    
    // Add 20% VAT on top of commission
    const vatRate = 0.20;
    const vatAmount = commissionAmount * vatRate;
    const totalAmount = commissionAmount + vatAmount;
    
    // Create commission payment record (the main record that commissions page looks for)


    
    commissionPayment = await prisma.commissionPayment.create({
      data: {
        jobId: job.id,
        contractorId: commissionContractorId, // Use consistent contractor ID from user session
        customerId: job.customerId,
        finalJobAmount: Number(job.finalAmount),
        commissionRate: commissionRatePercent,
        commissionAmount: commissionAmount,
        vatAmount: vatAmount,
        totalAmount: totalAmount,
        status: 'PENDING',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Due in 7 days
      },
    });
    

    
    // Create commission invoice linked to the commission payment
    const commissionInvoice = await prisma.commissionInvoice.create({
      data: {
        commissionPaymentId: commissionPayment.id,
        invoiceNumber: `COMM-${Date.now()}-${commissionContractorId.slice(-6)}`,
        contractorName: winningContractor.businessName || winningContractor.user.name || 'Unknown Contractor',
        contractorEmail: winningContractor.user.email || 'unknown@contractor.com',
        jobTitle: job.title,
        finalJobAmount: Number(job.finalAmount),
        commissionAmount: commissionAmount,
        vatAmount: vatAmount,
        totalAmount: totalAmount,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });



    // Send commission invoice email to contractor
    try {
      const { sendCommissionInvoiceEmail } = await import('../services/emailNotificationService');
      await sendCommissionInvoiceEmail({
        invoiceNumber: commissionInvoice.invoiceNumber,
        contractorName: winningContractor.businessName || winningContractor.user.name || 'Unknown Contractor',
        contractorEmail: winningContractor.user.email || 'unknown@contractor.com',
        jobTitle: job.title,
        finalJobAmount: Number(job.finalAmount),
        commissionAmount: commissionAmount,
        vatAmount: vatAmount,
        totalAmount: totalAmount,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

    } catch (emailError) {
      console.error('Failed to send commission invoice email:', emailError);
    }

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

    } catch (notificationError) {
      console.error('Failed to send commission notification:', notificationError);
    }
  } else {

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

// @desc    Contractor claims "I won the job" - sends notification but doesn't close job
// @route   POST /api/jobs/:id/claim-won
// @access  Private (Contractor only)
// NOTE: Multiple contractors can claim - customer confirms the actual winner
export const claimWon = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: {
        include: {
          user: true,
        },
      },
      jobAccess: {
        where: {
          contractorId: contractor.id,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Verify contractor has purchased access to this job
  if (job.jobAccess.length === 0) {
    return next(new AppError('You must purchase job access before claiming you won', 403));
  }

  // Can only claim if job is POSTED (not already assigned by customer)
  if (job.status !== 'POSTED') {
    return next(new AppError('Job is not available for claiming', 400));
  }

  // Check if this contractor already claimed
  const existingAccess = job.jobAccess[0];
  if (existingAccess.claimedWon) {
    return next(new AppError('You have already claimed this job. Please wait for customer confirmation.', 400));
  }

  // Get contractor with user info for notification
  const contractorWithUser = await prisma.contractor.findUnique({
    where: { id: contractor.id },
    include: {
      user: {
        select: {
          name: true,
        },
      },
    },
  });

  // Mark this contractor's JobAccess as having claimed won
  // This allows multiple contractors to claim - customer decides who actually won
  await prisma.jobAccess.update({
    where: {
      jobId_contractorId: {
        jobId: job.id,
        contractorId: contractor.id,
      },
    },
    data: {
      claimedWon: true,
      claimedWonAt: new Date(),
    },
  });

  // Send notification to customer
  const { createNotification } = await import('../services/notificationService');
  await createNotification({
    userId: job.customer.userId,
    title: 'Contractor Says They Won Your Job! ✅',
    message: `${contractor.businessName || contractorWithUser?.user.name || 'A contractor'} says they've agreed to do your job "${job.title}". Please confirm if this is correct so they can start work.`,
    type: 'CONTRACTOR_SELECTED',
    actionLink: `/dashboard/client/jobs/${job.id}`,
    actionText: 'Review & Confirm',
    metadata: {
      jobId: job.id,
      contractorId: contractor.id,
      contractorName: contractor.businessName || contractorWithUser?.user.name,
      event: 'contractor_claimed_won',
    },
  });

  // Notify contractor that their claim was submitted
  await createNotification({
    userId: req.user!.id,
    title: 'Job Win Claim Submitted 📋',
    message: `Your claim for "${job.title}" has been submitted. The customer will review and confirm the winner.`,
    type: 'INFO',
    actionLink: `/dashboard/contractor/jobs/${job.id}`,
    actionText: 'View Job',
    metadata: {
      jobId: job.id,
      event: 'claim_submitted',
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Customer has been notified. They will confirm if you won the job.',
    data: {
      job: {
        id: job.id,
        title: job.title,
        status: job.status, // Still POSTED - job remains open
        claimedWon: true,
      },
    },
  });
});

// @desc    Customer confirms contractor winner - moves job to IN_PROGRESS
// @route   PATCH /api/jobs/:id/confirm-winner
// @access  Private (Customer only)
// Body: { contractorId?: string } - optional, customer selects from contractors who claimed
export const confirmWinner = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;
  const { contractorId: selectedContractorId } = req.body;

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: {
        include: {
          user: true,
        },
      },
      jobAccess: {
        include: {
          contractor: {
            include: {
              user: true,
            },
          },
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Only customer can confirm winner
  if (job.customer.userId !== userId) {
    return next(new AppError('Only the job owner can confirm the winner', 403));
  }

  // Job must be POSTED
  if (job.status !== 'POSTED') {
    return next(new AppError('Job is not in a state to confirm winner', 400));
  }

  // Find contractors who have claimed they won
  const claimedContractors = job.jobAccess?.filter((access: any) => access.claimedWon);
  
  if (!claimedContractors || claimedContractors.length === 0) {
    return next(new AppError('No contractor has claimed this job yet', 400));
  }

  // If customer provided a contractorId, use that; otherwise use the only one who claimed
  let winningContractorId: string;
  
  if (selectedContractorId) {
    // Verify the selected contractor has claimed
    const selectedClaim = claimedContractors.find((c: any) => c.contractorId === selectedContractorId);
    if (!selectedClaim) {
      return next(new AppError('The selected contractor has not claimed this job', 400));
    }
    winningContractorId = selectedContractorId;
  } else if (claimedContractors.length === 1) {
    // Only one contractor claimed, use them
    winningContractorId = claimedContractors[0].contractorId;
  } else {
    // Multiple contractors claimed, customer must select one
    return next(new AppError('Multiple contractors have claimed this job. Please select which contractor won.', 400));
  }

  // Verify the contractor has purchased access
  const hasAccess = job.jobAccess?.some((access: any) => access.contractorId === winningContractorId);
  if (!hasAccess) {
    return next(new AppError('The selected contractor has not purchased access to this job', 400));
  }

  // Update job: set winner, change status to IN_PROGRESS, set wonAt timestamp
  // Note: wonAt field exists in schema but Prisma client may need regeneration
  // Using $executeRaw to set wonAt if Prisma client doesn't recognize it
  const updatedJob = await prisma.$transaction(async (tx) => {
    const job = await tx.job.update({
      where: { id: req.params.id },
      data: {
        status: 'IN_PROGRESS',
        wonByContractorId: winningContractorId,
        startDate: new Date(),
      },
    });
    
    // Set wonAt using raw SQL if Prisma client doesn't have the field
    try {
      await tx.$executeRaw`UPDATE "jobs" SET "wonAt" = ${new Date()} WHERE id = ${req.params.id}`;
    } catch (error) {
      // If raw SQL fails, try updating with wonAt field directly
      console.warn('Failed to set wonAt via raw SQL, trying direct update:', error);
      await tx.job.update({
        where: { id: req.params.id },
        data: { wonAt: new Date() } as any,
      });
    }
    
    return tx.job.findUnique({
      where: { id: req.params.id },
      include: {
        wonByContractor: {
          include: {
            user: true,
          },
        },
        customer: {
          include: {
            user: true,
          },
        },
        applications: {
          include: {
            contractor: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });
  });

  // Get winning contractor info
  const winningContractor = await prisma.contractor.findUnique({
    where: { id: winningContractorId },
    include: {
      user: true,
    },
  });

  if (!winningContractor) {
    return next(new AppError('Winning contractor not found', 404));
  }

  // Get all contractors with access for notifications
  const allAccessRecords = await prisma.jobAccess.findMany({
    where: { jobId: req.params.id },
    include: {
      contractor: {
        include: {
          user: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  // Send notification to winning contractor
  const { createNotification } = await import('../services/notificationService');
  await createNotification({
    userId: winningContractor.userId,
    title: 'You Won the Job! 🎉',
    message: `Congratulations! The customer has confirmed that you won the job: ${job.title}. The job is now In Progress and you can start working.`,
    type: 'JOB_STARTED',
    actionLink: `/dashboard/contractor/jobs/${job.id}`,
    actionText: 'View Job',
    metadata: {
      jobId: job.id,
      event: 'contractor_confirmed_winner',
    },
  });

  // Send notification to other contractors who had access that job is now assigned
  const otherContractorIds = allAccessRecords
    .filter((access) => access.contractorId !== winningContractorId)
    .map((access) => access.contractor?.user?.id)
    .filter((id): id is string => id !== undefined);

  if (otherContractorIds.length > 0) {
    await Promise.all(
      otherContractorIds.map((contractorUserId: string) =>
        createNotification({
          userId: contractorUserId,
          title: 'Job Assigned to Another Contractor',
          message: `The job "${job.title}" has been assigned to another contractor.`,
          type: 'JOB_STATUS_CHANGED',
          actionLink: `/jobs/${job.id}`,
        }).catch(err => console.error('Failed to notify contractor:', err))
      )
    );
  }

  res.status(200).json({
    status: 'success',
    message: 'Contractor confirmed. Job is now in progress and applications are closed.',
    data: {
      job: updatedJob,
    },
  });
});

// @desc    Customer suggests price change
// @route   PATCH /api/jobs/:id/suggest-price-change
// @access  Private (Customer only)
export const suggestPriceChange = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { suggestedAmount, feedback } = req.body;
  const userId = req.user!.id;

  if (!suggestedAmount || suggestedAmount <= 0) {
    return next(new AppError('Suggested amount is required and must be greater than 0', 400));
  }

  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: {
        include: {
          user: true,
        },
      },
      wonByContractor: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Only customer can suggest price change
  if (job.customer.userId !== userId) {
    return next(new AppError('Only the job owner can suggest price changes', 403));
  }

  // Job must be awaiting final price confirmation
  if (job.status !== 'AWAITING_FINAL_PRICE_CONFIRMATION') {
    return next(new AppError('Job is not awaiting final price confirmation', 400));
  }

  if (!job.wonByContractorId) {
    return next(new AppError('No contractor assigned to this job', 400));
  }

  // Store suggested price (we can use finalPriceRejectionReason or add a new field)
  // For now, we'll update the job with the suggested amount in metadata
  const updatedJob = await prisma.job.update({
    where: { id: req.params.id },
    data: {
      finalPriceRejectedAt: new Date(),
      finalPriceRejectionReason: feedback || `Customer suggested price change to £${suggestedAmount}`,
      // Reset proposed amount so contractor can propose again
      contractorProposedAmount: null,
      finalPriceProposedAt: null,
      status: 'IN_PROGRESS', // Back to IN_PROGRESS so contractor can propose new price
    },
  });

  // Send notification to contractor
  const { createNotification } = await import('../services/notificationService');
  await createNotification({
    userId: job.wonByContractor!.userId,
    title: 'Customer Suggested Price Change',
    message: `The customer has suggested a different price of £${suggestedAmount} for the job "${job.title}". ${feedback ? `Reason: ${feedback}` : ''}`,
    type: 'FINAL_PRICE_PROPOSED',
    actionLink: `/dashboard/contractor/jobs/${job.id}`,
    actionText: 'View Job',
  });

  res.status(200).json({
    status: 'success',
    message: 'Price change suggestion sent to contractor',
    data: {
      job: updatedJob,
      suggestedAmount,
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
      customer: {
        include: {
          user: true,
        },
      },
      wonByContractor: {
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

  // Send notifications to both customer and contractor about job start
  try {
    const { 
      createJobStartedNotification, 
      createJobStatusChangedNotification 
    } = await import('../services/notificationService');
    
    // Notify customer
    await createJobStartedNotification(
      job.customer.userId,
      job.title,
      job.wonByContractor?.user?.name || 'Contractor',
      true // isCustomer
    );
    
    // Notify contractor
    await createJobStartedNotification(
      job.wonByContractor?.user?.id || '',
      job.title,
      job.wonByContractor?.user?.name || 'Contractor',
      false // isCustomer
    );

    // Send status change notifications
    await createJobStatusChangedNotification(
      job.customer.userId,
      job.title,
      'POSTED',
      'IN_PROGRESS',
      true // isCustomer
    );
    
    await createJobStatusChangedNotification(
      job.wonByContractor?.user?.id || '',
      job.title,
      'POSTED',
      'IN_PROGRESS',
      false // isCustomer
    );


  } catch (error) {
    console.error('Failed to send job start notifications:', error);
  }

  res.status(200).json({
    status: 'success',
    message: 'Contractor confirmed and work can now begin',
    data: {
      job: updatedJob,
    },
  });
});

// @desc    Admin override final price confirmation (admin only)
// @route   PATCH /api/jobs/:id/admin-override-final-price
// @access  Private (Admin only)
export const adminOverrideFinalPrice = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const jobId = req.params.id;
  const userId = req.user!.id;
  const { reason } = req.body;

  // Check if user is admin
  if (req.user!.role !== 'ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
    return next(new AppError('Not authorized to perform admin actions', 403));
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
      wonByContractor: {
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

  if (job.status !== 'AWAITING_FINAL_PRICE_CONFIRMATION') {
    return next(new AppError('Job is not awaiting final price confirmation', 400));
  }

  if (!job.contractorProposedAmount) {
    return next(new AppError('No final price has been proposed for this job', 400));
  }

  // Admin overrides the final price confirmation
  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      finalAmount: job.contractorProposedAmount,
      finalPriceConfirmedAt: new Date(),
      adminOverrideAt: new Date(),
      adminOverrideBy: userId,
      status: 'COMPLETED',
      completionDate: new Date(),
      customerConfirmed: true,
    },
  });

  // Process commission if applicable
  await processCommissionForJob(jobId, Number(job.contractorProposedAmount));

  // Send notification to both customer and contractor about admin override
  try {
    const { createServiceEmail } = await import('../services/emailService');
    const emailService = (await import('../services/emailService')).createEmailService();
    
    // Email to customer
    const customerMailOptions = createServiceEmail({
      to: job.customer.user.email,
      subject: `Final Price Confirmed by Admin - Job: ${job.title}`,
      heading: 'Final Price Confirmed by Admin',
      body: `
        <p>An admin has confirmed the final price for your job due to the 7-day response period expiring.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>Job Details</h3>
          <p><strong>Job Title:</strong> ${job.title}</p>
          <p><strong>Contractor:</strong> ${job.wonByContractor?.user?.name || 'Contractor'}</p>
          <p><strong>Confirmed Final Price:</strong> £${Number(job.contractorProposedAmount).toFixed(2)}</p>
          <p><strong>Admin Reason:</strong> ${reason || 'Customer did not respond within 7 days'}</p>
        </div>

        <p>The job is now marked as completed.</p>
      `,
      ctaText: 'View Job Details',
      ctaUrl: `https://trustbuild.uk/dashboard/client/jobs/${jobId}`,
      footerText: 'This action was taken by an admin due to the response timeout.'
    });

    // Email to contractor
    const contractorMailOptions = createServiceEmail({
      to: job.wonByContractor?.user?.email || 'contractor@example.com',
      subject: `Final Price Confirmed by Admin - Job: ${job.title}`,
      heading: 'Final Price Confirmed by Admin',
      body: `
        <p>An admin has confirmed your final price proposal due to the customer not responding within 7 days.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>Job Details</h3>
          <p><strong>Job Title:</strong> ${job.title}</p>
          <p><strong>Customer:</strong> ${job.customer.user.name}</p>
          <p><strong>Confirmed Final Price:</strong> £${Number(job.contractorProposedAmount).toFixed(2)}</p>
          <p><strong>Admin Reason:</strong> ${reason || 'Customer did not respond within 7 days'}</p>
        </div>

        <p>The job is now marked as completed and you can request a review from the customer.</p>
      `,
      ctaText: 'View Job Details',
      ctaUrl: `https://trustbuild.uk/dashboard/contractor/jobs/${jobId}`,
      footerText: 'This action was taken by an admin due to the response timeout.'
    });

    await Promise.all([
      emailService.sendMail(customerMailOptions),
      emailService.sendMail(contractorMailOptions)
    ]);
    

  } catch (error) {
    console.error('Failed to send admin override notifications:', error);
    // Don't fail the override if email fails
  }

  res.status(200).json({
    status: 'success',
    message: 'Final price confirmed by admin override. Job marked as completed.',
    data: {
      job: updatedJob,
      adminOverride: true,
      reason: reason || 'Customer did not respond within 7 days',
    },
  });
});

// @desc    Get jobs awaiting final price confirmation (admin only)
// @route   GET /api/jobs/awaiting-final-price-confirmation
// @access  Private (Admin only)
export const getJobsAwaitingFinalPriceConfirmation = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Check if user is admin
  if (req.user!.role !== 'ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
    return next(new AppError('Not authorized to view admin data', 403));
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const jobs = await prisma.job.findMany({
    where: {
      status: 'AWAITING_FINAL_PRICE_CONFIRMATION',
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
      wonByContractor: {
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
    orderBy: { finalPriceProposedAt: 'asc' }, // Oldest first
    skip,
    take: limit,
  });

  const total = await prisma.job.count({
    where: {
      status: 'AWAITING_FINAL_PRICE_CONFIRMATION',
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      jobs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
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
      job.title,
      contractor.user?.name || 'Your contractor'
    );

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
router.get('/awaiting-final-price-confirmation', protect, getJobsAwaitingFinalPriceConfirmation);
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

// New Workflow Routes (Won → Completed → Customer Confirmation)
router.patch('/:id/mark-won', protect, markJobAsWon); // Already exists but keeping for clarity
router.patch('/:id/mark-completed', protect, markJobAsCompleted); // NEW: Contractor marks completed with amount
router.patch('/:id/confirm-job-completion', protect, confirmNewJobCompletion); // NEW: Customer confirms completion

router.patch('/:id/select-contractor', protect, selectContractor);
router.patch('/:id/contractor-mark-won', protect, contractorMarkJobAsWon);
router.patch('/:id/confirm-contractor-start', protect, confirmContractorStart);
router.post('/:id/express-interest', protect, expressInterest);
router.patch('/:id/complete-with-amount', protect, completeJobWithAmount);
router.patch('/:id/confirm-completion', protect, confirmJobCompletion);
router.post('/:id/test-commission', protect, testCommissionCreation);
router.post('/:id/request-review', protect, requestReview);

// New final price workflow routes
router.patch('/:id/propose-final-price', protect, proposeFinalPrice);
router.patch('/:id/confirm-final-price', protect, confirmFinalPrice);
router.patch('/:id/admin-override-final-price', protect, adminOverrideFinalPrice);

// New job winner workflow routes
router.post('/:id/claim-won', protect, claimWon);
router.patch('/:id/confirm-winner', protect, confirmWinner);
router.patch('/:id/suggest-price-change', protect, suggestPriceChange);

// Milestone routes
router.get('/:id/milestones', protect, getJobMilestones);
router.post('/:id/milestones', protect, createJobMilestone);
router.patch('/:id/milestones/:milestoneId', protect, updateJobMilestone);
router.delete('/:id/milestones/:milestoneId', protect, deleteJobMilestone);

export default router; 
