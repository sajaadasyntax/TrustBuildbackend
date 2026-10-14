import { PrismaClient, AdminRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedServices } from './seed-services';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting platform data seeding...\n');

  console.log('👑 Creating admin accounts...');

  const superAdminPassword = await bcrypt.hash('SuperAdmin@2024!', 12);
  const superAdmin = await prisma.admin.upsert({
    where: { email: 'superadmin@trustbuild.uk' },
    update: {
      isMainSuperAdmin: true,
    },
    create: {
      email: 'superadmin@trustbuild.uk',
      passwordHash: superAdminPassword,
      name: 'Super Administrator',
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
      isMainSuperAdmin: true,
    },
  });
  console.log('  ✅ Main Super Admin created:', superAdmin.email);

  const financeAdminPassword = await bcrypt.hash('FinanceAdmin@2024!', 12);
  const financeAdmin = await prisma.admin.upsert({
    where: { email: 'finance@trustbuild.uk' },
    update: {},
    create: {
      email: 'finance@trustbuild.uk',
      passwordHash: financeAdminPassword,
      name: 'Finance Administrator',
      role: AdminRole.FINANCE_ADMIN,
      isActive: true,
    },
  });
  console.log('  ✅ Finance Admin created:', financeAdmin.email);

  const supportAdminPassword = await bcrypt.hash('SupportAdmin@2024!', 12);
  const supportAdmin = await prisma.admin.upsert({
    where: { email: 'support@trustbuild.uk' },
    update: {},
    create: {
      email: 'support@trustbuild.uk',
      passwordHash: supportAdminPassword,
      name: 'Support Administrator',
      role: AdminRole.SUPPORT_ADMIN,
      isActive: true,
    },
  });
  console.log('  ✅ Support Admin created:', supportAdmin.email);

  console.log('\n⚙️  Creating system settings...');

  await prisma.setting.upsert({
    where: { key: 'COMMISSION_RATE' },
    update: {},
    create: {
      key: 'COMMISSION_RATE',
      value: { rate: 5.0, description: 'Commission rate percentage charged on completed jobs' },
      updatedBy: superAdmin.id,
    },
  });

  await prisma.setting.upsert({
    where: { key: 'FREE_JOB_ALLOCATION' },
    update: {},
    create: {
      key: 'FREE_JOB_ALLOCATION',
      value: {
        standard: 0,
        premium: 2,
        enterprise: 5,
        description: 'Free job leads allocated per contractor tier',
      },
      updatedBy: superAdmin.id,
    },
  });

  await prisma.setting.upsert({
    where: { key: 'SUBSCRIPTION_PRICING' },
    update: {},
    create: {
      key: 'SUBSCRIPTION_PRICING',
      value: {
        monthly: 49.99,
        sixMonths: 269.94,
        yearly: 479.88,
        currency: 'GBP',
      },
      updatedBy: superAdmin.id,
    },
  });

  await prisma.setting.upsert({
    where: { key: 'KYC_DEADLINE_DAYS' },
    update: {},
    create: {
      key: 'KYC_DEADLINE_DAYS',
      value: { days: 14, description: 'Days allowed for contractors to submit KYC documents' },
      updatedBy: superAdmin.id,
    },
  });

  await prisma.adminSettings.createMany({
    data: [
      {
        key: 'default_max_contractors_per_job',
        value: '5',
        description: 'Default maximum number of contractors that can purchase access to each job',
      },
      {
        key: 'commission_rate',
        value: '0.05',
        description: 'Commission rate (5%) charged to contractors who used credits and won jobs',
      },
      {
        key: 'platform_name',
        value: 'TrustBuild',
        description: 'Platform name displayed throughout the application',
      },
    ],
    skipDuplicates: true,
  });

  console.log('  ✅ System settings created');

  const services = await seedServices(prisma);

  console.log('✅ Platform data seeding completed successfully.');
  console.log(`   • Admins: 3`);
  console.log(`   • Services: ${services.length}`);
}

main()
  .catch((error) => {
    console.error('❌ Error during seeding:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
