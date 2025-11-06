#!/bin/bash

# Script to fix failed migrations and resolve migration state

echo "🔧 Fixing Prisma Migration Issues..."

# Step 1: Mark the failed migration as resolved
echo "Step 1: Resolving failed migration..."
npx prisma migrate resolve --applied 20251026193512_add_kyc_insurance_support

# Step 2: Mark the other failed migration as resolved
echo "Step 2: Resolving second failed migration..."
npx prisma migrate resolve --applied 20251027090815_add_admin_enhancements_and_password_reset

# Step 3: Apply new migrations
echo "Step 3: Applying new migrations..."
npx prisma migrate deploy

echo "✅ Migration fixes complete!"

