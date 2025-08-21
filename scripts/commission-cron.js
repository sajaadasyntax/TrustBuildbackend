#!/usr/bin/env node
/**
 * Commission Payment Reminder Cron Job
 * 
 * This script should be run every hour to:
 * 1. Check for overdue commission payments
 * 2. Send reminder emails at appropriate intervals
 * 3. Suspend accounts for overdue payments
 * 
 * Usage: node scripts/commission-cron.js
 * Crontab: 0 * * * * /usr/bin/node /path/to/backend/scripts/commission-cron.js
 */

require('dotenv').config();
const { processCommissionReminders } = require('../dist/src/services/commissionService');

async function runCommissionJob() {
  console.log(`🕐 [${new Date().toISOString()}] Starting commission reminder job...`);
  
  try {
    await processCommissionReminders();
    console.log(`✅ [${new Date().toISOString()}] Commission reminder job completed successfully`);
    process.exit(0);
  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Commission reminder job failed:`, error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Commission reminder job interrupted');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Commission reminder job terminated');
  process.exit(0);
});

// Run the job
runCommissionJob();
