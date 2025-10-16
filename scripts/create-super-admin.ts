import { PrismaClient, AdminRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createSuperAdmin() {
  try {
    // Configuration - CHANGE THESE VALUES
    const superAdminData = {
      email: 'admin@trustbuild.uk', // ⚠️ CHANGE THIS
      name: 'Super Admin',           // ⚠️ CHANGE THIS
      password: 'ChangeMe123!',      // ⚠️ CHANGE THIS IMMEDIATELY
    };

    console.log('🔍 Checking for existing SUPER_ADMIN...');

    // Check if SUPER_ADMIN already exists
    const existingAdmin = await prisma.admin.findUnique({
      where: { email: superAdminData.email },
    });

    if (existingAdmin) {
      console.log('⚠️  SUPER_ADMIN with this email already exists!');
      console.log(`   Email: ${existingAdmin.email}`);
      console.log(`   Role: ${existingAdmin.role}`);
      console.log(`   Created: ${existingAdmin.createdAt}`);
      console.log('\n💡 If you need to reset the password, use the password reset script.');
      return;
    }

    console.log('✨ Creating new SUPER_ADMIN...');

    // Hash the password
    const passwordHash = await bcrypt.hash(superAdminData.password, 12);

    // Create SUPER_ADMIN
    const admin = await prisma.admin.create({
      data: {
        email: superAdminData.email,
        name: superAdminData.name,
        passwordHash: passwordHash,
        role: AdminRole.SUPER_ADMIN,
        // permissions omitted - SUPER_ADMIN doesn't need specific permissions (defaults to null)
        isActive: true,
        twoFAEnabled: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    console.log('\n✅ SUPER_ADMIN created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email:', admin.email);
    console.log('👤 Name:', admin.name);
    console.log('🔑 Role:', admin.role);
    console.log('📅 Created:', admin.createdAt);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n⚠️  IMPORTANT SECURITY STEPS:');
    console.log('1. Login with these credentials');
    console.log('2. Change your password IMMEDIATELY via /profile');
    console.log('3. Enable 2FA for additional security');
    console.log('4. Delete or restrict access to this script');
    console.log('\n🚀 Login URL: https://www.trustbuild.uk/login');
    console.log('   or: http://localhost:3000/login (for development)');

  } catch (error) {
    console.error('❌ Error creating SUPER_ADMIN:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createSuperAdmin()
  .then(() => {
    console.log('\n✨ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });

