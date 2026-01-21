import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Service seed data
 * All services that should be available in the platform
 */
export const servicesData = [
  {
    name: 'Bathroom Fitting',
    description: 'Complete bathroom fitting and renovation services',
    category: 'Home Improvement',
    smallJobPrice: 25.00,
    mediumJobPrice: 35.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Bricklaying',
    description: 'Professional bricklaying and masonry services',
    category: 'Construction',
    smallJobPrice: 20.00,
    mediumJobPrice: 30.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Carpentry',
    description: 'Custom carpentry and woodworking services',
    category: 'Trade Services',
    smallJobPrice: 15.00,
    mediumJobPrice: 30.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Central Heating',
    description: 'Central heating installation and maintenance',
    category: 'Home Systems',
    smallJobPrice: 20.00,
    mediumJobPrice: 35.00,
    largeJobPrice: 60.00,
    isActive: true,
  },
  {
    name: 'Conversions',
    description: 'Home conversions and extensions',
    category: 'Construction',
    smallJobPrice: 30.00,
    mediumJobPrice: 50.00,
    largeJobPrice: 80.00,
    isActive: true,
  },
  {
    name: 'Electrical',
    description: 'Electrical installation, repair, and safety services',
    category: 'Trade Services',
    smallJobPrice: 15.00,
    mediumJobPrice: 30.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Flooring',
    description: 'Flooring installation and repair services',
    category: 'Home Improvement',
    smallJobPrice: 20.00,
    mediumJobPrice: 35.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Garden Landscaping',
    description: 'Garden design, landscaping, and maintenance services',
    category: 'Outdoor',
    smallJobPrice: 25.00,
    mediumJobPrice: 40.00,
    largeJobPrice: 60.00,
    isActive: true,
  },
  {
    name: 'Kitchen Fitting',
    description: 'Complete kitchen fitting and renovation services',
    category: 'Home Improvement',
    smallJobPrice: 30.00,
    mediumJobPrice: 45.00,
    largeJobPrice: 60.00,
    isActive: true,
  },
  {
    name: 'Painting & Decorating',
    description: 'Interior and exterior painting and decorating services',
    category: 'Decoration',
    smallJobPrice: 15.00,
    mediumJobPrice: 25.00,
    largeJobPrice: 40.00,
    isActive: true,
  },
  {
    name: 'Plastering',
    description: 'Professional plastering and rendering services',
    category: 'Trade Services',
    smallJobPrice: 20.00,
    mediumJobPrice: 35.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Plumbing',
    description: 'Plumbing installation, repair, and maintenance services',
    category: 'Trade Services',
    smallJobPrice: 15.00,
    mediumJobPrice: 25.00,
    largeJobPrice: 40.00,
    isActive: true,
  },
  {
    name: 'Roofing',
    description: 'Roof installation, repair, and maintenance services',
    category: 'Construction',
    smallJobPrice: 25.00,
    mediumJobPrice: 40.00,
    largeJobPrice: 60.00,
    isActive: true,
  },
  {
    name: 'Tiling',
    description: 'Professional tiling services for all surfaces',
    category: 'Home Improvement',
    smallJobPrice: 20.00,
    mediumJobPrice: 35.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Windows & Doors',
    description: 'Window and door installation and repair',
    category: 'Home Systems',
    smallJobPrice: 15.00,
    mediumJobPrice: 30.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Other',
    description: 'Other services not listed above',
    category: 'Other',
    smallJobPrice: 15.00,
    mediumJobPrice: 25.00,
    largeJobPrice: 40.00,
    isActive: true,
  },
  // Placeholder services that can be renamed from admin panel
  {
    name: 'Custom Service 1',
    description: 'Placeholder for additional service (can be renamed from admin)',
    category: 'Custom',
    smallJobPrice: 15.00,
    mediumJobPrice: 25.00,
    largeJobPrice: 40.00,
    isActive: false,
  },
  {
    name: 'Custom Service 2',
    description: 'Placeholder for additional service (can be renamed from admin)',
    category: 'Custom',
    smallJobPrice: 15.00,
    mediumJobPrice: 25.00,
    largeJobPrice: 40.00,
    isActive: false,
  },
  {
    name: 'Custom Service 3',
    description: 'Placeholder for additional service (can be renamed from admin)',
    category: 'Custom',
    smallJobPrice: 15.00,
    mediumJobPrice: 25.00,
    largeJobPrice: 40.00,
    isActive: false,
  },
  {
    name: 'Custom Service 4',
    description: 'Placeholder for additional service (can be renamed from admin)',
    category: 'Custom',
    smallJobPrice: 15.00,
    mediumJobPrice: 25.00,
    largeJobPrice: 40.00,
    isActive: false,
  },
  {
    name: 'Custom Service 5',
    description: 'Placeholder for additional service (can be renamed from admin)',
    category: 'Custom',
    smallJobPrice: 15.00,
    mediumJobPrice: 25.00,
    largeJobPrice: 40.00,
    isActive: false,
  },
];

/**
 * Seed services into the database
 * @param prismaClient - Prisma client instance
 */
export async function seedServices(prismaClient: PrismaClient = prisma) {
  console.log('📋 Seeding services...');
  
  const createdServices: any[] = [];
  for (const service of servicesData) {
    const created = await prismaClient.service.upsert({
      where: { name: service.name },
      update: {
        description: service.description,
        category: service.category,
        smallJobPrice: service.smallJobPrice,
        mediumJobPrice: service.mediumJobPrice,
        largeJobPrice: service.largeJobPrice,
        isActive: service.isActive,
      },
      create: {
        name: service.name,
        description: service.description,
        category: service.category,
        smallJobPrice: service.smallJobPrice,
        mediumJobPrice: service.mediumJobPrice,
        largeJobPrice: service.largeJobPrice,
        isActive: service.isActive,
      },
    });
    createdServices.push(created);
    console.log(`  ✅ ${service.name} - ${service.isActive ? 'Active' : 'Inactive'}`);
  }
  
  console.log(`\n  ✅ ${createdServices.length} services seeded successfully\n`);
  return createdServices;
}

/**
 * Standalone execution for services seed only
 * Run with: tsx prisma/seed-services.ts
 */
if (require.main === module) {
  seedServices()
    .then(() => {
      console.log('✅ Services seed completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Error seeding services:', error);
      process.exit(1);
    });
}
