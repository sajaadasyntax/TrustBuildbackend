@echo off
REM TrustBuild PM2 Setup Script for Windows
REM This script sets up PM2 for the TrustBuild backend with all cron jobs

echo.
echo 🚀 TrustBuild PM2 Setup Script
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not installed. Please install npm first.
    pause
    exit /b 1
)

echo ✅ Node.js and npm are installed

REM Install PM2 globally if not already installed
pm2 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 🔄 Installing PM2 globally...
    npm install -g pm2
    if %errorlevel% neq 0 (
        echo ❌ Failed to install PM2
        pause
        exit /b 1
    )
    echo ✅ PM2 installed successfully
) else (
    echo ✅ PM2 is already installed
)

REM Create logs directory
echo 🔄 Creating logs directory...
if not exist "logs" mkdir logs
echo ✅ Logs directory created

REM Install project dependencies
echo 🔄 Installing project dependencies...
npm install
if %errorlevel% neq 0 (
    echo ❌ Failed to install dependencies
    pause
    exit /b 1
)
echo ✅ Dependencies installed

REM Build the project
echo 🔄 Building TypeScript project...
npm run build
if %errorlevel% neq 0 (
    echo ❌ Failed to build project
    pause
    exit /b 1
)
echo ✅ Project built successfully

REM Check if ecosystem.config.js exists
if not exist "ecosystem.config.js" (
    echo ❌ ecosystem.config.js not found. Please ensure it exists in the backend directory.
    pause
    exit /b 1
)

REM Stop any existing PM2 processes
echo 🔄 Stopping any existing PM2 processes...
pm2 stop all >nul 2>&1
pm2 delete all >nul 2>&1
echo ✅ Existing processes stopped

REM Start all services
echo 🔄 Starting all services with PM2...
pm2 start ecosystem.config.js
if %errorlevel% neq 0 (
    echo ❌ Failed to start services
    pause
    exit /b 1
)
echo ✅ All services started

REM Save PM2 configuration
echo 🔄 Saving PM2 configuration...
pm2 save
echo ✅ PM2 configuration saved

REM Show status
echo.
echo 📊 Current PM2 status:
pm2 status

echo.
echo ✅ PM2 setup completed successfully!
echo.
echo 🚀 Available PM2 Commands:
echo   pm2 status                    - Show status of all processes
echo   pm2 logs                      - Show logs for all processes
echo   pm2 logs [process-name]       - Show logs for specific process
echo   pm2 restart all               - Restart all processes
echo   pm2 restart [process-name]    - Restart specific process
echo   pm2 stop all                  - Stop all processes
echo   pm2 stop [process-name]       - Stop specific process
echo   pm2 monit                     - Open PM2 monitoring dashboard
echo   pm2 flush                     - Clean all logs
echo   pm2 delete all                - Delete all processes

echo.
echo 🚀 Available NPM Scripts:
echo   npm run pm2:start             - Start all services
echo   npm run pm2:stop              - Stop all services
echo   npm run pm2:restart           - Restart all services
echo   npm run pm2:status            - Show status
echo   npm run pm2:logs              - Show logs
echo   npm run pm2:setup             - Setup PM2 startup
echo   npm run pm2:clean             - Clean logs
echo   npm run pm2:run [job]         - Run specific cron job manually

echo.
echo ⏰ Cron Job Schedule:
echo   Commission Reminders:        Every hour (0 * * * *)
echo   Final Price Timeout:        Every hour (0 * * * *)
echo   Final Price Reminders:      Every 6 hours (0 */6 * * *)
echo   Job Limits Update:          Daily at midnight (0 0 * * *)

echo.
echo ✅ Setup complete! Your TrustBuild backend is now running with PM2.
echo.
pause
