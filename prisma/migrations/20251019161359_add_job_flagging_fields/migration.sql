-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "flaggedAt" TIMESTAMP(3),
ADD COLUMN     "flaggedBy" TEXT,
ADD COLUMN     "isFlagged" BOOLEAN NOT NULL DEFAULT false;
