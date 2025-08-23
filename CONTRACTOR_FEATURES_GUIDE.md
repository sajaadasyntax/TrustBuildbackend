# Contractor Features Guide

## Overview

This guide covers the comprehensive features for contractors in the TrustBuild platform, including subscription plans, commission system, external reviews, and dashboard functionality.

## 1. Non-Subscribed vs Subscribed Contractors

### Non-Subscribed Contractors
- Pay per job access (lead purchase)
- No commission on completed jobs
- Can receive reviews from completed jobs
- No monthly fees
- Limited profile features

### Subscribed Contractors
- Monthly, 6-month, or yearly subscription options
- 5% commission on completed jobs
- Enhanced profile visibility
- Priority in search results
- Access to premium features

## 2. Subscription Plans

### Available Plans
1. **Monthly**: £49.99/month
2. **6-Month**: £269.94 (£44.99/month) - 10% discount
3. **Yearly**: £479.88 (£39.99/month) - 20% discount

### Subscription Management
```bash
# Get subscription details
GET /api/contractor/subscription

# Create subscription payment intent
POST /api/contractor/create-subscription-intent
{
  "plan": "MONTHLY" // or "SIX_MONTHS", "YEARLY"
}

# Confirm subscription
POST /api/contractor/confirm-subscription
{
  "stripePaymentIntentId": "pi_123456789",
  "plan": "MONTHLY"
}

# Cancel subscription
POST /api/contractor/cancel-subscription
```

## 3. Commission System (Subscribed Contractors Only)

### How It Works
1. Contractor marks job as completed with final amount
2. System calculates 5% commission + VAT
3. 48-hour payment deadline starts
4. Contractor receives invoice via email and in-app notification
5. Payment required within 48 hours to avoid account suspension

### Commission Calculation Example
```
Final Job Amount: £1,000
Commission (5%):  £50
VAT (20%):        £10
Total Due:        £60
```

### Commission API Endpoints
```bash
# Mark job as completed (triggers commission for subscribed)
POST /api/payments/complete-job
{
  "jobId": "job_123",
  "finalAmount": 1000.00
}

# Get commission payments
GET /api/payments/commissions

# Create payment intent for commission
POST /api/payments/create-commission-payment-intent
{
  "commissionPaymentId": "comm_123"
}

# Pay commission
POST /api/payments/pay-commission
{
  "commissionPaymentId": "comm_123",
  "stripePaymentIntentId": "pi_123456789"
}
```

## 4. External Reviews System

Contractors can add up to 3 external reviews from past work:

```bash
# Add external review
POST /api/reviews/external
{
  "rating": 5,
  "comment": "Great contractor, highly recommended!",
  "customerName": "John Smith",
  "customerEmail": "john@example.com",
  "projectType": "Kitchen Renovation",
  "projectDate": "2023-05-15"
}
```

### Review Limitations
- Maximum 3 external reviews per contractor
- External reviews are marked as unverified until admin approval
- After 3 external reviews, only platform-verified reviews are allowed

## 5. Notification System

### Notification Types
- Commission due reminders
- Commission overdue alerts
- Subscription expiring notices
- Job purchase notifications
- Review received alerts
- Account suspension notices

### Notification API
```bash
# Get notifications
GET /api/notifications?unreadOnly=true

# Mark notification as read
PATCH /api/notifications/:id/read

# Mark all as read
PATCH /api/notifications/read-all

# Update notification settings
PATCH /api/notifications/settings
{
  "email": true,
  "inApp": true,
  "commission": true,
  "subscription": true,
  "jobs": true,
  "reviews": true
}
```

## 6. Contractor Dashboard

The contractor dashboard provides a comprehensive overview of the contractor's activity and status:

```bash
# Get dashboard summary
GET /api/contractor/dashboard
```

### Dashboard Components
- **Profile Overview**: Name, business name, status, tier
- **Subscription Details**: Current plan, expiry date, pricing
- **Statistics**: Jobs completed, average rating, review count
- **Recent Jobs**: Last 5 completed jobs
- **Pending Commissions**: Due payments with countdown
- **Recent Reviews**: Latest 3 reviews received
- **Notification Count**: Unread notifications

### Invoice Management
```bash
# Get all invoices (both regular and commission)
GET /api/contractor/invoices
```

## 7. Payment Methods

All payment operations support:
- Visa
- MasterCard
- American Express
- Apple Pay
- Google Pay

## 8. Automatic Reminders

### Email Reminders
Sent at the following intervals before commission payment deadline:
- 36 hours before due
- 24 hours before due
- 12 hours before due
- 6 hours before due
- 2 hours before due (final warning)

### In-App Notifications
- Appear in the notification center
- Include countdown timer
- Direct payment link
- Urgent styling for approaching deadlines

## 9. Account Suspension

If a commission payment is not received within 48 hours:
1. Account is automatically suspended
2. Contractor profile is hidden from customers
3. Job access is restricted
4. In-app notification is sent
5. Email notification is sent
6. To restore: Pay all outstanding commissions + contact support

## 10. Admin Controls

Admins have comprehensive tools for managing invoices and commissions:

```bash
# Get all invoices with filters
GET /api/admin/invoices?status=OVERDUE&type=commission

# Get invoice statistics
GET /api/admin/invoices/statistics

# Get overdue commissions
GET /api/admin/invoices/overdue-commissions

# Send manual reminder
POST /api/admin/invoices/send-commission-reminder/:id
{
  "message": "Please pay your outstanding commission as soon as possible."
}

# Waive commission payment
PATCH /api/admin/invoices/waive-commission/:id
{
  "reason": "Customer cancelled project"
}
```

## API Integration Examples

### Complete Job Flow (Subscribed Contractor)
```javascript
// 1. Mark job as completed
const completeJob = async (jobId, finalAmount) => {
  const response = await fetch('/api/payments/complete-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, finalAmount }),
  });
  return await response.json();
};

// 2. Check for commission payment
const getCommissions = async () => {
  const response = await fetch('/api/payments/commissions');
  return await response.json();
};

// 3. Create payment intent for commission
const createCommissionPaymentIntent = async (commissionPaymentId) => {
  const response = await fetch('/api/payments/create-commission-payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commissionPaymentId }),
  });
  return await response.json();
};

// 4. Pay commission
const payCommission = async (commissionPaymentId, stripePaymentIntentId) => {
  const response = await fetch('/api/payments/pay-commission', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commissionPaymentId, stripePaymentIntentId }),
  });
  return await response.json();
};
```

### Subscription Flow
```javascript
// 1. Get subscription options
const getSubscriptionDetails = async () => {
  const response = await fetch('/api/contractor/subscription');
  return await response.json();
};

// 2. Create subscription payment intent
const createSubscriptionIntent = async (plan) => {
  const response = await fetch('/api/contractor/create-subscription-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  return await response.json();
};

// 3. Confirm subscription
const confirmSubscription = async (stripePaymentIntentId, plan) => {
  const response = await fetch('/api/contractor/confirm-subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stripePaymentIntentId, plan }),
  });
  return await response.json();
};
```

## Testing the System

### Test External Reviews
```bash
# Add test external review
POST /api/reviews/external
{
  "rating": 5,
  "comment": "Test external review",
  "customerName": "Test Customer",
  "customerEmail": "test@example.com",
  "projectType": "Test Project"
}
```

### Test Commission System
```bash
# 1. Complete a job
POST /api/payments/complete-job
{
  "jobId": "test_job",
  "finalAmount": 100.00
}

# 2. Check commission created
GET /api/payments/commissions

# 3. Test payment flow
POST /api/payments/create-commission-payment-intent
{
  "commissionPaymentId": "generated_id"
}
```

### Test Notification System
```bash
# Get notifications
GET /api/notifications

# Update settings
PATCH /api/notifications/settings
{
  "email": true,
  "inApp": true
}
```
