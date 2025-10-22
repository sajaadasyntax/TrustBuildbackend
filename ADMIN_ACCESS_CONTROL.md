# Admin Access Control Matrix

This document defines the exact sections and permissions each admin role has access to in the TrustBuild platform.

## 🎯 Role-Based Access Summary

### SUPPORT_ADMIN (6 Sections)
Support admins handle day-to-day platform support, user assistance, and content moderation.

| Section | Access Level | Capabilities |
|---------|-------------|--------------|
| ✅ **User Management** | Full | View and edit user accounts, resolve account issues |
| ✅ **Contractor Management** | Full | View and edit contractor profiles, manage contractor support |
| ✅ **KYC Review** | Review Only | View KYC submissions, request updates (cannot approve) |
| ✅ **Job Oversight** | Full | View, edit, flag jobs, set lead prices, manage disputes |
| ✅ **Review Management** | Full | View, moderate, approve/reject reviews |
| ✅ **Content Moderation** | Full | Manage FAQs, featured contractors, flagged content |

**Cannot Access:**
- ❌ Payment Dashboard
- ❌ Platform Settings
- ❌ Invoice Management
- ❌ Security Logs
- ❌ Final Price Confirmations (cannot override)
- ❌ KYC Approval (cannot approve, only review)
- ❌ Contractor Approval (cannot approve applications)

---

### FINANCE_ADMIN (5 Sections)
Finance admins handle financial operations, payments, and platform financial settings.

| Section | Access Level | Capabilities |
|---------|-------------|--------------|
| ✅ **User Management** | Full | View and edit user accounts |
| ✅ **Contractor Management** | Full + Approval | Manage profiles, **approve contractors**, **approve KYC** |
| ✅ **Job Oversight** | Full | View, edit jobs, set lead prices |
| ✅ **Payment Dashboard** | Full | View payments, process refunds, manage invoices, subscriptions |
| ✅ **Platform Settings** | Full | Configure commission rates, pricing, subscription plans |

**Cannot Access:**
- ❌ Review Management
- ❌ Content Moderation
- ❌ Security Logs

---

### SUPER_ADMIN (All Sections)
Super admins have unrestricted access to all platform features.

| Section | Access Level |
|---------|-------------|
| ✅ **All Sections** | Full Access |
| ✅ **Security Logs** | Exclusive Access |
| ✅ **Admin Management** | Can create/edit admins |

---

## 📋 Detailed Permission Mapping

### SUPPORT_ADMIN Permissions (16 total)
```json
[
  "users:read",
  "users:write",
  "contractors:read",
  "contractors:write",
  "kyc:read",
  "kyc:write",          // Can request updates, NOT approve
  "jobs:read",
  "jobs:write",
  "pricing:read",       // Can view job lead prices
  "pricing:write",      // Can SET job lead prices
  "reviews:read",
  "reviews:write",
  "content:read",
  "content:write",
  "support:read",
  "support:write"
]
```

**Key Points:**
- ✅ Can set lead prices for individual jobs (`pricing:write`)
- ❌ Cannot approve contractors (`contractors:approve` - missing)
- ❌ Cannot approve KYC (`kyc:approve` - missing)
- ❌ Cannot access payments (`payments:*` - missing)
- ❌ Cannot modify platform settings (`settings:*` - missing)
- ❌ Cannot override final prices (`final_price:write` - missing)

---

### FINANCE_ADMIN Permissions (19 total)
```json
[
  "users:read",
  "users:write",
  "contractors:read",
  "contractors:write",
  "contractors:approve",  // CAN approve contractor applications
  "kyc:read",
  "kyc:write",
  "kyc:approve",         // CAN approve KYC submissions
  "jobs:read",
  "jobs:write",
  "pricing:read",
  "pricing:write",       // Can set job lead prices
  "payments:read",
  "payments:write",
  "payments:refund",     // Can process refunds
  "settings:read",
  "settings:write",
  "final_price:read",
  "final_price:write"    // Can override final prices
]
```

**Key Points:**
- ✅ Can approve contractor applications and KYC
- ✅ Can process payment refunds
- ✅ Can modify platform settings and pricing
- ✅ Can override final price confirmations
- ❌ Cannot moderate reviews (`reviews:*` - missing)
- ❌ Cannot manage content (`content:*` - missing)

---

## 🚀 UI/UX Access Control

### Navigation Bar (Top Menu)
The navigation dynamically shows/hides based on permissions:

**SUPPORT_ADMIN sees:**
```
Dashboard | Users | Contractors | Jobs | Reviews | Content
```

**FINANCE_ADMIN sees:**
```
Dashboard | Users | Contractors | Jobs | Payments | Settings
```

**SUPER_ADMIN sees:**
```
Dashboard | Users | Contractors | Jobs | Reviews | Content | Payments | Settings
```

### Dashboard Cards
Each admin role sees a different set of cards on the dashboard:

#### SUPPORT_ADMIN Dashboard (6 cards)
1. **User Management** → `/admin/users`
2. **Contractor Management** → `/admin/contractors`
3. **KYC Review** → `/admin/kyc`
4. **Job Oversight** → `/admin/jobs`
5. **Review Management** → `/admin/reviews`
6. **Content Moderation** → `/admin/content/*`

#### FINANCE_ADMIN Dashboard (5 cards)
1. **User Management** → `/admin/users`
2. **Contractor Management** → `/admin/contractors` (with approval buttons)
3. **Job Oversight** → `/admin/jobs`
4. **Payment Dashboard** → `/admin/payments` (with refund capabilities)
5. **Platform Settings** → `/admin/settings`

---

## 🔒 Backend Route Protection

All admin routes use the `protectAdmin` middleware which:
1. Validates admin JWT token
2. Checks if admin exists and is active
3. Verifies required permissions for the route

### Example Route Protection:
```typescript
// Routes requiring pricing:write (can set lead prices)
router.patch('/jobs/:id/lead-price', 
  protectAdmin, 
  requirePermissions('pricing:write'), 
  updateJobLeadPrice
);

// Routes requiring kyc:approve (can approve KYC)
router.patch('/kyc/:id/approve', 
  protectAdmin, 
  requirePermissions('kyc:approve'), 
  approveKyc
);
```

---

## ✅ Testing the Access Control

### For SUPPORT_ADMIN:
1. ✅ Can view and edit users
2. ✅ Can edit contractor profiles (but not approve them)
3. ✅ Can view KYC submissions (but not approve them)
4. ✅ **Can update job lead prices** ← This was the bug, now fixed!
5. ✅ Can moderate reviews
6. ✅ Can manage content (FAQs, featured contractors)
7. ❌ Cannot access Payment Dashboard
8. ❌ Cannot access Platform Settings

### For FINANCE_ADMIN:
1. ✅ Can approve contractor applications
2. ✅ Can approve KYC submissions
3. ✅ Can update job lead prices
4. ✅ Can process payment refunds
5. ✅ Can modify platform settings
6. ❌ Cannot moderate reviews
7. ❌ Cannot manage content

---

## 🛠️ Applying Changes

### Method 1: SQL Script (Fastest)
Run `backend/UPDATE_ALL_ADMIN_PERMISSIONS.sql` in your Neon console:
```bash
# Open Neon Console → SQL Editor → Paste SQL → Run
```

### Method 2: TypeScript Scripts
```bash
cd backend

# Update Support Admins
npx ts-node scripts/update-support-admin-permissions.ts

# Update Finance Admins  
npx ts-node scripts/update-finance-admin-permissions.ts
```

### After Updating:
1. **Log out** from admin panel
2. **Clear browser localStorage** (F12 → Application → Local Storage → Clear All)
3. **Log back in** with your admin account
4. **Verify** you only see your designated sections
5. **Test** functionality within those sections

---

## 📊 Quick Reference Table

| Feature | SUPPORT_ADMIN | FINANCE_ADMIN | SUPER_ADMIN |
|---------|---------------|---------------|-------------|
| View Users | ✅ | ✅ | ✅ |
| Edit Users | ✅ | ✅ | ✅ |
| View Contractors | ✅ | ✅ | ✅ |
| Edit Contractors | ✅ | ✅ | ✅ |
| **Approve Contractors** | ❌ | ✅ | ✅ |
| View KYC | ✅ | ✅ | ✅ |
| Request KYC Updates | ✅ | ✅ | ✅ |
| **Approve KYC** | ❌ | ✅ | ✅ |
| View Jobs | ✅ | ✅ | ✅ |
| Edit Jobs | ✅ | ✅ | ✅ |
| **Set Lead Prices** | ✅ | ✅ | ✅ |
| View Reviews | ✅ | ❌ | ✅ |
| Moderate Reviews | ✅ | ❌ | ✅ |
| Manage Content | ✅ | ❌ | ✅ |
| View Payments | ❌ | ✅ | ✅ |
| **Process Refunds** | ❌ | ✅ | ✅ |
| Platform Settings | ❌ | ✅ | ✅ |
| **Override Final Prices** | ❌ | ✅ | ✅ |
| Security Logs | ❌ | ❌ | ✅ |
| Admin Management | ❌ | ❌ | ✅ |

---

## 🎯 Design Principles

1. **Section-Based Access**: If an admin can see a section, they have ALL permissions for that section's core functions.

2. **Role Separation**:
   - **SUPPORT_ADMIN**: Customer-facing support, content, and user assistance
   - **FINANCE_ADMIN**: Financial operations, contractor approvals, platform configuration
   - **SUPER_ADMIN**: Platform administration and security

3. **Approval Rights**:
   - Only FINANCE_ADMIN and SUPER_ADMIN can approve contractors and KYC
   - SUPPORT_ADMIN can review and request updates but not approve

4. **Financial Access**:
   - Only FINANCE_ADMIN and SUPER_ADMIN can access payments and refunds
   - SUPPORT_ADMIN has no financial access

5. **Content Control**:
   - Only SUPPORT_ADMIN and SUPER_ADMIN can moderate reviews and content
   - FINANCE_ADMIN focuses on financial operations, not content

---

## 📝 Change Log

### 2024-10-22: Initial Role-Based Access Control
- ✅ Separated SUPPORT_ADMIN and FINANCE_ADMIN permissions
- ✅ Added `pricing:write` to SUPPORT_ADMIN (can set job lead prices)
- ✅ Updated frontend navigation to hide unauthorized sections
- ✅ Split Payment and Content cards on dashboard
- ✅ Fixed 403 error when support admins update lead prices
- ✅ Aligned UI/UX with backend permissions

---

*Last Updated: October 22, 2024*

