# Payment Methods Configuration Guide

## Supported Payment Methods

TrustBuild now supports the following payment methods through Stripe:

### 1. **Card Payments** 💳
- **Visa**
- **MasterCard** 
- **American Express (Amex)**
- **All major debit cards**

### 2. **Digital Wallets** 📱
- **Apple Pay** (iOS devices)
- **Google Pay** (Android devices)

### 3. **TrustBuild Credits** 🎉
- Internal credit system
- 1 credit = 1 job access purchase

## Frontend Configuration Required

### Stripe Elements Configuration

The frontend needs to configure Stripe Elements to support all payment methods:

```javascript
// In your Stripe configuration
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

// Payment Element options
const paymentElementOptions = {
  mode: 'payment',
  amount: amountInPence, // Amount in pence (e.g., 1200 for £12.00)
  currency: 'gbp',
  payment_method_types: ['card'], // This enables all card types
  appearance: {
    theme: 'stripe',
    variables: {
      colorPrimary: '#2563eb', // TrustBuild blue
    }
  },
  // Automatically enables Apple Pay and Google Pay when available
  wallets: {
    applePay: 'auto',
    googlePay: 'auto'
  }
};
```

### Payment Method Display

The payment form should automatically show:
- Card input fields for Visa/MasterCard/Amex
- Apple Pay button (on supported devices)
- Google Pay button (on supported devices)
- TrustBuild Credits option (if contractor has credits)

## Backend Configuration

### Stripe Payment Intent

The backend is already configured to support all payment methods:

```typescript
const paymentIntent = await stripe.paymentIntents.create({
  amount: leadPrice * 100, // Convert to pence
  currency: 'gbp',
  payment_method_types: ['card'], // Enables all card types
  automatic_payment_methods: {
    enabled: true, // Enables Apple Pay, Google Pay automatically
    allow_redirects: 'never' // Better UX - no redirects
  },
  metadata: {
    jobId,
    contractorId: contractor.id,
    leadPrice: leadPrice.toString(),
    type: 'job_access_purchase'
  },
});
```

## Email Notifications

### Invoice Emails (Contractors)
Every payment (credit or card) now sends an invoice email to the contractor with:
- Invoice details and number
- Payment method used (Credit vs Card Payment)
- Job information
- Professional HTML formatting

### Customer Notifications
Every time a contractor purchases job access, the customer receives:
- Notification that a contractor is interested
- Contractor's name
- Progress bar showing how many contractors have purchased
- Next steps information

## Testing

### Test Endpoints

Use these endpoints to test the email system:

```bash
# Test invoice email
POST /api/payments/test-invoice-email
{
  "email": "test@example.com",
  "paymentMethod": "STRIPE" // or "CREDIT"
}

# Test customer notification
POST /api/payments/test-customer-notification
{
  "email": "customer@example.com"
}
```

### Test Cards (Stripe Test Mode)

Use these test card numbers:
- **Visa**: 4242 4242 4242 4242
- **MasterCard**: 5555 5555 5555 4444
- **Amex**: 3782 8224 6310 005
- **Declined card**: 4000 0000 0000 0002

## Production Deployment Checklist

- [ ] Update Stripe keys to live keys
- [ ] Test all payment methods on actual devices
- [ ] Verify Apple Pay domain verification
- [ ] Test Google Pay merchant verification
- [ ] Confirm email deliverability
- [ ] Test with real cards (small amounts)

## Payment Flow Summary

1. **Contractor clicks "Purchase Access"**
2. **Frontend shows payment options:**
   - TrustBuild Credits (if available)
   - Card payment (Visa/MC/Amex)
   - Apple Pay (if available)
   - Google Pay (if available)
3. **Payment processed**
4. **Automatically sends:**
   - Invoice email to contractor
   - Notification email to customer
5. **Contractor gets instant access to customer details**

## Troubleshooting

### Apple Pay Not Showing
- Verify device supports Apple Pay
- Check domain verification in Stripe Dashboard
- Ensure HTTPS is enabled

### Google Pay Not Showing
- Verify Google Pay merchant ID
- Check payment request API support
- Ensure secure context (HTTPS)

### Email Issues
- Check SMTP configuration
- Verify email sender reputation
- Test with different email providers
