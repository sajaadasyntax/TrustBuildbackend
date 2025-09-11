const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function updateJobLimits() {
  console.log('🔄 Updating job contractor limits...');

  try {
    // Update all jobs with low contractor limits to a more reasonable number
    const result = await prisma.job.updateMany({
      where: {
        maxContractorsPerJob: {
          lt: 5 // Less than 5
        }
      },
      data: {
        maxContractorsPerJob: 10 // Set to 10
      }
    });

    console.log(`✅ Updated ${result.count} jobs with low contractor limits`);

    // Get a summary of current limits
    const limitStats = await prisma.job.groupBy({
      by: ['maxContractorsPerJob'],
      _count: {
        id: true
      },
      orderBy: {
        maxContractorsPerJob: 'asc'
      }
    });

    console.log('📊 Current job contractor limits distribution:');
    limitStats.forEach(stat => {
      console.log(`  ${stat.maxContractorsPerJob} contractors: ${stat._count.id} jobs`);
    });

  } catch (error) {
    console.error('❌ Error updating job limits:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateJobLimits();
