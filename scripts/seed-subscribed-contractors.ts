import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding subscribed contractors...');

  try {
    // Create contractors with subscriptions
    const contractors = [
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
        plan: 'PREMIUM',
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
        plan: 'ENTERPRISE',
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
        plan: 'STANDARD',
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
        plan: 'PREMIUM',
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
        plan: 'STANDARD',
      },
    ];

    const password = await hash('TestPassword123!', 12);

    for (const contractorData of contractors) {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: contractorData.email },
      });

      if (existingUser) {
        console.log(`⏭️  Skipping ${contractorData.email} - already exists`);
        continue;
      }

      // Create user
      const user = await prisma.user.create({
        data: {
          name: contractorData.name,
          email: contractorData.email,
          password,
          role: 'CONTRACTOR',
          isActive: true,
          emailVerified: true,
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
          status: 'ACTIVE',
          averageRating: parseFloat((4 + Math.random()).toFixed(1)), // Random rating between 4.0 and 5.0
          totalReviews: Math.floor(Math.random() * 50) + 10, // Random reviews between 10 and 60
          tier: contractorData.plan,
          creditsBalance: contractorData.plan === 'ENTERPRISE' ? 100 : contractorData.plan === 'PREMIUM' ? 50 : 20,
          weeklyCreditsLimit: contractorData.plan === 'ENTERPRISE' ? 100 : contractorData.plan === 'PREMIUM' ? 50 : 20,
        },
      });

      // Create active subscription
      const currentPeriodEnd = new Date();
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1); // 1 month from now

      await prisma.subscription.create({
        data: {
          contractorId: contractor.id,
          plan: contractorData.plan as any,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd,
          stripeCustomerId: `cus_test_${contractor.id}`,
          stripeSubscriptionId: `sub_test_${contractor.id}`,
          stripePriceId: `price_test_${contractorData.plan.toLowerCase()}`,
          cancelAtPeriodEnd: false,
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

      console.log(`✅ Created ${contractorData.businessName} with ${contractorData.plan} subscription`);
    }

    console.log('\n🎉 Seeding completed successfully!');
    console.log('\n📧 Test Credentials:');
    console.log('   Email: [any-email@test.com from above]');
    console.log('   Password: TestPassword123!');
    console.log('\n💳 Subscription Plans:');
    console.log('   - 2 contractors with PREMIUM subscription');
    console.log('   - 1 contractor with ENTERPRISE subscription');
    console.log('   - 2 contractors with STANDARD subscription');
    console.log('\n✅ All contractors are approved and have active subscriptions');

  } catch (error) {
    console.error('❌ Error seeding data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

