#!/bin/bash

# ============================================================================
# Apply Admin Permissions Update Script
# ============================================================================
# This script applies the admin permission updates directly to your database
# from Ubuntu/Linux command line.
#
# Prerequisites:
# - psql installed: sudo apt-get install postgresql-client
# - DATABASE_URL in your .env file
# ============================================================================

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    TrustBuild Admin Permissions Update Script             ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ Error: .env file not found in current directory${NC}"
    echo -e "${YELLOW}💡 Make sure you're running this from the backend/ directory${NC}"
    exit 1
fi

# Load DATABASE_URL from .env
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)

if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}❌ Error: DATABASE_URL not found in .env file${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Found DATABASE_URL in .env"
echo ""

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo -e "${RED}❌ Error: psql is not installed${NC}"
    echo -e "${YELLOW}💡 Install it with: sudo apt-get install postgresql-client${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} PostgreSQL client (psql) is installed"
echo ""

# Check if SQL file exists
SQL_FILE="UPDATE_ALL_ADMIN_PERMISSIONS.sql"
if [ ! -f "$SQL_FILE" ]; then
    echo -e "${RED}❌ Error: $SQL_FILE not found${NC}"
    echo -e "${YELLOW}💡 Make sure the file exists in the backend/ directory${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Found SQL file: $SQL_FILE"
echo ""

# Show what will be updated
echo -e "${YELLOW}📋 This script will update permissions for:${NC}"
echo "   • SUPPORT_ADMIN (6 sections access)"
echo "   • FINANCE_ADMIN (5 sections access)"
echo ""

# Ask for confirmation
read -p "Do you want to proceed? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⚠️  Operation cancelled${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}🚀 Applying permissions update...${NC}"
echo ""

# Execute the SQL file
psql "$DATABASE_URL" -f "$SQL_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              ✅ Permissions Updated Successfully!          ║${NC}"
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo ""
    echo -e "${YELLOW}📝 Next steps:${NC}"
    echo "   1. Log out from the admin panel"
    echo "   2. Clear browser localStorage (F12 → Application → Clear)"
    echo "   3. Log back in with your admin account"
    echo "   4. Verify you only see your designated sections"
    echo ""
    echo -e "${GREEN}🎉 Done!${NC}"
else
    echo ""
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║              ❌ Error Applying Permissions                 ║${NC}"
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo ""
    echo -e "${YELLOW}💡 Check the error message above for details${NC}"
    exit 1
fi

