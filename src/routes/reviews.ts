import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';

const router = Router();

// @desc    Get all reviews for a contractor
// @route   GET /api/reviews/contractor/:contractorId
// @access  Public
export const getContractorReviews = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const contractor = await prisma.contractor.findUnique({
    where: { id: req.params.contractorId },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  const reviews = await prisma.review.findMany({
    where: { contractorId: req.params.contractorId },
    skip,
    take: limit,
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
      job: {
        select: {
          title: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const total = await prisma.review.count({
    where: { contractorId: req.params.contractorId },
  });

  const averageRating = await prisma.review.aggregate({
    where: { contractorId: req.params.contractorId },
    _avg: { rating: true },
  });

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
      averageRating: averageRating._avg.rating || 0,
    },
  });
});

// @desc    Create a review
// @route   POST /api/reviews
// @access  Private (Customer only)
export const createReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  const { jobId, contractorId, rating, comment, title } = req.body;

  // Validate rating
  if (rating < 1 || rating > 5) {
    return next(new AppError('Rating must be between 1 and 5', 400));
  }

  // Check if job exists and is completed
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      customer: true,
      applications: {
        where: {
          status: 'ACCEPTED',
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

  if (job.customer.userId !== req.user!.id) {
    return next(new AppError('Not authorized to review this job', 403));
  }

  if (job.status !== 'COMPLETED') {
    return next(new AppError('Can only review completed jobs', 400));
  }

  // Check if the contractor worked on this job by finding an accepted application
  const acceptedApplication = job.applications.find(app => app.contractorId === contractorId);
  if (!acceptedApplication) {
    return next(new AppError('Contractor did not work on this job', 400));
  }

  // Check if review already exists
  const existingReview = await prisma.review.findFirst({
    where: {
      jobId,
      customerId: customer.id,
      contractorId,
    },
  });

  if (existingReview) {
    return next(new AppError('Review already exists for this job', 400));
  }

  const review = await prisma.review.create({
    data: {
      jobId,
      customerId: customer.id,
      contractorId,
      rating,
      comment,
      title,
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
      job: {
        select: {
          title: true,
        },
      },
    },
  });

  // Update contractor's average rating
  await updateContractorRating(contractorId);

  res.status(201).json({
    status: 'success',
    data: {
      review,
    },
  });
});

// @desc    Update a review
// @route   PATCH /api/reviews/:id
// @access  Private (Customer who created the review)
export const updateReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  const review = await prisma.review.findUnique({
    where: { id: req.params.id },
  });

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  if (review.customerId !== customer.id) {
    return next(new AppError('Not authorized to update this review', 403));
  }

  const { rating, comment, title } = req.body;

  // Validate rating if provided
  if (rating && (rating < 1 || rating > 5)) {
    return next(new AppError('Rating must be between 1 and 5', 400));
  }

  const updatedReview = await prisma.review.update({
    where: { id: req.params.id },
    data: {
      ...(rating && { rating }),
      ...(comment && { comment }),
      ...(title && { title }),
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
      job: {
        select: {
          title: true,
        },
      },
    },
  });

  // Update contractor's average rating if rating changed
  if (rating) {
    await updateContractorRating(review.contractorId);
  }

  res.status(200).json({
    status: 'success',
    data: {
      review: updatedReview,
    },
  });
});

// @desc    Delete a review
// @route   DELETE /api/reviews/:id
// @access  Private (Customer who created the review or Admin)
export const deleteReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const review = await prisma.review.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
    },
  });

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  // Check authorization
  const isOwner = review.customer.userId === req.user!.id;
  const isAdmin = req.user?.role === 'ADMIN';

  if (!isOwner && !isAdmin) {
    return next(new AppError('Not authorized to delete this review', 403));
  }

  await prisma.review.delete({
    where: { id: req.params.id },
  });

  // Update contractor's average rating
  await updateContractorRating(review.contractorId);

  res.status(200).json({
    status: 'success',
    message: 'Review deleted successfully',
  });
});

// @desc    Respond to a review
// @route   POST /api/reviews/:id/respond
// @access  Private (Contractor who received the review)
export const respondToReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const review = await prisma.review.findUnique({
    where: { id: req.params.id },
  });

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  if (review.contractorId !== contractor.id) {
    return next(new AppError('Not authorized to respond to this review', 403));
  }

  const { response } = req.body;

  if (!response || response.trim().length === 0) {
    return next(new AppError('Response cannot be empty', 400));
  }

  const updatedReview = await prisma.review.update({
    where: { id: req.params.id },
    data: {
      contractorResponse: response,
      responseDate: new Date(),
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
  });

  res.status(200).json({
    status: 'success',
    data: {
      review: updatedReview,
    },
  });
});

// @desc    Get reviews for my jobs (Customer)
// @route   GET /api/reviews/my/given
// @access  Private (Customer only)
export const getMyGivenReviews = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user!.id },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  const reviews = await prisma.review.findMany({
    where: { customerId: customer.id },
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
  });

  res.status(200).json({
    status: 'success',
    data: {
      reviews,
    },
  });
});

// @desc    Get reviews for my work (Contractor)
// @route   GET /api/reviews/my/received
// @access  Private (Contractor only)
export const getMyReceivedReviews = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { userId: req.user!.id },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  const reviews = await prisma.review.findMany({
    where: { contractorId: contractor.id },
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
      job: {
        select: {
          title: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json({
    status: 'success',
    data: {
      reviews,
    },
  });
});

// @desc    Flag review for moderation
// @route   POST /api/reviews/:id/flag
// @access  Private
export const flagReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const review = await prisma.review.findUnique({
    where: { id: req.params.id },
  });

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  const { reason } = req.body;

  if (!reason) {
    return next(new AppError('Please provide a reason for flagging', 400));
  }

  // Update review to flagged status
  await prisma.review.update({
    where: { id: req.params.id },
    data: {
      flagged: true,
      flagReason: reason,
      flaggedBy: req.user!.id,
      flaggedAt: new Date(),
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Review flagged for moderation',
  });
});

// @desc    Get flagged reviews (Admin only)
// @route   GET /api/reviews/flagged
// @access  Private/Admin
export const getFlaggedReviews = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }

  const reviews = await prisma.review.findMany({
    where: { flagged: true },
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
    orderBy: { flaggedAt: 'desc' },
  });

  res.status(200).json({
    status: 'success',
    data: {
      reviews,
    },
  });
});

// @desc    Moderate flagged review (Admin only)
// @route   PATCH /api/reviews/:id/moderate
// @access  Private/Admin
export const moderateReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }

  const { action } = req.body; // 'approve' or 'remove'

  if (!['approve', 'remove'].includes(action)) {
    return next(new AppError('Invalid action. Use "approve" or "remove"', 400));
  }

  const review = await prisma.review.findUnique({
    where: { id: req.params.id },
  });

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  if (action === 'approve') {
    await prisma.review.update({
      where: { id: req.params.id },
      data: {
        flagged: false,
        flagReason: null,
        flaggedBy: null,
        flaggedAt: null,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Review approved and unflagged',
    });
  } else {
    await prisma.review.delete({
      where: { id: req.params.id },
    });

    // Update contractor's average rating
    await updateContractorRating(review.contractorId);

    res.status(200).json({
      status: 'success',
      message: 'Review removed',
    });
  }
});

// Helper function to update contractor's average rating
async function updateContractorRating(contractorId: string) {
  const stats = await prisma.review.aggregate({
    where: { contractorId },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await prisma.contractor.update({
    where: { id: contractorId },
    data: {
      averageRating: stats._avg.rating || 0,
      reviewCount: stats._count.rating || 0,
    },
  });
}

// Routes
router.get('/contractor/:contractorId', getContractorReviews);
router.get('/my/given', protect, getMyGivenReviews);
router.get('/my/received', protect, getMyReceivedReviews);
router.get('/flagged', protect, getFlaggedReviews);
router.post('/', protect, createReview);
router.patch('/:id', protect, updateReview);
router.delete('/:id', protect, deleteReview);
router.post('/:id/respond', protect, respondToReview);
router.post('/:id/flag', protect, flagReview);
router.patch('/:id/moderate', protect, moderateReview);

export default router; 