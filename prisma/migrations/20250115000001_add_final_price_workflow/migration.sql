-- AddFinalPriceWorkflow
-- Add fields to support contractor final price proposal and homeowner confirmation workflow

-- Add new fields to Job table
ALTER TABLE "Job" ADD COLUMN "contractorProposedAmount" DECIMAL(10,2);
ALTER TABLE "Job" ADD COLUMN "finalPriceProposedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "finalPriceConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "finalPriceRejectedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "finalPriceRejectionReason" TEXT;
ALTER TABLE "Job" ADD COLUMN "adminOverrideAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "adminOverrideBy" String;
ALTER TABLE "Job" ADD COLUMN "finalPriceTimeoutAt" TIMESTAMP(3);

-- Add new job status for awaiting final price confirmation
ALTER TYPE "JobStatus" ADD VALUE 'AWAITING_FINAL_PRICE_CONFIRMATION';

-- Add index for efficient querying of jobs awaiting confirmation
CREATE INDEX "Job_finalPriceProposedAt_idx" ON "Job"("finalPriceProposedAt");
CREATE INDEX "Job_status_finalPriceProposedAt_idx" ON "Job"("status", "finalPriceProposedAt");
