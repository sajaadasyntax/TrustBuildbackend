const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function processFinalPriceReminders() {
  console.log('🔄 Processing final price confirmation reminders...');
  
  const now = new Date();
  
  // Get all jobs awaiting final price confirmation
  const jobs = await prisma.job.findMany({
    where: {
      status: 'AWAITING_FINAL_PRICE_CONFIRMATION',
      finalPriceTimeoutAt: {
        not: null,
      },
    },
    include: {
      customer: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      wonByContractor: {
        include: {
          user: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  for (const job of jobs) {
    if (!job.finalPriceTimeoutAt || !job.contractorProposedAmount) {
      continue;
    }

    const timeUntilTimeout = job.finalPriceTimeoutAt.getTime() - now.getTime();
    const hoursRemaining = Math.ceil(timeUntilTimeout / (1000 * 60 * 60));
    
    // Send reminders at 24h, 12h, 6h, 2h, and 1h before timeout
    const reminderHours = [24, 12, 6, 2, 1];
    
    for (const reminderHour of reminderHours) {
      if (hoursRemaining <= reminderHour && hoursRemaining > 0) {
        // Check if we've already sent a reminder for this hour
        const existingNotification = await prisma.notification.findFirst({
          where: {
            userId: job.customer.userId,
            type: 'FINAL_PRICE_CONFIRMATION_REMINDER',
            metadata: {
              path: ['jobId'],
              equals: job.id,
            },
            createdAt: {
              gte: new Date(now.getTime() - (reminderHour * 60 * 60 * 1000)),
            },
          },
        });

        if (!existingNotification) {
          try {
            // Create the reminder notification
            await prisma.notification.create({
              data: {
                userId: job.customer.userId,
                title: `⏰ Final Price Confirmation Reminder`,
                message: `You have ${hoursRemaining} hours to confirm the final price of £${job.contractorProposedAmount.toFixed(2)} for job "${job.title}".`,
                type: 'FINAL_PRICE_CONFIRMATION_REMINDER',
                actionLink: `/dashboard/client/jobs/${job.id}`,
                actionText: 'Confirm Price',
                metadata: {
                  jobId: job.id,
                  jobTitle: job.title,
                  proposedAmount: job.contractorProposedAmount,
                  hoursRemaining,
                },
              },
            });
            console.log(`📧 Final price reminder sent for job ${job.id} (${hoursRemaining}h remaining)`);
          } catch (error) {
            console.error(`Failed to send final price reminder for job ${job.id}:`, error);
          }
        }
        break; // Only send one reminder per check
      }
    }
  }
  
  console.log(`✅ Processed ${jobs.length} jobs awaiting final price confirmation`);
}

async function processFinalPriceTimeouts() {
  console.log('🔄 Processing final price timeouts...');
  
  const now = new Date();
  
  // Get all jobs that have timed out
  const timedOutJobs = await prisma.job.findMany({
    where: {
      status: 'AWAITING_FINAL_PRICE_CONFIRMATION',
      finalPriceTimeoutAt: {
        lte: now,
      },
    },
    include: {
      customer: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      wonByContractor: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  for (const job of timedOutJobs) {
    if (!job.contractorProposedAmount) {
      continue;
    }

    // Auto-confirm the final price and mark job as completed
    await prisma.job.update({
      where: { id: job.id },
      data: {
        finalAmount: job.contractorProposedAmount,
        finalPriceConfirmedAt: now,
        status: 'COMPLETED',
        completionDate: now,
        customerConfirmed: true,
        adminOverrideAt: now,
        adminOverrideBy: 'system',
      },
    });

    console.log(`✅ Auto-confirmed final price for job ${job.id} (timed out)`);
  }
  
  console.log(`✅ Processed ${timedOutJobs.length} timed out jobs`);
}

async function main() {
  try {
    await processFinalPriceReminders();
    await processFinalPriceTimeouts();
  } catch (error) {
    console.error('Error processing final price reminders:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
