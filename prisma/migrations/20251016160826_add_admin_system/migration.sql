-- CreateEnum
CREATE TYPE "ContractorAccountStatus" AS ENUM ('ACTIVE', 'PAUSED', 'FROZEN', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ManualInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'OVERDUE', 'PAID', 'CANCELED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'JOB_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'JOB_STARTED';
ALTER TYPE "NotificationType" ADD VALUE 'JOB_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_HOLD';
ALTER TYPE "NotificationType" ADD VALUE 'MESSAGE_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'CONTRACTOR_SELECTED';
ALTER TYPE "NotificationType" ADD VALUE 'FINAL_PRICE_PROPOSED';
ALTER TYPE "NotificationType" ADD VALUE 'FINAL_PRICE_CONFIRMATION_REMINDER';

-- AlterTable
ALTER TABLE "contractors" ADD COLUMN     "accountStatus" "ContractorAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "freeJobAllocation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "frozenAt" TIMESTAMP(3),
ADD COLUMN     "frozenBy" TEXT,
ADD COLUMN     "frozenReason" TEXT;

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "permissions" JSONB,
    "twoFAEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFASecret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "description" TEXT,
    "diff" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_activities" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "city" TEXT,
    "country" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "contractor_kyc" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "idDocPath" TEXT,
    "utilityDocPath" TEXT,
    "companyNumber" TEXT,
    "submittedAt" TIMESTAMP(3),
    "dueBy" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_kyc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_invoices" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ManualInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "reason" TEXT,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "dueDate" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "pdfPath" TEXT,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_invoice_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "manual_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "activity_logs_adminId_idx" ON "activity_logs"("adminId");

-- CreateIndex
CREATE INDEX "activity_logs_action_idx" ON "activity_logs"("action");

-- CreateIndex
CREATE INDEX "activity_logs_entityType_idx" ON "activity_logs"("entityType");

-- CreateIndex
CREATE INDEX "activity_logs_createdAt_idx" ON "activity_logs"("createdAt");

-- CreateIndex
CREATE INDEX "login_activities_adminId_idx" ON "login_activities"("adminId");

-- CreateIndex
CREATE INDEX "login_activities_createdAt_idx" ON "login_activities"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "contractor_kyc_contractorId_key" ON "contractor_kyc"("contractorId");

-- CreateIndex
CREATE INDEX "contractor_kyc_status_idx" ON "contractor_kyc"("status");

-- CreateIndex
CREATE INDEX "contractor_kyc_dueBy_idx" ON "contractor_kyc"("dueBy");

-- CreateIndex
CREATE UNIQUE INDEX "manual_invoices_number_key" ON "manual_invoices"("number");

-- CreateIndex
CREATE INDEX "manual_invoices_contractorId_idx" ON "manual_invoices"("contractorId");

-- CreateIndex
CREATE INDEX "manual_invoices_status_idx" ON "manual_invoices"("status");

-- CreateIndex
CREATE INDEX "manual_invoices_dueDate_idx" ON "manual_invoices"("dueDate");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_activities" ADD CONSTRAINT "login_activities_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_kyc" ADD CONSTRAINT "contractor_kyc_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_invoices" ADD CONSTRAINT "manual_invoices_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_invoice_items" ADD CONSTRAINT "manual_invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "manual_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
