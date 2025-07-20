import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create services with TrustBuilders pricing model
  const services = [
    {
      name: 'Bathroom Fitting',
      description: 'Complete bathroom fitting and renovation services',
      category: 'Home Improvement',
      smallJobPrice: 25.00,
      mediumJobPrice: 35.00,
      largeJobPrice: 50.00,
    },
    {
      name: 'Bricklaying',
      description: 'Professional bricklaying and masonry services',
      category: 'Construction',
      smallJobPrice: 20.00,
      mediumJobPrice: 30.00,
      largeJobPrice: 50.00,
    },
    {
      name: 'Carpentry',
      description: 'Custom carpentry and woodworking services',
      category: 'Trade Services',
      smallJobPrice: 15.00,
      mediumJobPrice: 30.00,
      largeJobPrice: 50.00,
    },
    {
      name: 'Central Heating',
      description: 'Central heating installation and maintenance',
      category: 'Home Systems',
      smallJobPrice: 20.00,
      mediumJobPrice: 35.00,
      largeJobPrice: 60.00,
    },
    {
      name: 'Conversions',
      description: 'Home conversions and extensions',
      category: 'Construction',
      smallJobPrice: 30.00,
      mediumJobPrice: 50.00,
      largeJobPrice: 80.00,
    },
    {
      name: 'Electrical',
      description: 'Electrical installation, repair, and safety services',
      category: 'Trade Services',
      smallJobPrice: 15.00,
      mediumJobPrice: 30.00,
      largeJobPrice: 50.00,
    },
    {
      name: 'Flooring',
      description: 'Flooring installation and repair services',
      category: 'Home Improvement',
      smallJobPrice: 20.00,
      mediumJobPrice: 35.00,
      largeJobPrice: 50.00,
    },
    {
      name: 'Garden Landscaping',
      description: 'Garden design, landscaping, and maintenance services',
      category: 'Outdoor',
      smallJobPrice: 25.00,
      mediumJobPrice: 40.00,
      largeJobPrice: 60.00,
    },
    {
      name: 'Kitchen Fitting',
      description: 'Complete kitchen fitting and renovation services',
      category: 'Home Improvement',
      smallJobPrice: 30.00,
      mediumJobPrice: 45.00,
      largeJobPrice: 60.00,
    },
    {
      name: 'Painting & Decorating',
      description: 'Interior and exterior painting and decorating services',
      category: 'Decoration',
      smallJobPrice: 15.00,
      mediumJobPrice: 25.00,
      largeJobPrice: 40.00,
    },
    {
      name: 'Plastering',
      description: 'Professional plastering and rendering services',
      category: 'Trade Services',
      smallJobPrice: 20.00,
      mediumJobPrice: 35.00,
      largeJobPrice: 50.00,
    },
    {
      name: 'Plumbing',
      description: 'Plumbing installation, repair, and maintenance services',
      category: 'Trade Services',
      smallJobPrice: 15.00,
      mediumJobPrice: 25.00,
      largeJobPrice: 40.00,
    },
    {
      name: 'Roofing',
      description: 'Roof installation, repair, and maintenance services',
      category: 'Construction',
      smallJobPrice: 25.00,
      mediumJobPrice: 40.00,
      largeJobPrice: 60.00,
    },
    {
      name: 'Tiling',
      description: 'Professional tiling services for all surfaces',
      category: 'Home Improvement',
      smallJobPrice: 20.00,
      mediumJobPrice: 35.00,
      largeJobPrice: 50.00,
    },
    {
      name: 'Windows & Doors',
      description: 'Window and door installation and repair',
      category: 'Home Systems',
      smallJobPrice: 15.00,
      mediumJobPrice: 30.00,
      largeJobPrice: 50.00,
    },
  ];

  console.log('📋 Creating services...');
  for (const service of services) {
    await prisma.service.upsert({
      where: { name: service.name },
      update: {
        description: service.description,
        category: service.category,
        smallJobPrice: service.smallJobPrice,
        mediumJobPrice: service.mediumJobPrice,
        largeJobPrice: service.largeJobPrice,
      },
      create: service,
    });
  }

  // Create super admin user
  const superAdminPassword = await bcrypt.hash('superadmin123456', 12);
  const superAdminUser = await prisma.user.upsert({
    where: { email: 'superadmin@trustbuild.com' },
    update: {},
    create: {
      name: 'TrustBuild Super Admin',
      email: 'superadmin@trustbuild.com',
      password: superAdminPassword,
      role: UserRole.SUPER_ADMIN,
    },
  });

  console.log('🔑 Super Admin user created:', superAdminUser.email);

  // Create regular admin user
  const adminPassword = await bcrypt.hash('admin123456', 12);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@trustbuild.com' },
    update: {},
    create: {
      name: 'TrustBuild Admin',
      email: 'admin@trustbuild.com',
      password: adminPassword,
      role: UserRole.ADMIN,
    },
  });

  console.log('👤 Admin user created:', adminUser.email);

  // Create sample customer
  const customerPassword = await bcrypt.hash('customer123', 12);
  const customerUser = await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: {},
    create: {
      name: 'John Customer',
      email: 'customer@example.com',
      password: customerPassword,
      role: UserRole.CUSTOMER,
    },
  });

  await prisma.customer.upsert({
    where: { userId: customerUser.id },
    update: {},
    create: {
      userId: customerUser.id,
      phone: '+44 20 1234 5678',
      address: '123 Customer Street',
      city: 'London',
      postcode: 'SW1A 1AA',
    },
  });

  console.log('🏠 Sample customer created:', customerUser.email);

  // Create sample contractor
  const contractorPassword = await bcrypt.hash('contractor123', 12);
  const contractorUser = await prisma.user.upsert({
    where: { email: 'contractor@example.com' },
    update: {},
    create: {
      name: 'Mike Contractor',
      email: 'contractor@example.com',
      password: contractorPassword,
      role: UserRole.CONTRACTOR,
    },
  });

  const kitchenService = await prisma.service.findFirst({
    where: { name: 'Kitchen Renovation' },
  });

  const contractor = await prisma.contractor.upsert({
    where: { userId: contractorUser.id },
    update: {},
    create: {
      userId: contractorUser.id,
      businessName: 'Mike\'s Kitchen Solutions',
      description: 'Professional kitchen renovation specialist with over 10 years of experience.',
      phone: '+44 20 9876 5432',
      website: 'https://mikeskitchens.co.uk',
      operatingArea: 'London, Surrey, Kent',
      servicesProvided: 'Kitchen Renovation, Custom Cabinetry, Countertop Installation',
      yearsExperience: '10+',
      workSetup: 'team',
      providesWarranty: true,
      warrantyPeriod: '2 years',
      usesContracts: true,
      unsatisfiedCustomers: 'I always work closely with customers to address any concerns and ensure complete satisfaction. Communication is key.',
      preferredClients: 'Homeowners looking for high-quality kitchen renovations with attention to detail.',
      profileApproved: true,
      status: 'VERIFIED',
      averageRating: 4.8,
      reviewCount: 12,
      jobsCompleted: 25,
    },
  });

  // Connect contractor to services
  if (kitchenService) {
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        services: {
          connect: { id: kitchenService.id },
        },
      },
    });
  }

  console.log('🔨 Sample contractor created:', contractorUser.email);

  // Create sample job
  if (kitchenService) {
    const job = await prisma.job.create({
      data: {
        customerId: (await prisma.customer.findFirst({ where: { userId: customerUser.id } }))!.id,
        serviceId: kitchenService.id,
        title: 'Modern Kitchen Renovation',
        description: 'Looking for a complete kitchen renovation. Need new cabinets, countertops, and appliances installed. Kitchen is approximately 3m x 4m.',
        budget: 15000.00,
        location: 'London, SW1A 1AA',
        postcode: 'SW1A 1AA',
        urgency: 'within_week',
        status: 'POSTED',
        requiresQuote: true,
      },
    });

    console.log('💼 Sample job created:', job.title);

    // Create sample job application
    await prisma.jobApplication.create({
      data: {
        jobId: job.id,
        contractorId: contractor.id,
        coverLetter: 'I would be delighted to work on your kitchen renovation project. With over 10 years of experience and a proven track record, I can deliver a high-quality result within your timeline.',
        proposedRate: 14500.00,
        timeline: '2-3 weeks',
        status: 'PENDING',
      },
    });

    console.log('📝 Sample job application created');
  }

  // Create admin settings
  const adminSettings = [
    { key: 'platform_commission_rate', value: '5.0' },
    { key: 'max_job_applications', value: '10' },
    { key: 'contractor_approval_required', value: 'true' },
    { key: 'min_job_budget', value: '50.00' },
    { key: 'max_job_budget', value: '50000.00' },
  ];

  console.log('⚙️ Creating admin settings...');
  for (const setting of adminSettings) {
    await prisma.adminSettings.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }

  console.log('✅ Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 