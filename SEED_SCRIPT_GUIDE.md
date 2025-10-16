# 🌱 Database Seed Script Guide

## Overview

This comprehensive seed script populates your TrustBuild database with realistic test data including:

- **3 Admin Accounts** (Super Admin, Finance Admin, Support Admin)
- **8 Subscribed Contractors** (with different subscription tiers)
- **4 Customers** 
- **15 Professional Services** (with size-based pricing)
- **10 Jobs** (various statuses including posted, in progress, and completed)
- **Reviews, Payments, Invoices, and Commission Records**
- **System Settings and Admin Activity Logs**

## 🚀 How to Run the Seed Script

### Prerequisites

1. Make sure your PostgreSQL database is running
2. Ensure you have the correct `DATABASE_URL` in your `.env` file
3. Run migrations to create the database schema

### Running the Seed

```bash
cd backend

# Run database migrations (if not already done)
npx prisma migrate dev

# Run the seed script
npm run prisma:seed
```

Alternatively, you can run it directly:

```bash
cd backend
npx tsx prisma/seed.ts
```

Or use Prisma's built-in seed command:

```bash
cd backend
npx prisma db seed
```

## 🔐 Admin Login Credentials

### Super Admin
- **Email:** `superadmin@trustbuild.uk`
- **Password:** `SuperAdmin@2024!`
- **Role:** SUPER_ADMIN
- **Permissions:** Full access to all features

### Finance Admin
- **Email:** `finance@trustbuild.uk`
- **Password:** `FinanceAdmin@2024!`
- **Role:** FINANCE_ADMIN
- **Access:** Payments, invoices, commissions

### Support Admin
- **Email:** `support@trustbuild.uk`
- **Password:** `SupportAdmin@2024!`
- **Role:** SUPPORT_ADMIN
- **Access:** Users, contractors, jobs

## 👤 Test User Credentials

### Customers
All customer accounts use the password: `customer123`

1. **Sarah Johnson** - sarah.johnson@example.com (London)
2. **Michael Smith** - michael.smith@example.com (Manchester)
3. **Emma Williams** - emma.williams@example.com (Birmingham)
4. **James Brown** - james.brown@example.com (Leeds)

### Contractors (All with Active Subscriptions)
All contractor accounts use the password: `contractor123`

1. **Premium Builders Ltd** - david@premiumbuilders.co.uk
   - Tier: PREMIUM
   - Subscription: YEARLY (£39.99/month)
   - Services: Kitchen Fitting, Bathroom Fitting, Conversions

2. **ElectricPro Services** - lisa@electricpro.co.uk
   - Tier: STANDARD
   - Subscription: MONTHLY (£49.99/month)
   - Services: Electrical, Central Heating

3. **Davies Plumbing & Heating** - rob@daviesplumbing.co.uk
   - Tier: PREMIUM
   - Subscription: SIX_MONTHS (£44.99/month)
   - Services: Plumbing, Central Heating, Bathroom Fitting

4. **Garden Magic Landscaping** - jen@gardenmagic.co.uk
   - Tier: STANDARD
   - Subscription: MONTHLY (£49.99/month)
   - Services: Garden Landscaping

5. **Miller Roofing Specialists** - tom@millerroofing.co.uk
   - Tier: ENTERPRISE
   - Subscription: YEARLY (£39.99/month)
   - Services: Roofing, Bricklaying

6. **Turner Interiors** - sophie@turnerinteriors.co.uk
   - Tier: STANDARD
   - Subscription: MONTHLY (£49.99/month)
   - Services: Painting & Decorating, Plastering, Flooring

7. **Harrison Custom Carpentry** - mark@harrisoncarpentry.co.uk
   - Tier: PREMIUM
   - Subscription: YEARLY (£39.99/month)
   - Services: Carpentry, Flooring

8. **Green Build Solutions** - rachel@greenbuild.co.uk
   - Tier: PREMIUM
   - Subscription: SIX_MONTHS (£44.99/month)
   - Services: Conversions, Windows & Doors, Bricklaying

## 💼 Jobs Created

### Posted Jobs (Available for Applications)

1. **Complete Kitchen Renovation** - £15,000 (LARGE)
   - Customer: Sarah Johnson (London)
   - Service: Kitchen Fitting

2. **Full House Rewiring** - £5,000 (LARGE)
   - Customer: Michael Smith (Manchester)
   - Service: Electrical

3. **Bathroom Renovation** - £6,000 (MEDIUM)
   - Customer: Emma Williams (Birmingham)
   - Service: Bathroom Fitting

4. **Garden Makeover with Patio** - £8,000 (MEDIUM)
   - Customer: James Brown (Leeds)
   - Service: Garden Landscaping

5. **Roof Repair - Missing Tiles** - £800 (SMALL)
   - Customer: Sarah Johnson (London)
   - Service: Roofing

6. **Interior Painting - 3 Bedrooms** - £1,500 (SMALL)
   - Customer: Michael Smith (Manchester)
   - Service: Painting & Decorating

7. **Loft Conversion to Bedroom** - £25,000 (LARGE)
   - Customer: Emma Williams (Birmingham)
   - Service: Conversions

8. **Leaking Radiator Valve Replacement** - £200 (SMALL)
   - Customer: James Brown (Leeds)
   - Service: Plumbing

### In Progress Jobs

9. **Custom Built-in Wardrobes** - £3,500 (MEDIUM)
   - Customer: Sarah Johnson (London)
   - Service: Carpentry
   - Contractor: Harrison Custom Carpentry

### Completed Jobs

10. **New Boiler Installation** - £3,000 (MEDIUM)
    - Customer: Michael Smith (Manchester)
    - Service: Central Heating
    - Contractor: ElectricPro Services
    - Final Amount: £2,850
    - Commission Paid: Yes

## 📋 Services with Size-Based Pricing

All 15 services have been configured with the TrustBuilders pricing model:

| Service | Small Job | Medium Job | Large Job |
|---------|-----------|------------|-----------|
| Bathroom Fitting | £25.00 | £35.00 | £50.00 |
| Bricklaying | £20.00 | £30.00 | £50.00 |
| Carpentry | £15.00 | £30.00 | £50.00 |
| Central Heating | £20.00 | £35.00 | £60.00 |
| Conversions | £30.00 | £50.00 | £80.00 |
| Electrical | £15.00 | £30.00 | £50.00 |
| Flooring | £20.00 | £35.00 | £50.00 |
| Garden Landscaping | £25.00 | £40.00 | £60.00 |
| Kitchen Fitting | £30.00 | £45.00 | £60.00 |
| Painting & Decorating | £15.00 | £25.00 | £40.00 |
| Plastering | £20.00 | £35.00 | £50.00 |
| Plumbing | £15.00 | £25.00 | £40.00 |
| Roofing | £25.00 | £40.00 | £60.00 |
| Tiling | £20.00 | £35.00 | £50.00 |
| Windows & Doors | £15.00 | £30.00 | £50.00 |

## 💳 Subscription & Payment Data

### Subscription Plans Created
- **Monthly**: £49.99/month
- **Six Months**: £44.99/month (£269.94 total)
- **Yearly**: £39.99/month (£479.88 total)

### Payment Records
- Subscription payments for all 8 contractors
- Lead access payments for job applications
- Commission payment for completed job
- All payments include invoices with VAT (20%)

## ⭐ Reviews

Sample reviews have been created for several contractors to demonstrate the review system:

- 5-star review for Premium Builders Ltd (Kitchen)
- 5-star review for ElectricPro Services (Electrical)
- 4-star review for Davies Plumbing (Bathroom)
- 5-star review for Harrison Custom Carpentry (Wardrobes)

All reviews are marked as verified and linked to customers and jobs.

## 🔄 Credit System

Contractors have been allocated credits based on their tier:
- **STANDARD**: 0 free credits (Weekly limit: 3)
- **PREMIUM**: 2 free credits (Weekly limit: 3)
- **ENTERPRISE**: 5 free credits (Weekly limit: 5)

Some contractors have used credits to access jobs, with proper credit transaction records created.

## 📊 What to Test After Seeding

### Admin Dashboard
1. Login as Super Admin
2. View all users, contractors, and jobs
3. Check payment and invoice records
4. Review commission payments
5. View admin activity logs

### Contractor Features
1. Login as any contractor
2. View available jobs
3. Check subscription status
4. View credit balance
5. See job access history

### Customer Features
1. Login as any customer
2. View posted jobs
3. Check job applications
4. View completed jobs with reviews

### Job Workflow
1. Applications on posted jobs
2. In-progress job with selected contractor
3. Completed job with commission payment
4. Job access via credits and payments

## 🗑️ Resetting the Database

If you need to reset and re-seed the database:

```bash
cd backend

# Reset the database (WARNING: This deletes all data)
npx prisma migrate reset

# This will automatically run the seed script after resetting
```

Or manually:

```bash
# Drop and recreate database schema
npx prisma migrate reset --skip-seed

# Then run seed manually
npm run seed
```

## 📝 System Settings Created

The seed script creates the following system settings:

1. **COMMISSION_RATE**: 5.0% commission on completed jobs
2. **FREE_JOB_ALLOCATION**: Credits per tier (Standard: 0, Premium: 2, Enterprise: 5)
3. **SUBSCRIPTION_PRICING**: Pricing for all subscription plans
4. **KYC_DEADLINE_DAYS**: 14 days for KYC submission
5. **default_max_contractors_per_job**: 5 contractors per job
6. **platform_name**: TrustBuild

## 🚨 Important Security Notes

1. **Change Admin Passwords**: After testing, change all admin passwords immediately
2. **Production Use**: This seed script is for **DEVELOPMENT ONLY**
3. **Sensitive Data**: Never use this seed data in production
4. **Database Backups**: Always backup your database before seeding

## 🔧 Troubleshooting

### Error: "Unique constraint failed"
The seed script uses `upsert` for most records, but if you run it multiple times, you may encounter unique constraint errors. Solution: Reset the database first.

### Error: "Database connection failed"
Check your `.env` file has the correct `DATABASE_URL` and that PostgreSQL is running.

### Error: "Module not found"
Make sure you've run `npm install` in the backend directory.

### Performance Issues
The seed script creates many related records. On slower machines, it may take 30-60 seconds to complete.

## 📞 Support

If you encounter any issues with the seed script, check:
1. Database migrations are up to date
2. All dependencies are installed
3. PostgreSQL is running
4. Environment variables are set correctly

---

**Happy Testing! 🚀**

