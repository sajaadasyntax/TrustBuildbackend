/**
 * Quick script to add pricing permissions to support admins
 * This connects directly to the production database
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

async function main() {
  console.log('🔄 Updating support admin permissions...\n');

  try {
    // Get all support admins
    const supportAdmins = await prisma.admin.findMany({
      where: { role: 'SUPPORT_ADMIN' },
      select: {
        id: true,
        email: true,
        permissions: true,
      },
    });

    console.log(`Found ${supportAdmins.length} support admin(s)\n`);

    for (const admin of supportAdmins) {
      const currentPermissions = (admin.permissions as string[]) || [];
      
      // Add pricing permissions if not already present
      const newPermissions = Array.from(new Set([
        ...currentPermissions,
        'pricing:read',
        'pricing:write',
      ]));

      await prisma.admin.update({
        where: { id: admin.id },
        data: { permissions: newPermissions },
      });

      console.log(`✅ Updated ${admin.email}`);
      console.log(`   Added: pricing:read, pricing:write\n`);
    }

    console.log('✅ All support admins updated successfully!');
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

