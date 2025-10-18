# 🔧 Admin Login Fix - IMPORTANT

## 🚨 The Problem You Had

You tried to login with Finance Admin credentials at `/login`, but that page is **ONLY for customers and contractors**.

**Admin accounts use a completely different**:
- ✅ Database table (`admins` not `users`)  
- ✅ API endpoint (`/api/admin-auth/login` not `/api/auth/login`)
- ✅ Login page (now created at `/admin/login`)

## ✅ Solution Implemented

I've created a **dedicated admin login page** at:
```
project/app/admin/login/page.tsx
```

## 🚀 How to Use

### 1. Access the Admin Login Page

**URL**: `https://www.trustbuild.uk/admin/login`

**Local Development**: `http://localhost:3000/admin/login`

### 2. Login with Correct Credentials

| Role | Email | Password |
|------|-------|----------|
| **Super Admin** | `superadmin@trustbuild.uk` | `SuperAdmin@2024!` |
| **Finance Admin** | `finance@trustbuild.uk` | `FinanceAdmin@2024!` |
| **Support Admin** | `support@trustbuild.uk` | `SupportAdmin@2024!` |

### 3. After Login

You'll be redirected to `/admin` (the admin dashboard)

## ❌ Common Mistakes (What You Did Wrong)

### Mistake #1: Wrong Email
```
❌ financeadmin@trustbuild.uk
✅ finance@trustbuild.uk
```

### Mistake #2: Wrong Password
```
❌ fFnanceAdmin@2024!  (typo: double 'f')
✅ FinanceAdmin@2024!
```

### Mistake #3: Wrong Login Page
```
❌ https://www.trustbuild.uk/login  (for customers/contractors)
✅ https://www.trustbuild.uk/admin/login  (for admins)
```

## 📋 Quick Checklist

- [ ] Navigate to `/admin/login` (NOT `/login`)
- [ ] Use correct email: `finance@trustbuild.uk`
- [ ] Use correct password: `FinanceAdmin@2024!` 
- [ ] Click "Sign In to Admin Portal"
- [ ] You should be redirected to `/admin`

## 🔐 What Happens Behind the Scenes

When you submit the admin login form:

1. **Frontend** calls `POST /api/admin-auth/login`
2. **Backend** checks the `admins` table (not `users`)
3. **Backend** returns admin token + admin user data
4. **Frontend** stores token in `localStorage` as `admin_token`
5. **Frontend** redirects to `/admin` dashboard

## 🌐 The Two Login Systems

### Admin Login (NEW)
- **Page**: `/admin/login`
- **API**: `/api/admin-auth/login`
- **Table**: `admins`
- **Token Key**: `admin_token`
- **Users**: Super Admin, Finance Admin, Support Admin

### Regular User Login (EXISTING)
- **Page**: `/login`
- **API**: `/api/auth/login`
- **Table**: `users`
- **Token Key**: `auth_token`
- **Users**: Customers, Contractors

## 🚨 If You Still Get Errors

### Error: "Invalid email or password"
- ✅ Verify you're at `/admin/login` (check URL bar)
- ✅ Double-check email: `finance@trustbuild.uk`
- ✅ Double-check password (case-sensitive!)

### Error: "404 Not Found"
- ✅ Make sure you created the file: `project/app/admin/login/page.tsx`
- ✅ Restart your Next.js dev server: `npm run dev`

### Error: "Network request failed"
- ✅ Check backend is running
- ✅ Verify `NEXT_PUBLIC_API_URL` in `.env`

### Success but redirected to regular site
- ✅ Clear browser cache
- ✅ Clear localStorage: Open DevTools → Application → Local Storage → Clear All
- ✅ Try again

## 📝 Next Steps

1. **Deploy the new admin login page** to production
2. **Change default passwords** after first login
3. **Enable 2FA** for all admin accounts (highly recommended!)

## 💡 Pro Tip

Bookmark the admin login page:
- Production: `https://www.trustbuild.uk/admin/login`
- Development: `http://localhost:3000/admin/login`

This way you won't accidentally go to the customer/contractor login page!

---

**Created**: October 16, 2025  
**Status**: ✅ SOLVED

