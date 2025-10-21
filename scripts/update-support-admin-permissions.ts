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

    // Default permissions for SUPPORT_ADMIN
    const defaultSupportPermissions = [
      // Read-only access to most data
      AdminPermission.USERS_READ,
      AdminPermission.JOBS_READ,
      AdminPermission.CONTRACTORS_READ,
      AdminPermission.REVIEWS_READ,
      AdminPermission.CONTENT_READ,
      AdminPermission.PAYMENTS_READ,
      
      // Write access for support tasks
      AdminPermission.SUPPORT_READ,
      AdminPermission.SUPPORT_WRITE,
      AdminPermission.CONTENT_WRITE, // Can flag/moderate content
      AdminPermission.REVIEWS_WRITE, // Can moderate reviews
      
      // Job management (for handling customer requests)
      AdminPermission.JOBS_WRITE,
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
    
    console.log('\n💡 SUPPORT_ADMIN can now:');
    console.log('   • View all users, jobs, contractors, reviews, and payments');
    console.log('   • Flag and moderate content and reviews');
    console.log('   • Manage customer support tickets');
    console.log('   • Edit jobs (for customer support)');
    console.log('\n⚠️  SUPPORT_ADMIN CANNOT:');
    console.log('   • Delete users or jobs');
    console.log('   • Approve contractors or KYC');
    console.log('   • Manage pricing or settings');
    console.log('   • Process refunds');
    console.log('   • View security logs (SUPER_ADMIN only)');

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

