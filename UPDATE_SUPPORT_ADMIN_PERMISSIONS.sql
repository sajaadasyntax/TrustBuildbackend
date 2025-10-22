-- ============================================================================
-- Update SUPPORT_ADMIN Permissions
-- ============================================================================
-- 
-- This script updates all SUPPORT_ADMIN users with the complete set of 
-- permissions they need to perform their duties.
--
-- Principle: If an admin can access a section in the admin panel, they should
-- have ALL permissions needed for that section's functionality.
--
-- Run this in your Neon SQL Console
-- ============================================================================

-- Update all SUPPORT_ADMIN users with comprehensive permissions
UPDATE admins
SET permissions = '[
  "users:read",
  "users:write",
  "jobs:read",
  "jobs:write",
  "contractors:read",
  "contractors:write",
  "reviews:read",
  "reviews:write",
  "content:read",
  "content:write",
  "payments:read",
  "pricing:read",
  "pricing:write",
  "support:read",
  "support:write",
  "kyc:read",
  "kyc:write",
  "final_price:read",
  "final_price:write"
]'::jsonb
WHERE role = 'SUPPORT_ADMIN';

-- Verify the update
SELECT 
  id,
  email,
  name,
  role,
  is_active as "isActive",
  jsonb_array_length(permissions) as "permissionCount",
  permissions
FROM admins
WHERE role = 'SUPPORT_ADMIN'
ORDER BY email;

-- Show what permissions were added
SELECT 
  email,
  role,
  CASE 
    WHEN permissions ? 'pricing:write' THEN '✓' 
    ELSE '✗' 
  END as "pricing:write",
  CASE 
    WHEN permissions ? 'users:write' THEN '✓' 
    ELSE '✗' 
  END as "users:write",
  CASE 
    WHEN permissions ? 'final_price:write' THEN '✓' 
    ELSE '✗' 
  END as "final_price:write",
  CASE 
    WHEN permissions ? 'kyc:read' THEN '✓' 
    ELSE '✗' 
  END as "kyc:read"
FROM admins
WHERE role = 'SUPPORT_ADMIN';

-- ============================================================================
-- After running this script:
-- 1. Log out from the admin panel
-- 2. Clear browser localStorage
-- 3. Log back in as support admin
-- 4. Try updating the lead price again - it should work!
-- ============================================================================

