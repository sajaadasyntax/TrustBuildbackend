-- CreateEnum
CREATE TYPE "DisputeType" AS ENUM ('WORK_QUALITY', 'JOB_CONFIRMATION', 'CREDIT_REFUND', 'PROJECT_DELAY', 'PAYMENT_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisputeResolution" AS ENUM ('CUSTOMER_FAVOR', 'CONTRACTOR_FAVOR', 'MUTUAL_AGREEMENT', 'CREDIT_REFUNDED', 'COMMISSION_ADJUSTED', 'NO_ACTION');

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "raisedByUserId" TEXT NOT NULL,
    "raisedByRole" "UserRole" NOT NULL,
    "type" "DisputeType" NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceUrls" JSONB,
    "resolution" "DisputeResolution",
    "resolutionNotes" TEXT,
    "resolvedByAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "creditRefunded" BOOLEAN NOT NULL DEFAULT false,
    "creditRefundAmount" INTEGER,
    "commissionAdjusted" BOOLEAN NOT NULL DEFAULT false,
    "commissionAmount" DECIMAL(10,2),
    "jobCompletedOverride" BOOLEAN NOT NULL DEFAULT false,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_responses" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userRole" "UserRole" NOT NULL,
    "message" TEXT NOT NULL,
    "attachments" JSONB,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispute_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disputes_jobId_idx" ON "disputes"("jobId");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");

-- CreateIndex
CREATE INDEX "disputes_type_idx" ON "disputes"("type");

-- CreateIndex
CREATE INDEX "disputes_raisedByUserId_idx" ON "disputes"("raisedByUserId");

-- CreateIndex
CREATE INDEX "disputes_createdAt_idx" ON "disputes"("createdAt");

-- CreateIndex
CREATE INDEX "dispute_responses_disputeId_idx" ON "dispute_responses"("disputeId");

-- CreateIndex
CREATE INDEX "dispute_responses_userId_idx" ON "dispute_responses"("userId");

-- CreateIndex
CREATE INDEX "dispute_responses_createdAt_idx" ON "dispute_responses"("createdAt");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_responses" ADD CONSTRAINT "dispute_responses_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
