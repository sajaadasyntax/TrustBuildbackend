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
    permissions: string[] | null;
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
        permissions: true,
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
    req.admin = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      permissions: admin.permissions as string[] | null,
    };
    next();
  }
);

// Check if admin has specific permission
export const hasPermission = (admin: AdminAuthRequest['admin'], permission: string): boolean => {
  if (!admin) {
    return false;
  }

  // Super Admin has all permissions
  if (admin.role === AdminRole.SUPER_ADMIN) {
    return true;
  }

  // Check admin's assigned permissions
  const adminPermissions = admin.permissions || [];
  
  // Check for exact permission match
  if (adminPermissions.includes(permission)) {
    return true;
  }

  // Check for wildcard permission (e.g., 'jobs:*' for all job permissions)
  const [resource, action] = permission.split(':');
  if (adminPermissions.includes(`${resource}:*`)) {
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
      hasPermission(req.admin, permission)
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

