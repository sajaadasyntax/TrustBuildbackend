-- ============================================================================
-- Update ALL Admin Permissions - Role-Based Access Control
-- ============================================================================
-- 
-- This script sets up proper permissions for each admin role based on
-- the sections they should have access to.
--
-- Run this in your Neon SQL Console
-- ============================================================================

-- ============================================================================
-- SUPPORT_ADMIN - Access to 6 sections:
-- 1. User Management
-- 2. Contractor Management  
-- 3. KYC Review
-- 4. Job Oversight
-- 5. Review Management
-- 6. Content Moderation
-- ============================================================================
UPDATE admins
SET permissions = '[
  "users:read",
  "users:write",
  "contractors:read",
  "contractors:write",
  "kyc:read",
  "kyc:write",
  "jobs:read",
  "jobs:write",
  "pricing:read",
  "pricing:write",
  "reviews:read",
  "reviews:write",
  "content:read",
  "content:write",
  "support:read",
  "support:write"
]'::jsonb
WHERE role = 'SUPPORT_ADMIN';

-- ============================================================================
-- FINANCE_ADMIN - Access to 5 sections:
-- 1. User Management
-- 2. Contractor Management (includes KYC approval)
-- 3. Job Oversight
-- 4. Payment Dashboard
-- 5. Platform Settings
-- ============================================================================
UPDATE admins
SET permissions = '[
  "users:read",
  "users:write",
  "contractors:read",
  "contractors:write",
  "contractors:approve",
  "kyc:read",
  "kyc:write",
  "kyc:approve",
  "jobs:read",
  "jobs:write",
  "pricing:read",
  "pricing:write",
  "payments:read",
  "payments:write",
  "payments:refund",
  "settings:read",
  "settings:write",
  "final_price:read",
  "final_price:write"
]'::jsonb
WHERE role = 'FINANCE_ADMIN';

-- ============================================================================
-- Verify the updates
-- ============================================================================

-- Show all admins with their permission counts
SELECT 
  email,
  name,
  role,
  is_active as "isActive",
  jsonb_array_length(permissions) as "permissionCount"
FROM admins
ORDER BY 
  CASE role
    WHEN 'SUPER_ADMIN' THEN 1
    WHEN 'FINANCE_ADMIN' THEN 2
    WHEN 'SUPPORT_ADMIN' THEN 3
  END,
  email;

-- Show SUPPORT_ADMIN access
SELECT 
  '🎯 SUPPORT_ADMIN Access' as "Section",
  '✓' as "Users",
  '✓' as "Contractors",
  '✓' as "KYC",
  '✓' as "Jobs",
  '✓' as "Reviews",
  '✓' as "Content",
  '✗' as "Payments",
  '✗' as "Settings"
WHERE EXISTS (SELECT 1 FROM admins WHERE role = 'SUPPORT_ADMIN');

-- Show FINANCE_ADMIN access  
SELECT 
  '💰 FINANCE_ADMIN Access' as "Section",
  '✓' as "Users",
  '✓' as "Contractors",
  '✓' as "KYC+Approve",
  '✓' as "Jobs",
  '✗' as "Reviews",
  '✗' as "Content",
  '✓' as "Payments",
  '✓' as "Settings"
WHERE EXISTS (SELECT 1 FROM admins WHERE role = 'FINANCE_ADMIN');

-- Detailed permission check
SELECT 
  email,
  role,
  CASE WHEN permissions ? 'users:write' THEN '✓' ELSE '✗' END as "Users",
  CASE WHEN permissions ? 'contractors:approve' THEN '✓' ELSE '✗' END as "Approve Contractors",
  CASE WHEN permissions ? 'pricing:write' THEN '✓' ELSE '✗' END as "Set Prices",
  CASE WHEN permissions ? 'payments:refund' THEN '✓' ELSE '✗' END as "Refunds",
  CASE WHEN permissions ? 'reviews:write' THEN '✓' ELSE '✗' END as "Reviews",
  CASE WHEN permissions ? 'content:write' THEN '✓' ELSE '✗' END as "Content",
  CASE WHEN permissions ? 'settings:write' THEN '✓' ELSE '✗' END as "Settings"
FROM admins
WHERE role IN ('SUPPORT_ADMIN', 'FINANCE_ADMIN')
ORDER BY role, email;

-- ============================================================================
-- After running this script:
-- 1. Log out all admins from the admin panel
-- 2. Clear browser localStorage
-- 3. Log back in with the appropriate role
-- 4. Verify access to only the designated sections
-- ============================================================================

