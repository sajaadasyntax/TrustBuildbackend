#!/bin/bash

# ==============================================================
# TrustBuild Backend - Production Deployment Commands
# ==============================================================
# This script contains the commands to deploy the admin system
# migration and seed the database on production.
#
# Run this on your production server:
# root@ubuntu-s-2vcpu-2gb-lon1-01:/var/www/api.trustbuild.uk/TrustBuildbackend#
# ==============================================================

set -e  # Exit on error

echo "🚀 Starting TrustBuild Admin System Deployment..."
echo ""

# Step 1: Pull latest code
echo "📥 Step 1: Pulling latest code from repository..."
git pull origin main
echo "✅ Code updated"
echo ""

# Step 2: Install dependencies
echo "📦 Step 2: Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Step 3: Generate Prisma Client
echo "🔧 Step 3: Generating Prisma Client..."
npx prisma generate
echo "✅ Prisma Client generated"
echo ""

# Step 4: Deploy migration
echo "🗄️  Step 4: Deploying database migration..."
npx prisma migrate deploy
echo "✅ Migration deployed"
echo ""

# Step 5: Run seed script
echo "🌱 Step 5: Seeding database..."
npx tsx prisma/seed.ts
echo "✅ Database seeded"
echo ""

# Step 6: Restart PM2 processes
echo "♻️  Step 6: Restarting application..."
pm2 restart all
echo "✅ Application restarted"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "✅ DEPLOYMENT COMPLETE!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "🔐 Admin Login Credentials:"
echo "   URL: https://www.trustbuild.uk/admin/login"
echo ""
echo "   Super Admin:"
echo "   Email: superadmin@trustbuild.uk"
echo "   Password: SuperAdmin@2024!"
echo ""
echo "   Finance Admin:"
echo "   Email: finance@trustbuild.uk"
echo "   Password: FinanceAdmin@2024!"
echo ""
echo "   Support Admin:"
echo "   Email: support@trustbuild.uk"
echo "   Password: SupportAdmin@2024!"
echo ""
echo "⚠️  IMPORTANT: Change these passwords immediately after login!"
echo ""
echo "🔍 Verify deployment:"
echo "   pm2 status"
echo "   pm2 logs api"
echo ""
echo "═══════════════════════════════════════════════════════════"

