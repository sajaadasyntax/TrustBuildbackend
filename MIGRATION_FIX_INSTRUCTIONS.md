# Migration Fix Instructions

## Problem
You encountered migration errors:
1. Failed migration: `20251026193512_add_kyc_insurance_support`
2. Column conflict: `companyDocPath` already exists

## Solution

### Option 1: Automated Fix (Recommended)

Run the fix script:
```bash
cd backend
chmod +x fix-migrations.sh
./fix-migrations.sh
```

### Option 2: Manual Fix

#### Step 1: Resolve Failed Migrations
```bash
# Mark the failed migrations as resolved
npx prisma migrate resolve --applied 20251026193512_add_kyc_insurance_support
npx prisma migrate resolve --applied 20251027090815_add_admin_enhancements_and_password_reset
```

#### Step 2: Apply New Migrations
```bash
npx prisma migrate deploy
```

### Option 3: If Above Doesn't Work

#### Check Migration Status
```bash
npx prisma migrate status
```

#### Manually Fix Database State

1. **Check if columns exist:**
```sql
-- Connect to your database
\c neondb

-- Check if companyDocPath exists
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'contractor_kyc' AND column_name = 'companyDocPath';
```

2. **If column exists, mark migration as applied:**
```bash
npx prisma migrate resolve --applied 20251027090815_add_admin_enhancements_and_password_reset
```

3. **Apply new migrations:**
```bash
npx prisma migrate deploy
```

### Option 4: Fresh Start (ONLY if you can lose data)

⚠️ **WARNING: This will delete all data!**

```bash
# Reset database completely
npx prisma migrate reset

# This will apply all migrations from scratch
```

## What Was Fixed

1. ✅ Updated `20251027090815_add_admin_enhancements_and_password_reset/migration.sql`:
   - Added `IF NOT EXISTS` to all `ADD COLUMN` statements
   - Added `IF NOT EXISTS` to `CREATE TABLE` statement
   - Added `IF NOT EXISTS` to all `CREATE INDEX` statements

2. ✅ Updated `20251106_revised_free_credits_and_messaging/migration.sql`:
   - Added safe enum value addition (checks if exists first)
   - Added safe default value change (only if currently 0)
   - All columns use `IF NOT EXISTS`
   - All indexes use `IF NOT EXISTS`

## Verification

After fixing, verify everything works:

```bash
# Check migration status
npx prisma migrate status

# Should show all migrations as applied
# Should show no failed migrations

# Generate Prisma Client
npx prisma generate

# Verify schema matches database
npx prisma db pull
```

## If Still Having Issues

1. **Check Prisma migration table:**
```sql
SELECT * FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 10;
```

2. **Manually mark migrations as applied:**
```bash
npx prisma migrate resolve --applied <migration_name>
```

3. **Check for conflicting migrations:**
```bash
ls -la prisma/migrations/
```

4. **Contact support with:**
   - Output of `npx prisma migrate status`
   - Output of `SELECT * FROM "_prisma_migrations"`
   - Error messages

