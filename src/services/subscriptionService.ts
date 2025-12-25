import { prisma } from '../config/database';
import { getSubscriptionPricingFromSettings } from './settingsService';

/**
 * Unified Subscription Service
 * Provides consistent subscription management across the entire application
 */

export interface SubscriptionStatus {
  hasActiveSubscription: boolean;
  subscription: any | null;
  isInCurrentPeriod: boolean;
  daysRemaining: number;
}

/**
 * Check if a contractor has an active subscription
 * This is the unified function used across the entire app
 */
export async function checkSubscriptionStatus(contractorId: string): Promise<SubscriptionStatus> {
  const contractor = await prisma.contractor.findUnique({
    where: { id: contractorId },
    include: {
      subscription: true,
    },
  });

  if (!contractor || !contractor.subscription) {
    return {
      hasActiveSubscription: false,
      subscription: null,
      isInCurrentPeriod: false,
      daysRemaining: 0,
    };
  }

  const subscription = contractor.subscription;
  const now = new Date();

  // Check if subscription is active and within current period
  const isActive = subscription.isActive && subscription.status === 'active';
  const isInCurrentPeriod = 
    now >= subscription.currentPeriodStart &&
    now <= subscription.currentPeriodEnd;

  const hasActiveSubscription = isActive && isInCurrentPeriod;

  const daysRemaining = hasActiveSubscription
    ? Math.max(0, Math.floor((subscription.currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  return {
    hasActiveSubscription,
    subscription: hasActiveSubscription ? subscription : null,
    isInCurrentPeriod,
    daysRemaining,
  };
}

/**
 * Check subscription status by user ID
 */
export async function checkSubscriptionStatusByUserId(userId: string): Promise<SubscriptionStatus> {
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!contractor) {
    return {
      hasActiveSubscription: false,
      subscription: null,
      isInCurrentPeriod: false,
      daysRemaining: 0,
    };
  }

  return checkSubscriptionStatus(contractor.id);
}

/**
 * Get subscription pricing from admin settings
 * This is the unified pricing function used across the entire app
 */
export async function getSubscriptionPricing(plan: string) {
  const pricing = await getSubscriptionPricingFromSettings();
  
  // VAT rate is 20% - prices from settings are VAT-inclusive
  const VAT_RATE = 0.20;
  
  // Calculate base price and VAT from VAT-inclusive total
  // Formula: basePrice = total / 1.20, vatAmount = total - basePrice
  const calculateVatBreakdown = (totalInclVat: number) => {
    const basePrice = totalInclVat / (1 + VAT_RATE);
    const vatAmount = totalInclVat - basePrice;
    return { basePrice: Math.round(basePrice * 100) / 100, vatAmount: Math.round(vatAmount * 100) / 100 };
  };
  
  switch (plan) {
    case 'MONTHLY': {
      const { basePrice, vatAmount } = calculateVatBreakdown(pricing.monthly);
      return {
        monthly: pricing.monthly,
        total: pricing.monthly,
        basePrice: basePrice,
        vatAmount: vatAmount,
        discount: 0,
        discountPercentage: 0,
        duration: 1,
        durationUnit: 'month',
        includesVAT: true,
      };
    }
    case 'SIX_MONTHS': {
      const sixMonthTotal = pricing.sixMonths;
      const sixMonthMonthly = sixMonthTotal / 6;
      const monthlyTotal = pricing.monthly * 6;
      const sixMonthDiscount = monthlyTotal - sixMonthTotal;
      const { basePrice, vatAmount } = calculateVatBreakdown(sixMonthTotal);
      return {
        monthly: sixMonthMonthly,
        total: sixMonthTotal,
        basePrice: basePrice,
        vatAmount: vatAmount,
        discount: sixMonthDiscount,
        discountPercentage: Math.round((sixMonthDiscount / monthlyTotal) * 100),
        duration: 6,
        durationUnit: 'months',
        includesVAT: true,
      };
    }
    case 'YEARLY': {
      const yearlyTotal = pricing.yearly;
      const yearlyMonthly = yearlyTotal / 12;
      const monthlyTotalYearly = pricing.monthly * 12;
      const yearlyDiscount = monthlyTotalYearly - yearlyTotal;
      const { basePrice, vatAmount } = calculateVatBreakdown(yearlyTotal);
      return {
        monthly: yearlyMonthly,
        total: yearlyTotal,
        basePrice: basePrice,
        vatAmount: vatAmount,
        discount: yearlyDiscount,
        discountPercentage: Math.round((yearlyDiscount / monthlyTotalYearly) * 100),
        duration: 12,
        durationUnit: 'months',
        includesVAT: true,
      };
    }
    default: {
      const { basePrice, vatAmount } = calculateVatBreakdown(pricing.monthly);
      return {
        monthly: pricing.monthly,
        total: pricing.monthly,
        basePrice: basePrice,
        vatAmount: vatAmount,
        discount: 0,
        discountPercentage: 0,
        duration: 1,
        durationUnit: 'month',
        includesVAT: true,
      };
    }
  }
}

/**
 * Calculate subscription end date based on plan
 */
export function calculateSubscriptionEndDate(plan: string, startDate: Date = new Date()): Date {
  const endDate = new Date(startDate);
  
  switch (plan) {
    case 'MONTHLY':
      endDate.setMonth(endDate.getMonth() + 1);
      break;
    case 'SIX_MONTHS':
      endDate.setMonth(endDate.getMonth() + 6);
      break;
    case 'YEARLY':
      endDate.setFullYear(endDate.getFullYear() + 1);
      break;
    default:
      endDate.setMonth(endDate.getMonth() + 1);
  }
  
  return endDate;
}

/**
 * Get formatted subscription details for API responses
 */
export async function formatSubscriptionDetails(subscription: any) {
  if (!subscription) {
    return null;
  }

  const pricing = await getSubscriptionPricing(subscription.plan);
  const now = new Date();
  
  const nextBillingDate = subscription.currentPeriodEnd;
  const formattedNextBillingDate = nextBillingDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const daysRemaining = Math.max(0, Math.floor((subscription.currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return {
    id: subscription.id,
    plan: subscription.plan,
    planName: subscription.plan === 'MONTHLY' ? 'Monthly' : subscription.plan === 'SIX_MONTHS' ? '6-Month' : 'Yearly',
    status: subscription.status,
    isActive: subscription.isActive,
    startDate: subscription.currentPeriodStart.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }),
    endDate: formattedNextBillingDate,
    nextBillingDate: formattedNextBillingDate,
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    currentPeriodStart: subscription.currentPeriodStart.toISOString(),
    pricing,
    daysRemaining,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
  };
}

