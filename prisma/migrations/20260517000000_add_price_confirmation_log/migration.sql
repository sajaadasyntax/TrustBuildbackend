-- CreateEnum
CREATE TYPE "PriceConfirmationAction" AS ENUM ('PROPOSED', 'CONFIRMED', 'REJECTED', 'ADMIN_OVERRIDE');

-- CreateTable
CREATE TABLE "price_confirmation_logs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "customerId" TEXT,
    "action" "PriceConfirmationAction" NOT NULL,
    "proposedAmount" DECIMAL(10,2),
    "previousAmount" DECIMAL(10,2),
    "rejectionReason" TEXT,
    "performedByUserId" TEXT NOT NULL,
    "performedByRole" "UserRole" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_confirmation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_confirmation_logs_jobId_idx" ON "price_confirmation_logs"("jobId");

-- CreateIndex
CREATE INDEX "price_confirmation_logs_contractorId_idx" ON "price_confirmation_logs"("contractorId");

-- CreateIndex
CREATE INDEX "price_confirmation_logs_createdAt_idx" ON "price_confirmation_logs"("createdAt");

-- CreateIndex
CREATE INDEX "price_confirmation_logs_action_idx" ON "price_confirmation_logs"("action");

-- AddForeignKey
ALTER TABLE "price_confirmation_logs" ADD CONSTRAINT "price_confirmation_logs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_confirmation_logs" ADD CONSTRAINT "price_confirmation_logs_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
