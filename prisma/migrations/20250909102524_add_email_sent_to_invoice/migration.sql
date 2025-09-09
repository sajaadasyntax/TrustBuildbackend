-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('MONTHLY', 'SIX_MONTHS', 'YEARLY');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INFO', 'WARNING', 'SUCCESS', 'ERROR', 'COMMISSION_DUE', 'COMMISSION_OVERDUE', 'SUBSCRIPTION_EXPIRING', 'JOB_PURCHASED', 'REVIEW_RECEIVED', 'ACCOUNT_SUSPENDED');

-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE 'COMMISSION';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "emailSent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "monthlyPrice" DECIMAL(8,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "plan" "SubscriptionPlan" NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notificationSettings" JSONB NOT NULL DEFAULT '{"email": true, "inApp": true, "commission": true, "subscription": true, "jobs": true, "reviews": true}';

-- CreateTable
CREATE TABLE "commission_payments" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "finalJobAmount" DECIMAL(10,2) NOT NULL,
    "commissionRate" DECIMAL(4,2) NOT NULL DEFAULT 5.00,
    "commissionAmount" DECIMAL(10,2) NOT NULL,
    "vatAmount" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "stripePaymentId" TEXT,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderSent" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_invoices" (
    "id" TEXT NOT NULL,
    "commissionPaymentId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "contractorName" TEXT NOT NULL,
    "contractorEmail" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "finalJobAmount" DECIMAL(10,2) NOT NULL,
    "commissionAmount" DECIMAL(10,2) NOT NULL,
    "vatAmount" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'INFO',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "actionLink" TEXT,
    "actionText" TEXT,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_actions" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_payments_jobId_key" ON "commission_payments"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "commission_invoices_commissionPaymentId_key" ON "commission_invoices"("commissionPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "commission_invoices_invoiceNumber_key" ON "commission_invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- AddForeignKey
ALTER TABLE "commission_payments" ADD CONSTRAINT "commission_payments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payments" ADD CONSTRAINT "commission_payments_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payments" ADD CONSTRAINT "commission_payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_invoices" ADD CONSTRAINT "commission_invoices_commissionPaymentId_fkey" FOREIGN KEY ("commissionPaymentId") REFERENCES "commission_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
