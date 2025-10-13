import { PrismaClient, UserRole, AdminRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create Admin accounts
  console.log('👑 Creating admin accounts...');
  
  const superAdminPassword = await bcrypt.hash('SuperAdmin@2024!', 12);
  const superAdmin = await prisma.admin.upsert({
    where: { email: 'superadmin@trustbuild.uk' },
    update: {},
    create: {
      email: 'superadmin@trustbuild.uk',
      passwordHash: superAdminPassword,
      name: 'Super Administrator',
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
    },
  });
  console.log('✅ Super Admin created:', superAdmin.email);

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
  console.log('✅ Finance Admin created:', financeAdmin.email);

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
  console.log('✅ Support Admin created:', supportAdmin.email);

  // Create default system settings
  console.log('⚙️ Creating system settings...');
  
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

  console.log('✅ System settings created');

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

  // Create super admin user (User model - for backward compatibility)
  const legacySuperAdminPassword = await bcrypt.hash('superadmin123456', 12);
  const superAdminUser = await prisma.user.upsert({
    where: { email: 'superadmin@trustbuild.com' },
    update: {},
    create: {
      name: 'TrustBuild Super Admin',
      email: 'superadmin@trustbuild.com',
      password: legacySuperAdminPassword,
      role: UserRole.SUPER_ADMIN,
    },
  });

  console.log('🔑 Legacy Super Admin user created:', superAdminUser.email);

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
  let job;
  if (kitchenService) {
    job = await prisma.job.create({
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
  } else {
    console.log('⚠️ Kitchen service not found - creating basic sample job');
    // Create a basic job with any available service
    const anyService = await prisma.service.findFirst();
    if (anyService) {
      job = await prisma.job.create({
        data: {
          customerId: (await prisma.customer.findFirst({ where: { userId: customerUser.id } }))!.id,
          serviceId: anyService.id,
          title: 'Basic Home Improvement',
          description: 'Looking for general home improvements.',
          budget: 5000.00,
          location: 'London, SW1A 1AA',
          postcode: 'SW1A 1AA',
          urgency: 'flexible',
          status: 'POSTED',
          requiresQuote: true,
        },
      });
      console.log('💼 Basic sample job created:', job.title);
    } else {
      console.log('❌ No services available to create sample job');
    }
  }
  
  // Get customer for payments
  const customer = await prisma.customer.findFirst({
    where: { userId: customerUser.id },
  });

  if (!customer) {
    throw new Error('Customer not found');
  }

  // Create sample payments
  console.log('💰 Creating sample payment data...');
  
  // Create a few payments for different purposes
  const paymentTypes = ['LEAD_ACCESS', 'SUBSCRIPTION', 'JOB_PAYMENT', 'COMMISSION'];
  const paymentStatuses = ['PENDING', 'COMPLETED', 'FAILED'];
  
  // Create more sample jobs for testing
  const additionalJobs = [];
  for (let i = 0; i < 3; i++) {
    // Make sure we have a valid service
    const service = await prisma.service.findFirst({
      orderBy: { id: 'asc' },
      skip: i % services.length
    });
    
    if (!service) {
      console.log(`⚠️ No service found for job ${i+1}, skipping`);
      continue;
    }
    
    const newJob = await prisma.job.create({
      data: {
        customer: { connect: { id: customer.id } },
        service: { connect: { id: service.id } },
        title: `Sample Job ${i+1}`,
        description: `This is a sample job for testing job access.`,
        budget: 2000.00 + (i * 500),
        location: 'Manchester, UK',
        postcode: 'M1 1AA',
        urgency: 'flexible',
        status: 'POSTED',
        jobSize: (['SMALL', 'MEDIUM', 'LARGE'][i % 3] as 'SMALL' | 'MEDIUM' | 'LARGE'),
      }
    });
    additionalJobs.push(newJob);
    console.log(`📋 Created additional job: ${newJob.title}`);
  }
  
  // Create an array of payment data
  const paymentData = [
    {
      contractorId: contractor.id,
      amount: 49.99,
      type: 'SUBSCRIPTION' as const,
      status: 'COMPLETED' as const,
      description: 'Monthly subscription payment',
    },
    {
      contractorId: contractor.id,
      jobId: job?.id,
      amount: 15.00,
      type: 'LEAD_ACCESS' as const,
      status: 'COMPLETED' as const,
      description: 'Job lead access payment',
    },
    {
      customerId: customer.id,
      amount: 500.00,
      type: 'JOB_PAYMENT' as const,
      status: 'COMPLETED' as const,
      description: 'Milestone payment for kitchen renovation',
    },
    {
      contractorId: contractor.id,
      amount: 25.00,
      type: 'COMMISSION' as const,
      status: 'PENDING' as const,
      description: 'Commission payment for completed job',
    },
    {
      contractorId: contractor.id,
      amount: 29.99,
      type: 'LEAD_ACCESS' as const,
      status: 'COMPLETED' as const,
      description: 'Job lead access payment bundle',
    }
  ];
  
  // Create each payment
  for (const payment of paymentData) {
    // Skip payments that require a job if job is undefined
    if (payment.jobId && !job) {
      console.log(`⚠️ Skipping payment requiring job: ${payment.description}`);
      continue;
    }
    
    const createdPayment = await prisma.payment.create({
      data: payment,
    });
    console.log(`💵 Created ${payment.type} payment: £${payment.amount}`);
    
    // Create an invoice for completed payments
    if (payment.status === 'COMPLETED') {
      const invoice = await prisma.invoice.create({
        data: {
          payments: { connect: { id: createdPayment.id } },
          invoiceNumber: `INV-${Date.now().toString().substring(0, 10)}-${Math.floor(Math.random() * 1000)}`,
          amount: payment.amount,
          vatAmount: payment.amount * 0.2,
          totalAmount: payment.amount * 1.2,
          currency: 'GBP',
          recipientName: 'Sample Recipient',
          recipientEmail: 'recipient@example.com',
          description: payment.description,
          emailSent: true,
          issuedAt: new Date(),
          paidAt: payment.status === 'COMPLETED' ? new Date() : null,
        }
      });
      console.log(`📄 Created invoice: ${invoice.invoiceNumber}`);
      
      // Create job access record for LEAD_ACCESS payments
      if (payment.type === 'LEAD_ACCESS' && payment.jobId) {
        await prisma.jobAccess.create({
          data: {
            jobId: payment.jobId,
            contractorId: payment.contractorId,
            accessMethod: 'PAYMENT',
            paidAmount: payment.amount,
            creditUsed: false,
          }
        });
        console.log(`🔑 Created job access record for job: ${payment.jobId}`);
      }
    }
  }
  
  // Create subscriptions for testing
  console.log('🔄 Creating sample subscription data...');
  
  // Create multiple contractors with various subscription types
  const additionalContractors = [];
  
  // Create 5 more contractors with different subscriptions
  for (let i = 0; i < 5; i++) {
    // Create user
    const newUser = await prisma.user.create({
      data: {
        name: `Test Contractor ${i+1}`,
        email: `contractor${i+1}@example.com`,
        password: await bcrypt.hash('contractor123', 10),
        role: 'CONTRACTOR',
      },
    });
    
    // Create contractor profile
    const newContractor = await prisma.contractor.create({
      data: {
        userId: newUser.id,
        businessName: `Test Business ${i+1}`,
        description: 'A test contractor business',
        phone: `+44712345678${i}`,
        yearsExperience: `${5 + i}`,
        creditsBalance: 3,
      },
    });
    
    additionalContractors.push(newContractor);
    console.log(`👷 Created test contractor: ${newContractor.businessName}`);
  }
  
  // Calculate subscription dates
  const now = new Date();
  
  // Different subscription plans and statuses to create
  const subscriptionConfigs = [
    {
      contractor: contractor,
      plan: 'MONTHLY',
      status: 'active',
      isActive: true,
      monthsToAdd: 1,
      monthlyPrice: 49.99
    },
    {
      contractor: additionalContractors[0],
      plan: 'SIX_MONTHS',
      status: 'active',
      isActive: true,
      monthsToAdd: 6,
      monthlyPrice: 44.99
    },
    {
      contractor: additionalContractors[1],
      plan: 'YEARLY',
      status: 'active',
      isActive: true,
      monthsToAdd: 12,
      monthlyPrice: 39.99
    },
    {
      contractor: additionalContractors[2],
      plan: 'MONTHLY',
      status: 'cancelled',
      isActive: false,
      monthsToAdd: 1,
      monthlyPrice: 49.99
    },
    {
      contractor: additionalContractors[3],
      plan: 'MONTHLY',
      status: 'pending',
      isActive: false,
      monthsToAdd: 1,
      monthlyPrice: 49.99
    }
  ];
  
  // Create each subscription
  for (const config of subscriptionConfigs) {
    const endDate = new Date(now);
    endDate.setMonth(now.getMonth() + config.monthsToAdd);
    
    const subscription = await prisma.subscription.create({
      data: {
        contractorId: config.contractor.id,
        plan: config.plan as 'BASIC' | 'STANDARD' | 'PREMIUM' as any,
        tier: 'STANDARD',
        status: config.status,
        isActive: config.isActive,
        monthlyPrice: config.monthlyPrice,
        currentPeriodStart: now,
        currentPeriodEnd: endDate,
      }
    });
    
    // Create payment for active subscriptions
    if (config.isActive) {
      const paymentAmount = config.monthlyPrice * config.monthsToAdd;
      
      const payment = await prisma.payment.create({
        data: {
          contractorId: config.contractor.id,
          amount: paymentAmount,
          type: 'SUBSCRIPTION' as const,
          status: 'COMPLETED' as const,
          description: `${config.plan} subscription payment`,
        }
      });
      
      // Create invoice for the payment
      await prisma.invoice.create({
        data: {
          payments: { connect: { id: payment.id } },
          invoiceNumber: `INV-SUB-${Date.now().toString().substring(0, 10)}-${Math.floor(Math.random() * 1000)}`,
          amount: paymentAmount,
          vatAmount: paymentAmount * 0.2,
          totalAmount: paymentAmount * 1.2,
          currency: 'GBP',
          recipientName: config.contractor.businessName || 'Contractor',
          recipientEmail: `contractor-${config.contractor.id}@example.com`,
          description: `${config.plan} subscription payment`,
          emailSent: true,
          issuedAt: now,
          paidAt: now,
        }
      });
    }
    
    console.log(`✅ Created ${config.plan} subscription (${config.status}) for contractor: ${config.contractor.id}`);
  }
  
  // Create job access records using credits
  console.log('🎫 Creating job access records with credits...');
  
  // Create job access using credits for the additional contractors
  for (let i = 0; i < Math.min(additionalJobs.length, additionalContractors.length); i++) {
    const jobId = additionalJobs[i].id;
    const contractorId = additionalContractors[i].id;
    
    // Create job access record
    await prisma.jobAccess.create({
      data: {
        jobId,
        contractorId,
        accessMethod: 'CREDIT',
        creditUsed: true,
      }
    });
    
    // Create credit transaction record
    await prisma.creditTransaction.create({
      data: {
        contractorId,
        amount: -1, // Use 1 credit
        type: 'JOB_ACCESS' as const,
        description: `Credit used to access job ${additionalJobs[i].title}`,
        jobId,
      }
    });
    
    // Update contractor's credit balance
    await prisma.contractor.update({
      where: { id: contractorId },
      data: {
        creditsBalance: {
          decrement: 1
        }
      }
    });
    
    console.log(`✅ Created job access with credits for job ${additionalJobs[i].title} by contractor ${contractorId}`);
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

  // Create default admin settings
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