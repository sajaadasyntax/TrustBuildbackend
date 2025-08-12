-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "commissionPaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "customerConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "finalAmount" DECIMAL(10,2),
ADD COLUMN     "maxContractorsPerJob" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "wonByContractorId" TEXT;

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_wonByContractorId_fkey" FOREIGN KEY ("wonByContractorId") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
