import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest, restrictTo } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';

const router = Router();

// @desc    Get reviews for a contractor
// @route   GET /api/reviews/contractor/:contractorId
// @access  Public
export const getContractorReviews = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { contractorId } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { id: contractorId },
    select: { id: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  // Get reviews
  const reviews = await prisma.review.findMany({
    where: { contractorId },
    include: {
      job: {
        select: {
          id: true,
          title: true,
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
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const total = await prisma.review.count({
    where: { contractorId },
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
    },
  });
});

// @desc    Create a review for a contractor
// @route   POST /api/reviews
// @access  Private (Customer only)
export const createReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { jobId, contractorId, rating, comment } = req.body;
  const userId = req.user!.id;

  if (!jobId || !contractorId || !rating) {
    return next(new AppError('Job ID, contractor ID, and rating are required', 400));
  }

  if (rating < 1 || rating > 5) {
    return next(new AppError('Rating must be between 1 and 5', 400));
  }

  // Get customer profile
  const customer = await prisma.customer.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  // Check if job exists and belongs to this customer
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      customerId: customer.id,
      status: 'COMPLETED',
      wonByContractorId: contractorId,
    },
  });

  if (!job) {
    return next(new AppError('Job not found or not completed by this contractor', 404));
  }

  // Check if review already exists
  const existingReview = await prisma.review.findUnique({
    where: {
      jobId_customerId: {
        jobId,
        customerId: customer.id,
      },
    },
  });

  if (existingReview) {
    return next(new AppError('You have already reviewed this job', 400));
  }

  // Create review
  const review = await prisma.review.create({
    data: {
      jobId,
      customerId: customer.id,
      contractorId,
      rating,
      comment,
      isVerified: true, // Verified since it's from the platform
      projectType: job.title,
      projectDate: job.completionDate,
    },
  });

  // Update contractor rating
  await updateContractorRating(contractorId);

  res.status(201).json({
    status: 'success',
    data: {
      review,
    },
  });
});

// @desc    Add external review for a contractor (from past work)
// @route   POST /api/reviews/external
// @access  Private (Contractor only)
export const addExternalReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { rating, comment, customerName, customerEmail, projectType, projectDate } = req.body;
  const userId = req.user!.id;

  if (!rating || !customerName || !projectType) {
    return next(new AppError('Rating, customer name, and project type are required', 400));
  }

  if (rating < 1 || rating > 5) {
    return next(new AppError('Rating must be between 1 and 5', 400));
  }

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Check if contractor has reached the limit of 3 external reviews
  const externalReviewsCount = await prisma.review.count({
    where: {
      contractorId: contractor.id,
      isExternal: true,
    },
  });

  if (externalReviewsCount >= 3) {
    return next(new AppError('You can only add up to 3 external reviews', 400));
  }

  // Create external review
  const review = await prisma.review.create({
    data: {
      // Use a dummy job ID for external reviews
      jobId: `external-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      customerId: 'external', // Use a placeholder for external reviews
      contractorId: contractor.id,
      rating,
      comment,
      isVerified: false, // External reviews are not verified by default
      isExternal: true,
      customerName,
      customerEmail,
      projectType,
      projectDate: projectDate ? new Date(projectDate) : undefined,
    },
  });

  // Update contractor rating
  await updateContractorRating(contractor.id);

  res.status(201).json({
    status: 'success',
    data: {
      review,
      externalReviewsRemaining: 3 - (externalReviewsCount + 1),
    },
  });
});

// @desc    Update a review
// @route   PUT /api/reviews/:id
// @access  Private (Customer or Admin)
export const updateReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { rating, comment } = req.body;
  const userId = req.user!.id;
  const isAdmin = req.user!.role === 'ADMIN' || req.user!.role === 'SUPER_ADMIN';

  // Get review
  const review = await prisma.review.findUnique({
    where: { id },
    include: {
      customer: true,
    },
  });

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  // Check if user is the customer who created the review or an admin
  const isCustomer = review.customer && review.customer.userId === userId;
  
  if (!isCustomer && !isAdmin) {
    return next(new AppError('You are not authorized to update this review', 403));
  }

  // Update review
  const updatedReview = await prisma.review.update({
    where: { id },
    data: {
      rating: rating !== undefined ? rating : review.rating,
      comment: comment !== undefined ? comment : review.comment,
    },
  });

  // Update contractor rating
  await updateContractorRating(review.contractorId);

  res.status(200).json({
    status: 'success',
    data: {
      review: updatedReview,
    },
  });
});

// @desc    Delete a review
// @route   DELETE /api/reviews/:id
// @access  Private (Admin only)
export const deleteReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  // Delete review
  await prisma.review.delete({
    where: { id },
  });

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

// @desc    Verify an external review
// @route   PATCH /api/reviews/:id/verify
// @access  Private (Admin only)
export const verifyReview = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  // Get review
  const review = await prisma.review.findUnique({
    where: { id },
  });

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  // Update review
  const updatedReview = await prisma.review.update({
    where: { id },
    data: {
      isVerified: true,
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

// Helper function to update contractor rating
async function updateContractorRating(contractorId: string) {
  // Get all verified reviews for the contractor
  const reviews = await prisma.review.findMany({
    where: {
      contractorId,
      isVerified: true,
    },
    select: {
      rating: true,
    },
  });

  // Calculate average rating
  const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
  const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;

  // Count verified reviews
  const verifiedReviews = await prisma.review.count({
    where: {
      contractorId,
      isVerified: true,
    },
  });

  // Update contractor
  await prisma.contractor.update({
    where: { id: contractorId },
    data: {
      averageRating,
      reviewCount: reviews.length,
      verifiedReviews,
    },
  });
}

// @desc    Get reviews that I've received as a contractor
// @route   GET /api/reviews/my/received
// @access  Private (Contractor only)
export const getMyReceivedReviews = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get reviews
  const reviews = await prisma.review.findMany({
    where: { contractorId: contractor.id },
    include: {
      job: {
        select: {
          id: true,
          title: true,
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
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json({
    status: 'success',
    data: {
      reviews,
    },
  });
});

// @desc    Get reviews that I've given as a customer
// @route   GET /api/reviews/my/given
// @access  Private (Customer only)
export const getMyGivenReviews = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;

  // Get customer profile
  const customer = await prisma.customer.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!customer) {
    return next(new AppError('Customer profile not found', 404));
  }

  // Get reviews
  const reviews = await prisma.review.findMany({
    where: { customerId: customer.id },
    include: {
      job: {
        select: {
          id: true,
          title: true,
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

// Routes
router.use(protect);

router.get('/contractor/:contractorId', getContractorReviews);
router.get('/my/received', restrictTo('CONTRACTOR'), getMyReceivedReviews);
router.get('/my/given', restrictTo('CUSTOMER'), getMyGivenReviews);
router.post('/', restrictTo('CUSTOMER'), createReview);
router.post('/external', restrictTo('CONTRACTOR'), addExternalReview);
router.put('/:id', updateReview);
router.delete('/:id', restrictTo('ADMIN', 'SUPER_ADMIN'), deleteReview);
router.patch('/:id/verify', restrictTo('ADMIN', 'SUPER_ADMIN'), verifyReview);

export default router;