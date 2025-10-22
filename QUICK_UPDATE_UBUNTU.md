# 🚀 Quick Update from Ubuntu

## One-Line Command (Easiest)

```bash
cd backend && chmod +x scripts/apply-admin-permissions.sh && ./scripts/apply-admin-permissions.sh
```

That's it! The script will:
- ✅ Check your `.env` for `DATABASE_URL`
- ✅ Verify `psql` is installed
- ✅ Ask for confirmation
- ✅ Apply all permission updates
- ✅ Show you the results

---

## Alternative: Direct psql Command

```bash
cd backend
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" -f UPDATE_ALL_ADMIN_PERMISSIONS.sql
```

---

## Prerequisites Check

**1. Install psql (if not already installed):**
```bash
sudo apt-get update
sudo apt-get install postgresql-client
```

**2. Verify your .env has DATABASE_URL:**
```bash
grep DATABASE_URL backend/.env
```

Should show something like:
```
DATABASE_URL="postgresql://username:password@db.region.neon.tech:5432/database?sslmode=require"
```

---

## After Running

1. **Log out** from admin panel
2. **Clear localStorage**: F12 → Application → Local Storage → Clear All
3. **Log back in** with your admin account
4. **Test**: Try updating a job lead price as support admin (should work now!)

---

## What This Updates

### ✅ SUPPORT_ADMIN gets (6 sections):
- User Management
- Contractor Management  
- KYC Review
- Job Oversight (including lead price updates)
- Review Management
- Content Moderation

### ✅ FINANCE_ADMIN gets (5 sections):
- User Management
- Contractor Management (with approval powers)
- Job Oversight
- Payment Dashboard (with refund powers)
- Platform Settings

---

## Verify It Worked

```bash
# Quick check
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" -c "SELECT email, role, jsonb_array_length(permissions) as perms FROM admins WHERE role IN ('SUPPORT_ADMIN', 'FINANCE_ADMIN');"
```

Expected:
- SUPPORT_ADMIN: 16 permissions
- FINANCE_ADMIN: 19 permissions

---

## 🎉 Done!

Your admin permissions are now properly restricted by role. Each admin will only see and access their designated sections!

