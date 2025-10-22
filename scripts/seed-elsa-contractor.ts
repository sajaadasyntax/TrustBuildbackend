import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Elsa as subscribed contractor...');

  try {
    const contractorData = {
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
      plan: 'PREMIUM', // You can change this to 'STANDARD' or 'ENTERPRISE' if needed
    };

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: contractorData.email },
    });

    if (existingUser) {
      console.log(`⏭️  User ${contractorData.email} already exists`);
      
      // Check if they have a contractor profile
      const existingContractor = await prisma.contractor.findUnique({
        where: { userId: existingUser.id },
        include: { subscription: true },
      });

      if (existingContractor) {
        console.log(`✅ Contractor profile already exists`);
        if (existingContractor.subscription) {
          console.log(`✅ Subscription already exists (${existingContractor.subscription.tier})`);
        } else {
          console.log(`⚠️  No subscription found. Creating one...`);
          
          // Create subscription if missing
          const currentPeriodEnd = new Date();
          currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

          await prisma.subscription.create({
            data: {
              contractorId: existingContractor.id,
              tier: contractorData.plan as any,
              plan: 'MONTHLY',
              status: 'active',
              isActive: true,
              currentPeriodStart: new Date(),
              currentPeriodEnd,
              stripeSubscriptionId: `sub_elsa_${existingContractor.id}`,
              monthlyPrice: contractorData.plan === 'ENTERPRISE' ? 99.99 : contractorData.plan === 'PREMIUM' ? 49.99 : 19.99,
            },
          });

          console.log(`✅ Created ${contractorData.plan} subscription`);
        }
      } else {
        console.log(`⚠️  No contractor profile found. Creating one...`);
        
        // Create contractor profile for existing user
        const contractor = await prisma.contractor.create({
          data: {
            userId: existingUser.id,
            businessName: contractorData.businessName,
            description: contractorData.description,
            phone: contractorData.phone,
            city: contractorData.city,
            postcode: contractorData.postcode,
            operatingArea: contractorData.operatingArea,
            servicesProvided: contractorData.servicesProvided,
            yearsExperience: contractorData.yearsExperience,
            profileApproved: true,
            status: 'VERIFIED',
            averageRating: 4.8,
            tier: contractorData.plan as any,
            creditsBalance: contractorData.plan === 'ENTERPRISE' ? 100 : contractorData.plan === 'PREMIUM' ? 50 : 20,
            weeklyCreditsLimit: contractorData.plan === 'ENTERPRISE' ? 100 : contractorData.plan === 'PREMIUM' ? 50 : 20,
          },
        });

        // Create subscription
        const currentPeriodEnd = new Date();
        currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

        await prisma.subscription.create({
          data: {
            contractorId: contractor.id,
            tier: contractorData.plan as any,
            plan: 'MONTHLY',
            status: 'active',
            isActive: true,
            currentPeriodStart: new Date(),
            currentPeriodEnd,
            stripeSubscriptionId: `sub_elsa_${contractor.id}`,
            monthlyPrice: contractorData.plan === 'ENTERPRISE' ? 99.99 : contractorData.plan === 'PREMIUM' ? 49.99 : 19.99,
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

        console.log(`✅ Created contractor profile and ${contractorData.plan} subscription`);
      }

      console.log('\n🎉 Update completed!');
      return;
    }

    // Create new user
    const password = await hash('TestPassword123!', 12);
    
    const user = await prisma.user.create({
      data: {
        name: contractorData.name,
        email: contractorData.email,
        password,
        role: 'CONTRACTOR',
        isActive: true,
      },
    });

    console.log(`✅ Created user account`);

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
        status: 'VERIFIED',
        averageRating: 4.8,
        tier: contractorData.plan as any,
        creditsBalance: contractorData.plan === 'ENTERPRISE' ? 100 : contractorData.plan === 'PREMIUM' ? 50 : 20,
        weeklyCreditsLimit: contractorData.plan === 'ENTERPRISE' ? 100 : contractorData.plan === 'PREMIUM' ? 50 : 20,
      },
    });

    console.log(`✅ Created contractor profile`);

    // Create active subscription
    const currentPeriodEnd = new Date();
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

    await prisma.subscription.create({
      data: {
        contractorId: contractor.id,
        tier: contractorData.plan as any,
        plan: 'MONTHLY',
        status: 'active',
        isActive: true,
        currentPeriodStart: new Date(),
        currentPeriodEnd,
        stripeSubscriptionId: `sub_elsa_${contractor.id}`,
        monthlyPrice: contractorData.plan === 'ENTERPRISE' ? 99.99 : contractorData.plan === 'PREMIUM' ? 49.99 : 19.99,
      },
    });

    console.log(`✅ Created ${contractorData.plan} subscription`);

    // Create KYC record
    await prisma.contractorKyc.create({
      data: {
        contractorId: contractor.id,
        status: 'APPROVED',
        submittedAt: new Date(),
        reviewedAt: new Date(),
      },
    });

    console.log(`✅ Created KYC approval`);

    console.log('\n🎉 Seeding completed successfully!');
    console.log('\n📧 Login Credentials:');
    console.log(`   Email: ${contractorData.email}`);
    console.log('   Password: TestPassword123!');
    console.log(`\n💳 Subscription: ${contractorData.plan} (Monthly)`);
    console.log(`   Credits: ${contractorData.plan === 'ENTERPRISE' ? 100 : contractorData.plan === 'PREMIUM' ? 50 : 20}`);
    console.log('\n✅ Contractor is approved with active subscription and KYC verified');

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

