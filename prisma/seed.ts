import { PrismaClient, UserRole, AdminRole, ContractorTier, JobStatus, JobSize, ContractorStatus, SubscriptionPlan } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting comprehensive database seeding...\n');

  // ============================================================
  // 1. CREATE ADMIN ACCOUNTS
  // ============================================================
  console.log('👑 Creating admin accounts...');
  
  const superAdminPassword = await bcrypt.hash('SuperAdmin@2024!', 12);
  const superAdmin = await prisma.admin.upsert({
    where: { email: 'superadmin@trustbuild.uk' },
    update: {
      isMainSuperAdmin: true, // Update existing admin to be Main Super Admin
    },
    create: {
      email: 'superadmin@trustbuild.uk',
      passwordHash: superAdminPassword,
      name: 'Super Administrator',
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
      isMainSuperAdmin: true, // This is the Main Super Admin
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
  console.log('');

  // ============================================================
  // 2. CREATE SYSTEM SETTINGS
  // ============================================================
  console.log('⚙️  Creating system settings...');
  
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
        description: 'Free job leads allocated per contractor tier'
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
        currency: 'GBP'
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
  console.log('');

  // ============================================================
  // 3. CREATE SERVICES
  // ============================================================
  console.log('📋 Creating services...');
  
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

  const createdServices: any[] = [];
  for (const service of services) {
    const created = await prisma.service.upsert({
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
    createdServices.push(created);
  }
  console.log(`  ✅ Created ${createdServices.length} services`);
  console.log('');

  // ============================================================
  // 4. CREATE CUSTOMERS
  // ============================================================
  console.log('🏠 Creating customers...');
  
  const customerData = [
    {
      name: 'Sarah Johnson',
      email: 'sarah.johnson@example.com',
      phone: '+44 20 1234 5678',
      address: '123 High Street',
      city: 'London',
      postcode: 'SW1A 1AA',
    },
    {
      name: 'Michael Smith',
      email: 'michael.smith@example.com',
      phone: '+44 161 234 5678',
      address: '45 Oak Avenue',
      city: 'Manchester',
      postcode: 'M1 1AA',
    },
    {
      name: 'Emma Williams',
      email: 'emma.williams@example.com',
      phone: '+44 121 234 5678',
      address: '78 Park Lane',
      city: 'Birmingham',
      postcode: 'B1 1AA',
    },
    {
      name: 'James Brown',
      email: 'james.brown@example.com',
      phone: '+44 113 234 5678',
      address: '12 Victoria Road',
      city: 'Leeds',
      postcode: 'LS1 1AA',
    },
  ];

  const customers: any[] = [];
  for (const data of customerData) {
    const password = await bcrypt.hash('customer123', 12);
    const user = await prisma.user.upsert({
      where: { email: data.email },
      update: {},
      create: {
        name: data.name,
        email: data.email,
        password,
        role: UserRole.CUSTOMER,
      },
    });

    const customer = await prisma.customer.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        phone: data.phone,
        address: data.address,
        city: data.city,
        postcode: data.postcode,
      },
    });
    customers.push(customer);
    console.log(`  ✅ Customer created: ${data.name} (${data.email})`);
  }
  console.log('');

  // ============================================================
  // 5. CREATE CONTRACTORS (WITH SUBSCRIPTIONS)
  // ============================================================
  console.log('🔨 Creating contractors with subscriptions...');
  
  const contractorData = [
    {
      name: 'David Thompson',
      email: 'david@premiumbuilders.co.uk',
      businessName: 'Premium Builders Ltd',
      description: 'Award-winning building contractor with 15+ years experience. Specializing in high-end renovations and extensions.',
      phone: '+44 20 9876 5432',
      website: 'https://premiumbuilders.co.uk',
      operatingArea: 'London, Surrey, Kent',
      servicesProvided: 'Kitchen Fitting, Bathroom Fitting, Conversions',
      yearsExperience: '15+',
      tier: ContractorTier.PREMIUM,
      subscriptionPlan: SubscriptionPlan.YEARLY,
      subscriptionPrice: 39.99,
      servicesIndexes: [8, 0, 4], // Kitchen, Bathroom, Conversions
    },
    {
      name: 'Lisa Anderson',
      email: 'lisa@electricpro.co.uk',
      businessName: 'ElectricPro Services',
      description: 'Fully qualified electrician with NICEIC certification. Available for domestic and commercial electrical work.',
      phone: '+44 161 567 8901',
      website: 'https://electricpro.co.uk',
      operatingArea: 'Manchester, Greater Manchester',
      servicesProvided: 'Electrical, Central Heating',
      yearsExperience: '10',
      tier: ContractorTier.STANDARD,
      subscriptionPlan: SubscriptionPlan.MONTHLY,
      subscriptionPrice: 49.99,
      servicesIndexes: [5, 3], // Electrical, Central Heating
    },
    {
      name: 'Robert Davies',
      email: 'rob@daviesplumbing.co.uk',
      businessName: 'Davies Plumbing & Heating',
      description: 'Gas Safe registered plumber and heating engineer. Fast, reliable, and competitively priced.',
      phone: '+44 121 234 9876',
      website: 'https://daviesplumbing.co.uk',
      operatingArea: 'Birmingham, West Midlands',
      servicesProvided: 'Plumbing, Central Heating, Bathroom Fitting',
      yearsExperience: '12',
      tier: ContractorTier.PREMIUM,
      subscriptionPlan: SubscriptionPlan.SIX_MONTHS,
      subscriptionPrice: 44.99,
      servicesIndexes: [11, 3, 0], // Plumbing, Heating, Bathroom
    },
    {
      name: 'Jennifer Wilson',
      email: 'jen@gardenmagic.co.uk',
      businessName: 'Garden Magic Landscaping',
      description: 'Creative landscape designer transforming outdoor spaces. From concept to completion.',
      phone: '+44 113 876 5432',
      website: 'https://gardenmagic.co.uk',
      operatingArea: 'Leeds, Yorkshire',
      servicesProvided: 'Garden Landscaping',
      yearsExperience: '8',
      tier: ContractorTier.STANDARD,
      subscriptionPlan: SubscriptionPlan.MONTHLY,
      subscriptionPrice: 49.99,
      servicesIndexes: [7], // Garden Landscaping
    },
    {
      name: 'Thomas Miller',
      email: 'tom@millerroofing.co.uk',
      businessName: 'Miller Roofing Specialists',
      description: 'Third-generation roofing company. All types of roofing work with 10-year guarantees.',
      phone: '+44 117 234 5678',
      website: 'https://millerroofing.co.uk',
      operatingArea: 'Bristol, Somerset, Bath',
      servicesProvided: 'Roofing, Bricklaying',
      yearsExperience: '20+',
      tier: ContractorTier.ENTERPRISE,
      subscriptionPlan: SubscriptionPlan.YEARLY,
      subscriptionPrice: 39.99,
      servicesIndexes: [12, 1], // Roofing, Bricklaying
    },
    {
      name: 'Sophie Turner',
      email: 'sophie@turnerinteriors.co.uk',
      businessName: 'Turner Interiors',
      description: 'Professional painter and decorator. Transforming homes with quality finishes.',
      phone: '+44 131 567 8901',
      website: 'https://turnerinteriors.co.uk',
      operatingArea: 'Edinburgh, Lothian',
      servicesProvided: 'Painting & Decorating, Plastering, Flooring',
      yearsExperience: '7',
      tier: ContractorTier.STANDARD,
      subscriptionPlan: SubscriptionPlan.MONTHLY,
      subscriptionPrice: 49.99,
      servicesIndexes: [9, 10, 6], // Painting, Plastering, Flooring
    },
    {
      name: 'Mark Harrison',
      email: 'mark@harrisoncarpentry.co.uk',
      businessName: 'Harrison Custom Carpentry',
      description: 'Bespoke carpentry and joinery. From fitted wardrobes to custom staircases.',
      phone: '+44 151 234 9876',
      website: 'https://harrisoncarpentry.co.uk',
      operatingArea: 'Liverpool, Merseyside',
      servicesProvided: 'Carpentry, Flooring',
      yearsExperience: '14',
      tier: ContractorTier.PREMIUM,
      subscriptionPlan: SubscriptionPlan.YEARLY,
      subscriptionPrice: 39.99,
      servicesIndexes: [2, 6], // Carpentry, Flooring
    },
    {
      name: 'Rachel Green',
      email: 'rachel@greenbuild.co.uk',
      businessName: 'Green Build Solutions',
      description: 'Eco-friendly building solutions. Sustainable renovations and extensions.',
      phone: '+44 114 876 5432',
      website: 'https://greenbuild.co.uk',
      operatingArea: 'Sheffield, South Yorkshire',
      servicesProvided: 'Conversions, Windows & Doors, Bricklaying',
      yearsExperience: '11',
      tier: ContractorTier.PREMIUM,
      subscriptionPlan: SubscriptionPlan.SIX_MONTHS,
      subscriptionPrice: 44.99,
      servicesIndexes: [4, 14, 1], // Conversions, Windows, Bricklaying
    },
  ];

  const contractors: any[] = [];
  const originalContractors: any[] = []; // Track contractors from contractorData (they have servicesIndexes)
  const now = new Date();

  for (const data of contractorData) {
    const password = await bcrypt.hash('contractor123', 12);
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password,
        role: UserRole.CONTRACTOR,
      },
    });

    const contractor = await prisma.contractor.create({
      data: {
        userId: user.id,
        businessName: data.businessName,
        description: data.description,
        phone: data.phone,
        website: data.website,
        operatingArea: data.operatingArea,
        servicesProvided: data.servicesProvided,
        yearsExperience: data.yearsExperience,
        workSetup: 'team',
        providesWarranty: true,
        warrantyPeriod: '2 years',
        usesContracts: true,
        unsatisfiedCustomers: 'I prioritize customer satisfaction and always work to resolve any concerns professionally.',
        preferredClients: 'Homeowners and businesses looking for quality workmanship.',
        profileApproved: true,
        status: ContractorStatus.VERIFIED,
        tier: data.tier,
        creditsBalance: data.tier === ContractorTier.ENTERPRISE ? 5 : data.tier === ContractorTier.PREMIUM ? 2 : 0,
        weeklyCreditsLimit: 0, // Non-subscribed contractors don't get weekly credits (will be set to 3 when they subscribe)
        averageRating: 4.5 + Math.random() * 0.5,
        reviewCount: Math.floor(Math.random() * 50) + 10,
        jobsCompleted: Math.floor(Math.random() * 100) + 20,
        accountStatus: 'ACTIVE',
      },
    });

    // Connect contractor to services
    for (const serviceIndex of data.servicesIndexes) {
      await prisma.contractor.update({
        where: { id: contractor.id },
        data: {
          services: {
            connect: { id: createdServices[serviceIndex].id },
          },
        },
      });
    }

    // Create subscription
    const monthsToAdd = data.subscriptionPlan === SubscriptionPlan.YEARLY ? 12 : 
                       data.subscriptionPlan === SubscriptionPlan.SIX_MONTHS ? 6 : 1;
    const endDate = new Date(now);
    endDate.setMonth(now.getMonth() + monthsToAdd);

    const subscription = await prisma.subscription.create({
      data: {
        contractorId: contractor.id,
        plan: data.subscriptionPlan,
        tier: data.tier,
        status: 'active',
        isActive: true,
        monthlyPrice: data.subscriptionPrice,
        currentPeriodStart: now,
        currentPeriodEnd: endDate,
        stripeSubscriptionId: `sub_${Math.random().toString(36).substring(7)}`,
      },
    });

    // Update contractor to get weekly credits (subscribed contractors get 3 weekly credits)
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        weeklyCreditsLimit: 3,
        creditsBalance: 3, // Give them initial credits
        lastCreditReset: now,
      },
    });

    // Create payment for subscription
    const paymentAmount = data.subscriptionPrice * monthsToAdd;
    const payment = await prisma.payment.create({
      data: {
        contractorId: contractor.id,
        amount: paymentAmount,
        type: 'SUBSCRIPTION',
        status: 'COMPLETED',
        description: `${data.subscriptionPlan} subscription payment`,
        stripePaymentId: `pi_${Math.random().toString(36).substring(7)}`,
      },
    });

    // Create invoice for the payment
    await prisma.invoice.create({
      data: {
        payments: { connect: { id: payment.id } },
        invoiceNumber: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        amount: paymentAmount,
        vatAmount: paymentAmount * 0.2,
        totalAmount: paymentAmount * 1.2,
        currency: 'GBP',
        recipientName: data.businessName,
        recipientEmail: data.email,
        description: `${data.subscriptionPlan} subscription payment`,
        emailSent: true,
        issuedAt: now,
        paidAt: now,
      },
    });

    contractors.push(contractor);
    originalContractors.push(contractor); // Track original contractors
    console.log(`  ✅ Contractor created: ${data.businessName} (${data.subscriptionPlan} subscription)`);
  }

  // Additional subscribed contractors for testing
  console.log('  Creating additional test contractors...');
  const additionalContractors = [
    {
      name: 'Premium Plumber Ltd',
      email: 'premium.plumber@test.com',
      businessName: 'Premium Plumbing Services',
      description: 'Professional plumbing services with 15 years experience',
      phone: '07700 900111',
      city: 'London',
      postcode: 'SW1A 1AA',
      operatingArea: 'Greater London',
      servicesProvided: 'Plumbing, Heating, Boiler Installation',
      yearsExperience: '15',
      tier: ContractorTier.PREMIUM,
    },
    {
      name: 'Enterprise Electricians',
      email: 'enterprise.electric@test.com',
      businessName: 'Enterprise Electrical Solutions',
      description: 'Large scale electrical installations and maintenance',
      phone: '07700 900222',
      city: 'Manchester',
      postcode: 'M1 1AA',
      operatingArea: 'Greater Manchester',
      servicesProvided: 'Electrical Installation, PAT Testing, Emergency Callouts',
      yearsExperience: '20',
      tier: ContractorTier.ENTERPRISE,
    },
    {
      name: 'Standard Builder Co',
      email: 'standard.builder@test.com',
      businessName: 'Standard Building Services',
      description: 'General building and construction work',
      phone: '07700 900333',
      city: 'Birmingham',
      postcode: 'B1 1AA',
      operatingArea: 'West Midlands',
      servicesProvided: 'Building, Extensions, Renovations',
      yearsExperience: '10',
      tier: ContractorTier.STANDARD,
    },
    {
      name: 'Premium Roofer Pro',
      email: 'premium.roofer@test.com',
      businessName: 'Pro Roofing Solutions',
      description: 'Expert roofing services, repairs and installations',
      phone: '07700 900444',
      city: 'Bristol',
      postcode: 'BS1 1AA',
      operatingArea: 'Bristol and South West',
      servicesProvided: 'Roofing, Guttering, Flat Roof Installation',
      yearsExperience: '12',
      tier: ContractorTier.PREMIUM,
    },
    {
      name: 'Standard Painter',
      email: 'standard.painter@test.com',
      businessName: 'Quality Painting Services',
      description: 'Interior and exterior painting and decorating',
      phone: '07700 900555',
      city: 'Leeds',
      postcode: 'LS1 1AA',
      operatingArea: 'West Yorkshire',
      servicesProvided: 'Painting, Decorating, Wallpapering',
      yearsExperience: '8',
      tier: ContractorTier.STANDARD,
    },
    {
      name: 'Elsa Jaadam',
      email: 'elsajaadammar@gmail.com',
      businessName: 'Elsa Professional Services',
      description: 'High-quality professional services with excellent customer satisfaction',
      phone: '07700 900999',
      city: 'London',
      postcode: 'E1 6AN',
      operatingArea: 'London and surrounding areas',
      servicesProvided: 'General Contracting, Property Maintenance, Renovations',
      yearsExperience: '10',
      tier: ContractorTier.PREMIUM,
    },
  ];

  const testPassword = await bcrypt.hash('TestPassword123!', 12);
  
  for (const contractorData of additionalContractors) {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: contractorData.email },
    });

    if (existingUser) {
      console.log(`  ⏭️  Skipping ${contractorData.email} - already exists`);
      continue;
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        name: contractorData.name,
        email: contractorData.email,
        password: testPassword,
        role: UserRole.CONTRACTOR,
        isActive: true,
      },
    });

    // Create contractor profile
    const contractor = await prisma.contractor.create({
      data: {
        userId: user.id,
        businessName: contractorData.businessName,
        description: contractorData.description,
        phone: contractorData.phone,
        city: contractorData.city,
        postcode: contractorData.postcode,
        operatingArea: contractorData.operatingArea,
        servicesProvided: contractorData.servicesProvided,
        yearsExperience: contractorData.yearsExperience,
        profileApproved: true,
        status: ContractorStatus.VERIFIED,
        averageRating: parseFloat((4 + Math.random()).toFixed(1)),
        tier: contractorData.tier,
        creditsBalance: contractorData.tier === ContractorTier.ENTERPRISE ? 100 : contractorData.tier === ContractorTier.PREMIUM ? 50 : 20,
        weeklyCreditsLimit: 0, // Non-subscribed contractors don't get weekly credits (will be set to 3 when they subscribe)
      },
    });

    // Create active subscription
    const currentPeriodEnd = new Date();
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

    await prisma.subscription.create({
      data: {
        contractorId: contractor.id,
        tier: contractorData.tier,
        plan: SubscriptionPlan.MONTHLY,
        status: 'active',
        isActive: true,
        currentPeriodStart: new Date(),
        currentPeriodEnd,
        stripeSubscriptionId: `sub_test_${contractor.id}`,
        monthlyPrice: contractorData.tier === ContractorTier.ENTERPRISE ? 99.99 : contractorData.tier === ContractorTier.PREMIUM ? 49.99 : 19.99,
      },
    });

    // Update contractor to get weekly credits (subscribed contractors get 3 weekly credits)
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        weeklyCreditsLimit: 3,
        creditsBalance: 3, // Give them initial credits
        lastCreditReset: new Date(),
      },
    });

    // Create KYC record
    await prisma.contractorKyc.create({
      data: {
        contractorId: contractor.id,
        status: 'APPROVED',
        submittedAt: new Date(),
        reviewedAt: new Date(),
      },
    });

    contractors.push(contractor);
    console.log(`  ✅ Test contractor created: ${contractorData.businessName} (${contractorData.tier} subscription)`);
  }

  // Add non-subscribed contractors for testing
  console.log('  Creating non-subscribed contractors...');
  const nonSubscribedContractors = [
    {
      name: 'John Smith',
      email: 'john.smith@test.com',
      businessName: 'Smith Handyman Services',
      description: 'General handyman and repair services',
      phone: '07700 900666',
      city: 'Liverpool',
      postcode: 'L1 1AA',
      operatingArea: 'Merseyside',
      servicesProvided: 'General Repairs, Handyman Work, Small Jobs',
      yearsExperience: '5',
    },
    {
      name: 'Sarah Johnson',
      email: 'sarah.johnson@test.com',
      businessName: 'Johnson Cleaning Services',
      description: 'Professional cleaning and maintenance',
      phone: '07700 900777',
      city: 'Newcastle',
      postcode: 'NE1 1AA',
      operatingArea: 'Tyne and Wear',
      servicesProvided: 'Cleaning, Maintenance, Property Care',
      yearsExperience: '7',
    },
    {
      name: 'Mike Brown',
      email: 'mike.brown@test.com',
      businessName: 'Brown Tiling Services',
      description: 'Expert tiling and flooring installation',
      phone: '07700 900888',
      city: 'Sheffield',
      postcode: 'S1 1AA',
      operatingArea: 'South Yorkshire',
      servicesProvided: 'Tiling, Flooring, Bathroom Renovations',
      yearsExperience: '12',
    },
  ];

  for (const contractorData of nonSubscribedContractors) {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: contractorData.email },
    });

    if (existingUser) {
      console.log(`  ⏭️  Skipping ${contractorData.email} - already exists`);
      continue;
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        name: contractorData.name,
        email: contractorData.email,
        password: testPassword,
        role: UserRole.CONTRACTOR,
        isActive: true,
      },
    });

    // Create contractor profile (no subscription, weeklyCreditsLimit = 0)
    const contractor = await prisma.contractor.create({
      data: {
        userId: user.id,
        businessName: contractorData.businessName,
        description: contractorData.description,
        phone: contractorData.phone,
        city: contractorData.city,
        postcode: contractorData.postcode,
        operatingArea: contractorData.operatingArea,
        servicesProvided: contractorData.servicesProvided,
        yearsExperience: contractorData.yearsExperience,
        profileApproved: true,
        status: ContractorStatus.VERIFIED,
        averageRating: parseFloat((4 + Math.random()).toFixed(1)),
        tier: ContractorTier.STANDARD,
        creditsBalance: 1, // 1 free credit
        weeklyCreditsLimit: 0, // No weekly credits (not subscribed)
      },
    });

    // Create KYC record
    await prisma.contractorKyc.create({
      data: {
        contractorId: contractor.id,
        status: 'APPROVED',
        submittedAt: new Date(),
        reviewedAt: new Date(),
      },
    });

    contractors.push(contractor);
    console.log(`  ✅ Non-subscribed contractor created: ${contractorData.businessName}`);
  }
  console.log('');

  // ============================================================
  // 6. CREATE JOBS
  // ============================================================
  console.log('💼 Creating jobs...');
  
  const jobsData = [
    {
      customerIndex: 0,
      serviceIndex: 8, // Kitchen Fitting
      title: 'Complete Kitchen Renovation',
      description: 'Looking for a complete kitchen renovation. Need new cabinets, countertops, appliances installed, and tiling. Kitchen is approximately 4m x 3m. High-quality finish required.',
      budget: 15000,
      location: 'London, SW1A',
      postcode: 'SW1A 1AA',
      urgency: 'within_week',
      status: JobStatus.POSTED,
      jobSize: JobSize.LARGE,
      estimatedValue: 15000,
    },
    {
      customerIndex: 1,
      serviceIndex: 5, // Electrical
      title: 'Full House Rewiring',
      description: 'Need complete rewiring of 3-bedroom semi-detached house. Property is 1960s build and needs updating to modern standards with new consumer unit.',
      budget: 5000,
      location: 'Manchester, M1',
      postcode: 'M1 1AA',
      urgency: 'asap',
      status: JobStatus.POSTED,
      jobSize: JobSize.LARGE,
      estimatedValue: 5000,
    },
    {
      customerIndex: 2,
      serviceIndex: 0, // Bathroom Fitting
      title: 'Bathroom Renovation',
      description: 'Complete bathroom renovation needed. Remove existing suite, re-tile walls and floor, install new suite with walk-in shower. Approximately 2.5m x 2m.',
      budget: 6000,
      location: 'Birmingham, B1',
      postcode: 'B1 1AA',
      urgency: 'flexible',
      status: JobStatus.POSTED,
      jobSize: JobSize.MEDIUM,
      estimatedValue: 6000,
    },
    {
      customerIndex: 3,
      serviceIndex: 7, // Garden Landscaping
      title: 'Garden Makeover with Patio',
      description: 'Looking to transform back garden. Need new patio area (approximately 20m²), lawn re-turfing, flower beds, and garden lighting.',
      budget: 8000,
      location: 'Leeds, LS1',
      postcode: 'LS1 1AA',
      urgency: 'flexible',
      status: JobStatus.POSTED,
      jobSize: JobSize.MEDIUM,
      estimatedValue: 8000,
    },
    {
      customerIndex: 0,
      serviceIndex: 12, // Roofing
      title: 'Roof Repair - Missing Tiles',
      description: 'Several tiles missing from pitched roof after recent storms. Need inspection and repair. Roof is approximately 15 years old.',
      budget: 800,
      location: 'London, SW1A',
      postcode: 'SW1A 1AA',
      urgency: 'asap',
      status: JobStatus.POSTED,
      jobSize: JobSize.SMALL,
      estimatedValue: 800,
    },
    {
      customerIndex: 1,
      serviceIndex: 9, // Painting & Decorating
      title: 'Interior Painting - 3 Bedrooms',
      description: 'Need 3 bedrooms painted. Walls and ceilings in white, woodwork in brilliant white gloss. Rooms are empty and ready to paint.',
      budget: 1500,
      location: 'Manchester, M1',
      postcode: 'M1 1AA',
      urgency: 'within_week',
      status: JobStatus.POSTED,
      jobSize: JobSize.SMALL,
      estimatedValue: 1500,
    },
    {
      customerIndex: 2,
      serviceIndex: 4, // Conversions
      title: 'Loft Conversion to Bedroom',
      description: 'Want to convert loft space into a bedroom with ensuite. Roof height is adequate. Need dormer window, stairs, plumbing, and electrics.',
      budget: 25000,
      location: 'Birmingham, B1',
      postcode: 'B1 1AA',
      urgency: 'flexible',
      status: JobStatus.POSTED,
      jobSize: JobSize.LARGE,
      estimatedValue: 25000,
    },
    {
      customerIndex: 3,
      serviceIndex: 11, // Plumbing
      title: 'Leaking Radiator Valve Replacement',
      description: 'Have a leaking radiator valve in living room. Need it replaced urgently to prevent water damage.',
      budget: 200,
      location: 'Leeds, LS1',
      postcode: 'LS1 1AA',
      urgency: 'asap',
      status: JobStatus.POSTED,
      jobSize: JobSize.SMALL,
      estimatedValue: 200,
    },
    {
      customerIndex: 0,
      serviceIndex: 2, // Carpentry
      title: 'Custom Built-in Wardrobes',
      description: 'Looking for bespoke fitted wardrobes for master bedroom. Wall is 3.5m wide, floor to ceiling. Need modern design with soft-close doors.',
      budget: 3500,
      location: 'London, SW1A',
      postcode: 'SW1A 1AA',
      urgency: 'flexible',
      status: JobStatus.IN_PROGRESS,
      jobSize: JobSize.MEDIUM,
      estimatedValue: 3500,
      wonByContractorIndex: 6, // Mark Harrison - Carpentry
    },
    {
      customerIndex: 2,
      serviceIndex: 0, // Bathroom Fitting
      title: 'Bathroom Refurbishment',
      description: 'Complete bathroom refurbishment including new suite, tiling, and plumbing work. Modern design with walk-in shower.',
      budget: 5500,
      location: 'Birmingham, B1',
      postcode: 'B1 1AA',
      urgency: 'within_week',
      status: JobStatus.WON,
      jobSize: JobSize.MEDIUM,
      estimatedValue: 5500,
      wonByContractorIndex: 2, // Robert Davies - Plumbing, Heating, Bathroom
    },
    {
      customerIndex: 1,
      serviceIndex: 3, // Central Heating
      title: 'New Boiler Installation',
      description: 'Current boiler is 18 years old and inefficient. Need new combi boiler installed with 10-year warranty. 3-bed semi with 8 radiators.',
      budget: 3000,
      location: 'Manchester, M1',
      postcode: 'M1 1AA',
      urgency: 'within_week',
      status: JobStatus.COMPLETED,
      jobSize: JobSize.MEDIUM,
      estimatedValue: 3000,
      wonByContractorIndex: 1, // Lisa Anderson - Electrical/Heating
      finalAmount: 2850,
      customerConfirmed: true,
      commissionPaid: true,
    },
  ];

  const jobs: any[] = [];
  for (const jobData of jobsData) {
    const service = createdServices[jobData.serviceIndex];
    const customer = customers[jobData.customerIndex];

    let leadPrice;
    if (jobData.jobSize === JobSize.SMALL) {
      leadPrice = service.smallJobPrice;
    } else if (jobData.jobSize === JobSize.MEDIUM) {
      leadPrice = service.mediumJobPrice;
    } else {
      leadPrice = service.largeJobPrice;
    }

    // Set wonAt timestamp if contractor won the job
    const wonAt = jobData.wonByContractorIndex !== undefined ? new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)) : null; // 7 days ago
    
    const job = await prisma.job.create({
      data: {
        customerId: customer.id,
        serviceId: service.id,
        title: jobData.title,
        description: jobData.description,
        budget: jobData.budget,
        location: jobData.location,
        postcode: jobData.postcode,
        urgency: jobData.urgency,
        status: jobData.status,
        jobSize: jobData.jobSize,
        leadPrice,
        estimatedValue: jobData.estimatedValue,
        maxContractorsPerJob: 5,
        wonByContractorId: jobData.wonByContractorIndex !== undefined ? contractors[jobData.wonByContractorIndex].id : null,
        wonAt: wonAt,
        finalAmount: jobData.finalAmount || null,
        customerConfirmed: jobData.customerConfirmed || false,
        commissionPaid: jobData.commissionPaid || false,
        completionDate: jobData.status === JobStatus.COMPLETED && jobData.finalAmount ? new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)) : null, // 3 days ago if completed
      },
    });

    jobs.push(job);
    console.log(`  ✅ Job created: ${jobData.title} (${jobData.status})`);

    // Create job applications for posted jobs, IN_PROGRESS, WON, and COMPLETED jobs
    // All jobs with a wonByContractorId need applications
    if (jobData.status === JobStatus.POSTED || 
        jobData.status === JobStatus.IN_PROGRESS || 
        jobData.status === JobStatus.WON ||
        (jobData.status === JobStatus.COMPLETED && jobData.wonByContractorIndex !== undefined)) {
      // Get 2-3 random contractors who provide this service
      // Only check contractors from the original contractorData array (they have servicesIndexes)
      const applicableContractors = originalContractors.filter((c, index) => {
        // Only check original contractors (from contractorData array)
        const contractorInfo = contractorData[index];
        if (!contractorInfo || !contractorInfo.servicesIndexes) return false;
        return contractorInfo.servicesIndexes.includes(jobData.serviceIndex);
      });

      const numApplications = Math.min(3, applicableContractors.length);
      const wonContractorIndex = jobData.wonByContractorIndex;
      
      for (let i = 0; i < numApplications; i++) {
        const contractor = applicableContractors[i];
        const isWonContractor = wonContractorIndex !== undefined && 
                                 contractors[wonContractorIndex]?.id === contractor.id;
        
        // Determine application status
        let applicationStatus = 'PENDING';
        if (jobData.status === JobStatus.IN_PROGRESS && i === 0) {
          applicationStatus = 'ACCEPTED';
        } else if (isWonContractor) {
          // Contractor who won must have ACCEPTED application
          applicationStatus = 'ACCEPTED';
        } else if (jobData.status === JobStatus.WON || jobData.status === JobStatus.COMPLETED) {
          // For WON/COMPLETED jobs, only the winner has ACCEPTED, others are PENDING
          applicationStatus = 'PENDING';
        }
        
        await prisma.jobApplication.create({
          data: {
            jobId: job.id,
            contractorId: contractor.id,
            coverLetter: `I would be delighted to work on your ${jobData.title.toLowerCase()} project. With my experience and expertise, I can deliver excellent results.`,
            proposedRate: jobData.budget * (0.85 + Math.random() * 0.15),
            timeline: jobData.urgency === 'asap' ? '1 week' : jobData.urgency === 'within_week' ? '2 weeks' : '3-4 weeks',
            status: applicationStatus,
          },
        });
      }

      // Create job access for contractors who applied
      for (let i = 0; i < numApplications; i++) {
        const contractor = applicableContractors[i];
        // Check if job access already exists (for jobs that were created with wonByContractorId)
        const existingAccess = await prisma.jobAccess.findFirst({
          where: {
            jobId: job.id,
            contractorId: contractor.id,
          },
        });

        if (!existingAccess) {
          const useCredit = contractor.creditsBalance > 0 && Math.random() > 0.5;

          await prisma.jobAccess.create({
            data: {
              jobId: job.id,
              contractorId: contractor.id,
              accessMethod: useCredit ? 'CREDIT' : 'PAYMENT',
              paidAmount: useCredit ? null : leadPrice,
              creditUsed: useCredit,
            },
          });

          if (useCredit) {
            // Deduct credit
            await prisma.contractor.update({
              where: { id: contractor.id },
              data: { creditsBalance: { decrement: 1 } },
            });

            // Create credit transaction
            await prisma.creditTransaction.create({
              data: {
                contractorId: contractor.id,
                amount: -1,
                type: 'JOB_ACCESS',
                description: `Credit used to access job: ${jobData.title}`,
                jobId: job.id,
              },
            });
          } else {
            // Create payment
            await prisma.payment.create({
              data: {
                contractorId: contractor.id,
                jobId: job.id,
                amount: leadPrice,
                type: 'LEAD_ACCESS',
                status: 'COMPLETED',
                description: `Lead access payment for: ${jobData.title}`,
                stripePaymentId: `pi_${Math.random().toString(36).substring(7)}`,
              },
            });
          }
        }
      }
    }

    // Create commission payment for completed job
    if (jobData.status === JobStatus.COMPLETED && jobData.finalAmount && jobData.wonByContractorIndex !== undefined) {
      const contractor = contractors[jobData.wonByContractorIndex];
      const commissionRate = 5.0;
      const commissionAmount = (jobData.finalAmount * commissionRate) / 100;
      const vatAmount = commissionAmount * 0.2;
      const totalAmount = commissionAmount + vatAmount;

      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + 30);

      const commissionPayment = await prisma.commissionPayment.create({
        data: {
          jobId: job.id,
          contractorId: contractor.id,
          customerId: customer.id,
          finalJobAmount: jobData.finalAmount,
          commissionRate,
          commissionAmount,
          vatAmount,
          totalAmount,
          status: 'PAID',
          dueDate,
          paidAt: now,
          stripePaymentId: `pi_${Math.random().toString(36).substring(7)}`,
        },
      });

      // Create commission invoice
      await prisma.commissionInvoice.create({
        data: {
          commissionPaymentId: commissionPayment.id,
          invoiceNumber: `COM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          contractorName: contractorData[jobData.wonByContractorIndex].businessName,
          contractorEmail: contractorData[jobData.wonByContractorIndex].email,
          jobTitle: jobData.title,
          finalJobAmount: jobData.finalAmount,
          commissionAmount,
          vatAmount,
          totalAmount,
          dueDate,
          emailSent: true,
        },
      });
    }
  }
  console.log('');

  // ============================================================
  // 7. CREATE REVIEWS
  // ============================================================
  console.log('⭐ Creating reviews...');
  
  // Add some reviews for contractors
  const reviewsData = [
    {
      contractorIndex: 0,
      customerIndex: 0,
      rating: 5,
      comment: 'Excellent work on our kitchen renovation. David and his team were professional, punctual, and the quality of work exceeded our expectations. Highly recommended!',
      isVerified: true,
    },
    {
      contractorIndex: 1,
      customerIndex: 1,
      rating: 5,
      comment: 'Lisa did a fantastic job rewiring our house. Very knowledgeable and explained everything clearly. The work was completed on time and to a high standard.',
      isVerified: true,
    },
    {
      contractorIndex: 2,
      customerIndex: 2,
      rating: 4,
      comment: 'Good work overall. The bathroom looks great. There were a couple of minor issues but Rob sorted them out promptly.',
      isVerified: true,
    },
    {
      contractorIndex: 6,
      customerIndex: 0,
      rating: 5,
      comment: 'Mark created beautiful custom wardrobes for our bedroom. The craftsmanship is outstanding and they fit perfectly. Worth every penny!',
      isVerified: true,
      jobIndex: 8,
    },
  ];

  for (const reviewData of reviewsData) {
    const contractor = contractors[reviewData.contractorIndex];
    const customer = customers[reviewData.customerIndex];
    const job = reviewData.jobIndex !== undefined ? jobs[reviewData.jobIndex] : null;

    await prisma.review.create({
      data: {
        contractorId: contractor.id,
        customerId: customer.id,
        jobId: job?.id,
        rating: reviewData.rating,
        comment: reviewData.comment,
        isVerified: reviewData.isVerified,
      },
    });

    // Update contractor stats
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        reviewCount: { increment: 1 },
        verifiedReviews: reviewData.isVerified ? { increment: 1 } : undefined,
      },
    });

    console.log(`  ✅ Review created for ${contractorData[reviewData.contractorIndex].businessName}`);
  }
  console.log('');

  // ============================================================
  // 8. CREATE ADMIN ACTIVITY LOGS
  // ============================================================
  console.log('📝 Creating admin activity logs...');
  
  await prisma.activityLog.createMany({
    data: [
      {
        adminId: superAdmin.id,
        action: 'SETTINGS_UPDATE',
        entityType: 'Setting',
        entityId: 'COMMISSION_RATE',
        description: 'Updated commission rate settings',
        diff: { before: 4.5, after: 5.0 },
      },
      {
        adminId: financeAdmin.id,
        action: 'INVOICE_CREATE',
        entityType: 'Invoice',
        description: 'Created manual invoice for contractor',
      },
      {
        adminId: supportAdmin.id,
        action: 'CONTRACTOR_VERIFY',
        entityType: 'Contractor',
        entityId: contractors[0].id,
        description: 'Verified contractor profile',
      },
    ],
  });
  console.log('  ✅ Activity logs created');
  console.log('');

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ DATABASE SEEDING COMPLETED SUCCESSFULLY!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 Summary:');
  console.log(`   • Admins: 3 (1 Super Admin, 1 Finance Admin, 1 Support Admin)`);
  console.log(`   • Services: ${createdServices.length}`);
  console.log(`   • Customers: ${customers.length}`);
  console.log(`   • Contractors: ${contractors.length} (all with active subscriptions)`);
  console.log(`   • Jobs: ${jobs.length} (various statuses)`);
  console.log(`   • Reviews: ${reviewsData.length}`);
  console.log('');
  console.log('🔐 Admin Login Credentials:');
  console.log('   ┌─────────────────────────────────────────────────────┐');
  console.log('   │ Super Admin:                                        │');
  console.log('   │   Email: superadmin@trustbuild.uk                   │');
  console.log('   │   Password: SuperAdmin@2024!                        │');
  console.log('   ├─────────────────────────────────────────────────────┤');
  console.log('   │ Finance Admin:                                      │');
  console.log('   │   Email: finance@trustbuild.uk                      │');
  console.log('   │   Password: FinanceAdmin@2024!                      │');
  console.log('   ├─────────────────────────────────────────────────────┤');
  console.log('   │ Support Admin:                                      │');
  console.log('   │   Email: support@trustbuild.uk                      │');
  console.log('   │   Password: SupportAdmin@2024!                      │');
  console.log('   └─────────────────────────────────────────────────────┘');
  console.log('');
  console.log('👤 Test User Credentials (all users):');
  console.log('   • Customers: customer123');
  console.log('   • Contractors: contractor123');
  console.log('');
  console.log('🚀 Next Steps:');
  console.log('   1. Visit http://localhost:3000 (frontend)');
  console.log('   2. Login with admin credentials');
  console.log('   3. Explore the admin dashboard');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
