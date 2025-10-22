import { PrismaClient, AdminRole } from '@prisma/client';
import { AdminPermission } from '../src/config/permissions';

const prisma = new PrismaClient();

/**
 * Update Support Admin with proper permissions
 * 
 * This script assigns appropriate permissions to SUPPORT_ADMIN users
 * so they can view and manage content, reviews, and support tickets.
 */

async function updateSupportAdminPermissions() {
  try {
    console.log('🔍 Finding SUPPORT_ADMIN users...\n');

    // Find all SUPPORT_ADMIN users
    const supportAdmins = await prisma.admin.findMany({
      where: {
        role: AdminRole.SUPPORT_ADMIN,
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

    if (supportAdmins.length === 0) {
      console.log('⚠️  No SUPPORT_ADMIN users found');
      console.log('💡 Support admins should be created first via the admin panel');
      return;
    }

    console.log(`✨ Found ${supportAdmins.length} SUPPORT_ADMIN user(s)\n`);

    // SUPPORT_ADMIN - Access ONLY these sections:
    // 1. Contractor Management
    // 2. Job Oversight
    // 3. Review Management
    // 4. User Management
    // 5. Content Moderation
    // 6. KYC Review
    const defaultSupportPermissions = [
      // User Management
      AdminPermission.USERS_READ,
      AdminPermission.USERS_WRITE,
      
      // Contractor Management
      AdminPermission.CONTRACTORS_READ,
      AdminPermission.CONTRACTORS_WRITE,
      
      // KYC Review
      AdminPermission.KYC_READ,
      AdminPermission.KYC_WRITE,
      
      // Job Oversight (view and manage jobs for support)
      AdminPermission.JOBS_READ,
      AdminPermission.JOBS_WRITE,
      AdminPermission.PRICING_READ,
      AdminPermission.PRICING_WRITE, // Can update job lead prices
      
      // Review Management
      AdminPermission.REVIEWS_READ,
      AdminPermission.REVIEWS_WRITE,
      
      // Content Moderation
      AdminPermission.CONTENT_READ,
      AdminPermission.CONTENT_WRITE,
      
      // Support (internal - not a visible section but needed for tickets)
      AdminPermission.SUPPORT_READ,
      AdminPermission.SUPPORT_WRITE,
    ];

    // Update each SUPPORT_ADMIN
    for (const admin of supportAdmins) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📧 Email: ${admin.email}`);
      console.log(`👤 Name: ${admin.name}`);
      console.log(`🔑 Role: ${admin.role}`);
      console.log(`📝 Current permissions: ${admin.permissions ? JSON.stringify(admin.permissions).length : 0} chars`);
      
      const updatedAdmin = await prisma.admin.update({
        where: { id: admin.id },
        data: {
          permissions: defaultSupportPermissions,
        },
        select: {
          id: true,
          email: true,
          name: true,
          permissions: true,
        },
      });

      console.log(`✅ Updated with ${defaultSupportPermissions.length} permissions:`);
      console.log(defaultSupportPermissions.map(p => `   - ${p}`).join('\n'));
      console.log('');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n✅ All SUPPORT_ADMIN permissions updated successfully!');
    console.log('\n📋 Assigned permissions:');
    defaultSupportPermissions.forEach(permission => {
      console.log(`   ✓ ${permission}`);
    });
    
    console.log('\n💡 SUPPORT_ADMIN has access to these sections ONLY:');
    console.log('   1️⃣  User Management - View and edit user accounts');
    console.log('   2️⃣  Contractor Management - View and edit contractor profiles');
    console.log('   3️⃣  KYC Review - View KYC submissions and request updates');
    console.log('   4️⃣  Job Oversight - View, edit, flag jobs, set lead prices');
    console.log('   5️⃣  Review Management - View and moderate reviews');
    console.log('   6️⃣  Content Moderation - Manage FAQ, featured contractors, flagged content');
    console.log('\n⚠️  SUPPORT_ADMIN CANNOT ACCESS:');
    console.log('   ✗ Payment Dashboard');
    console.log('   ✗ Platform Settings');
    console.log('   ✗ Invoice Management');
    console.log('   ✗ Pricing Management');
    console.log('   ✗ Security Logs');
    console.log('   ✗ Final Price Confirmations');
    console.log('\n✅ Principle: Support admins have ALL permissions for their 6 designated sections!');

  } catch (error) {
    console.error('❌ Error updating SUPPORT_ADMIN permissions:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

updateSupportAdminPermissions()
  .then(() => {
    console.log('\n✨ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });

