import express, { Response } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import {
  loginAdmin,
  verify2FALogin,
  enable2FA,
  verify2FAToken,
  complete2FASetup,
  disable2FA,
  hashAdminPassword,
} from '../services/adminAuthService';
import {
  protectAdmin,
  restrictToAdminRole,
  getClientIp,
  getClientUserAgent,
  AdminAuthRequest,
} from '../middleware/adminAuth';
import { logActivity } from '../services/auditService';
import { prisma } from '../config/database';
import { AdminRole } from '@prisma/client';

const router = express.Router();

// Admin login (step 1 - email & password)
router.post(
  '/login',
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Email and password are required',
      });
    }

    const result = await loginAdmin(
      email,
      password,
      getClientIp(req),
      getClientUserAgent(req)
    );

    if (!result.success) {
      return res.status(401).json({
        status: 'error',
        message: result.message,
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        admin: result.admin,
        token: result.token,
        requires2FA: result.requires2FA,
        tempToken: result.tempToken,
      },
    });
  })
);

// Verify 2FA and complete login (step 2)
router.post(
  '/verify-2fa',
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { tempToken, token: token2FA } = req.body;

    if (!tempToken || !token2FA) {
      return res.status(400).json({
        status: 'error',
        message: 'Temporary token and 2FA code are required',
      });
    }

    const result = await verify2FALogin(
      tempToken,
      token2FA,
      getClientIp(req),
      getClientUserAgent(req)
    );

    if (!result.success) {
      return res.status(401).json({
        status: 'error',
        message: result.message,
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        admin: result.admin,
        token: result.token,
      },
    });
  })
);

// Enable 2FA (step 1 - generate QR code)
router.post(
  '/2fa/enable',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const result = await enable2FA(req.admin!.id);

    res.status(200).json({
      status: 'success',
      data: {
        secret: result.secret,
        qrCode: result.qrCode,
        message: 'Scan the QR code with your authenticator app and verify with a code',
      },
    });
  })
);

// Verify and complete 2FA setup (step 2)
router.post(
  '/2fa/verify-setup',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        status: 'error',
        message: '2FA token is required',
      });
    }

    const isValid = await verify2FAToken(req.admin!.id, token);

    if (!isValid) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid 2FA token',
      });
    }

    await complete2FASetup(req.admin!.id);

    await logActivity({
      adminId: req.admin!.id,
      action: '2FA_ENABLED',
      entityType: 'Admin',
      entityId: req.admin!.id,
      description: '2FA authentication enabled',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: '2FA has been successfully enabled',
    });
  })
);

// Disable 2FA
router.post(
  '/2fa/disable',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        status: 'error',
        message: 'Password is required to disable 2FA',
      });
    }

    // Verify password
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin!.id },
    });

    const bcrypt = require('bcryptjs');
    const isValidPassword = await bcrypt.compare(password, admin!.passwordHash);

    if (!isValidPassword) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid password',
      });
    }

    await disable2FA(req.admin!.id);

    await logActivity({
      adminId: req.admin!.id,
      action: '2FA_DISABLED',
      entityType: 'Admin',
      entityId: req.admin!.id,
      description: '2FA authentication disabled',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: '2FA has been disabled',
    });
  })
);

// Get current admin profile
router.get(
  '/me',
  protectAdmin,
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin!.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        permissions: true,
        isActive: true,
        isMainSuperAdmin: true,
        twoFAEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (!admin) {
      return res.status(404).json({
        status: 'error',
        message: 'Admin not found',
      });
    }

    res.status(200).json({
      status: 'success',
      data: { admin },
    });
  })
);

// List all admins (Super Admin only)
router.get(
  '/admins',
  protectAdmin,
  restrictToAdminRole(AdminRole.SUPER_ADMIN),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const admins = await prisma.admin.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        permissions: true,
        isActive: true,
        isMainSuperAdmin: true,
        twoFAEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      data: { admins },
    });
  })
);

// Create new admin (Super Admin only)
router.post(
  '/admins',
  protectAdmin,
  restrictToAdminRole(AdminRole.SUPER_ADMIN),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { email, name, role, password, permissions } = req.body;

    if (!email || !name || !role || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Email, name, role, and password are required',
      });
    }

    // Validate role
    if (!['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN'].includes(role)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid admin role',
      });
    }

    // Only Main Super Admin can create new Super Admins
    if (role === 'SUPER_ADMIN' && !req.admin!.isMainSuperAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'Only the Main Super Admin can create new Super Admins',
      });
    }

    // Prevent creating additional Main Super Admins - only one can exist
    if (req.body.isMainSuperAdmin === true) {
      const existingMainSuperAdmin = await prisma.admin.findFirst({
        where: { isMainSuperAdmin: true },
      });

      if (existingMainSuperAdmin) {
        return res.status(400).json({
          status: 'error',
          message: 'A Main Super Admin already exists. Only one Main Super Admin is allowed.',
        });
      }
    }

    // For regular admins (non-SUPER_ADMIN), permissions are required
    if (role !== 'SUPER_ADMIN' && (!permissions || !Array.isArray(permissions) || permissions.length === 0)) {
      return res.status(400).json({
        status: 'error',
        message: 'Permissions are required for non-SUPER_ADMIN roles',
      });
    }

    // Check if email already exists
    const existingAdmin = await prisma.admin.findUnique({
      where: { email },
    });

    if (existingAdmin) {
      return res.status(400).json({
        status: 'error',
        message: 'An admin with this email already exists',
      });
    }

    const passwordHash = await hashAdminPassword(password);

    const admin = await prisma.admin.create({
      data: {
        email,
        name,
        role: role as AdminRole,
        passwordHash,
        permissions: role === 'SUPER_ADMIN' ? null : permissions, // SUPER_ADMIN doesn't need permissions
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        permissions: true,
        isActive: true,
        createdAt: true,
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'ADMIN_CREATE',
      entityType: 'Admin',
      entityId: admin.id,
      description: `Created new admin: ${admin.email} with role ${admin.role}`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(201).json({
      status: 'success',
      data: { admin },
    });
  })
);

// Update admin (Super Admin only)
router.patch(
  '/admins/:id',
  protectAdmin,
  restrictToAdminRole(AdminRole.SUPER_ADMIN),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { id } = req.params;
    const { name, role, isActive } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;

    const admin = await prisma.admin.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'ADMIN_UPDATE',
      entityType: 'Admin',
      entityId: admin.id,
      description: `Updated admin: ${admin.email}`,
      diff: updateData,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      data: { admin },
    });
  })
);

// Delete admin (Super Admin only)
router.delete(
  '/admins/:id',
  protectAdmin,
  restrictToAdminRole(AdminRole.SUPER_ADMIN),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { id } = req.params;

    // Prevent deleting self
    if (id === req.admin!.id) {
      return res.status(400).json({
        status: 'error',
        message: 'You cannot delete your own admin account',
      });
    }

    const targetAdmin = await prisma.admin.findUnique({
      where: { id },
      select: { 
        email: true, 
        role: true,
        isMainSuperAdmin: true,
      },
    });

    if (!targetAdmin) {
      return res.status(404).json({
        status: 'error',
        message: 'Admin not found',
      });
    }

    // Prevent deletion of Main Super Admin
    if (targetAdmin.isMainSuperAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'The Main Super Admin cannot be deleted',
      });
    }

    // Only Main Super Admin can delete other Super Admins
    if (targetAdmin.role === AdminRole.SUPER_ADMIN && !req.admin!.isMainSuperAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'Only the Main Super Admin can delete other Super Admins',
      });
    }

    await prisma.admin.delete({
      where: { id },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'ADMIN_DELETE',
      entityType: 'Admin',
      entityId: id,
      description: `Deleted admin: ${targetAdmin.email}`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'Admin deleted successfully',
    });
  })
);

export default router;

