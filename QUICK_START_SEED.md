# 🚀 Quick Start - Database Seed

## Run the Seed Script

```bash
cd backend
npm run prisma:seed
```

## Login Credentials

### 👑 Admin Accounts

| Email | Password | Role |
|-------|----------|------|
| superadmin@trustbuild.uk | `SuperAdmin@2024!` | Super Admin |
| finance@trustbuild.uk | `FinanceAdmin@2024!` | Finance Admin |
| support@trustbuild.uk | `SupportAdmin@2024!` | Support Admin |

### 🔨 Contractors (8 total - all subscribed)

**Password for all:** `contractor123`

- david@premiumbuilders.co.uk
- lisa@electricpro.co.uk
- rob@daviesplumbing.co.uk
- jen@gardenmagic.co.uk
- tom@millerroofing.co.uk
- sophie@turnerinteriors.co.uk
- mark@harrisoncarpentry.co.uk
- rachel@greenbuild.co.uk

### 🏠 Customers (4 total)

**Password for all:** `customer123`

- sarah.johnson@example.com
- michael.smith@example.com
- emma.williams@example.com
- james.brown@example.com

## What's Created

✅ 3 Admin accounts with different roles
✅ 8 Contractors with active subscriptions
✅ 4 Customers
✅ 15 Services with size-based pricing
✅ 10 Jobs (8 posted, 1 in-progress, 1 completed)
✅ 4 Reviews
✅ Payment records, invoices, and commission data

## Reset & Re-seed

```bash
cd backend
npx prisma migrate reset
# This automatically runs the seed script
```

## More Info

See `SEED_SCRIPT_GUIDE.md` for complete documentation.

