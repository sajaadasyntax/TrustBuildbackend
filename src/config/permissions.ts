/**
 * Admin Permission System
 * 
 * Defines all available permissions for admin users.
 * SUPER_ADMIN has all permissions by default.
 * Regular admins only have permissions explicitly assigned to them.
 */

export enum AdminPermission {
  // Users Management
  USERS_READ = 'users:read',
  USERS_WRITE = 'users:write',
  USERS_DELETE = 'users:delete',
  
  // Jobs Management
  JOBS_READ = 'jobs:read',
  JOBS_WRITE = 'jobs:write',
  JOBS_DELETE = 'jobs:delete',
  
  // Contractors Management
  CONTRACTORS_READ = 'contractors:read',
  CONTRACTORS_WRITE = 'contractors:write',
  CONTRACTORS_APPROVE = 'contractors:approve',
  
  // KYC Management
  KYC_READ = 'kyc:read',
  KYC_WRITE = 'kyc:write',
  KYC_APPROVE = 'kyc:approve',
  
  // Payments & Invoices
  PAYMENTS_READ = 'payments:read',
  PAYMENTS_WRITE = 'payments:write',
  PAYMENTS_REFUND = 'payments:refund',
  
  // Reviews Management
  REVIEWS_READ = 'reviews:read',
  REVIEWS_WRITE = 'reviews:write',
  REVIEWS_DELETE = 'reviews:delete',
  
  // Settings Management
  SETTINGS_READ = 'settings:read',
  SETTINGS_WRITE = 'settings:write',
  
  // Pricing Management
  PRICING_READ = 'pricing:read',
  PRICING_WRITE = 'pricing:write',
  
  // Support & Tickets
  SUPPORT_READ = 'support:read',
  SUPPORT_WRITE = 'support:write',
  
  // Content Management
  CONTENT_READ = 'content:read',
  CONTENT_WRITE = 'content:write',
  
  // Security & Logs (SUPER_ADMIN only)
  SECURITY_LOGS_READ = 'security_logs:read',
  SECURITY_LOGS_WRITE = 'security_logs:write',
  
  // Final Price Confirmations
  FINAL_PRICE_READ = 'final_price:read',
  FINAL_PRICE_WRITE = 'final_price:write',
}

// Group permissions by section for easier UI rendering
export const PERMISSION_GROUPS = {
  users: {
    label: 'Users Management',
    description: 'Manage platform users (customers and contractors)',
    permissions: [
      AdminPermission.USERS_READ,
      AdminPermission.USERS_WRITE,
      AdminPermission.USERS_DELETE,
    ],
  },
  jobs: {
    label: 'Jobs Management',
    description: 'View and manage jobs posted on the platform',
    permissions: [
      AdminPermission.JOBS_READ,
      AdminPermission.JOBS_WRITE,
      AdminPermission.JOBS_DELETE,
    ],
  },
  contractors: {
    label: 'Contractors Management',
    description: 'Manage contractor profiles and approvals',
    permissions: [
      AdminPermission.CONTRACTORS_READ,
      AdminPermission.CONTRACTORS_WRITE,
      AdminPermission.CONTRACTORS_APPROVE,
    ],
  },
  kyc: {
    label: 'KYC Management',
    description: 'Review and approve KYC submissions',
    permissions: [
      AdminPermission.KYC_READ,
      AdminPermission.KYC_WRITE,
      AdminPermission.KYC_APPROVE,
    ],
  },
  payments: {
    label: 'Payments & Invoices',
    description: 'Manage payments, invoices, and refunds',
    permissions: [
      AdminPermission.PAYMENTS_READ,
      AdminPermission.PAYMENTS_WRITE,
      AdminPermission.PAYMENTS_REFUND,
    ],
  },
  reviews: {
    label: 'Reviews Management',
    description: 'Moderate and manage user reviews',
    permissions: [
      AdminPermission.REVIEWS_READ,
      AdminPermission.REVIEWS_WRITE,
      AdminPermission.REVIEWS_DELETE,
    ],
  },
  settings: {
    label: 'Settings Management',
    description: 'Configure platform settings',
    permissions: [
      AdminPermission.SETTINGS_READ,
      AdminPermission.SETTINGS_WRITE,
    ],
  },
  pricing: {
    label: 'Pricing Management',
    description: 'Manage service pricing and commission rates',
    permissions: [
      AdminPermission.PRICING_READ,
      AdminPermission.PRICING_WRITE,
    ],
  },
  support: {
    label: 'Support & Tickets',
    description: 'Handle customer support requests',
    permissions: [
      AdminPermission.SUPPORT_READ,
      AdminPermission.SUPPORT_WRITE,
    ],
  },
  content: {
    label: 'Content Management',
    description: 'Manage platform content (FAQ, featured contractors, etc.)',
    permissions: [
      AdminPermission.CONTENT_READ,
      AdminPermission.CONTENT_WRITE,
    ],
  },
  security: {
    label: 'Security & Logs',
    description: 'View security logs and admin activity (SUPER_ADMIN only)',
    superAdminOnly: true,
    permissions: [
      AdminPermission.SECURITY_LOGS_READ,
      AdminPermission.SECURITY_LOGS_WRITE,
    ],
  },
  finalPrice: {
    label: 'Final Price Confirmations',
    description: 'Manage final price confirmations and overrides',
    permissions: [
      AdminPermission.FINAL_PRICE_READ,
      AdminPermission.FINAL_PRICE_WRITE,
    ],
  },
};

// Helper function to check if admin has a specific permission
export function hasPermission(
  adminPermissions: string[] | null | undefined,
  requiredPermission: AdminPermission
): boolean {
  if (!adminPermissions || adminPermissions.length === 0) {
    return false;
  }
  return adminPermissions.includes(requiredPermission);
}

// Helper function to check if admin has any of the required permissions
export function hasAnyPermission(
  adminPermissions: string[] | null | undefined,
  requiredPermissions: AdminPermission[]
): boolean {
  if (!adminPermissions || adminPermissions.length === 0) {
    return false;
  }
  return requiredPermissions.some(permission => 
    adminPermissions.includes(permission)
  );
}

// Helper function to check if admin has all required permissions
export function hasAllPermissions(
  adminPermissions: string[] | null | undefined,
  requiredPermissions: AdminPermission[]
): boolean {
  if (!adminPermissions || adminPermissions.length === 0) {
    return false;
  }
  return requiredPermissions.every(permission => 
    adminPermissions.includes(permission)
  );
}

// Get permission label for display
export function getPermissionLabel(permission: AdminPermission): string {
  const labels: Record<AdminPermission, string> = {
    [AdminPermission.USERS_READ]: 'View Users',
    [AdminPermission.USERS_WRITE]: 'Edit Users',
    [AdminPermission.USERS_DELETE]: 'Delete Users',
    [AdminPermission.JOBS_READ]: 'View Jobs',
    [AdminPermission.JOBS_WRITE]: 'Edit Jobs',
    [AdminPermission.JOBS_DELETE]: 'Delete Jobs',
    [AdminPermission.CONTRACTORS_READ]: 'View Contractors',
    [AdminPermission.CONTRACTORS_WRITE]: 'Edit Contractors',
    [AdminPermission.CONTRACTORS_APPROVE]: 'Approve Contractors',
    [AdminPermission.KYC_READ]: 'View KYC',
    [AdminPermission.KYC_WRITE]: 'Edit KYC',
    [AdminPermission.KYC_APPROVE]: 'Approve KYC',
    [AdminPermission.PAYMENTS_READ]: 'View Payments',
    [AdminPermission.PAYMENTS_WRITE]: 'Edit Payments',
    [AdminPermission.PAYMENTS_REFUND]: 'Process Refunds',
    [AdminPermission.REVIEWS_READ]: 'View Reviews',
    [AdminPermission.REVIEWS_WRITE]: 'Edit Reviews',
    [AdminPermission.REVIEWS_DELETE]: 'Delete Reviews',
    [AdminPermission.SETTINGS_READ]: 'View Settings',
    [AdminPermission.SETTINGS_WRITE]: 'Edit Settings',
    [AdminPermission.PRICING_READ]: 'View Pricing',
    [AdminPermission.PRICING_WRITE]: 'Edit Pricing',
    [AdminPermission.SUPPORT_READ]: 'View Support',
    [AdminPermission.SUPPORT_WRITE]: 'Handle Support',
    [AdminPermission.CONTENT_READ]: 'View Content',
    [AdminPermission.CONTENT_WRITE]: 'Edit Content',
    [AdminPermission.SECURITY_LOGS_READ]: 'View Security Logs',
    [AdminPermission.SECURITY_LOGS_WRITE]: 'Manage Security Logs',
    [AdminPermission.FINAL_PRICE_READ]: 'View Final Price',
    [AdminPermission.FINAL_PRICE_WRITE]: 'Manage Final Price',
  };
  
  return labels[permission] || permission;
}

