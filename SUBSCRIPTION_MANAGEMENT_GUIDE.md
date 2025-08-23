# Subscription Management Guide

This guide explains how to implement subscription management functionality for contractors in the TrustBuild platform.

## API Endpoints

### 1. Get Subscription Plans
```
GET /api/subscriptions/plans
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "plans": [
      {
        "id": "MONTHLY",
        "name": "Monthly",
        "monthly": 49.99,
        "total": 49.99,
        "discount": 0,
        "discountPercentage": 0,
        "duration": 1,
        "durationUnit": "month",
        "features": [
          "Access to all job listings",
          "No commission on completed jobs",
          "Unlimited job applications",
          "Profile visibility to customers",
          "Customer reviews"
        ]
      },
      {
        "id": "SIX_MONTHS",
        "name": "6-Month",
        "monthly": 44.99,
        "total": 269.94,
        "discount": 30.00,
        "discountPercentage": 10,
        "duration": 6,
        "durationUnit": "months",
        "features": [
          "All Monthly plan features",
          "10% discount",
          "Priority in search results",
          "Featured profile badge",
          "Extended profile customization"
        ]
      },
      {
        "id": "YEARLY",
        "name": "Yearly",
        "monthly": 39.99,
        "total": 479.88,
        "discount": 119.88,
        "discountPercentage": 20,
        "duration": 12,
        "durationUnit": "months",
        "features": [
          "All 6-Month plan features",
          "20% discount",
          "Top placement in search results",
          "Premium profile badge",
          "Advanced analytics dashboard",
          "Dedicated support"
        ]
      }
    ]
  }
}
```

### 2. Get Current Subscription
```
GET /api/subscriptions/current
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "subscription": {
      "id": "subscription_id",
      "plan": "MONTHLY",
      "planName": "Monthly",
      "status": "active",
      "isActive": true,
      "startDate": "1 January 2024",
      "endDate": "1 February 2024",
      "nextBillingDate": "1 February 2024",
      "pricing": {
        "monthly": 49.99,
        "total": 49.99,
        "discount": 0,
        "discountPercentage": 0,
        "duration": 1,
        "durationUnit": "month"
      },
      "daysRemaining": 15,
      "stripeSubscriptionId": "sub_123456789"
    },
    "hasActiveSubscription": true
  }
}
```

### 3. Create Subscription Payment Intent
```
POST /api/subscriptions/create-payment-intent
```

**Request:**
```json
{
  "plan": "MONTHLY" // or "SIX_MONTHS" or "YEARLY"
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "clientSecret": "pi_123456789_secret_987654321",
    "amount": 49.99,
    "plan": "MONTHLY",
    "pricing": {
      "monthly": 49.99,
      "total": 49.99,
      "discount": 0,
      "discountPercentage": 0,
      "duration": 1,
      "durationUnit": "month"
    }
  }
}
```

### 4. Confirm Subscription
```
POST /api/subscriptions/confirm
```

**Request:**
```json
{
  "stripePaymentIntentId": "pi_123456789",
  "plan": "MONTHLY"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Subscription confirmed successfully",
  "data": {
    "subscription": {
      "id": "subscription_id",
      "plan": "MONTHLY",
      "status": "active",
      "isActive": true,
      "currentPeriodStart": "2024-01-01T00:00:00.000Z",
      "currentPeriodEnd": "2024-02-01T00:00:00.000Z",
      "monthlyPrice": 49.99
    }
  }
}
```

### 5. Cancel Subscription
```
POST /api/subscriptions/cancel
```

**Response:**
```json
{
  "status": "success",
  "message": "Subscription cancelled successfully",
  "data": {
    "subscription": {
      "id": "subscription_id",
      "plan": "MONTHLY",
      "status": "cancelled",
      "isActive": false,
      "currentPeriodStart": "2024-01-01T00:00:00.000Z",
      "currentPeriodEnd": "2024-02-01T00:00:00.000Z",
      "monthlyPrice": 49.99
    }
  }
}
```

## Frontend Implementation

### 1. Subscription Management Component

Create a component that allows contractors to:
- View available subscription plans
- Compare plan features
- Select and purchase a plan
- View current subscription details
- Cancel current subscription

### 2. Subscription Payment Flow

1. **Display Plans:**
   - Show all available plans with features and pricing
   - Highlight savings for longer plans
   - Include clear call-to-action buttons

2. **Payment Process:**
   - When user selects a plan, call `/api/subscriptions/create-payment-intent`
   - Use Stripe Elements to collect payment information
   - Submit payment using the returned `clientSecret`
   - On successful payment, call `/api/subscriptions/confirm`

3. **Subscription Management:**
   - Show current subscription details
   - Display remaining time
   - Provide option to cancel
   - If cancelled, show expiry date

### 3. Example React Component Structure

```jsx
// SubscriptionPlans.jsx - Display available plans
const SubscriptionPlans = ({ onSelectPlan, currentPlan }) => {
  const [plans, setPlans] = useState([]);
  
  useEffect(() => {
    // Fetch plans from API
    const fetchPlans = async () => {
      const response = await fetch('/api/subscriptions/plans');
      const data = await response.json();
      setPlans(data.data.plans);
    };
    
    fetchPlans();
  }, []);
  
  return (
    <div className="subscription-plans">
      {plans.map(plan => (
        <PlanCard 
          key={plan.id}
          plan={plan}
          isActive={currentPlan?.plan === plan.id}
          onSelect={() => onSelectPlan(plan)}
        />
      ))}
    </div>
  );
};

// CurrentSubscription.jsx - Display current subscription
const CurrentSubscription = ({ subscription, onCancel }) => {
  if (!subscription) {
    return <p>You don't have an active subscription.</p>;
  }
  
  return (
    <div className="current-subscription">
      <h3>Your {subscription.planName} Subscription</h3>
      <p>Status: {subscription.status}</p>
      <p>Next billing date: {subscription.nextBillingDate}</p>
      <p>Days remaining: {subscription.daysRemaining}</p>
      
      <button onClick={onCancel} className="cancel-button">
        Cancel Subscription
      </button>
    </div>
  );
};

// PaymentForm.jsx - Handle payment collection
const PaymentForm = ({ clientSecret, plan, onSuccess }) => {
  const stripe = useStripe();
  const elements = useElements();
  
  const handleSubmit = async (event) => {
    event.preventDefault();
    
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.origin + '/payment-success',
      },
      redirect: 'if_required',
    });
    
    if (result.error) {
      // Show error
    } else {
      // Call confirm endpoint
      const response = await fetch('/api/subscriptions/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stripePaymentIntentId: result.paymentIntent.id,
          plan: plan.id,
        }),
      });
      
      if (response.ok) {
        onSuccess();
      }
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <button type="submit">Subscribe Now</button>
    </form>
  );
};

// Main component
const SubscriptionManager = () => {
  const [currentSubscription, setCurrentSubscription] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  
  useEffect(() => {
    // Fetch current subscription
    const fetchSubscription = async () => {
      const response = await fetch('/api/subscriptions/current');
      const data = await response.json();
      setCurrentSubscription(data.data.subscription);
    };
    
    fetchSubscription();
  }, []);
  
  const handleSelectPlan = async (plan) => {
    setSelectedPlan(plan);
    
    // Create payment intent
    const response = await fetch('/api/subscriptions/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: plan.id }),
    });
    
    const data = await response.json();
    setClientSecret(data.data.clientSecret);
  };
  
  const handleCancelSubscription = async () => {
    if (confirm('Are you sure you want to cancel your subscription?')) {
      const response = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
      });
      
      if (response.ok) {
        const data = await response.json();
        setCurrentSubscription(data.data.subscription);
      }
    }
  };
  
  const handlePaymentSuccess = async () => {
    // Refresh subscription data
    const response = await fetch('/api/subscriptions/current');
    const data = await response.json();
    setCurrentSubscription(data.data.subscription);
    setSelectedPlan(null);
    setClientSecret(null);
  };
  
  return (
    <div className="subscription-manager">
      <h2>Subscription Management</h2>
      
      <CurrentSubscription 
        subscription={currentSubscription} 
        onCancel={handleCancelSubscription} 
      />
      
      <h3>Available Plans</h3>
      <SubscriptionPlans 
        onSelectPlan={handleSelectPlan}
        currentPlan={currentSubscription}
      />
      
      {selectedPlan && clientSecret && (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <PaymentForm 
            clientSecret={clientSecret}
            plan={selectedPlan}
            onSuccess={handlePaymentSuccess}
          />
        </Elements>
      )}
    </div>
  );
};
```

## Integration with Payments Page

Add the subscription management component to the contractor's payments page:

```jsx
// PaymentsPage.jsx
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
```

## Styling Guidelines

- Use a clean, professional design
- Highlight the best value plan
- Use color to indicate subscription status (active, cancelled)
- Include progress bars for subscription time remaining
- Make payment forms clear and easy to use
- Provide clear feedback during payment processing

## Testing

1. Test subscription purchase flow with Stripe test cards
2. Verify subscription details are displayed correctly
3. Test cancellation flow
4. Verify emails are sent correctly
5. Test with different subscription plans

## Error Handling

- Display clear error messages for payment failures
- Handle network errors gracefully
- Provide retry options for failed payments
- Show confirmation dialogs for important actions (like cancellation)
