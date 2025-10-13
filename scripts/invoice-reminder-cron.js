const { PrismaClient } = require('@prisma/client');
const { sendInvoiceReminder } = require('../dist/src/services/manualInvoiceService');

const prisma = new PrismaClient();

async function runInvoiceReminderJob() {
  console.log('🔔 Starting invoice reminder cron job...');
  console.log(`📅 Current time: ${new Date().toISOString()}`);

  try {
    const now = new Date();

    // Find invoices that need reminders
    // 1. Issued invoices approaching due date (3 days before)
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    // 2. Overdue invoices
    const overdueInvoices = await prisma.manualInvoice.findMany({
      where: {
        status: {
          in: ['ISSUED', 'OVERDUE'],
        },
        dueDate: {
          lt: now,
        },
        paidAt: null,
      },
      include: {
        contractor: {
          include: {
            user: {
              select: {
                email: true,
                name: true,
              },
            },
          },
        },
      },
    });

    // Mark overdue invoices
    for (const invoice of overdueInvoices) {
      if (invoice.status !== 'OVERDUE') {
        await prisma.manualInvoice.update({
          where: { id: invoice.id },
          data: { status: 'OVERDUE' },
        });
      }

      // Send reminder if not sent recently (within 7 days)
      const daysSinceLastReminder = invoice.lastReminderAt
        ? (now - invoice.lastReminderAt) / (1000 * 60 * 60 * 24)
        : 999;

      if (daysSinceLastReminder >= 7) {
        try {
          await sendInvoiceReminder(invoice.id);
          console.log(`📧 Sent overdue reminder for invoice ${invoice.number}`);
        } catch (error) {
          console.error(`❌ Failed to send reminder for ${invoice.number}:`, error.message);
        }
      }
    }

    // Find invoices due soon (within 3 days)
    const dueSoonInvoices = await prisma.manualInvoice.findMany({
      where: {
        status: 'ISSUED',
        dueDate: {
          gte: now,
          lte: threeDaysFromNow,
        },
        paidAt: null,
        remindersSent: 0, // Only send if no reminders sent yet
      },
    });

    for (const invoice of dueSoonInvoices) {
      try {
        await sendInvoiceReminder(invoice.id);
        console.log(`📧 Sent due soon reminder for invoice ${invoice.number}`);
      } catch (error) {
        console.error(`❌ Failed to send reminder for ${invoice.number}:`, error.message);
      }
    }

    console.log(`✅ Invoice reminder job completed`);
    console.log(`   - Overdue invoices processed: ${overdueInvoices.length}`);
    console.log(`   - Due soon reminders sent: ${dueSoonInvoices.length}`);
  } catch (error) {
    console.error('❌ Invoice reminder job failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the job
runInvoiceReminderJob()
  .then(() => {
    console.log('✅ Invoice reminder cron job finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Invoice reminder cron job failed:', error);
    process.exit(1);
  });

