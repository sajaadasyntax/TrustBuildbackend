# Cron Jobs Setup Guide

This guide explains how to set up and run the automated cron jobs for the TrustBuild platform.

## Available Cron Jobs

### 1. Commission Payment Reminders
- **Script**: `scripts/commission-cron.js`
- **Purpose**: Sends reminder emails for overdue commission payments
- **Frequency**: Every hour
- **Command**: `npm run cron:commission`

### 2. Final Price Timeout Processing
- **Script**: `scripts/final-price-timeout-cron.js`
- **Purpose**: Auto-confirms final prices for jobs where customers haven't responded within 7 days
- **Frequency**: Every hour
- **Command**: `npm run cron:final-price-timeout`

## Setup Instructions

### Option 1: Manual Testing
Run the cron jobs manually for testing:

```bash
# Build the project first
npm run build

# Run commission reminders
npm run cron:commission

# Run final price timeout processing
npm run cron:final-price-timeout
```

### Option 2: System Cron (Linux/macOS)
Add these lines to your crontab (`crontab -e`):

```bash
# Commission payment reminders - every hour
0 * * * * cd /path/to/backend && /usr/bin/node scripts/commission-cron.js

# Final price timeout processing - every hour
0 * * * * cd /path/to/backend && /usr/bin/node scripts/final-price-timeout-cron.js
```

### Option 3: Windows Task Scheduler
1. Open Task Scheduler
2. Create Basic Task
3. Set trigger to "Daily" with "Repeat task every: 1 hour"
4. Set action to "Start a program"
5. Program: `node`
6. Arguments: `scripts/final-price-timeout-cron.js`
7. Start in: `C:\path\to\backend`

### Option 4: PM2 Process Manager (Recommended)

#### Quick Setup
Use the automated setup script:

**Linux/macOS:**
```bash
chmod +x scripts/setup-pm2.sh
./scripts/setup-pm2.sh
```

**Windows:**
```cmd
scripts\setup-pm2.bat
```

#### Manual Setup
Install PM2 globally:
```bash
npm install -g pm2
```

The ecosystem file is already created at `ecosystem.config.js` with the following services:
- **trustbuild-api**: Main API server
- **commission-cron**: Commission payment reminders (every hour)
- **final-price-timeout-cron**: Final price timeout processing (every hour)
- **final-price-reminder-cron**: Final price confirmation reminders (every 6 hours)
- **job-limits-cron**: Job limits update (daily at midnight)

Start with PM2:
```bash
# Build the project first
npm run build

# Start all services
pm2 start ecosystem.config.js

# Save configuration
pm2 save

# Setup startup (optional)
pm2 startup
```

#### PM2 Management Commands
```bash
# Using NPM scripts (recommended)
npm run pm2:start      # Start all services
npm run pm2:stop       # Stop all services
npm run pm2:restart    # Restart all services
npm run pm2:status     # Show status
npm run pm2:logs       # Show logs
npm run pm2:setup      # Setup PM2 startup
npm run pm2:clean      # Clean logs
npm run pm2:run [job]  # Run specific cron job manually

# Using PM2 directly
pm2 status             # Show status
pm2 logs               # Show logs
pm2 logs [service]     # Show logs for specific service
pm2 restart all        # Restart all
pm2 restart [service]  # Restart specific service
pm2 stop all           # Stop all
pm2 monit              # Open monitoring dashboard
pm2 flush              # Clean all logs
```

## Monitoring

### Log Files
Cron jobs output to console. For production, redirect to log files:

```bash
# Add to crontab
0 * * * * cd /path/to/backend && /usr/bin/node scripts/commission-cron.js >> logs/commission-cron.log 2>&1
0 * * * * cd /path/to/backend && /usr/bin/node scripts/final-price-timeout-cron.js >> logs/final-price-timeout-cron.log 2>&1
```

### Health Checks
Monitor cron job execution by checking:
1. Log files for successful completion messages
2. Database for updated job statuses
3. Email delivery for notifications

## Troubleshooting

### Common Issues

1. **Permission Denied**
   - Ensure the script has execute permissions: `chmod +x scripts/*.js`

2. **Module Not Found**
   - Run `npm run build` to compile TypeScript
   - Ensure all dependencies are installed

3. **Database Connection Issues**
   - Check `.env` file configuration
   - Verify database server is running

4. **Email Sending Failures**
   - Check SendGrid API key configuration
   - Verify email service settings

### Testing
Test individual functions:
```bash
# Test commission processing
node -e "require('./dist/src/services/commissionService').processCommissionReminders()"

# Test final price timeout processing
node -e "require('./dist/src/services/finalPriceTimeoutService').processFinalPriceTimeouts()"
```

## Security Considerations

1. **Environment Variables**: Never hardcode sensitive data in cron scripts
2. **File Permissions**: Restrict access to cron scripts and log files
3. **Error Handling**: Scripts exit with appropriate codes for monitoring
4. **Resource Limits**: Consider memory and CPU usage for large datasets

## Production Deployment

For production environments:

1. Use a process manager like PM2 or systemd
2. Set up proper logging and monitoring
3. Configure alerts for job failures
4. Test thoroughly in staging environment
5. Have rollback procedures ready

## Support

For issues with cron jobs:
1. Check the logs first
2. Verify database connectivity
3. Test email configuration
4. Review environment variables
5. Contact the development team
