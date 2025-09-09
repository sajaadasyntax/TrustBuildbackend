# Subscription Benefits Guide

## Overview

TrustBuild offers a subscription service for contractors with several benefits, including:

1. **Unlimited Job Access**: Subscribed contractors get unlimited access to all jobs without additional payment
2. **No Commission on Completed Jobs**: No percentage fees on completed jobs
3. **Enhanced Profile Visibility**: Improved visibility to potential customers
4. **Priority Support**: Faster response to support requests

## Technical Implementation Details

### VAT Handling

All subscription prices now **include** 20% VAT. The pricing structure is as follows:

| Plan | Monthly Price | Total Price | Base Price (without VAT) | VAT Amount | Duration |
|------|--------------|------------|------------------------|-----------|----------|
| Monthly | £49.99 | £49.99 | £41.66 | £8.33 | 1 month |
| Six Months | £44.99 | £269.94 | £224.95 | £44.99 | 6 months |
| Yearly | £39.99 | £479.88 | £399.90 | £79.98 | 12 months |

### Unlimited Job Access

Subscribed contractors automatically get access to all job listings without additional payment:

1. All job access checks now verify if the contractor has an active subscription
2. If a subscription is active, job access is granted automatically
3. When purchasing job access, contractors with subscriptions get free access (via the new "SUBSCRIPTION" access method)

### Database Schema Updates

A new `AccessMethod` enum has been added to track how job access was granted:
- `CREDIT`: Access purchased using credits
- `PAYMENT`: Access purchased using direct payment
- `SUBSCRIPTION`: Access granted as part of subscription benefits

## Testing the Implementation

To test the subscription benefits:

1. Create a new contractor account
2. Purchase a subscription (any tier)
3. Navigate to job listings
4. Verify that you can access all job details without additional payment
5. Verify that job applications can be submitted without purchasing individual access

## Support

If you encounter any issues with subscription benefits, please contact support at support@trustbuild.uk.
