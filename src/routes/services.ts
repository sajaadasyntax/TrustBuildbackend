import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';

const router = Router();

// @desc    Get all services
// @route   GET /api/services
// @access  Public
export const getAllServices = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const skip = (page - 1) * limit;

  const { category, search, isActive } = req.query;

  // Build filter conditions
  const where: any = {};

  // Default to active services only for public endpoints (unless explicitly requested)
  if (isActive !== undefined) {
    // Handle both string 'true'/'false' and boolean true/false
    const isActiveValue = typeof isActive === 'string' ? isActive === 'true' : Boolean(isActive);
    where.isActive = isActiveValue;
  } else {
    // Default to active services only when not specified
    where.isActive = true;
  }

  if (category) {
    where.category = { contains: category as string, mode: 'insensitive' };
  }

  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { description: { contains: search as string, mode: 'insensitive' } },
      { category: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  const services = await prisma.service.findMany({
    where,
    skip,
    take: limit,
    include: {
      contractors: {
        where: { profileApproved: true },
        select: {
          id: true,
          businessName: true,
          averageRating: true,
        },
        take: 3,
      },
      _count: {
        select: {
          contractors: {
            where: { profileApproved: true },
          },
        },
      },
    },
    orderBy: [
      { category: 'asc' },
      { name: 'asc' },
    ],
  });

  const total = await prisma.service.count({ where });

  res.status(200).json({
    status: 'success',
    data: {
      services,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get single service
// @route   GET /api/services/:id
// @access  Public
export const getService = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const service = await prisma.service.findUnique({
    where: { id: req.params.id },
    include: {
      contractors: {
        where: { profileApproved: true },
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
        },
      },
    },
  });

  if (!service) {
    return next(new AppError('Service not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      service,
    },
  });
});

// @desc    Create new service (Admin only)
// @route   POST /api/services
// @access  Private/Admin
export const createService = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }

  const { name, description, category, isActive } = req.body;

  // Check if service already exists
  const existingService = await prisma.service.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
    },
  });

  if (existingService) {
    return next(new AppError('Service with this name already exists', 400));
  }

  const service = await prisma.service.create({
    data: {
      name,
      description,
      category,
      isActive: isActive !== undefined ? isActive : true,
    },
  });

  res.status(201).json({
    status: 'success',
    data: {
      service,
    },
  });
});

// @desc    Update service (Admin only)
// @route   PATCH /api/services/:id
// @access  Private/Admin
export const updateService = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }

  const service = await prisma.service.findUnique({
    where: { id: req.params.id },
  });

  if (!service) {
    return next(new AppError('Service not found', 404));
  }

  const { name, description, category, isActive } = req.body;

  // Check if name conflicts with another service
  if (name && name !== service.name) {
    const existingService = await prisma.service.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        id: { not: req.params.id },
      },
    });

    if (existingService) {
      return next(new AppError('Service with this name already exists', 400));
    }
  }

  const updatedService = await prisma.service.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name }),
      ...(description && { description }),
      ...(category && { category }),
      ...(isActive !== undefined && { isActive }),
    },
    include: {
      contractors: {
        select: {
          id: true,
          businessName: true,
        },
      },
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      service: updatedService,
    },
  });
});

// @desc    Delete service (Admin only)
// @route   DELETE /api/services/:id
// @access  Private/Admin
export const deleteService = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }

  const service = await prisma.service.findUnique({
    where: { id: req.params.id },
    include: {
      contractors: true,
    },
  });

  if (!service) {
    return next(new AppError('Service not found', 404));
  }

  // Check if service has contractors
  if (service.contractors.length > 0) {
    return next(new AppError('Cannot delete service that has contractors assigned', 400));
  }

  await prisma.service.delete({
    where: { id: req.params.id },
  });

  res.status(200).json({
    status: 'success',
    message: 'Service deleted successfully',
  });
});

// @desc    Get service categories
// @route   GET /api/services/categories
// @access  Public
export const getServiceCategories = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const categories = await prisma.service.findMany({
    where: { isActive: true },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });

  const categoryList = categories.map(c => c.category).filter(Boolean);

  res.status(200).json({
    status: 'success',
    data: {
      categories: categoryList,
    },
  });
});

// @desc    Get contractors for a service
// @route   GET /api/services/:id/contractors
// @access  Public
export const getServiceContractors = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const { location, rating, tier } = req.query;

  const service = await prisma.service.findUnique({
    where: { id: req.params.id },
  });

  if (!service) {
    return next(new AppError('Service not found', 404));
  }

  // Build filter conditions
  const where: any = {
    profileApproved: true,
    services: {
      some: {
        id: req.params.id,
      },
    },
  };

  if (location) {
    where.city = { contains: location as string, mode: 'insensitive' };
  }

  if (rating) {
    where.averageRating = { gte: parseFloat(rating as string) };
  }

  if (tier) {
    where.tier = tier as string;
  }

  const contractors = await prisma.contractor.findMany({
    where,
    skip,
    take: limit,
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
    },
    orderBy: [
      { featuredContractor: 'desc' },
      { averageRating: 'desc' },
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

// @desc    Add service to contractor
// @route   POST /api/services/:id/contractors/:contractorId
// @access  Private (Contractor or Admin)
export const addServiceToContractor = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const service = await prisma.service.findUnique({
    where: { id: req.params.id },
  });

  if (!service) {
    return next(new AppError('Service not found', 404));
  }

  const contractor = await prisma.contractor.findUnique({
    where: { id: req.params.contractorId },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  // Check authorization
  const isOwner = contractor.userId === req.user!.id;
  const isAdmin = req.user?.role === 'ADMIN';

  if (!isOwner && !isAdmin) {
    return next(new AppError('Not authorized to modify this contractor profile', 403));
  }

  // Check if service is already assigned
  const existingConnection = await prisma.contractor.findFirst({
    where: {
      id: req.params.contractorId,
      services: {
        some: {
          id: req.params.id,
        },
      },
    },
  });

  if (existingConnection) {
    return next(new AppError('Service already assigned to contractor', 400));
  }

  await prisma.contractor.update({
    where: { id: req.params.contractorId },
    data: {
      services: {
        connect: { id: req.params.id },
      },
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Service added to contractor successfully',
  });
});

// @desc    Remove service from contractor
// @route   DELETE /api/services/:id/contractors/:contractorId
// @access  Private (Contractor or Admin)
export const removeServiceFromContractor = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const contractor = await prisma.contractor.findUnique({
    where: { id: req.params.contractorId },
  });

  if (!contractor) {
    return next(new AppError('Contractor not found', 404));
  }

  // Check authorization
  const isOwner = contractor.userId === req.user!.id;
  const isAdmin = req.user?.role === 'ADMIN';

  if (!isOwner && !isAdmin) {
    return next(new AppError('Not authorized to modify this contractor profile', 403));
  }

  await prisma.contractor.update({
    where: { id: req.params.contractorId },
    data: {
      services: {
        disconnect: { id: req.params.id },
      },
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Service removed from contractor successfully',
  });
});

// Routes
router.get('/', getAllServices);
router.get('/categories', getServiceCategories);
router.post('/', protect, createService);
router.get('/:id', getService);
router.patch('/:id', protect, updateService);
router.delete('/:id', protect, deleteService);
router.get('/:id/contractors', getServiceContractors);
router.post('/:id/contractors/:contractorId', protect, addServiceToContractor);
router.delete('/:id/contractors/:contractorId', protect, removeServiceFromContractor);

export default router; 
