import { PrismaClient } from '@prisma/client';

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
    description: 'Brickwork, blockwork, garden walls, repairs and structural masonry services.',
    category: 'Construction',
    smallJobPrice: 20.00,
    mediumJobPrice: 30.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Carpentry',
    description: 'Custom carpentry, woodwork, door fitting, repairs and bespoke joinery services.',
    category: 'Trade Services',
    smallJobPrice: 15.00,
    mediumJobPrice: 30.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Central Heating',
    description: 'Boiler installation, radiator fitting, central heating repairs and servicing.',
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
    description: 'Electrical installation, rewiring, lighting, repairs, testing and safety services.',
    category: 'Trade Services',
    smallJobPrice: 15.00,
    mediumJobPrice: 30.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Flooring',
    description: 'Installation and repair of laminate, vinyl, hardwood, engineered wood and carpets.',
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
    description: 'Interior and exterior painting, wallpapering and decorating services.',
    category: 'Decoration',
    smallJobPrice: 15.00,
    mediumJobPrice: 25.00,
    largeJobPrice: 40.00,
    isActive: true,
  },
  {
    name: 'Plastering',
    description: 'Professional plastering, skimming, rendering and wall repair services.',
    category: 'Trade Services',
    smallJobPrice: 20.00,
    mediumJobPrice: 35.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Plumbing',
    description: 'Plumbing installation, leak repairs, pipework, bathrooms and general maintenance.',
    category: 'Trade Services',
    smallJobPrice: 15.00,
    mediumJobPrice: 25.00,
    largeJobPrice: 40.00,
    isActive: true,
  },
  {
    name: 'Roofing',
    description: 'Roof installation, repairs, leak detection, waterproofing and maintenance.',
    category: 'Construction',
    smallJobPrice: 25.00,
    mediumJobPrice: 40.00,
    largeJobPrice: 60.00,
    isActive: true,
  },
  {
    name: 'Tiling',
    description: 'Professional wall and floor tiling for kitchens, bathrooms and living areas.',
    category: 'Home Improvement',
    smallJobPrice: 20.00,
    mediumJobPrice: 35.00,
    largeJobPrice: 50.00,
    isActive: true,
  },
  {
    name: 'Windows & Doors',
    description: 'Window and door installation, glazing, repairs, locks and maintenance.',
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
  // Expanded homeowner and commercial service catalogue.
  ...[
    { name: 'Heating', description: 'Boiler installation, radiator fitting, central heating repairs and servicing.', category: 'Home Systems' },
    { name: 'Gas Services', description: 'Gas appliance installation, servicing, safety inspections and certified repairs.', category: 'Home Systems' },
    { name: 'Plumbing & Repairs', description: 'General plumbing services, including leak repairs, tap and toilet replacements, pipe repairs, bathroom plumbing installations and maintenance.', category: 'Trade Services' },
    { name: 'Bathroom Renovation', description: 'Complete bathroom refurbishment, plumbing, tiling and fixture installation.', category: 'Home Improvement' },
    { name: 'Kitchen Renovation', description: 'Complete kitchen fitting, cabinets, worktops, appliances and renovations.', category: 'Home Improvement' },
    { name: 'Home Renovation', description: 'Full property refurbishment and complete home improvement services.', category: 'Home Improvement' },
    { name: 'General Building', description: 'Building work, structural alterations, extensions and renovation projects.', category: 'Construction' },
    { name: 'Extensions', description: 'Single and double-storey home extensions built to a high standard.', category: 'Construction' },
    { name: 'Loft Conversion', description: 'Professional loft conversions to create additional living space.', category: 'Construction' },
    { name: 'Garage Conversion', description: 'Convert garages into bedrooms, offices or living spaces.', category: 'Construction' },
    { name: 'Flat Roofing', description: 'Installation and repair of felt, EPDM, fibreglass and flat roofing systems.', category: 'Construction' },
    { name: 'Guttering', description: 'Gutter installation, repairs, cleaning and rainwater drainage solutions.', category: 'Construction' },
    { name: 'Chimney Services', description: 'Chimney repairs, rebuilding, repointing and maintenance.', category: 'Construction' },
    { name: 'Repointing', description: 'Brick repointing and mortar repairs to restore masonry strength.', category: 'Construction' },
    { name: 'Rendering', description: 'External wall rendering, silicone render and decorative finishes.', category: 'Construction' },
    { name: 'Damp Proofing', description: 'Damp treatment, waterproofing, mould removal and moisture control.', category: 'Property Maintenance' },
    { name: 'Mould Removal', description: 'Professional mould treatment, prevention and damaged surface restoration.', category: 'Property Maintenance' },
    { name: 'Insulation', description: 'Loft, wall and floor insulation to improve energy efficiency.', category: 'Home Systems' },
    { name: 'Glazing', description: 'Double glazing installation, replacement glass and repairs.', category: 'Home Systems' },
    { name: 'Locksmith', description: 'Lock installation, repairs, replacements and emergency lockout services.', category: 'Home Systems' },
    { name: 'Handyman', description: 'General repairs, installations, furniture assembly and home maintenance.', category: 'Property Maintenance' },
    { name: 'Property Maintenance', description: 'Residential and commercial property maintenance and repair services.', category: 'Property Maintenance' },
    { name: 'Facilities Maintenance', description: 'Planned and reactive maintenance for commercial buildings.', category: 'Commercial Services' },
    { name: 'Cleaning Services', description: 'Domestic, commercial, end of tenancy and after builders cleaning.', category: 'Cleaning' },
    { name: 'Window Cleaning', description: 'Professional interior and exterior window cleaning services.', category: 'Cleaning' },
    { name: 'Pressure Washing', description: 'Driveway, patio, decking and exterior surface pressure cleaning.', category: 'Outdoor' },
    { name: 'Driveways', description: 'Driveway installation using block paving, resin, concrete and tarmac.', category: 'Outdoor' },
    { name: 'Block Paving', description: 'Block paving installation, repairs and driveway restoration.', category: 'Outdoor' },
    { name: 'Patios', description: 'Patio installation, repairs and paving for outdoor spaces.', category: 'Outdoor' },
    { name: 'Landscaping', description: 'Garden landscaping, planting, turfing and outdoor improvements.', category: 'Outdoor' },
    { name: 'Gardening', description: 'Garden maintenance, hedge trimming, planting and lawn care.', category: 'Outdoor' },
    { name: 'Fencing', description: 'Fence installation, repairs, gates and concrete post replacement.', category: 'Outdoor' },
    { name: 'Decking', description: 'Timber and composite decking installation and repairs.', category: 'Outdoor' },
    { name: 'Tree Surgery', description: 'Tree pruning, removal, stump grinding and maintenance.', category: 'Outdoor' },
    { name: 'Drainage', description: 'Blocked drains, drainage repairs, inspections and maintenance.', category: 'Property Maintenance' },
    { name: 'Waste Removal', description: 'House clearance, garden waste and construction waste disposal.', category: 'Property Maintenance' },
    { name: 'Demolition', description: 'Safe demolition and site clearance services.', category: 'Construction' },
    { name: 'Scaffolding', description: 'Scaffold supply, erection and dismantling services.', category: 'Construction' },
    { name: 'Concrete Services', description: 'Concrete bases, foundations, paths and structural concrete work.', category: 'Construction' },
    { name: 'Paving', description: 'Garden paths, paving slabs and outdoor surface installation.', category: 'Outdoor' },
    { name: 'Stonework', description: 'Natural stone installation, restoration and repairs.', category: 'Construction' },
    { name: 'Cladding', description: 'External wall cladding installation and replacement.', category: 'Construction' },
    { name: 'Metalwork & Welding', description: 'Metal fabrication, welding, gates, railings and repairs.', category: 'Specialist Services' },
    { name: 'Security Systems', description: 'CCTV, alarms, access control and security system installation.', category: 'Home Systems' },
    { name: 'Smart Home Installation', description: 'Smart lighting, heating, cameras and home automation systems.', category: 'Home Systems' },
    { name: 'Appliance Installation', description: 'Installation and connection of kitchen and household appliances.', category: 'Home Systems' },
    { name: 'Air Conditioning', description: 'Air conditioning installation, servicing and repairs.', category: 'Home Systems' },
    { name: 'Ventilation', description: 'Extractor fans, ventilation systems and air quality improvements.', category: 'Home Systems' },
    { name: 'Solar Panels', description: 'Solar panel installation, maintenance and energy solutions.', category: 'Renewable Energy' },
    { name: 'EV Charger Installation', description: 'Electric vehicle charging point installation and maintenance.', category: 'Renewable Energy' },
    { name: 'Pest Control', description: 'Professional pest prevention, treatment and removal services.', category: 'Specialist Services' },
    { name: 'Asbestos Removal', description: 'Licensed asbestos inspection, removal and disposal services.', category: 'Specialist Services' },
    { name: 'Fire Safety', description: 'Fire doors, alarms, extinguishers and compliance services.', category: 'Specialist Services' },
    { name: 'Commercial Fit Out', description: 'Office, retail and commercial property refurbishment services.', category: 'Commercial Services' },
    { name: 'Office Refurbishment', description: 'Office renovation, partitioning and workspace improvements.', category: 'Commercial Services' },
    { name: 'Shop Fitting', description: 'Retail shop fitting, displays and interior fit out services.', category: 'Commercial Services' },
    { name: 'Warehouse Maintenance', description: 'Industrial property repairs and maintenance services.', category: 'Commercial Services' },
    { name: 'Bathroom Repairs', description: 'Bathroom repairs, resealing, leak fixing and maintenance.', category: 'Home Improvement' },
    { name: 'Kitchen Repairs', description: 'Kitchen repairs, cabinet adjustments and worktop replacement.', category: 'Home Improvement' },
    { name: 'Ceiling Repairs', description: 'Ceiling crack repairs, water damage restoration and replastering.', category: 'Property Maintenance' },
    { name: 'Wall Repairs', description: 'Wall crack repairs, patching and surface restoration.', category: 'Property Maintenance' },
    { name: 'Floor Repairs', description: 'Repair of damaged timber, laminate, vinyl and tiled flooring.', category: 'Home Improvement' },
    { name: 'Door Repairs', description: 'Door adjustment, repair, replacement and hardware installation.', category: 'Home Improvement' },
    { name: 'Window Repairs', description: 'Window repairs, hinges, handles, locks and glazing replacement.', category: 'Home Systems' },
    { name: 'Roof Repairs', description: 'Emergency roof repairs and leak prevention services.', category: 'Construction' },
    { name: 'Emergency Repairs', description: '24/7 emergency property repair and maintenance services.', category: 'Property Maintenance' },
  ].map((service) => ({
    ...service,
    smallJobPrice: 15.00,
    mediumJobPrice: 30.00,
    largeJobPrice: 50.00,
    isActive: true,
  })),
];

/**
 * Seed services into the database
 * @param prismaClient - Prisma client instance
 */
export async function seedServices(prismaClient: PrismaClient) {
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
  const standalonePrisma = new PrismaClient();
  seedServices(standalonePrisma)
    .then(() => {
      console.log('✅ Services seed completed successfully');
    })
    .catch((error) => {
      console.error('❌ Error seeding services:', error);
      process.exitCode = 1;
    })
    .finally(() => standalonePrisma.$disconnect());
}
