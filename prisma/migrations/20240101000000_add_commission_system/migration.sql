-- Add subscription plan type enum
CREATE TYPE "SubscriptionPlan" AS ENUM ('MONTHLY', 'SIX_MONTHS', 'YEARLY');

-- Add commission status enum  
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'WAIVED');

-- Add plan field to subscriptions table
ALTER TABLE "subscriptions" ADD COLUMN "plan" "SubscriptionPlan" NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "subscriptions" ADD COLUMN "monthlyPrice" DECIMAL(8,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "subscriptions" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Create commission payments table
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

-- Create invoices table for commission invoices
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

-- Add indexes
CREATE UNIQUE INDEX "commission_payments_jobId_key" ON "commission_payments"("jobId");
CREATE UNIQUE INDEX "commission_invoices_commissionPaymentId_key" ON "commission_invoices"("commissionPaymentId");
CREATE UNIQUE INDEX "commission_invoices_invoiceNumber_key" ON "commission_invoices"("invoiceNumber");
CREATE INDEX "commission_payments_contractorId_idx" ON "commission_payments"("contractorId");
CREATE INDEX "commission_payments_status_idx" ON "commission_payments"("status");
CREATE INDEX "commission_payments_dueDate_idx" ON "commission_payments"("dueDate");

-- Add foreign key constraints
ALTER TABLE "commission_payments" ADD CONSTRAINT "commission_payments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_payments" ADD CONSTRAINT "commission_payments_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_payments" ADD CONSTRAINT "commission_payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_invoices" ADD CONSTRAINT "commission_invoices_commissionPaymentId_fkey" FOREIGN KEY ("commissionPaymentId") REFERENCES "commission_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
