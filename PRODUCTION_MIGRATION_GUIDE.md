# 🚀 Production Migration Guide - Admin System

## Issue
The production database is missing the admin system tables (`admins`, `activity_logs`, `login_activities`, `settings`, `contractor_kyc`, `manual_invoices`).

## Solution
A new migration has been created: `20251016160826_add_admin_system`

This migration adds:
- ✅ Admin tables (admins, activity_logs, login_activities, settings)
- ✅ KYC system (contractor_kyc)
- ✅ Manual invoices (manual_invoices, manual_invoice_items)
- ✅ Additional NotificationType enum values
- ✅ Contractor account status fields

## 📋 Steps to Deploy

### Option 1: Deploy New Migration Only (Recommended)

If you want to keep your existing data and just add the missing tables:

```bash
# SSH into your production server
ssh root@your-server

# Navigate to backend directory
cd /var/www/api.trustbuild.uk/TrustBuildbackend

# Pull the latest code (including new migration)
git pull origin main

# Install dependencies (if needed)
npm install

# Deploy the migration
npx prisma migrate deploy

# Run the seed script to create admin accounts
npx tsx prisma/seed.ts
```

### Option 2: Complete Database Reset (⚠️ DESTROYS ALL DATA)

Only use this if you want to start fresh:

```bash
# SSH into your production server
ssh root@your-server

# Navigate to backend directory
cd /var/www/api.trustbuild.uk/TrustBuildbackend

# Pull the latest code
git pull origin main

# Reset database and run migrations
npx prisma migrate reset

# This will automatically run the seed script
```

## 🔍 Verify Migration

After running the migration, verify the tables were created:

```bash
# Connect to your database
psql $DATABASE_URL

# List all tables
\dt

# Check admins table
SELECT * FROM admins;

# Exit
\q
```

## 📝 What Will Be Created by Seed Script

After running the migration, the seed script will create:

### Admin Accounts (3)
- **Super Admin**: superadmin@trustbuild.uk / SuperAdmin@2024!
- **Finance Admin**: finance@trustbuild.uk / FinanceAdmin@2024!
- **Support Admin**: support@trustbuild.uk / SupportAdmin@2024!

### Test Data (if database is empty)
- 8 Contractors with active subscriptions
- 4 Customers
- 15 Services
- 10 Jobs (various statuses)
- Payment records, invoices, reviews

## 🔒 Security Notes

1. **Change Admin Passwords Immediately** after first login
2. **Enable 2FA** for all admin accounts
3. **Restrict SSH Access** to the production server
4. **Backup Database** before running migrations

## 🐛 Troubleshooting

### Error: "The table `public.admins` does not exist"
**Solution**: You need to pull the latest code and run the migration first.

```bash
git pull origin main
npx prisma migrate deploy
```

### Error: "Migration already applied"
**Solution**: If the migration was already applied, just run the seed script.

```bash
npx tsx prisma/seed.ts
```

### Error: "Unique constraint failed on admins.email"
**Solution**: Admin accounts already exist. You can skip the seed or reset the database.

```bash
# Option 1: Skip (if you just need to add other data)
# Just continue - the seed script uses upsert for admins

# Option 2: Reset everything
npx prisma migrate reset
```

## 📦 Migration File Location

The new migration is located at:
```
backend/prisma/migrations/20251016160826_add_admin_system/migration.sql
```

Make sure this file is committed to your Git repository and pulled to production.

## ✅ Checklist

Before deploying:
- [ ] Backup production database
- [ ] Pull latest code to production
- [ ] Run `npx prisma migrate deploy`
- [ ] Run seed script: `npx tsx prisma/seed.ts`
- [ ] Test admin login at `/admin/login`
- [ ] Change default admin passwords
- [ ] Enable 2FA for admin accounts

## 🆘 Rollback (if needed)

If something goes wrong and you need to rollback:

```bash
# This will undo the last migration
# ⚠️ WARNING: This may lose data in the new tables
npx prisma migrate resolve --rolled-back 20251016160826_add_admin_system
```

## 📞 Support

If you encounter issues:
1. Check the error message carefully
2. Verify DATABASE_URL is correct
3. Ensure PostgreSQL version is compatible (11+)
4. Check that all migration files are present

---

**Need Help?** Check the logs:
```bash
# Check application logs
pm2 logs api

# Check database connection
npx prisma db pull
```

