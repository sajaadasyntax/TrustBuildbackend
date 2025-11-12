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
    isMainSuperAdmin?: boolean;
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
        isMainSuperAdmin: true,
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
      isMainSuperAdmin: (admin as any).isMainSuperAdmin || false,
    };
    next();
  }
);

// Role-based default permissions for SUPPORT_ADMIN and FINANCE_ADMIN
// Used when permissions array is empty or null (fallback)
const SUPPORT_ADMIN_PERMISSIONS = [
  'users:read', 'users:write',
  'contractors:read', 'contractors:write',
  'kyc:read', 'kyc:write',
  'jobs:read', 'jobs:write',
  'reviews:read', 'reviews:write',
  'content:read', 'content:write',
  'support:read', 'support:write',
  'pricing:read', 'pricing:write',
  'disputes:read', 'disputes:write',
];

const FINANCE_ADMIN_PERMISSIONS = [
  'users:read', 'users:write',
  'contractors:read', 'contractors:write',
  'contractors:approve',
  'kyc:read', 'kyc:write',
  'kyc:approve',
  'jobs:read', 'jobs:write',
  'payments:read', 'payments:write',
  'payments:refund',
  'settings:read', 'settings:write',
  'pricing:read', 'pricing:write',
  'disputes:read', 'disputes:write',
  'disputes:resolve',
  'final_price:read', 'final_price:write',
];

// Check if admin has specific permission
export const hasPermission = (admin: AdminAuthRequest['admin'], permission: string): boolean => {
  if (!admin) {
    return false;
  }

  // Super Admin has all permissions (bypass all checks)
  if (admin.role === AdminRole.SUPER_ADMIN) {
    return true;
  }

  // Get admin's assigned permissions
  const adminPermissions = admin.permissions || [];
  
  // For SUPPORT_ADMIN and FINANCE_ADMIN: if permissions array is empty/null, use role-based fallback
  let effectivePermissions = adminPermissions;
  
  if (admin.role === AdminRole.SUPPORT_ADMIN && (!adminPermissions || adminPermissions.length === 0)) {
    effectivePermissions = SUPPORT_ADMIN_PERMISSIONS;
  } else if (admin.role === AdminRole.FINANCE_ADMIN && (!adminPermissions || adminPermissions.length === 0)) {
    effectivePermissions = FINANCE_ADMIN_PERMISSIONS;
  }
  
  // Check for exact permission match
  if (effectivePermissions.includes(permission)) {
    return true;
  }

  // Check for wildcard permission (e.g., 'jobs:*' for all job permissions)
  const [resource, action] = permission.split(':');
  if (effectivePermissions.includes(`${resource}:*`)) {
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

// Helper to check if user is Main Super Admin
export const isMainSuperAdmin = (req: AdminAuthRequest): boolean => {
  return req.admin?.role === AdminRole.SUPER_ADMIN && (req.admin as any).isMainSuperAdmin === true;
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

