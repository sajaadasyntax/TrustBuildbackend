# KYC System - Complete Implementation Guide

## Overview

A comprehensive KYC (Know Your Customer) verification system has been implemented for contractor registration. New contractors must submit verification documents within 14 days or their account will be automatically paused.

## Features Implemented

### ✅ Backend Features

1. **Automatic KYC Record Creation**
   - KYC record created automatically when contractor registers
   - 14-day deadline set for document submission
   - Account starts in PAUSED status until documents are submitted

2. **Document Upload System**
   - Contractors upload: ID document, utility bill, company number (optional)
   - File validation (PDF, JPG, PNG, max 10MB)
   - Secure file storage in `uploads/kyc/[contractorId]/`

3. **Account Status Management**
   - PAUSED: No KYC documents submitted (initial state)
   - ACTIVE: KYC documents submitted, pending review
   - VERIFIED: Admin approved KYC, full access granted
   - SUSPENDED: Admin action

4. **Admin Review System**
   - Approve/Reject KYC submissions
   - Add notes and rejection reasons
   - Automatic email notifications

5. **Automated Deadline Enforcement (Cron Job)**
   - Runs daily at midnight
   - Checks for overdue KYC submissions
   - Automatically pauses accounts past deadline
   - Sends reminder emails 3 days before deadline
   - Sends overdue notification emails

6. **Enhanced Authentication**
   - Auth middleware includes contractor/KYC status
   - Frontend receives KYC status with every auth check

### ✅ Frontend Features

1. **KYC Submission Page** (`/dashboard/kyc`)
   - Upload form for required documents
   - Status display (Pending, Submitted, Approved, Rejected, Overdue)
   - Deadline countdown
   - Rejection reason display

2. **KYC Status Banner**
   - Shows on contractor dashboard
   - Warns about pending/overdue KYC
   - Quick link to submission page

3. **KYC Guard Component**
   - Redirects contractors to KYC page if documents needed
   - Prevents access to contractor features until approved

4. **Admin KYC Review Interface** (`/admin/kyc`)
   - Queue of pending submissions
   - Tabs: Submitted, Approved, Rejected, Overdue
   - One-click approve/reject with notes
   - Contractor information display

## Database Schema

The `ContractorKyc` table includes:

```prisma
model ContractorKyc {
  id             String    @id @default(cuid())
  contractorId   String    @unique
  status         KycStatus @default(PENDING)
  idDocPath      String?
  utilityDocPath String?
  companyNumber  String?
  submittedAt    DateTime?
  dueBy          DateTime?
  reviewedBy     String?
  reviewedAt     DateTime?
  rejectionReason String?
  notes          String?
}

enum KycStatus {
  PENDING        // No documents submitted yet
  SUBMITTED      // Documents uploaded, awaiting review
  UNDER_REVIEW   // Admin is reviewing
  APPROVED       // Approved by admin
  REJECTED       // Rejected by admin
  OVERDUE        // Past deadline
}
```

## Deployment Instructions

### Backend Deployment (Ubuntu Server)

```bash
# 1. Navigate to backend directory
cd /var/www/api.trustbuild.uk/TrustBuildbackend

# 2. Stop PM2 processes
pm2 stop all

# 3. Pull latest changes
git fetch
git pull origin master

# 4. Install dependencies (if package.json changed)
npm install

# 5. Create uploads directory if it doesn't exist
mkdir -p uploads/kyc

# 6. Set proper permissions
chmod 755 uploads
chmod 755 uploads/kyc

# 7. Build TypeScript
npm run build

# 8. Restart PM2 (KYC cron is already in ecosystem.config.js)
pm2 restart all

# 9. Verify PM2 status
pm2 status

# 10. Check logs
pm2 logs api --lines 50
pm2 logs kyc-deadline-cron --lines 20
```

### Frontend Deployment

```bash
# 1. Navigate to frontend directory
cd /path/to/frontend

# 2. Pull latest changes
git pull origin main

# 3. Install dependencies
npm install

# 4. Build
npm run build

# 5. Restart/deploy (depends on your hosting)
# For Vercel: git push will auto-deploy
# For PM2: pm2 restart frontend
```

## Configuration

### Environment Variables

Ensure these are set in your `.env` file:

```bash
# Backend
DATABASE_URL="postgresql://..."
JWT_SECRET="your-secret-key"
FRONTEND_URL="https://trustbuild.uk"
ADMIN_EMAIL="admin@trustbuild.uk"

# File Upload
MAX_FILE_SIZE=10485760  # 10MB in bytes
```

### KYC Settings

You can configure the KYC deadline in the database:

```sql
INSERT INTO settings (key, value)
VALUES ('KYC_DEADLINE_DAYS', '{"days": 14}')
ON CONFLICT (key) DO UPDATE SET value = '{"days": 14}';
```

## API Endpoints

### Contractor Endpoints

- `GET /api/admin/kyc/my-status` - Get own KYC status
- `POST /api/admin/kyc/upload` - Upload KYC documents

### Admin Endpoints

- `GET /api/admin/kyc/queue?status=SUBMITTED` - Get KYC queue
- `GET /api/admin/kyc/:kycId` - Get specific KYC record
- `POST /api/admin/kyc/:kycId/approve` - Approve KYC
- `POST /api/admin/kyc/:kycId/reject` - Reject KYC

## User Flow

### New Contractor Registration

1. **Registration**
   - Contractor fills registration form
   - Account created with role CONTRACTOR
   - Contractor profile created with `accountStatus: PAUSED`
   - KYC record created with 14-day deadline
   - Welcome email sent with KYC instructions

2. **First Login**
   - Contractor logs in
   - Redirected to home page (account paused, limited access)
   - KYC banner shows on dashboard: "Submit KYC documents"
   - Deadline displayed prominently

3. **KYC Submission**
   - Contractor goes to `/dashboard/kyc`
   - Uploads:
     - Government-issued ID
     - Utility bill (< 3 months old)
     - Company number (optional)
   - Submits documents
   - Account status changes to ACTIVE (pending review)
   - Admin receives notification email

4. **Admin Review**
   - Admin logs into `/admin/kyc`
   - Reviews documents
   - Either:
     - **Approves**: Contractor status set to VERIFIED, account fully activated
     - **Rejects**: Contractor status set to PAUSED, rejection reason sent via email

5. **Approved State**
   - Contractor receives approval email
   - Full access to all contractor features
   - Can browse jobs, submit applications, purchase leads, etc.

### Deadline Enforcement

**Day 11** (3 days before deadline):
- Cron job sends reminder email
- "Submit KYC in 3 days" notification

**Day 14** (deadline):
- If no submission:
  - KYC status → OVERDUE
  - Account status → PAUSED
  - Overdue notification email sent
  - Contractor redirected to KYC page on next login

**After Deadline**:
- Contractor can still submit documents
- Admin must review and approve to reactivate account

## Email Notifications

### Contractor Emails

1. **Welcome Email (Registration)**
   - Welcome message
   - KYC requirements explained
   - 14-day deadline mentioned
   - Link to KYC submission page

2. **KYC Reminder (3 days before)**
   - Deadline warning
   - Days remaining
   - Required documents list
   - Direct link to submit

3. **KYC Overdue**
   - Account paused notification
   - Instructions to submit documents
   - Direct link to submission page

4. **KYC Approved**
   - Congratulations message
   - Account fully activated
   - Link to dashboard

5. **KYC Rejected**
   - Rejection reason
   - Instructions to resubmit
   - Required corrections explained
   - Direct link to resubmit

### Admin Emails

1. **New KYC Submission**
   - Contractor details
   - Documents submitted
   - Link to review queue

## Frontend Components

### For Contractors

- **`/dashboard/kyc`** - Main KYC submission page
- **`<KycStatusBanner />`** - Status alert banner
- **`<KycGuard />`** - Route protection component

### For Admins

- **`/admin/kyc`** - KYC review queue and management

## Testing Checklist

### Backend Testing

```bash
# Test KYC status endpoint
curl -H "Authorization: Bearer $TOKEN" \
  https://api.trustbuild.uk/api/admin/kyc/my-status

# Test document upload
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -F "idDocument=@id.pdf" \
  -F "utilityBill=@bill.pdf" \
  -F "companyNumber=12345678" \
  https://api.trustbuild.uk/api/admin/kyc/upload

# Test admin queue
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.trustbuild.uk/api/admin/kyc/queue?status=SUBMITTED

# Manually trigger KYC cron
cd /var/www/api.trustbuild.uk/TrustBuildbackend
node scripts/kyc-deadline-cron.js
```

### Frontend Testing

1. Register new contractor
2. Verify KYC page loads
3. Upload test documents
4. Check admin can see submission
5. Test approve/reject flows
6. Verify email notifications
7. Test deadline enforcement

## Monitoring

### Check Cron Job Status

```bash
# PM2 status
pm2 status kyc-deadline-cron

# View cron logs
pm2 logs kyc-deadline-cron

# View recent runs
tail -f logs/kyc-deadline-out.log
```

### Database Queries

```sql
-- Check KYC statuses
SELECT 
  k.status, 
  COUNT(*) as count 
FROM contractor_kyc k 
GROUP BY k.status;

-- Find overdue KYC
SELECT 
  c.business_name,
  u.email,
  k.status,
  k.due_by
FROM contractor_kyc k
JOIN contractors c ON c.id = k.contractor_id
JOIN users u ON u.id = c.user_id
WHERE k.due_by < NOW() AND k.status IN ('PENDING', 'REJECTED');

-- Check paused accounts
SELECT 
  u.email,
  c.account_status,
  k.status
FROM contractors c
JOIN users u ON u.id = c.user_id
LEFT JOIN contractor_kyc k ON k.contractor_id = c.id
WHERE c.account_status = 'PAUSED';
```

## Troubleshooting

### Issue: KYC Cron Not Running

```bash
# Check if cron is in PM2
pm2 list | grep kyc

# Restart cron
pm2 restart kyc-deadline-cron

# Check cron schedule
pm2 describe kyc-deadline-cron | grep cron_restart
```

### Issue: File Upload Fails

```bash
# Check uploads directory permissions
ls -la uploads/kyc

# Fix permissions if needed
chmod 755 uploads/kyc
chown -R $USER:$USER uploads
```

### Issue: Emails Not Sending

1. Check email service configuration
2. Verify SMTP credentials in `.env`
3. Check email service logs
4. Test email service independently

### Issue: Contractor Can't Access Features

1. Check contractor account status
2. Check KYC status
3. Verify auth middleware includes contractor data
4. Check frontend auth context

## Security Considerations

1. **File Upload Security**
   - File type validation
   - Size limits enforced
   - Secure storage outside public directory
   - Only admin can access uploaded documents

2. **Access Control**
   - Contractors can only see their own KYC
   - Only admins can approve/reject
   - Document paths not exposed in API responses

3. **Data Privacy**
   - Sensitive documents stored securely
   - GDPR compliance considerations
   - Audit log of admin actions

## Future Enhancements

- [ ] Document download for admins
- [ ] Bulk approve/reject
- [ ] KYC status change notifications
- [ ] Document expiry tracking
- [ ] Re-verification reminders (yearly)
- [ ] Integration with third-party KYC services
- [ ] Enhanced document validation (OCR, face matching)

## Support

For issues or questions:
- Check logs: `pm2 logs`
- Review database: Check contractor_kyc table
- Contact: admin@trustbuild.uk

---

**Last Updated:** October 19, 2024
**Version:** 1.0.0

