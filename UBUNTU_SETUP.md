# Ubuntu/Linux Setup Guide

This guide shows you how to apply admin permission updates from Ubuntu/Linux command line.

---

## 🚀 Quick Start (Ubuntu/Linux)

### Option 1: Run the Shell Script (Easiest)

```bash
# Navigate to the backend directory
cd backend

# Make the script executable
chmod +x scripts/apply-admin-permissions.sh

# Run the script
./scripts/apply-admin-permissions.sh
```

The script will:
1. ✅ Check for `.env` file and `DATABASE_URL`
2. ✅ Verify `psql` is installed
3. ✅ Ask for confirmation
4. ✅ Apply all permission updates
5. ✅ Show verification results

---

## 📋 Option 2: Manual psql Command

If you prefer to run the SQL directly:

```bash
# Navigate to backend directory
cd backend

# Load DATABASE_URL from .env
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)

# Run the SQL file
psql "$DATABASE_URL" -f UPDATE_ALL_ADMIN_PERMISSIONS.sql
```

---

## 📦 Prerequisites

### 1. Install PostgreSQL Client (psql)

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install postgresql-client

# Or specific version
sudo apt-get install postgresql-client-15
```

**Verify installation:**
```bash
psql --version
# Should output: psql (PostgreSQL) 15.x
```

### 2. Check DATABASE_URL

Your `.env` file should contain:
```env
DATABASE_URL="postgresql://username:password@host:5432/database?sslmode=require"
```

**Test connection:**
```bash
cd backend
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" -c "SELECT NOW();"
```

If this works, you're ready to apply permissions!

---

## 🛠️ Option 3: Run TypeScript Scripts (Alternative)

If you prefer the TypeScript approach:

```bash
cd backend

# Update Support Admins
npx ts-node scripts/update-support-admin-permissions.ts

# Update Finance Admins
npx ts-node scripts/update-finance-admin-permissions.ts
```

**Prerequisites for TypeScript:**
```bash
# Install dependencies if not already done
npm install

# Generate Prisma Client
npx prisma generate
```

---

## 📊 Verification

After applying permissions, verify the changes:

```bash
# Connect to database
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL"
```

**Run these queries in psql:**

```sql
-- Check all admin roles and permission counts
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

-- Check specific permissions for SUPPORT_ADMIN
SELECT 
  email,
  role,
  CASE WHEN permissions ? 'pricing:write' THEN '✓' ELSE '✗' END as "Can Set Prices",
  CASE WHEN permissions ? 'contractors:approve' THEN '✓' ELSE '✗' END as "Can Approve",
  CASE WHEN permissions ? 'payments:read' THEN '✓' ELSE '✗' END as "Can View Payments"
FROM admins
WHERE role = 'SUPPORT_ADMIN';

-- Exit psql
\q
```

**Expected Results:**
- SUPPORT_ADMIN: 16 permissions, ✓ Can Set Prices, ✗ Can Approve, ✗ Can View Payments
- FINANCE_ADMIN: 19 permissions, ✓ Can Set Prices, ✓ Can Approve, ✓ Can View Payments

---

## 🐛 Troubleshooting

### Error: "psql: command not found"

**Solution:**
```bash
sudo apt-get update
sudo apt-get install postgresql-client
```

### Error: "DATABASE_URL not found"

**Solution:**
```bash
# Check if .env file exists
ls -la backend/.env

# Check if DATABASE_URL is set
grep DATABASE_URL backend/.env

# Make sure you're in the backend directory
cd backend
```

### Error: "connection refused"

**Solutions:**
1. Check if DATABASE_URL is correct in `.env`
2. Verify your database server is running
3. Check firewall rules if using remote database
4. Ensure SSL mode is correct (`sslmode=require` for Neon)

### Error: "permission denied for table admins"

**Solution:**
Your database user needs appropriate permissions. Check with:
```sql
SELECT current_user;
\du
```

---

## 🔧 Advanced: Direct SQL Execution

For one-line execution without script:

```bash
cd backend && \
export $(grep -v '^#' .env | grep DATABASE_URL | xargs) && \
psql "$DATABASE_URL" -f UPDATE_ALL_ADMIN_PERMISSIONS.sql && \
echo "✅ Permissions updated successfully!"
```

---

## 📝 What Gets Updated?

### SUPPORT_ADMIN (16 permissions)
```json
[
  "users:read", "users:write",
  "contractors:read", "contractors:write",
  "kyc:read", "kyc:write",
  "jobs:read", "jobs:write",
  "pricing:read", "pricing:write",
  "reviews:read", "reviews:write",
  "content:read", "content:write",
  "support:read", "support:write"
]
```

### FINANCE_ADMIN (19 permissions)
```json
[
  "users:read", "users:write",
  "contractors:read", "contractors:write", "contractors:approve",
  "kyc:read", "kyc:write", "kyc:approve",
  "jobs:read", "jobs:write",
  "pricing:read", "pricing:write",
  "payments:read", "payments:write", "payments:refund",
  "settings:read", "settings:write",
  "final_price:read", "final_price:write"
]
```

---

## 🎯 After Update Checklist

- [ ] Permissions applied successfully (no SQL errors)
- [ ] Verified permission counts in database
- [ ] Logged out from admin panel
- [ ] Cleared browser localStorage
- [ ] Logged back in as SUPPORT_ADMIN
- [ ] Verified can update job lead prices (no 403 error)
- [ ] Verified cannot see Payment/Settings sections
- [ ] Logged in as FINANCE_ADMIN
- [ ] Verified can approve contractors and KYC
- [ ] Verified can access Payment Dashboard

---

## 💡 Quick Reference

| Command | Purpose |
|---------|---------|
| `./scripts/apply-admin-permissions.sh` | Apply all permission updates |
| `psql "$DATABASE_URL" -f UPDATE_ALL_ADMIN_PERMISSIONS.sql` | Direct SQL execution |
| `npx ts-node scripts/update-support-admin-permissions.ts` | Update support admins via TypeScript |
| `psql "$DATABASE_URL" -c "SELECT email, role FROM admins"` | List all admins |
| `npx prisma studio` | Open Prisma Studio GUI |

---

## 🆘 Need Help?

If you encounter issues:

1. **Check the logs**: Look at the error message carefully
2. **Verify connection**: Test `psql "$DATABASE_URL" -c "SELECT 1"`
3. **Check permissions**: Ensure your DB user has UPDATE rights
4. **Try Neon Console**: As a fallback, copy/paste SQL directly in Neon's SQL editor

---

*Last Updated: October 22, 2024*

