#!/bin/bash

# TrustBuild PM2 Setup Script
# This script sets up PM2 for the TrustBuild backend with all cron jobs

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}🔄 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header() {
    echo -e "${CYAN}🚀 $1${NC}"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root"
   exit 1
fi

print_header "TrustBuild PM2 Setup Script"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

print_success "Node.js and npm are installed"

# Install PM2 globally if not already installed
if ! command -v pm2 &> /dev/null; then
    print_status "Installing PM2 globally..."
    npm install -g pm2
    print_success "PM2 installed successfully"
else
    print_success "PM2 is already installed"
fi

# Create logs directory
print_status "Creating logs directory..."
mkdir -p logs
print_success "Logs directory created"

# Install project dependencies
print_status "Installing project dependencies..."
npm install
print_success "Dependencies installed"

# Build the project
print_status "Building TypeScript project..."
npm run build
print_success "Project built successfully"

# Check if ecosystem.config.js exists
if [ ! -f "ecosystem.config.js" ]; then
    print_error "ecosystem.config.js not found. Please ensure it exists in the backend directory."
    exit 1
fi

# Stop any existing PM2 processes
print_status "Stopping any existing PM2 processes..."
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true
print_success "Existing processes stopped"

# Start all services
print_status "Starting all services with PM2..."
pm2 start ecosystem.config.js
print_success "All services started"

# Save PM2 configuration
print_status "Saving PM2 configuration..."
pm2 save
print_success "PM2 configuration saved"

# Setup PM2 startup (optional)
read -p "Do you want to setup PM2 to start on system boot? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_status "Setting up PM2 startup..."
    pm2 startup
    print_warning "Please run the command shown above as root to complete startup setup"
fi

# Show status
print_status "Current PM2 status:"
pm2 status

print_success "PM2 setup completed successfully!"
print_header "Available PM2 Commands:"
echo -e "${CYAN}  pm2 status${NC}                    - Show status of all processes"
echo -e "${CYAN}  pm2 logs${NC}                      - Show logs for all processes"
echo -e "${CYAN}  pm2 logs [process-name]${NC}       - Show logs for specific process"
echo -e "${CYAN}  pm2 restart all${NC}               - Restart all processes"
echo -e "${CYAN}  pm2 restart [process-name]${NC}    - Restart specific process"
echo -e "${CYAN}  pm2 stop all${NC}                  - Stop all processes"
echo -e "${CYAN}  pm2 stop [process-name]${NC}       - Stop specific process"
echo -e "${CYAN}  pm2 monit${NC}                     - Open PM2 monitoring dashboard"
echo -e "${CYAN}  pm2 flush${NC}                     - Clean all logs"
echo -e "${CYAN}  pm2 delete all${NC}                - Delete all processes"

print_header "Available NPM Scripts:"
echo -e "${CYAN}  npm run pm2:start${NC}             - Start all services"
echo -e "${CYAN}  npm run pm2:stop${NC}              - Stop all services"
echo -e "${CYAN}  npm run pm2:restart${NC}           - Restart all services"
echo -e "${CYAN}  npm run pm2:status${NC}            - Show status"
echo -e "${CYAN}  npm run pm2:logs${NC}              - Show logs"
echo -e "${CYAN}  npm run pm2:setup${NC}             - Setup PM2 startup"
echo -e "${CYAN}  npm run pm2:clean${NC}             - Clean logs"
echo -e "${CYAN}  npm run pm2:run [job]${NC}         - Run specific cron job manually"

print_header "Cron Job Schedule:"
echo -e "${YELLOW}  Commission Reminders:${NC}        Every hour (0 * * * *)"
echo -e "${YELLOW}  Final Price Timeout:${NC}        Every hour (0 * * * *)"
echo -e "${YELLOW}  Final Price Reminders:${NC}      Every 6 hours (0 */6 * * *)"
echo -e "${YELLOW}  Job Limits Update:${NC}          Daily at midnight (0 0 * * *)"

print_success "Setup complete! Your TrustBuild backend is now running with PM2."
