#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function runCommand(command, description) {
  try {
    log(`\n${colors.cyan}🔄 ${description}...${colors.reset}`);
    const output = execSync(command, { 
      encoding: 'utf8', 
      stdio: 'pipe',
      cwd: process.cwd()
    });
    log(`${colors.green}✅ ${description} completed${colors.reset}`);
    if (output.trim()) {
      console.log(output);
    }
    return true;
  } catch (error) {
    log(`${colors.red}❌ ${description} failed: ${error.message}${colors.reset}`);
    return false;
  }
}

function createLogsDirectory() {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    log(`${colors.green}📁 Created logs directory${colors.reset}`);
  }
}

function checkPM2Installed() {
  try {
    execSync('pm2 --version', { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

function installPM2() {
  if (!checkPM2Installed()) {
    log(`${colors.yellow}📦 PM2 not found. Installing PM2 globally...${colors.reset}`);
    runCommand('npm install -g pm2', 'Installing PM2');
  } else {
    log(`${colors.green}✅ PM2 is already installed${colors.reset}`);
  }
}

function buildProject() {
  log(`${colors.blue}🔨 Building project...${colors.reset}`);
  return runCommand('npm run build', 'Building TypeScript project');
}

function startServices() {
  log(`${colors.blue}🚀 Starting all services...${colors.reset}`);
  
  // Start the main API
  runCommand('pm2 start ecosystem.config.js --only trustbuild-api', 'Starting TrustBuild API');
  
  // Start cron jobs
  runCommand('pm2 start ecosystem.config.js --only commission-cron', 'Starting Commission Cron');
  runCommand('pm2 start ecosystem.config.js --only final-price-timeout-cron', 'Starting Final Price Timeout Cron');
  runCommand('pm2 start ecosystem.config.js --only final-price-reminder-cron', 'Starting Final Price Reminder Cron');
  
  // Try to start job limits cron if it exists
  if (fs.existsSync(path.join(process.cwd(), 'scripts/update-job-limits.js'))) {
    runCommand('pm2 start ecosystem.config.js --only job-limits-cron', 'Starting Job Limits Cron');
  }
  
  // Save PM2 configuration
  runCommand('pm2 save', 'Saving PM2 configuration');
}

function stopServices() {
  log(`${colors.red}🛑 Stopping all services...${colors.reset}`);
  runCommand('pm2 stop all', 'Stopping all PM2 processes');
}

function restartServices() {
  log(`${colors.yellow}🔄 Restarting all services...${colors.reset}`);
  runCommand('pm2 restart all', 'Restarting all PM2 processes');
}

function showStatus() {
  log(`${colors.blue}📊 PM2 Process Status:${colors.reset}`);
  runCommand('pm2 status', 'Showing PM2 status');
  
  log(`${colors.blue}📈 PM2 Monitoring:${colors.reset}`);
  runCommand('pm2 monit', 'Opening PM2 monitoring');
}

function showLogs(service = null) {
  if (service) {
    log(`${colors.blue}📋 Showing logs for ${service}:${colors.reset}`);
    runCommand(`pm2 logs ${service} --lines 50`, `Showing logs for ${service}`);
  } else {
    log(`${colors.blue}📋 Showing logs for all services:${colors.reset}`);
    runCommand('pm2 logs --lines 50', 'Showing all logs');
  }
}

function cleanLogs() {
  log(`${colors.yellow}🧹 Cleaning PM2 logs...${colors.reset}`);
  runCommand('pm2 flush', 'Flushing PM2 logs');
}

function deleteAll() {
  log(`${colors.red}🗑️ Deleting all PM2 processes...${colors.reset}`);
  runCommand('pm2 delete all', 'Deleting all PM2 processes');
}

function setupStartup() {
  log(`${colors.blue}⚙️ Setting up PM2 startup...${colors.reset}`);
  runCommand('pm2 startup', 'Setting up PM2 startup');
}

function runCronJob(jobName) {
  const availableJobs = {
    'commission': 'scripts/commission-cron.js',
    'final-price-timeout': 'scripts/final-price-timeout-cron.js',
    'final-price-reminder': 'scripts/final-price-reminder-cron.js',
    'job-limits': 'scripts/update-job-limits.js'
  };

  if (availableJobs[jobName]) {
    log(`${colors.blue}🏃 Running ${jobName} cron job manually...${colors.reset}`);
    runCommand(`node ${availableJobs[jobName]}`, `Running ${jobName} cron job`);
  } else {
    log(`${colors.red}❌ Unknown cron job: ${jobName}${colors.reset}`);
    log(`${colors.yellow}Available jobs: ${Object.keys(availableJobs).join(', ')}${colors.reset}`);
  }
}

function showHelp() {
  log(`${colors.bright}TrustBuild PM2 Manager${colors.reset}`);
  log(`${colors.cyan}Usage: node scripts/pm2-manager.js [command]${colors.reset}\n`);
  
  log(`${colors.bright}Available Commands:${colors.reset}`);
  log(`${colors.green}  start${colors.reset}           - Build project and start all services`);
  log(`${colors.green}  stop${colors.reset}            - Stop all services`);
  log(`${colors.green}  restart${colors.reset}         - Restart all services`);
  log(`${colors.green}  status${colors.reset}          - Show status of all services`);
  log(`${colors.green}  logs [service]${colors.reset}  - Show logs (optionally for specific service)`);
  log(`${colors.green}  build${colors.reset}           - Build the project only`);
  log(`${colors.green}  install${colors.reset}         - Install PM2 globally`);
  log(`${colors.green}  setup${colors.reset}           - Setup PM2 startup`);
  log(`${colors.green}  clean${colors.reset}           - Clean PM2 logs`);
  log(`${colors.green}  delete${colors.reset}          - Delete all PM2 processes`);
  log(`${colors.green}  run [job]${colors.reset}       - Run specific cron job manually`);
  log(`${colors.green}  help${colors.reset}            - Show this help message\n`);
  
  log(`${colors.bright}Available Cron Jobs:${colors.reset}`);
  log(`${colors.yellow}  commission${colors.reset}           - Commission payment reminders`);
  log(`${colors.yellow}  final-price-timeout${colors.reset}  - Final price timeout processing`);
  log(`${colors.yellow}  final-price-reminder${colors.reset} - Final price confirmation reminders`);
  log(`${colors.yellow}  job-limits${colors.reset}           - Job limits update\n`);
  
  log(`${colors.bright}Examples:${colors.reset}`);
  log(`${colors.cyan}  node scripts/pm2-manager.js start${colors.reset}`);
  log(`${colors.cyan}  node scripts/pm2-manager.js logs trustbuild-api${colors.reset}`);
  log(`${colors.cyan}  node scripts/pm2-manager.js run commission${colors.reset}`);
}

// Main execution
function main() {
  const command = process.argv[2];
  const arg = process.argv[3];

  log(`${colors.bright}${colors.blue}🚀 TrustBuild PM2 Manager${colors.reset}\n`);

  switch (command) {
    case 'start':
      createLogsDirectory();
      installPM2();
      if (buildProject()) {
        startServices();
        showStatus();
      }
      break;
    
    case 'stop':
      stopServices();
      break;
    
    case 'restart':
      restartServices();
      showStatus();
      break;
    
    case 'status':
      showStatus();
      break;
    
    case 'logs':
      showLogs(arg);
      break;
    
    case 'build':
      buildProject();
      break;
    
    case 'install':
      installPM2();
      break;
    
    case 'setup':
      setupStartup();
      break;
    
    case 'clean':
      cleanLogs();
      break;
    
    case 'delete':
      deleteAll();
      break;
    
    case 'run':
      if (arg) {
        runCronJob(arg);
      } else {
        log(`${colors.red}❌ Please specify a cron job to run${colors.reset}`);
        log(`${colors.yellow}Available jobs: commission, final-price-timeout, final-price-reminder, job-limits${colors.reset}`);
      }
      break;
    
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    
    default:
      log(`${colors.red}❌ Unknown command: ${command || 'none'}${colors.reset}`);
      showHelp();
      process.exit(1);
  }
}

main();
