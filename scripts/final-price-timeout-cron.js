#!/usr/bin/env node
/**
 * Final Price Timeout Processing Cron Job
 * 
 * This script should be run every hour to:
 * 1. Check for jobs awaiting final price confirmation that have timed out
 * 2. Auto-confirm final prices for timed out jobs
 * 3. Process commissions and send notifications
 * 
 * Usage: node scripts/final-price-timeout-cron.js
 * Crontab: 0 * * * * /usr/bin/node /path/to/backend/scripts/final-price-timeout-cron.js
 */

require('dotenv').config();
const { processFinalPriceTimeouts } = require('../dist/src/services/finalPriceTimeoutService');

async function runFinalPriceTimeoutJob() {
  console.log(`🕐 [${new Date().toISOString()}] Starting final price timeout job...`);
  
  try {
    await processFinalPriceTimeouts();
    console.log(`✅ [${new Date().toISOString()}] Final price timeout job completed successfully`);
    process.exit(0);
  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Final price timeout job failed:`, error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Final price timeout job interrupted');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Final price timeout job terminated');
  process.exit(0);
});

// Run the job
runFinalPriceTimeoutJob();
