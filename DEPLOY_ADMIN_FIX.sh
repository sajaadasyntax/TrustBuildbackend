#!/bin/bash

# Admin Dashboard 404 Fix - Deployment Script
# This script fixes the route ordering issue causing admin dashboard to return 404

echo "🔧 Starting Admin Dashboard Fix Deployment..."
echo "=============================================="

# Stop PM2 processes
echo ""
echo "📊 Stopping PM2 processes..."
pm2 stop all

# Pull latest changes
echo ""
echo "📥 Pulling latest changes from repository..."
git fetch
git pull origin master

# Install dependencies (in case any were updated)
echo ""
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo ""
echo "🔨 Building TypeScript..."
npm run build

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
else
    echo "❌ Build failed! Please check the errors above."
    exit 1
fi

# Restart PM2 processes
echo ""
echo "🚀 Restarting PM2 processes..."
pm2 restart all

# Check PM2 status
echo ""
echo "📊 PM2 Status:"
pm2 status

# Save PM2 configuration
echo ""
echo "💾 Saving PM2 configuration..."
pm2 save

echo ""
echo "=============================================="
echo "✅ Deployment complete!"
echo ""
echo "🔍 Check the logs with: pm2 logs api"
echo "📊 Check the status with: pm2 status"
echo ""
echo "Expected fix: /api/admin/dashboard should now return proper stats instead of 404"

