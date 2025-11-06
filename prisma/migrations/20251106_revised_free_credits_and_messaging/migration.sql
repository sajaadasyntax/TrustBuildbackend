-- AlterEnum: Add WON status to JobStatus (only if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'WON' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'JobStatus')) THEN
        ALTER TYPE "JobStatus" ADD VALUE 'WON';
    END IF;
END $$;

-- AlterTable: Update Contractor to use unified credit system
-- Change default creditsBalance from 0 to 1 (everyone gets 1 free credit)
-- Only change default if it's currently 0
DO $$ 
BEGIN
    IF (SELECT column_default::int FROM information_schema.columns 
        WHERE table_name = 'contractors' AND column_name = 'creditsBalance')::int = 0 THEN
        ALTER TABLE "contractors" ALTER COLUMN "creditsBalance" SET DEFAULT 1;
    END IF;
END $$;

-- AlterTable: Add hasUsedFreeTrial tracking to Contractor
ALTER TABLE "contractors" ADD COLUMN IF NOT EXISTS "hasUsedFreeTrial" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Remove old free points fields if they exist (from previous migration)
ALTER TABLE "contractors" DROP COLUMN IF EXISTS "freePointsBalance";
ALTER TABLE "contractors" DROP COLUMN IF EXISTS "freePointUsed";

-- AlterTable: Add wonAt field to Job
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "wonAt" TIMESTAMP(3);

-- AlterTable: Update JobAccess to track free trial usage
-- usedFreePoint already exists from previous migration, so we'll keep it

-- CreateTable: Internal Messaging System
CREATE TABLE IF NOT EXISTS "messages" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" "UserRole" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientRole" "UserRole" NOT NULL,
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "attachmentUrls" JSONB,
    "relatedJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (only if table was just created)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
        CREATE INDEX IF NOT EXISTS "messages_senderId_idx" ON "messages"("senderId");
        CREATE INDEX IF NOT EXISTS "messages_recipientId_idx" ON "messages"("recipientId");
        CREATE INDEX IF NOT EXISTS "messages_isRead_idx" ON "messages"("isRead");
        CREATE INDEX IF NOT EXISTS "messages_createdAt_idx" ON "messages"("createdAt");
    END IF;
END $$;

-- Update existing contractors to have 1 credit if they have 0
-- This gives everyone the free trial credit
UPDATE "contractors" 
SET "creditsBalance" = 1, "hasUsedFreeTrial" = false 
WHERE "creditsBalance" = 0 AND "hasUsedFreeTrial" = false;

-- Comments for documentation
COMMENT ON COLUMN "contractors"."creditsBalance" IS 'Unified credit system: includes 1 free trial credit + subscription credits';
COMMENT ON COLUMN "contractors"."hasUsedFreeTrial" IS 'Track if contractor has used their initial free trial credit (restricted to SMALL jobs)';
COMMENT ON TABLE "messages" IS 'Internal messaging system: Only allows Admin↔Customer and Admin↔Contractor messaging';

