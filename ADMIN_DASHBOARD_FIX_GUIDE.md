# Admin Dashboard 404 Fix - Deployment Guide

## Problem Summary
The admin dashboard endpoint `/api/admin/dashboard` was returning a 404 error with the message "Contractor not found" despite successful admin authentication.

## Root Cause
The issue was caused by **incorrect route registration order** in `src/index.ts`. More specific admin subroutes (like `/api/admin/jobs`, `/api/admin/settings`) were being registered **AFTER** the general `/api/admin` route, which could cause routing conflicts in Express.js.

## Fix Applied
Reordered route registration in `src/index.ts`:
- All specific admin subroutes are now registered **BEFORE** the general `/api/admin` route
- This ensures Express properly matches the most specific routes first
- General admin routes are now registered last as a catch-all

## Changes Made
```javascript
// BEFORE (Incorrect order)
app.use('/api/admin', adminRoutes);
app.use('/api/admin/invoices', adminInvoiceRoutesNew);
app.use('/api/admin/subscriptions', adminSubscriptionRoutes);
// ... other routes ...
app.use('/api/admin/settings', adminSettingsRoutes);
app.use('/api/admin/jobs', adminJobsRoutes);

// AFTER (Correct order)
app.use('/api/admin/settings', adminSettingsRoutes);
app.use('/api/admin/activity', adminActivityRoutes);
app.use('/api/admin/jobs', adminJobsRoutes);
app.use('/api/admin/kyc', adminKycRoutes);
app.use('/api/admin/manual-invoices', adminManualInvoicesRoutes);
app.use('/api/admin/invoices', adminInvoiceRoutesNew);
app.use('/api/admin/subscriptions', adminSubscriptionRoutes);
// General admin routes (catch-all, must be last)
app.use('/api/admin', adminRoutes);
```

## Deployment Instructions for Ubuntu Server

### Option 1: Automated Deployment (Recommended)

Run the automated deployment script:

```bash
# Navigate to the backend directory
cd /var/www/api.trustbuild.uk/TrustBuildbackend

# Pull the latest changes (including the deployment script)
git fetch
git pull origin master

# Make the script executable
chmod +x DEPLOY_ADMIN_FIX.sh

# Run the deployment script
./DEPLOY_ADMIN_FIX.sh
```

### Option 2: Manual Deployment

If you prefer to run commands manually:

```bash
# Navigate to the backend directory
cd /var/www/api.trustbuild.uk/TrustBuildbackend

# Stop PM2 processes
pm2 stop all

# Pull latest changes
git fetch
git pull origin master

# Install dependencies (if needed)
npm install

# Build TypeScript
npm run build

# Restart PM2 processes
pm2 restart all

# Check status
pm2 status

# Save PM2 configuration
pm2 save

# View logs to verify
pm2 logs api --lines 50
```

## Verification Steps

After deployment, verify the fix is working:

1. **Check PM2 Status:**
   ```bash
   pm2 status
   ```
   All processes should be "online"

2. **Test the API endpoint directly:**
   ```bash
   curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://api.trustbuild.uk/api/admin/dashboard
   ```
   Should return dashboard stats instead of 404

3. **Check PM2 Logs:**
   ```bash
   pm2 logs api --lines 100
   ```
   Look for any errors in the logs

4. **Test in Frontend:**
   - Log in to the admin panel
   - Navigate to the dashboard
   - Dashboard should load with statistics
   - No "Contractor not found" error

## Expected Results

✅ **Before Fix:** 
- Status: 404 Not Found
- Response: `{status: 'fail', message: 'Contractor not found'}`

✅ **After Fix:**
- Status: 200 OK
- Response: Dashboard statistics with user counts, contractor stats, job stats, etc.

## Rollback Instructions

If you need to rollback this change:

```bash
cd /var/www/api.trustbuild.uk/TrustBuildbackend
git log --oneline -5  # Find the commit before the fix
git reset --hard <previous-commit-hash>
npm run build
pm2 restart all
```

## Troubleshooting

### If the issue persists after deployment:

1. **Clear Node.js cache:**
   ```bash
   pm2 stop all
   rm -rf dist
   npm run build
   pm2 restart all
   ```

2. **Check if the correct code is deployed:**
   ```bash
   grep -n "Admin system routes" src/index.ts
   ```
   Should show the comment around line 167

3. **Check TypeScript compilation:**
   ```bash
   npm run build
   ```
   Should complete without errors

4. **Verify PM2 is using the correct directory:**
   ```bash
   pm2 info api
   ```
   Check the "script path" points to the correct location

5. **Check for TypeScript errors:**
   ```bash
   npm run build 2>&1 | grep -i error
   ```

6. **Restart with fresh logs:**
   ```bash
   pm2 stop all
   pm2 flush  # Clear old logs
   pm2 restart all
   pm2 logs api
   ```

## Additional Notes

- This fix does not require database migrations
- No environment variables need to be updated
- The fix is backward compatible with existing admin functionality
- All admin authentication continues to work as before

## Support

If you encounter any issues:
1. Check PM2 logs: `pm2 logs api --lines 200`
2. Check the error logs: `pm2 logs api --err`
3. Verify the build completed successfully
4. Ensure all PM2 processes are running

## Related Files Changed
- `backend/src/index.ts` - Route registration order fixed
- `backend/DEPLOY_ADMIN_FIX.sh` - Automated deployment script (new)
- `backend/ADMIN_DASHBOARD_FIX_GUIDE.md` - This guide (new)

