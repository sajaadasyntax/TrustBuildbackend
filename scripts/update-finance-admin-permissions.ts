import { PrismaClient, AdminRole } from '@prisma/client';
import { AdminPermission } from '../src/config/permissions';

const prisma = new PrismaClient();

/**
 * Update Finance Admin with proper permissions
 * 
 * FINANCE_ADMIN has access to these sections ONLY:
 * 1. Contractor Management
 * 2. Job Oversight
 * 3. Payment Dashboard
 * 4. Platform Settings
 * 5. User Management
 */

async function updateFinanceAdminPermissions() {
  try {
    console.log('🔍 Finding FINANCE_ADMIN users...\n');

    // Find all FINANCE_ADMIN users
    const financeAdmins = await prisma.admin.findMany({
      where: {
        role: AdminRole.FINANCE_ADMIN,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        permissions: true,
        isActive: true,
      },
    });

    if (financeAdmins.length === 0) {
      console.log('⚠️  No FINANCE_ADMIN users found');
      return;
    }

    console.log(`✨ Found ${financeAdmins.length} FINANCE_ADMIN user(s)\n`);

    // FINANCE_ADMIN - Access ONLY these sections:
    // 1. User Management
    // 2. Contractor Management
    // 3. Job Oversight
    // 4. Payment Dashboard
    // 5. Platform Settings
    const defaultFinancePermissions = [
      // User Management
      AdminPermission.USERS_READ,
      AdminPermission.USERS_WRITE,
      
      // Contractor Management
      AdminPermission.CONTRACTORS_READ,
      AdminPermission.CONTRACTORS_WRITE,
      AdminPermission.CONTRACTORS_APPROVE, // Can approve contractor applications
      
      // KYC (part of contractor management)
      AdminPermission.KYC_READ,
      AdminPermission.KYC_WRITE,
      AdminPermission.KYC_APPROVE, // Can approve KYC submissions
      
      // Job Oversight
      AdminPermission.JOBS_READ,
      AdminPermission.JOBS_WRITE,
      AdminPermission.PRICING_READ,
      AdminPermission.PRICING_WRITE, // Can update job lead prices
      
      // Payment Dashboard (full access)
      AdminPermission.PAYMENTS_READ,
      AdminPermission.PAYMENTS_WRITE,
      AdminPermission.PAYMENTS_REFUND, // Can process refunds
      
      // Platform Settings
      AdminPermission.SETTINGS_READ,
      AdminPermission.SETTINGS_WRITE,
      
      // Final Price Management (financial oversight)
      AdminPermission.FINAL_PRICE_READ,
      AdminPermission.FINAL_PRICE_WRITE,
    ];

    // Update each FINANCE_ADMIN
    for (const admin of financeAdmins) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📧 Email: ${admin.email}`);
      console.log(`👤 Name: ${admin.name}`);
      console.log(`🔑 Role: ${admin.role}`);
      
      const updatedAdmin = await prisma.admin.update({
        where: { id: admin.id },
        data: {
          permissions: defaultFinancePermissions,
        },
      });

      console.log(`✅ Updated with ${defaultFinancePermissions.length} permissions`);
      console.log('');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n✅ All FINANCE_ADMIN permissions updated successfully!');
    console.log('\n📋 Assigned permissions:');
    defaultFinancePermissions.forEach(permission => {
      console.log(`   ✓ ${permission}`);
    });
    
    console.log('\n💡 FINANCE_ADMIN has access to these sections ONLY:');
    console.log('   1️⃣  User Management - View and edit user accounts');
    console.log('   2️⃣  Contractor Management - Approve contractors, manage KYC');
    console.log('   3️⃣  Job Oversight - View and manage jobs, set lead prices');
    console.log('   4️⃣  Payment Dashboard - View payments, process refunds, manage invoices');
    console.log('   5️⃣  Platform Settings - Configure platform settings and pricing');
    console.log('\n⚠️  FINANCE_ADMIN CANNOT ACCESS:');
    console.log('   ✗ Review Management');
    console.log('   ✗ Content Moderation');
    console.log('   ✗ Security Logs (SUPER_ADMIN only)');
    console.log('\n✅ Principle: Finance admins have ALL permissions for their 5 designated sections!');

  } catch (error) {
    console.error('❌ Error updating FINANCE_ADMIN permissions:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

updateFinanceAdminPermissions()
  .then(() => {
    console.log('\n✨ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });

