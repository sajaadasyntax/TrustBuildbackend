import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import CryptoJS from 'crypto-js';
import { prisma } from '../config/database';
import { AdminRole } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-encryption-key-32-chars!!';

// Encrypt 2FA secret before storing
export const encrypt2FASecret = (secret: string): string => {
  return CryptoJS.AES.encrypt(secret, ENCRYPTION_KEY).toString();
};

// Decrypt 2FA secret when verifying
export const decrypt2FASecret = (encryptedSecret: string): string => {
  const bytes = CryptoJS.AES.decrypt(encryptedSecret, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
};

// Generate JWT token for admin
export const generateAdminToken = (adminId: string, role: AdminRole): string => {
  return jwt.sign(
    { 
      id: adminId,
      role,
      type: 'admin'
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Verify admin password
export const verifyAdminPassword = async (
  password: string,
  passwordHash: string
): Promise<boolean> => {
  return await bcrypt.compare(password, passwordHash);
};

// Hash admin password
export const hashAdminPassword = async (password: string): Promise<string> => {
  return await bcrypt.hash(password, 12);
};

// Enable 2FA for admin
export const enable2FA = async (adminId: string) => {
  // Generate secret
  const secret = speakeasy.generateSecret({
    name: `TrustBuild Admin (${adminId})`,
    length: 32,
  });

  // Encrypt secret before storing
  const encryptedSecret = encrypt2FASecret(secret.base32);

  // Update admin with encrypted secret (but don't enable yet - wait for verification)
  await prisma.admin.update({
    where: { id: adminId },
    data: {
      twoFASecret: encryptedSecret,
    },
  });

  // Generate QR code
  const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url || '');

  return {
    secret: secret.base32, // Return unencrypted for initial setup
    qrCode: qrCodeDataUrl,
  };
};

// Verify 2FA token
export const verify2FAToken = async (
  adminId: string,
  token: string
): Promise<boolean> => {
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { twoFASecret: true },
  });

  if (!admin || !admin.twoFASecret) {
    return false;
  }

  // Decrypt secret
  const secret = decrypt2FASecret(admin.twoFASecret);

  // Verify token
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 2, // Allow 2 time steps before/after for clock skew
  });
};

// Complete 2FA setup (after verification)
export const complete2FASetup = async (adminId: string): Promise<void> => {
  await prisma.admin.update({
    where: { id: adminId },
    data: {
      twoFAEnabled: true,
    },
  });
};

// Disable 2FA
export const disable2FA = async (adminId: string): Promise<void> => {
  await prisma.admin.update({
    where: { id: adminId },
    data: {
      twoFAEnabled: false,
      twoFASecret: null,
    },
  });
};

// Login admin (step 1 - verify password)
export const loginAdmin = async (
  email: string,
  password: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{
  success: boolean;
  admin?: any;
  requires2FA?: boolean;
  tempToken?: string;
  token?: string;
  message?: string;
}> => {
  // Find admin
  const admin = await prisma.admin.findUnique({
    where: { email },
  });

  if (!admin) {
    return {
      success: false,
      message: 'Invalid credentials',
    };
  }

  if (!admin.isActive) {
    return {
      success: false,
      message: 'Account is deactivated',
    };
  }

  // Verify password
  const isValidPassword = await verifyAdminPassword(password, admin.passwordHash);

  if (!isValidPassword) {
    // Log failed login attempt
    await prisma.loginActivity.create({
      data: {
        adminId: admin.id,
        ip: ipAddress,
        userAgent,
        success: false,
      },
    });

    return {
      success: false,
      message: 'Invalid credentials',
    };
  }

  // If 2FA is enabled, return temporary token
  if (admin.twoFAEnabled) {
    const tempToken = jwt.sign(
      { 
        id: admin.id,
        type: 'admin-2fa-pending'
      },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    return {
      success: true,
      requires2FA: true,
      tempToken,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    };
  }

  // Generate full access token
  const token = generateAdminToken(admin.id, admin.role);

  // Update last login
  await prisma.admin.update({
    where: { id: admin.id },
    data: {
      lastLoginAt: new Date(),
    },
  });

  // Log successful login
  await prisma.loginActivity.create({
    data: {
      adminId: admin.id,
      ip: ipAddress,
      userAgent,
      success: true,
    },
  });

  return {
    success: true,
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      twoFAEnabled: admin.twoFAEnabled,
    },
  };
};

// Verify 2FA and complete login (step 2)
export const verify2FALogin = async (
  tempToken: string,
  token2FA: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{
  success: boolean;
  token?: string;
  admin?: any;
  message?: string;
}> => {
  try {
    // Verify temp token
    const decoded = jwt.verify(tempToken, JWT_SECRET) as {
      id: string;
      type: string;
    };

    if (decoded.type !== 'admin-2fa-pending') {
      return {
        success: false,
        message: 'Invalid token',
      };
    }

    // Verify 2FA token
    const is2FAValid = await verify2FAToken(decoded.id, token2FA);

    if (!is2FAValid) {
      return {
        success: false,
        message: 'Invalid 2FA code',
      };
    }

    // Get admin details
    const admin = await prisma.admin.findUnique({
      where: { id: decoded.id },
    });

    if (!admin) {
      return {
        success: false,
        message: 'Admin not found',
      };
    }

    // Generate full access token
    const token = generateAdminToken(admin.id, admin.role);

    // Update last login
    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        lastLoginAt: new Date(),
      },
    });

    // Log successful login
    await prisma.loginActivity.create({
      data: {
        adminId: admin.id,
        ip: ipAddress,
        userAgent,
        success: true,
      },
    });

    return {
      success: true,
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        twoFAEnabled: admin.twoFAEnabled,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Invalid or expired token',
    };
  }
};

