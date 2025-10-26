# TrustBuild Dispute Management System

## Overview

The Dispute Management System allows customers and contractors to raise disputes about jobs, and provides admins with tools to review, investigate, and resolve these disputes fairly.

## Supported Dispute Types

1. **Work Quality** - Customer reports poor finishing or work quality issues
2. **Job Confirmation / Commission** - Issues with job completion confirmation or commission payments
3. **Credit Refund** - Contractor requests credit refund for cancelled or invalid jobs
4. **Project Delay** - Disputes about project delays and communication issues
5. **Payment Issue** - Payment-related disputes
6. **Other** - Any other type of dispute

## Database Schema

### Dispute Model
- `id`: Unique identifier
- `jobId`: Associated job
- `raisedByUserId`: User who raised the dispute (customer or contractor)
- `raisedByRole`: CUSTOMER or CONTRACTOR
- `type`: Dispute type (enum)
- `status`: Current status (OPEN, UNDER_REVIEW, AWAITING_EVIDENCE, RESOLVED, CLOSED)
- `priority`: LOW, MEDIUM, HIGH, URGENT
- `title`: Brief summary
- `description`: Detailed description
- `evidenceUrls`: Array of uploaded evidence files
- `resolution`: Resolution type (CUSTOMER_FAVOR, CONTRACTOR_FAVOR, etc.)
- `resolutionNotes`: Admin notes about resolution
- `creditRefunded`: Whether credits were refunded
- `creditRefundAmount`: Number of credits refunded
- `commissionAdjusted`: Whether commission was adjusted
- `commissionAmount`: Adjusted commission amount
- `jobCompletedOverride`: Whether admin marked job as completed

### DisputeResponse Model
- `id`: Unique identifier
- `disputeId`: Associated dispute
- `userId`: User who responded
- `userRole`: Role of responder
- `message`: Response message
- `attachments`: Array of attachment URLs
- `isInternal`: Whether response is admin-only (internal note)

## API Endpoints

### User Endpoints (`/api/disputes`)

#### Create Dispute
```
POST /api/disputes
Content-Type: multipart/form-data

Body:
- jobId: string (required)
- type: DisputeType (required)
- title: string (required)
- description: string (required)
- priority: string (optional, default: MEDIUM)
- evidence: File[] (optional, max 10 files)
```

#### Get User's Disputes
```
GET /api/disputes
```

#### Get Dispute Details
```
GET /api/disputes/:id
```

#### Add Response to Dispute
```
POST /api/disputes/:id/responses
Content-Type: multipart/form-data

Body:
- message: string (required)
- attachments: File[] (optional, max 5 files)
```

### Admin Endpoints (`/api/admin/disputes`)

#### Get All Disputes (with filters)
```
GET /api/admin/disputes?status=OPEN&type=WORK_QUALITY&priority=HIGH&search=keywords
```

#### Get Dispute Statistics
```
GET /api/admin/disputes/stats

Response:
{
  totalDisputes: number,
  openDisputes: number,
  resolvedDisputes: number,
  byType: Array<{ type: string, _count: number }>
}
```

#### Get Dispute Details
```
GET /api/admin/disputes/:id
```

#### Update Dispute Status
```
PATCH /api/admin/disputes/:id/status
Content-Type: application/json

Body:
{
  status: "UNDER_REVIEW" | "AWAITING_EVIDENCE" | "RESOLVED" | "CLOSED"
}
```

#### Update Dispute Priority
```
PATCH /api/admin/disputes/:id/priority
Content-Type: application/json

Body:
{
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"
}
```

#### Add Admin Response/Note
```
POST /api/admin/disputes/:id/responses
Content-Type: multipart/form-data

Body:
- message: string (required)
- isInternal: boolean (optional, default: false)
- attachments: File[] (optional)
```

#### Resolve Dispute
```
POST /api/admin/disputes/:id/resolve
Content-Type: application/json

Body:
{
  resolution: "CUSTOMER_FAVOR" | "CONTRACTOR_FAVOR" | "MUTUAL_AGREEMENT" | "CREDIT_REFUNDED" | "COMMISSION_ADJUSTED" | "NO_ACTION",
  resolutionNotes: string (required),
  refundCredits: boolean (optional),
  creditAmount: number (optional, required if refundCredits is true),
  adjustCommission: boolean (optional),
  commissionAmount: number (optional, required if adjustCommission is true),
  completeJob: boolean (optional)
}
```

#### Close Dispute
```
POST /api/admin/disputes/:id/close
Content-Type: application/json

Body:
{
  reason: string (required)
}
```

## Resolution Actions

When resolving a dispute, admins can take the following actions:

### 1. Refund Credits
- Restores job access credits to the contractor
- Creates a credit transaction record
- Used for disputes where contractor shouldn't have been charged

### 2. Adjust Commission
- Modifies the commission amount for a job
- Updates the CommissionPayment record
- Used when commission calculation needs correction

### 3. Mark Job as Completed
- Overrides customer confirmation requirement
- Sets job status to COMPLETED
- Records admin override in job record
- Used when contractor completed work but customer won't confirm

## Workflow Examples

### Example 1: Work Quality Dispute

1. Customer opens dispute with type "WORK_QUALITY"
2. Job status changes to "DISPUTED"
3. Admin reviews photos and statements from both parties
4. Admin requests additional evidence if needed (status: AWAITING_EVIDENCE)
5. Admin makes decision:
   - If customer is right: Resolution "CUSTOMER_FAVOR", potentially refund contractor credits
   - If contractor is right: Resolution "CONTRACTOR_FAVOR", mark job as completed
   - If both agree: Resolution "MUTUAL_AGREEMENT" with new terms
6. Notifications sent to both parties
7. Job status updated accordingly

### Example 2: Credit Refund Dispute

1. Contractor opens dispute with type "CREDIT_REFUND"
2. Contractor explains job was cancelled before work started
3. Admin verifies no work or payment occurred
4. Admin resolves with:
   - resolution: "CREDIT_REFUNDED"
   - refundCredits: true
   - creditAmount: 1
5. Credits automatically restored to contractor account
6. Credit transaction recorded

### Example 3: Job Confirmation Dispute

1. Contractor opens dispute with type "JOB_CONFIRMATION"
2. Contractor provides proof of completion and customer communication
3. Admin verifies work was completed
4. Admin resolves with:
   - resolution: "CONTRACTOR_FAVOR"
   - completeJob: true
5. Job marked as completed
6. Commission payment processed automatically

## Permissions

Admins need the following permissions:
- `disputes:read` - View disputes
- `disputes:write` - Update dispute details, add responses
- `disputes:resolve` - Resolve disputes and take resolution actions

## Notifications

The system sends notifications for:
- New dispute created (to admins and other party)
- New response added (to involved parties)
- Dispute resolved (to customer and contractor)
- Status changes (to involved parties)

## Setup Instructions

### 1. Run Database Migration
```bash
cd backend
npx prisma migrate deploy
npx prisma generate
```

### 2. Update Admin Permissions
```bash
cd backend
npx ts-node scripts/update-dispute-permissions.ts
```

### 3. Restart Backend Server
```bash
cd backend
npm run dev
# or
pm2 restart api
```

### 4. Verify Installation
- Check admin panel at `/admin/disputes`
- Verify permissions are showing in admin navigation
- Test creating a dispute from user dashboard

## UI Components

### Admin UI
- **Disputes Page** (`/admin/disputes`)
  - List all disputes with filters
  - View dispute details
  - Add responses and notes
  - Resolve disputes with various actions

### User UI
- **CreateDisputeDialog Component**
  - Reusable dialog for creating disputes
  - File upload for evidence
  - Type and priority selection

- **Disputes List Pages**
  - `/dashboard/client/disputes` - Customer disputes
  - `/dashboard/contractor/disputes` - Contractor disputes

## Best Practices

1. **Evidence Collection**: Always encourage users to upload photos, documents, and screenshots
2. **Communication**: Keep detailed notes in responses
3. **Fair Resolution**: Review evidence from both parties before deciding
4. **Timely Response**: Address disputes quickly to maintain trust
5. **Documentation**: Use resolutionNotes to explain decisions clearly
6. **Consistency**: Apply similar resolutions to similar cases

## Monitoring

Track these metrics:
- Number of disputes by type
- Average resolution time
- Resolution distribution (customer vs contractor favor)
- Common dispute patterns
- Repeat dispute creators

## Future Enhancements

Potential improvements:
- Automated dispute routing based on type
- Dispute escalation for unresolved cases
- Integration with review system
- Dispute prevention alerts
- Contractor/customer reputation scores based on disputes

