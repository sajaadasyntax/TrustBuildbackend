-- AlterTable: Update default freeJobAllocation from 0 to 1
-- This ensures new contractors get 1 free job lead by default
ALTER TABLE "contractors" ALTER COLUMN "freeJobAllocation" SET DEFAULT 1;

