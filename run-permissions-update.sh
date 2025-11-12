#!/bin/bash

# Script to update admin permissions
# Usage: ./run-permissions-update.sh

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL environment variable is not set"
    echo "Please set it with: export DATABASE_URL='your-connection-string'"
    exit 1
fi

# Run the SQL script
echo "🔄 Updating admin permissions..."
psql "$DATABASE_URL" -f prisma/UPDATE_ALL_ADMIN_PERMISSIONS.sql

if [ $? -eq 0 ]; then
    echo "✅ Admin permissions updated successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Log out all admins from the admin panel"
    echo "2. Clear browser localStorage"
    echo "3. Log back in with the appropriate role"
    echo "4. Verify access to only the designated sections"
else
    echo "❌ Error updating permissions. Please check the error message above."
    exit 1
fi


