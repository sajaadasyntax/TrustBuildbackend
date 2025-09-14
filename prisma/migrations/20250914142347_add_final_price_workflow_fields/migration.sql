-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'AWAITING_FINAL_PRICE_CONFIRMATION';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "adminOverrideAt" TIMESTAMP(3),
ADD COLUMN     "adminOverrideBy" TEXT,
ADD COLUMN     "contractorProposedAmount" DECIMAL(10,2),
ADD COLUMN     "finalPriceConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "finalPriceProposedAt" TIMESTAMP(3),
ADD COLUMN     "finalPriceRejectedAt" TIMESTAMP(3),
ADD COLUMN     "finalPriceRejectionReason" TEXT,
ADD COLUMN     "finalPriceTimeoutAt" TIMESTAMP(3);
