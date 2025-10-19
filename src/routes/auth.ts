import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { protect, AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

interface RegisterData {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: 'CUSTOMER' | 'CONTRACTOR';
  // Customer fields
  phone?: string;
  address?: string;
  city?: string;
  postcode?: string;
  // Contractor fields
  businessName?: string;
  description?: string;
  businessAddress?: string;
  servicesProvided?: string;
  yearsExperience?: string;
  operatingArea?: string;
  workSetup?: string;
  providesWarranty?: boolean;
  warrantyPeriod?: string;
  websiteOrInstagram?: string;
  unsatisfiedCustomers?: string;
  preferredClients?: string;
  usesContracts?: boolean;
}

const signToken = (id: string): string => {
  return jwt.sign({ id }, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  } as jwt.SignOptions);
};

const createSendToken = (user: any, statusCode: number, res: express.Response): void => {
  const token = signToken(user.id);
  
  const cookieOptions = {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
  };

  res.cookie('jwt', token, cookieOptions);

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
export const register = catchAsync(async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const {
    name,
    email,
    password,
    confirmPassword,
    role,
    // Customer fields
    phone,
    address,
    city,
    postcode,
    // Contractor fields
    businessName,
    description,
    businessAddress,
    servicesProvided,
    yearsExperience,
    operatingArea,
    workSetup,
    providesWarranty,
    warrantyPeriod,
    websiteOrInstagram,
    unsatisfiedCustomers,
    preferredClients,
    usesContracts,
  }: RegisterData = req.body;

  // Validate required fields
  if (!name || !email || !password || !role) {
    return next(new AppError('Please provide name, email, password, and role', 400));
  }

  if (password !== confirmPassword) {
    return next(new AppError('Passwords do not match', 400));
  }

  if (password.length < 8) {
    return next(new AppError('Password must be at least 8 characters long', 400));
  }

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return next(new AppError('User with this email already exists', 400));
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create user
  const newUser = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  // Create customer or contractor profile
  if (role === 'CUSTOMER') {
    await prisma.customer.create({
      data: {
        userId: newUser.id,
        phone,
        address,
        city,
        postcode,
      },
    });

    // Send welcome email to customer
    try {
      const { sendCustomerWelcomeEmail } = await import('../services/emailNotificationService');
      await sendCustomerWelcomeEmail({
        name: newUser.name,
        email: newUser.email,
      });
    } catch (error) {
      console.error('Failed to send customer welcome email:', error);
      // Don't fail registration if email fails
    }
  } else if (role === 'CONTRACTOR') {
    // Create contractor profile
    const newContractor = await prisma.contractor.create({
      data: {
        userId: newUser.id,
        businessName,
        description,
        businessAddress,
        city,
        postcode,
        phone,
        operatingArea,
        servicesProvided,
        yearsExperience,
        workSetup,
        providesWarranty: providesWarranty || false,
        warrantyPeriod,
        instagramHandle: websiteOrInstagram,
        unsatisfiedCustomers,
        preferredClients,
        usesContracts: usesContracts || false,
        creditsBalance: 0, // No initial credits for non-subscribers
        lastCreditReset: null, // No credit reset for non-subscribers
        profileApproved: false, // Requires admin approval
        accountStatus: 'PAUSED', // Start paused until KYC is completed
      },
    });

    // Create KYC record with 14-day deadline
    const kycDeadline = new Date();
    kycDeadline.setDate(kycDeadline.getDate() + 14); // 14 days to submit KYC

    await prisma.contractorKyc.create({
      data: {
        contractorId: newContractor.id,
        status: 'PENDING',
        dueBy: kycDeadline,
      },
    });

    // Note: Credits will only be allocated when contractor subscribes
    // No initial credit transaction for non-subscribers

    // Send welcome email to contractor
    try {
      const { sendContractorWelcomeEmail } = await import('../services/emailNotificationService');
      await sendContractorWelcomeEmail({
        name: newUser.name,
        email: newUser.email,
        businessName: businessName,
      });
    } catch (error) {
      console.error('Failed to send contractor welcome email:', error);
      // Don't fail registration if email fails
    }
  }

  createSendToken(newUser, 201, res);
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = catchAsync(async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { email, password } = req.body;

  // Check if email and password exist
  if (!email || !password) {
    return next(new AppError('Please provide email and password!', 400));
  }

  // Check if user exists && password is correct
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      password: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401));
  }

  if (!user.isActive) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 401));
  }

  createSendToken(user, 200, res);
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
export const logout = (req: express.Request, res: express.Response): void => {
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });
  
  res.status(200).json({ 
    status: 'success',
    message: 'Logged out successfully' 
  });
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
export const getMe = catchAsync(async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
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
          address: true,
          city: true,
          postcode: true,
        },
      },
      contractor: {
        select: {
          id: true,
          businessName: true,
          description: true,
          phone: true,
          website: true,
          instagramHandle: true,
          operatingArea: true,
          servicesProvided: true,
          yearsExperience: true,
          status: true,
          tier: true,
          averageRating: true,
          reviewCount: true,
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

// @desc    Update password
// @route   PATCH /api/auth/update-password
// @access  Private
export const updatePassword = catchAsync(async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
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
  const updatedUser = await prisma.user.update({
    where: { id: req.user!.id },
    data: { password: hashedNewPassword },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  });

  createSendToken(updatedUser, 200, res);
});

// Routes
router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', protect, getMe);
router.patch('/update-password', protect, updatePassword);

export default router; 