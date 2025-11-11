-- AlterTable: Update default weeklyCreditsLimit from 3 to 0
-- Non-subscribed contractors should have 0 weekly credits limit
-- Weekly credits limit is set to 3 when they subscribe
ALTER TABLE "contractors" ALTER COLUMN "weeklyCreditsLimit" SET DEFAULT 0;

