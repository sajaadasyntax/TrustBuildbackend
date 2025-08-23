import React, { useState, useEffect } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import './SubscriptionManager.css';

// Initialize Stripe
const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLIC_KEY);

// Plan Card Component
const PlanCard = ({ plan, isActive, onSelect }) => {
  return (
    <div className={`plan-card ${isActive ? 'active' : ''} ${plan.id === 'YEARLY' ? 'best-value' : ''}`}>
      {plan.id === 'YEARLY' && <div className="best-value-badge">Best Value</div>}
      <h3 className="plan-name">{plan.name}</h3>
      <div className="plan-price">
        <span className="price-amount">£{plan.monthly}</span>
        <span className="price-period">/month</span>
      </div>
      {plan.discountPercentage > 0 && (
        <div className="discount-badge">Save {plan.discountPercentage}%</div>
      )}
      <div className="plan-total">
        <span>Total: £{plan.total}</span>
        {plan.duration > 1 && (
          <span className="duration">for {plan.duration} {plan.durationUnit}</span>
        )}
      </div>
      <div className="plan-features">
        <h4>Features:</h4>
        <ul>
          {plan.features.map((feature, index) => (
            <li key={index}>{feature}</li>
          ))}
        </ul>
      </div>
      <button
        className={`plan-select-button ${isActive ? 'current' : 'select'}`}
        onClick={() => !isActive && onSelect(plan)}
        disabled={isActive}
      >
        {isActive ? 'Current Plan' : 'Select Plan'}
      </button>
    </div>
  );
};

// Current Subscription Component
const CurrentSubscription = ({ subscription, onCancel }) => {
  if (!subscription) {
    return (
      <div className="no-subscription">
        <h3>No Active Subscription</h3>
        <p>Subscribe to a plan to access premium features and benefits.</p>
      </div>
    );
  }
  
  const isActive = subscription.isActive && subscription.status === 'active';
  const isCancelled = subscription.status === 'cancelled';
  
  return (
    <div className={`current-subscription ${isActive ? 'active' : 'cancelled'}`}>
      <h3>Your {subscription.planName} Subscription</h3>
      <div className="subscription-details">
        <div className="subscription-status">
          <span className={`status-badge ${isActive ? 'active' : 'cancelled'}`}>
            {isActive ? 'Active' : 'Cancelled'}
          </span>
        </div>
        
        <div className="subscription-dates">
          <p>
            <strong>Start Date:</strong> {subscription.startDate}
          </p>
          <p>
            <strong>Next Billing:</strong> {isCancelled ? 'Not Renewing' : subscription.nextBillingDate}
          </p>
        </div>
        
        {subscription.daysRemaining > 0 && (
          <div className="subscription-progress">
            <p>
              <strong>Days Remaining:</strong> {subscription.daysRemaining}
            </p>
            <div className="progress-bar-container">
              <div 
                className="progress-bar" 
                style={{ 
                  width: `${Math.min(100, (subscription.daysRemaining / 30) * 100)}%` 
                }}
              ></div>
            </div>
          </div>
        )}
      </div>
      
      {isActive && (
        <button onClick={onCancel} className="cancel-button">
          Cancel Subscription
        </button>
      )}
      
      {isCancelled && (
        <div className="cancelled-notice">
          <p>Your subscription will remain active until {subscription.endDate}.</p>
        </div>
      )}
    </div>
  );
};

// Payment Form Component
const PaymentForm = ({ clientSecret, plan, onSuccess, onCancel }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  
  const handleSubmit = async (event) => {
    event.preventDefault();
    
    if (!stripe || !elements) {
      return;
    }
    
    setProcessing(true);
    setError(null);
    
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin + '/payment-success',
        },
        redirect: 'if_required',
      });
      
      if (result.error) {
        setError(result.error.message);
        setProcessing(false);
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
        } else {
          const errorData = await response.json();
          setError(errorData.message || 'Failed to confirm subscription');
        }
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setProcessing(false);
    }
  };
  
  return (
    <div className="payment-form-container">
      <h3>Complete Your {plan.name} Subscription</h3>
      <div className="payment-summary">
        <p><strong>Plan:</strong> {plan.name}</p>
        <p><strong>Amount:</strong> £{plan.total}</p>
        {plan.discountPercentage > 0 && (
          <p><strong>Savings:</strong> {plan.discountPercentage}% (£{plan.discount.toFixed(2)})</p>
        )}
      </div>
      
      <form onSubmit={handleSubmit} className="payment-form">
        <div id="payment-element" className="payment-element"></div>
        
        {error && (
          <div className="payment-error">
            <p>{error}</p>
          </div>
        )}
        
        <div className="payment-actions">
          <button 
            type="button" 
            className="cancel-payment-button"
            onClick={onCancel}
            disabled={processing}
          >
            Cancel
          </button>
          <button 
            type="submit" 
            className="submit-payment-button"
            disabled={!stripe || processing}
          >
            {processing ? 'Processing...' : 'Subscribe Now'}
          </button>
        </div>
      </form>
    </div>
  );
};

// Main Subscription Manager Component
const SubscriptionManager = () => {
  const [currentSubscription, setCurrentSubscription] = useState(null);
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Fetch current subscription and plans
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Fetch current subscription
        const subscriptionResponse = await fetch('/api/subscriptions/current');
        if (!subscriptionResponse.ok) {
          throw new Error('Failed to fetch subscription data');
        }
        const subscriptionData = await subscriptionResponse.json();
        setCurrentSubscription(subscriptionData.data.subscription);
        
        // Fetch plans
        const plansResponse = await fetch('/api/subscriptions/plans');
        if (!plansResponse.ok) {
          throw new Error('Failed to fetch subscription plans');
        }
        const plansData = await plansResponse.json();
        setPlans(plansData.data.plans);
      } catch (err) {
        setError('Failed to load subscription data. Please try again.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, []);
  
  // Handle plan selection
  const handleSelectPlan = async (plan) => {
    setSelectedPlan(plan);
    setError(null);
    
    try {
      const response = await fetch('/api/subscriptions/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: plan.id }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to create payment intent');
      }
      
      const data = await response.json();
      setClientSecret(data.data.clientSecret);
    } catch (err) {
      setError('Failed to initialize payment. Please try again.');
      console.error(err);
    }
  };
  
  // Handle subscription cancellation
  const handleCancelSubscription = async () => {
    if (!window.confirm('Are you sure you want to cancel your subscription? You will still have access until the end of your current billing period.')) {
      return;
    }
    
    setError(null);
    
    try {
      const response = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error('Failed to cancel subscription');
      }
      
      const data = await response.json();
      setCurrentSubscription(data.data.subscription);
      
      // Show success message
      alert('Your subscription has been cancelled successfully. You will have access until the end of your current billing period.');
    } catch (err) {
      setError('Failed to cancel subscription. Please try again.');
      console.error(err);
    }
  };
  
  // Handle payment success
  const handlePaymentSuccess = async () => {
    // Refresh subscription data
    try {
      const response = await fetch('/api/subscriptions/current');
      if (!response.ok) {
        throw new Error('Failed to fetch updated subscription data');
      }
      
      const data = await response.json();
      setCurrentSubscription(data.data.subscription);
      setSelectedPlan(null);
      setClientSecret(null);
      
      // Show success message
      alert('Your subscription has been activated successfully!');
    } catch (err) {
      setError('Subscription was processed, but failed to update data. Please refresh the page.');
      console.error(err);
    }
  };
  
  // Cancel payment
  const handleCancelPayment = () => {
    setSelectedPlan(null);
    setClientSecret(null);
  };
  
  if (loading) {
    return <div className="subscription-loading">Loading subscription data...</div>;
  }
  
  return (
    <div className="subscription-manager">
      <h2>Subscription Management</h2>
      
      {error && (
        <div className="subscription-error">
          <p>{error}</p>
        </div>
      )}
      
      {/* Current Subscription Section */}
      <section className="current-subscription-section">
        <CurrentSubscription 
          subscription={currentSubscription} 
          onCancel={handleCancelSubscription} 
        />
      </section>
      
      {/* Payment Form (when a plan is selected) */}
      {selectedPlan && clientSecret ? (
        <section className="payment-section">
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <PaymentForm 
              clientSecret={clientSecret}
              plan={selectedPlan}
              onSuccess={handlePaymentSuccess}
              onCancel={handleCancelPayment}
            />
          </Elements>
        </section>
      ) : (
        /* Available Plans Section */
        <section className="available-plans-section">
          <h3>Available Plans</h3>
          <div className="plans-container">
            {plans.map(plan => (
              <PlanCard 
                key={plan.id}
                plan={plan}
                isActive={currentSubscription?.plan === plan.id && currentSubscription?.isActive}
                onSelect={handleSelectPlan}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default SubscriptionManager;
