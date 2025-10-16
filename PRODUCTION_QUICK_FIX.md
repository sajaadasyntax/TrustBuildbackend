# ⚡ Production Quick Fix - Admin System Migration

## The Problem
Your production database reset failed because the `admins` table doesn't exist.

## The Solution
Run these commands on your production server:

```bash
# Navigate to backend directory
cd /var/www/api.trustbuild.uk/TrustBuildbackend

# Pull the latest code (includes new migration)
git pull origin main

# Install dependencies
npm install

# Deploy the migration (creates admin tables)
npx prisma migrate deploy

# Run the seed script (creates admin accounts & test data)
npx tsx prisma/seed.ts

# Restart the application
pm2 restart all
```

## ✅ That's It!

After running these commands, you should be able to login:

**URL:** https://www.trustbuild.uk/admin/login

**Super Admin:**
- Email: `superadmin@trustbuild.uk`
- Password: `SuperAdmin@2024!`

**⚠️ IMPORTANT:** Change the password immediately after first login!

## 🔍 Verify It Worked

```bash
# Check if admin table exists
npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM admins;"

# Should return: count = 3 (three admin accounts)
```

## 📝 What Got Created

- ✅ 3 Admin accounts (Super Admin, Finance Admin, Support Admin)
- ✅ 8 Contractors with active subscriptions
- ✅ 4 Customers
- ✅ 15 Services
- ✅ 10 Jobs (various statuses)
- ✅ Reviews, payments, invoices

## 🐛 Still Getting Errors?

### Error: "Migration has already been applied"
**Good!** This means the migration worked. Just run the seed:
```bash
npx tsx prisma/seed.ts
```

### Error: "Unique constraint failed on admins.email"
**Good!** This means admin accounts already exist. You're done!

### Error: "Cannot find module 'tsx'"
Install tsx:
```bash
npm install -D tsx
```

## 📞 Need More Help?

See the detailed guide: `PRODUCTION_MIGRATION_GUIDE.md`

