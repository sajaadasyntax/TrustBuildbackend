-- Add pricing:read and pricing:write permissions to all SUPPORT_ADMIN users
-- Run this against your Neon database

UPDATE admins
SET permissions = jsonb_set(
  COALESCE(permissions, '[]'::jsonb),
  '{999}',
  '"pricing:read"'::jsonb
)
WHERE role = 'SUPPORT_ADMIN'
  AND NOT (permissions ? 'pricing:read');

UPDATE admins
SET permissions = jsonb_set(
  COALESCE(permissions, '[]'::jsonb),
  '{999}',
  '"pricing:write"'::jsonb
)
WHERE role = 'SUPPORT_ADMIN'
  AND NOT (permissions ? 'pricing:write');

-- Verify the update
SELECT 
  id,
  email,
  name,
  role,
  permissions
FROM admins
WHERE role = 'SUPPORT_ADMIN';

