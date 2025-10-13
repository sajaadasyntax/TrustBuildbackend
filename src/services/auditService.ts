import { prisma } from '../config/database';
import { createServiceEmail, createEmailService } from './emailService';

interface AuditLogData {
  adminId: string;
  action: string;
  entityType: string;
  entityId?: string;
  description?: string;
  diff?: any;
  ipAddress?: string;
  userAgent?: string;
}

// Actions that trigger Super Admin notifications
const CRITICAL_ACTIONS = [
  'SETTINGS_UPDATE',
  'COMMISSION_RATE_CHANGE',
  'JOB_VALUE_ADJUST',
  'MANUAL_INVOICE_CREATE',
  'MANUAL_INVOICE_CANCEL',
  'CONTRACTOR_FREEZE',
  'CONTRACTOR_UNFREEZE',
  'ADMIN_CREATE',
  'ADMIN_DELETE',
  'KYC_DECISION',
];

// Create activity log entry
export const logActivity = async (data: AuditLogData): Promise<void> => {
  try {
    // Create log entry
    const log = await prisma.activityLog.create({
      data: {
        adminId: data.adminId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        description: data.description,
        diff: data.diff || null,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });

    console.log(`📝 Activity logged: ${data.action} by admin ${data.adminId}`);

    // Check if this action requires Super Admin notification
    if (CRITICAL_ACTIONS.includes(data.action)) {
      await notifySuperAdmin(log, data);
    }
  } catch (error) {
    console.error('❌ Failed to log activity:', error);
    // Don't throw - logging failures shouldn't break the main operation
  }
};

// Notify Super Admin of critical actions
const notifySuperAdmin = async (log: any, data: AuditLogData): Promise<void> => {
  try {
    // Get all Super Admins
    const superAdmins = await prisma.admin.findMany({
      where: {
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });

    if (superAdmins.length === 0) {
      console.warn('⚠️ No Super Admins found to notify');
      return;
    }

    // Get performing admin details
    const performingAdmin = await prisma.admin.findUnique({
      where: { id: data.adminId },
      select: { email: true, name: true, role: true },
    });

    if (!performingAdmin) {
      return;
    }

    // Build email content
    const actionDescriptions: Record<string, string> = {
      SETTINGS_UPDATE: 'System settings were updated',
      COMMISSION_RATE_CHANGE: 'Commission rate was changed',
      JOB_VALUE_ADJUST: 'Job value was adjusted',
      MANUAL_INVOICE_CREATE: 'Manual invoice was created',
      MANUAL_INVOICE_CANCEL: 'Manual invoice was canceled',
      CONTRACTOR_FREEZE: 'Contractor account was frozen',
      CONTRACTOR_UNFREEZE: 'Contractor account was unfrozen',
      ADMIN_CREATE: 'New admin account was created',
      ADMIN_DELETE: 'Admin account was deleted',
      KYC_DECISION: 'KYC verification decision was made',
    };

    const actionTitle = actionDescriptions[data.action] || data.action;

    let diffDetails = '';
    if (data.diff) {
      diffDetails = `
        <div style="margin: 20px 0; padding: 15px; background: #f8f9fa; border-left: 4px solid #fbbf24;">
          <h3 style="margin-top: 0;">Changes Made:</h3>
          <pre style="white-space: pre-wrap; font-family: monospace; font-size: 12px;">${JSON.stringify(data.diff, null, 2)}</pre>
        </div>
      `;
    }

    const emailContent = createServiceEmail({
      to: superAdmins.map(admin => admin.email),
      subject: `🚨 Critical Action: ${actionTitle}`,
      heading: 'Critical Admin Action Detected',
      body: `
        <p><strong>Action:</strong> ${actionTitle}</p>
        <p><strong>Performed by:</strong> ${performingAdmin.name} (${performingAdmin.email})</p>
        <p><strong>Role:</strong> ${performingAdmin.role}</p>
        <p><strong>Entity Type:</strong> ${data.entityType}</p>
        ${data.entityId ? `<p><strong>Entity ID:</strong> ${data.entityId}</p>` : ''}
        ${data.description ? `<p><strong>Description:</strong> ${data.description}</p>` : ''}
        ${diffDetails}
        <p><strong>Time:</strong> ${new Date().toLocaleString('en-GB')}</p>
        ${data.ipAddress ? `<p><strong>IP Address:</strong> ${data.ipAddress}</p>` : ''}
      `,
      footerText: 'This is an automated security notification from TrustBuild Admin System',
    });

    const emailService = createEmailService();
    await emailService.sendMail(emailContent);

    console.log(`📧 Super Admin notification sent for action: ${data.action}`);
  } catch (error) {
    console.error('❌ Failed to notify Super Admin:', error);
    // Don't throw - notification failures shouldn't break the main operation
  }
};

// Get activity logs with filters
export const getActivityLogs = async (filters: {
  adminId?: string;
  action?: string;
  entityType?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) => {
  const where: any = {};

  if (filters.adminId) where.adminId = filters.adminId;
  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = filters.startDate;
    if (filters.endDate) where.createdAt.lte = filters.endDate;
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        admin: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit || 50,
      skip: filters.offset || 0,
    }),
    prisma.activityLog.count({ where }),
  ]);

  return {
    logs,
    total,
    page: Math.floor((filters.offset || 0) / (filters.limit || 50)) + 1,
    totalPages: Math.ceil(total / (filters.limit || 50)),
  };
};

// Get login activities
export const getLoginActivities = async (filters: {
  adminId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) => {
  const where: any = {};

  if (filters.adminId) where.adminId = filters.adminId;
  
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = filters.startDate;
    if (filters.endDate) where.createdAt.lte = filters.endDate;
  }

  const [activities, total] = await Promise.all([
    prisma.loginActivity.findMany({
      where,
      include: {
        admin: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit || 50,
      skip: filters.offset || 0,
    }),
    prisma.loginActivity.count({ where }),
  ]);

  return {
    activities,
    total,
    page: Math.floor((filters.offset || 0) / (filters.limit || 50)) + 1,
    totalPages: Math.ceil(total / (filters.limit || 50)),
  };
};

