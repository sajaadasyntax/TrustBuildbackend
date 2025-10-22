import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import bcrypt from 'bcryptjs';

const router = Router();

// @desc    Get all users (Admin only)
// @route   GET /api/users
// @access  Private/Admin
export const getAllUsers = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const users = await prisma.user.findMany({
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
        },
      },
      contractor: {
        select: {
          id: true,
          businessName: true,
          status: true,
          averageRating: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  const total = await prisma.user.count();

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

// @desc    Get current user profile
// @route   GET /api/users/me
// @access  Private
export const getMe = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      customer: true,
      contractor: {
        include: {
          services: true,
          portfolio: true,
        },
      },
    },
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user,
    },
  });
});

// @desc    Update user profile
// @route   PATCH /api/users/me
// @access  Private
export const updateMe = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { name, email } = req.body;

  // Check if email is already taken by another user
  if (email && email !== req.user!.email) {
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return next(new AppError('Email is already in use', 400));
    }
  }

  const updatedUser = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      ...(name && { name }),
      ...(email && { email }),
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

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
    },
  });
});

// @desc    Update user password
// @route   PATCH /api/users/me/password
// @access  Private
export const updatePassword = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmNewPassword) {
    return next(new AppError('Please provide current password, new password, and confirm new password', 400));
  }

  if (newPassword !== confirmNewPassword) {
    return next(new AppError('New passwords do not match', 400));
  }

  if (newPassword.length < 8) {
    return next(new AppError('Password must be at least 8 characters long', 400));
  }

  // Get user from database
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Check if current password is correct
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return next(new AppError('Your current password is incorrect', 401));
  }

  // Hash new password
  const hashedNewPassword = await bcrypt.hash(newPassword, 12);

  // Update password
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { password: hashedNewPassword },
  });

  res.status(200).json({
    status: 'success',
    message: 'Password updated successfully',
  });
});

// @desc    Deactivate user account
// @route   DELETE /api/users/me
// @access  Private
export const deactivateMe = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { isActive: false },
  });

  res.status(200).json({
    status: 'success',
    message: 'Account deactivated successfully',
  });
});

// @desc    Get user by ID (Admin only)
// @route   GET /api/users/:id
// @access  Private/Admin
export const getUserById = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }

  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      customer: true,
      contractor: {
        include: {
          services: true,
          portfolio: true,
        },
      },
    },
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user,
    },
  });
});

// @desc    Update user (Admin only)
// @route   PATCH /api/users/:id
// @access  Private/Admin
export const updateUser = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user?.role || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return next(new AppError('Access denied. Admin only.', 403));
  }

  const { name, email, role, isActive } = req.body;

  const updatedUser = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name }),
      ...(email && { email }),
      ...(role && { role }),
      ...(isActive !== undefined && { isActive }),
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

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
    },
  });
});

// @desc    Change password
// @route   PATCH /api/users/change-password
// @access  Private
export const changePassword = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return next(new AppError('Please provide current password, new password, and confirmation', 400));
  }

  if (newPassword !== confirmPassword) {
    return next(new AppError('New password and confirmation do not match', 400));
  }

  if (newPassword.length < 8) {
    return next(new AppError('Password must be at least 8 characters long', 400));
  }

  // Get user with password
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      password: true,
    },
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Check current password
  const isPasswordCorrect = await bcrypt.compare(currentPassword, user.password);
  if (!isPasswordCorrect) {
    return next(new AppError('Current password is incorrect', 401));
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // Update password
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword },
  });

  res.status(200).json({
    status: 'success',
    message: 'Password changed successfully',
  });
});

// Routes
router.get('/', protect, getAllUsers);
router.get('/me', protect, getMe);
router.patch('/change-password', protect, changePassword);
router.patch('/me', protect, updateMe);
router.patch('/me/password', protect, updatePassword);
router.delete('/me', protect, deactivateMe);
router.get('/:id', protect, getUserById);
router.patch('/:id', protect, updateUser);

export default router; 
