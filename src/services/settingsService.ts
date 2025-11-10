import { prisma } from '../config/database';

/**
 * Get a setting value from AdminSettings (primary) or Setting (fallback)
 * This ensures backward compatibility while using AdminSettings as the source of truth
 */
export async function getSetting(key: string): Promise<any> {
  // Try AdminSettings first (source of truth from admin panel)
  const adminSetting = await prisma.adminSettings.findUnique({
    where: { key: key.toUpperCase() },
  });

  if (adminSetting?.value) {
    try {
      return JSON.parse(adminSetting.value);
    } catch {
      return adminSetting.value;
    }
  }

  // Fallback to Setting table for backward compatibility
  const setting = await prisma.setting.findUnique({
    where: { key: key.toUpperCase() },
  });

  if (setting?.value) {
    return setting.value;
  }

  return null;
}

/**
 * Get commission rate from settings
 */
export async function getCommissionRate(): Promise<number> {
  const setting = await getSetting('COMMISSION_RATE');
  if (setting?.rate) {
    return parseFloat(setting.rate.toString());
  }
  return 5.0; // Default
}

/**
 * Get subscription pricing from settings
 */
export async function getSubscriptionPricingFromSettings(): Promise<{
  monthly: number;
  sixMonths: number;
  yearly: number;
  currency: string;
}> {
  const setting = await getSetting('SUBSCRIPTION_PRICING');
  if (setting) {
    return {
      monthly: parseFloat(setting.monthly?.toString() || '49.99'),
      sixMonths: parseFloat(setting.sixMonths?.toString() || '269.94'),
      yearly: parseFloat(setting.yearly?.toString() || '479.88'),
      currency: setting.currency || 'GBP',
    };
  }
  // Default pricing
  return {
    monthly: 49.99,
    sixMonths: 269.94,
    yearly: 479.88,
    currency: 'GBP',
  };
}

/**
 * Get free job allocation from settings
 */
export async function getFreeJobAllocation(): Promise<number> {
  const setting = await getSetting('FREE_JOB_ALLOCATION');
  if (setting?.defaultAllocation !== undefined) {
    return parseInt(setting.defaultAllocation.toString());
  }
  return 1; // Default
}

