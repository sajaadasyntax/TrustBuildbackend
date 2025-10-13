import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { AppError, catchAsync } from './errorHandler';
import { AdminRole } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export interface AdminAuthRequest extends Request {
  admin?: {
    id: string;
    email: string;
    name: string;
    role: AdminRole;
  };
}

// Protect admin routes - verify admin JWT token
export const protectAdmin = catchAsync(
  async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
    // Get token
    let token: string | undefined;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.adminJwt) {
      token = req.cookies.adminJwt;
    }

    if (!token) {
      return next(
        new AppError('You are not logged in as an admin. Please log in to access.', 401)
      );
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      role: AdminRole;
      type: string;
    };

    // Check token type
    if (decoded.type !== 'admin') {
      return next(new AppError('Invalid admin token', 401));
    }

    // Check if admin still exists and is active
    const admin = await prisma.admin.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });

    if (!admin) {
      return next(
        new AppError('The admin belonging to this token no longer exists.', 401)
      );
    }

    if (!admin.isActive) {
      return next(
        new AppError('Your admin account has been deactivated. Please contact support.', 401)
      );
    }

    // Grant access to protected route
    req.admin = admin;
    next();
  }
);

// Permission map for different admin roles
const PERMISSIONS: Record<AdminRole, string[]> = {
  SUPER_ADMIN: ['*'], // All permissions
  FINANCE_ADMIN: [
    'invoices:read',
    'invoices:create',
    'invoices:update',
    'invoices:delete',
    'payments:read',
    'payments:update',
    'commissions:read',
    'commissions:update',
    'jobs:read',
    'jobs:update_value',
    'contractors:read',
    'settings:read',
    'settings:update_commission',
    'settings:update_pricing',
    'activity_logs:read',
  ],
  SUPPORT_ADMIN: [
    'jobs:read',
    'jobs:cancel',
    'jobs:reassign',
    'contractors:read',
    'contractors:freeze',
    'contractors:unfreeze',
    'contractors:update_limits',
    'kyc:read',
    'kyc:approve',
    'kyc:reject',
    'disputes:read',
    'disputes:resolve',
    'activity_logs:read',
  ],
};

// Check if admin has specific permission
export const hasPermission = (role: AdminRole, permission: string): boolean => {
  const rolePermissions = PERMISSIONS[role];
  
  // Super Admin has all permissions
  if (rolePermissions.includes('*')) {
    return true;
  }

  // Check for exact permission match
  if (rolePermissions.includes(permission)) {
    return true;
  }

  // Check for wildcard permission (e.g., 'jobs:*' for all job permissions)
  const [resource, action] = permission.split(':');
  if (rolePermissions.includes(`${resource}:*`)) {
    return true;
  }

  return false;
};

// Middleware to restrict access based on permissions
export const requirePermission = (...permissions: string[]) => {
  return (req: AdminAuthRequest, res: Response, next: NextFunction) => {
    if (!req.admin) {
      return next(new AppError('Authentication required', 401));
    }

    const hasRequiredPermission = permissions.some(permission =>
      hasPermission(req.admin!.role, permission)
    );

    if (!hasRequiredPermission) {
      return next(
        new AppError(
          `You do not have permission to perform this action. Required: ${permissions.join(' or ')}`,
          403
        )
      );
    }

    next();
  };
};

// Middleware to restrict to specific admin roles
export const restrictToAdminRole = (...roles: AdminRole[]) => {
  return (req: AdminAuthRequest, res: Response, next: NextFunction) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return next(
        new AppError(
          'You do not have permission to perform this action',
          403
        )
      );
    }
    next();
  };
};

// Helper to check if user is Super Admin
export const isSuperAdmin = (req: AdminAuthRequest): boolean => {
  return req.admin?.role === AdminRole.SUPER_ADMIN;
};

// Helper to get client IP address
export const getClientIp = (req: Request): string => {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
    req.socket.remoteAddress ||
    'unknown'
  );
};

// Helper to get client user agent
export const getClientUserAgent = (req: Request): string => {
  return req.headers['user-agent'] || 'unknown';
};

