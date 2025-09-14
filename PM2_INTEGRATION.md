# PM2 Integration Guide

This guide explains how to use PM2 to manage the TrustBuild backend API and all cron jobs.

## 🚀 Quick Start

### Automated Setup (Recommended)

**Windows:**
```cmd
scripts\setup-pm2.bat
```

**Linux/macOS:**
```bash
chmod +x scripts/setup-pm2.sh
./scripts/setup-pm2.sh
```

### Manual Setup

1. **Install PM2 globally:**
   ```bash
   npm install -g pm2
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

3. **Start all services:**
   ```bash
   pm2 start ecosystem.config.js
   ```

4. **Save configuration:**
   ```bash
   pm2 save
   ```

## 📋 Services Overview

| Service | Description | Schedule | Memory Limit |
|---------|-------------|----------|--------------|
| `trustbuild-api` | Main API server | Always running | 1GB |
| `commission-cron` | Commission payment reminders | Every hour | 512MB |
| `final-price-timeout-cron` | Final price timeout processing | Every hour | 512MB |
| `final-price-reminder-cron` | Final price confirmation reminders | Every 6 hours | 512MB |
| `job-limits-cron` | Job limits update | Daily at midnight | 256MB |

## 🛠️ Management Commands

### Using NPM Scripts (Recommended)

```bash
# Service Management
npm run pm2:start      # Start all services
npm run pm2:stop       # Stop all services
npm run pm2:restart    # Restart all services
npm run pm2:status     # Show status of all services

# Monitoring
npm run pm2:logs       # Show logs for all services
npm run pm2:logs [service]  # Show logs for specific service

# Maintenance
npm run pm2:setup      # Setup PM2 startup
npm run pm2:clean      # Clean PM2 logs
npm run pm2:delete     # Delete all PM2 processes

# Manual Execution
npm run pm2:run commission           # Run commission cron manually
npm run pm2:run final-price-timeout  # Run final price timeout manually
npm run pm2:run final-price-reminder # Run final price reminder manually
npm run pm2:run job-limits           # Run job limits update manually
```

### Using PM2 Directly

```bash
# Service Management
pm2 start ecosystem.config.js        # Start all services
pm2 start ecosystem.config.js --only trustbuild-api  # Start specific service
pm2 stop all                         # Stop all services
pm2 stop [service-name]              # Stop specific service
pm2 restart all                      # Restart all services
pm2 restart [service-name]           # Restart specific service
pm2 delete all                       # Delete all services
pm2 delete [service-name]            # Delete specific service

# Monitoring
pm2 status                           # Show status
pm2 logs                             # Show logs for all services
pm2 logs [service-name]              # Show logs for specific service
pm2 logs [service-name] --lines 100  # Show last 100 lines
pm2 monit                            # Open monitoring dashboard

# Maintenance
pm2 save                             # Save current configuration
pm2 startup                          # Setup startup script
pm2 flush                            # Clean all logs
pm2 reload all                       # Reload all services (zero-downtime)
```

## 📊 Monitoring

### Real-time Monitoring
```bash
pm2 monit
```
This opens a real-time monitoring dashboard showing:
- CPU and memory usage
- Process status
- Log output
- Error counts

### Log Management
```bash
# View logs
pm2 logs                           # All services
pm2 logs trustbuild-api           # API server only
pm2 logs commission-cron          # Commission cron only

# Log files location
logs/
├── api-error.log
├── api-out.log
├── api-combined.log
├── commission-cron-error.log
├── commission-cron-out.log
├── final-price-cron-error.log
├── final-price-cron-out.log
└── ...
```

### Health Checks
```bash
# Check if all services are running
pm2 status

# Check specific service
pm2 show trustbuild-api

# View process information
pm2 info trustbuild-api
```

## ⚙️ Configuration

### Ecosystem Configuration
The `ecosystem.config.js` file contains all service configurations:

```javascript
module.exports = {
  apps: [
    {
      name: 'trustbuild-api',
      script: 'dist/src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      }
    },
    // ... other services
  ]
};
```

### Environment Variables
Each service can have its own environment variables:

```javascript
{
  name: 'trustbuild-api',
  env: {
    NODE_ENV: 'production',
    PORT: 5000
  },
  env_development: {
    NODE_ENV: 'development',
    PORT: 5000
  }
}
```

## 🔄 Cron Job Schedules

| Job | Schedule | Description |
|-----|----------|-------------|
| Commission Reminders | `0 * * * *` | Every hour at minute 0 |
| Final Price Timeout | `0 * * * *` | Every hour at minute 0 |
| Final Price Reminders | `0 */6 * * *` | Every 6 hours |
| Job Limits Update | `0 0 * * *` | Daily at midnight |

## 🚨 Troubleshooting

### Common Issues

1. **Service won't start:**
   ```bash
   pm2 logs [service-name]  # Check logs for errors
   pm2 show [service-name]  # Check configuration
   ```

2. **Memory issues:**
   ```bash
   pm2 restart [service-name]  # Restart service
   pm2 reload [service-name]   # Zero-downtime restart
   ```

3. **Cron jobs not running:**
   ```bash
   pm2 logs commission-cron  # Check cron job logs
   npm run pm2:run commission  # Test manually
   ```

4. **Database connection issues:**
   - Check `.env` file configuration
   - Verify database server is running
   - Check network connectivity

### Log Analysis

```bash
# Filter error logs
pm2 logs --err

# Filter output logs
pm2 logs --out

# Follow logs in real-time
pm2 logs --follow

# Show logs with timestamps
pm2 logs --timestamp
```

## 🔧 Advanced Configuration

### Custom Cron Schedules
Edit `ecosystem.config.js` to modify cron schedules:

```javascript
{
  name: 'commission-cron',
  cron_restart: '0 */2 * * *',  // Every 2 hours
  // ... other config
}
```

### Resource Limits
Adjust memory limits based on your server capacity:

```javascript
{
  name: 'trustbuild-api',
  max_memory_restart: '2G',  // Increase to 2GB
  // ... other config
}
```

### Clustering
For high-traffic scenarios, you can cluster the API:

```javascript
{
  name: 'trustbuild-api',
  instances: 4,              // 4 instances
  exec_mode: 'cluster',      // Cluster mode
  // ... other config
}
```

## 📈 Production Deployment

### Server Setup
1. Install Node.js and npm
2. Clone the repository
3. Install dependencies: `npm install`
4. Configure environment variables
5. Run the setup script: `./scripts/setup-pm2.sh`

### Startup Configuration
```bash
pm2 startup
# Follow the instructions to enable startup
pm2 save
```

### Monitoring Setup
- Set up log rotation
- Configure monitoring alerts
- Set up health check endpoints
- Monitor resource usage

## 🔒 Security Considerations

1. **File Permissions:**
   ```bash
   chmod 600 ecosystem.config.js
   chmod 700 scripts/
   ```

2. **Environment Variables:**
   - Never commit `.env` files
   - Use secure environment variable management
   - Rotate secrets regularly

3. **Log Security:**
   - Restrict log file access
   - Monitor log files for sensitive data
   - Implement log rotation

## 📞 Support

For issues with PM2 integration:

1. Check the logs first: `pm2 logs`
2. Verify service status: `pm2 status`
3. Test manual execution: `npm run pm2:run [job]`
4. Check system resources: `pm2 monit`
5. Review configuration: `pm2 show [service]`

## 📚 Additional Resources

- [PM2 Documentation](https://pm2.keymetrics.io/docs/)
- [PM2 Ecosystem File](https://pm2.keymetrics.io/docs/usage/application-declaration/)
- [PM2 Monitoring](https://pm2.keymetrics.io/docs/usage/monitoring/)
- [PM2 Logs](https://pm2.keymetrics.io/docs/usage/log-management/)
