const { PrismaClient } = require('@prisma/client');
const { createServiceEmail, createEmailService } = require('../dist/src/services/emailService');

const prisma = new PrismaClient();

async function runKycDeadlineJob() {
  console.log('📋 Starting KYC deadline cron job...');
  console.log(`📅 Current time: ${new Date().toISOString()}`);

  try {
    const now = new Date();

    // Find KYC records that are overdue
    const overdueKyc = await prisma.contractorKyc.findMany({
      where: {
        status: {
          in: ['PENDING', 'SUBMITTED'],
        },
        dueBy: {
          lt: now,
        },
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

    for (const kyc of overdueKyc) {
      // Update KYC status to OVERDUE
      await prisma.contractorKyc.update({
        where: { id: kyc.id },
        data: { status: 'OVERDUE' },
      });

      // Pause contractor account
      await prisma.contractor.update({
        where: { id: kyc.contractorId },
        data: {
          accountStatus: 'PAUSED',
        },
      });

      // Send notification email
      const emailService = createEmailService();
      const emailContent = createServiceEmail({
        to: kyc.contractor.user.email,
        subject: '⚠️ KYC Verification Overdue - Account Paused - TrustBuild',
        heading: 'KYC Verification Required',
        body: `
          <p>Dear ${kyc.contractor.user.name},</p>
          <p>Your KYC verification documents were due by ${kyc.dueBy?.toLocaleDateString()} but have not been submitted.</p>
          <p><strong>Your account has been temporarily paused.</strong></p>
          <p>To reactivate your account, please submit your verification documents as soon as possible:</p>
          <ul>
            <li>Government-issued ID (passport, driving license)</li>
            <li>Recent utility bill (within 3 months)</li>
            <li>Company number (if applicable)</li>
          </ul>
          <p>Once submitted, our team will review your documents and reactivate your account within 24-48 hours.</p>
        `,
        ctaText: 'Submit Documents Now',
        ctaUrl: `${process.env.FRONTEND_URL}/dashboard/kyc`,
      });

      await emailService.sendMail(emailContent);

      console.log(`⚠️ KYC overdue for contractor ${kyc.contractor.user.email} - account paused`);
    }

    // Find KYC records due soon (within 3 days) and send warning
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    const dueSoonKyc = await prisma.contractorKyc.findMany({
      where: {
        status: {
          in: ['PENDING'],
        },
        dueBy: {
          gte: now,
          lte: threeDaysFromNow,
        },
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

    for (const kyc of dueSoonKyc) {
      const emailService = createEmailService();
      const daysRemaining = Math.ceil((kyc.dueBy - now) / (1000 * 60 * 60 * 24));
      
      const emailContent = createServiceEmail({
        to: kyc.contractor.user.email,
        subject: `⏰ KYC Verification Due in ${daysRemaining} Days - TrustBuild`,
        heading: 'KYC Verification Reminder',
        body: `
          <p>Dear ${kyc.contractor.user.name},</p>
          <p>This is a friendly reminder that your KYC verification documents are due in <strong>${daysRemaining} days</strong> (by ${kyc.dueBy?.toLocaleDateString()}).</p>
          <p>Please submit the following documents before the deadline to avoid account suspension:</p>
          <ul>
            <li>Government-issued ID (passport, driving license)</li>
            <li>Recent utility bill (within 3 months)</li>
            <li>Company number (if applicable)</li>
          </ul>
          <p>Completing your verification allows you to access all platform features without interruption.</p>
        `,
        ctaText: 'Submit Documents',
        ctaUrl: `${process.env.FRONTEND_URL}/dashboard/kyc`,
      });

      await emailService.sendMail(emailContent);

      console.log(`⏰ KYC reminder sent to ${kyc.contractor.user.email} - ${daysRemaining} days remaining`);
    }

    console.log(`✅ KYC deadline job completed`);
    console.log(`   - Overdue KYC records: ${overdueKyc.length}`);
    console.log(`   - Due soon reminders: ${dueSoonKyc.length}`);
  } catch (error) {
    console.error('❌ KYC deadline job failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the job
runKycDeadlineJob()
  .then(() => {
    console.log('✅ KYC deadline cron job finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ KYC deadline cron job failed:', error);
    process.exit(1);
  });

