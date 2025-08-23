# Subscription Integration Guide

This guide explains how to integrate the Subscription Manager component into the existing payments page for contractors.

## Prerequisites

1. Ensure you have the following dependencies installed:
   ```bash
   npm install @stripe/react-stripe-js @stripe/stripe-js
   ```

2. Set up your Stripe public key in your environment variables:
   ```
   REACT_APP_STRIPE_PUBLIC_KEY=pk_test_your_stripe_public_key
   ```

## Integration Steps

### 1. Copy the Component Files

Copy the following files to your frontend project:
- `SubscriptionManager.jsx` → `src/components/subscription/SubscriptionManager.jsx`
- `SubscriptionManager.css` → `src/components/subscription/SubscriptionManager.css`

### 2. Update the Payments Page

Open your payments page component (e.g., `PaymentsPage.jsx`) and make the following changes:

```jsx
import React from 'react';
import { useAuth } from '../contexts/AuthContext'; // Adjust path as needed
import SubscriptionManager from '../components/subscription/SubscriptionManager';
import PaymentHistory from '../components/payments/PaymentHistory'; // Your existing component

const PaymentsPage = () => {
  const { user } = useAuth();
  const isContractor = user?.role === 'CONTRACTOR';
  
  return (
    <div className="payments-page">
      <h1>Payments & Subscriptions</h1>
      
      {isContractor && (
        <div className="subscription-section">
          <h2>Manage Subscription</h2>
          <SubscriptionManager />
        </div>
      )}
      
      <div className="payment-history-section">
        <h2>Payment History</h2>
        <PaymentHistory />
      </div>
    </div>
  );
};

export default PaymentsPage;
```

### 3. Set Up Stripe Provider

Ensure your app has the Stripe provider set up in your main app component:

```jsx
// In App.jsx or similar top-level component
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLIC_KEY);

function App() {
  return (
    <Elements stripe={stripePromise}>
      {/* Your app components */}
    </Elements>
  );
}
```

### 4. Update API Service

Create or update your API service to include the subscription endpoints:

```jsx
// src/services/api.js

// Subscription API calls
export const subscriptionApi = {
  getPlans: async () => {
    const response = await fetch('/api/subscriptions/plans');
    if (!response.ok) throw new Error('Failed to fetch subscription plans');
    return response.json();
  },
  
  getCurrentSubscription: async () => {
    const response = await fetch('/api/subscriptions/current');
    if (!response.ok) throw new Error('Failed to fetch current subscription');
    return response.json();
  },
  
  createPaymentIntent: async (plan) => {
    const response = await fetch('/api/subscriptions/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    if (!response.ok) throw new Error('Failed to create payment intent');
    return response.json();
  },
  
  confirmSubscription: async (stripePaymentIntentId, plan) => {
    const response = await fetch('/api/subscriptions/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stripePaymentIntentId, plan }),
    });
    if (!response.ok) throw new Error('Failed to confirm subscription');
    return response.json();
  },
  
  cancelSubscription: async () => {
    const response = await fetch('/api/subscriptions/cancel', {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to cancel subscription');
    return response.json();
  },
};
```

### 5. Update the SubscriptionManager Component

Update the SubscriptionManager component to use your API service:

```jsx
// In SubscriptionManager.jsx
import { subscriptionApi } from '../../services/api';

// Then replace fetch calls with API service calls:
// Example:
// const response = await fetch('/api/subscriptions/current');
// becomes:
// const response = await subscriptionApi.getCurrentSubscription();
```

### 6. Add Styles to Your Main CSS

Import the subscription styles in your main CSS file:

```css
/* In your main CSS file */
@import '../components/subscription/SubscriptionManager.css';
```

### 7. Testing the Integration

1. Log in as a contractor user
2. Navigate to the payments page
3. Verify that the subscription section appears
4. Test the following flows:
   - View available plans
   - Subscribe to a plan using Stripe test cards
   - View current subscription details
   - Cancel a subscription

## Troubleshooting

### Common Issues

1. **Subscription data not loading**
   - Check browser console for API errors
   - Verify that the user has the CONTRACTOR role
   - Ensure the backend API endpoints are working correctly

2. **Stripe Elements not appearing**
   - Check that Stripe public key is correctly set
   - Verify that Stripe Elements are properly initialized

3. **Payment fails to process**
   - Use Stripe test cards for testing (e.g., 4242 4242 4242 4242)
   - Check browser console for Stripe errors
   - Verify that the backend can communicate with Stripe

4. **Subscription not updating after payment**
   - Ensure the confirm endpoint is called after successful payment
   - Check that the subscription data is refreshed after confirmation

## Example Stripe Test Cards

Use these cards for testing the payment flow:

- **Successful payment**: 4242 4242 4242 4242
- **Authentication required**: 4000 0025 0000 3155
- **Payment declined**: 4000 0000 0000 9995

For all test cards, use:
- Any future expiration date
- Any 3-digit CVC
- Any postal code

## Additional Resources

- [Stripe Elements Documentation](https://stripe.com/docs/stripe-js/react)
- [Stripe Test Cards](https://stripe.com/docs/testing#cards)
- [Subscription API Documentation](../SUBSCRIPTION_MANAGEMENT_GUIDE.md)
