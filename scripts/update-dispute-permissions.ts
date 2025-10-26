import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateDisputePermissions() {
  try {
    console.log('🔄 Updating admin permissions for dispute management...\n');

    // Get all admins
    const admins = await prisma.admin.findMany();

    for (const admin of admins) {
      const currentPermissions = (admin.permissions as string[]) || [];
      
      // Add dispute permissions if not already present
      const disputePermissions = ['disputes:read', 'disputes:write', 'disputes:resolve'];
      const updatedPermissions = [...new Set([...currentPermissions, ...disputePermissions])];

      if (admin.role === 'SUPER_ADMIN') {
        // Super admins get all permissions
        await prisma.admin.update({
          where: { id: admin.id },
          data: { permissions: updatedPermissions },
        });
        console.log(`✅ Updated permissions for SUPER_ADMIN: ${admin.name} (${admin.email})`);
      } else if (admin.role === 'SUPPORT_ADMIN') {
        // Support admins get read and write permissions
        const supportPermissions = [...currentPermissions, 'disputes:read', 'disputes:write', 'disputes:resolve'];
        await prisma.admin.update({
          where: { id: admin.id },
          data: { permissions: [...new Set(supportPermissions)] },
        });
        console.log(`✅ Updated permissions for SUPPORT_ADMIN: ${admin.name} (${admin.email})`);
      } else {
        console.log(`ℹ️  Skipped ${admin.role}: ${admin.name} (${admin.email}) - Manual review required`);
      }
    }

    console.log('\n✅ Admin permissions updated successfully!');
  } catch (error) {
    console.error('❌ Error updating admin permissions:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateDisputePermissions();

