-- AlterEnum: Add WON status to JobStatus
ALTER TYPE "JobStatus" ADD VALUE 'WON';

-- AlterTable: Add free points fields to Contractor
ALTER TABLE "contractors" ADD COLUMN "freePointsBalance" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "contractors" ADD COLUMN "freePointUsed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add wonAt field to Job
ALTER TABLE "jobs" ADD COLUMN "wonAt" TIMESTAMP(3);

-- AlterTable: Add usedFreePoint field to JobAccess
ALTER TABLE "job_access" ADD COLUMN "usedFreePoint" BOOLEAN NOT NULL DEFAULT false;

-- Update existing contractors to have 1 free point (only if they haven't used it yet)
UPDATE "contractors" SET "freePointsBalance" = 1, "freePointUsed" = false 
WHERE "freePointsBalance" = 0 AND "freePointUsed" = false;

