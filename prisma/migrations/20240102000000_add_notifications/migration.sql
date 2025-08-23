-- Create notification type enum
CREATE TYPE "NotificationType" AS ENUM (
  'INFO',
  'WARNING',
  'SUCCESS',
  'ERROR',
  'COMMISSION_DUE',
  'COMMISSION_OVERDUE',
  'SUBSCRIPTION_EXPIRING',
  'JOB_PURCHASED',
  'REVIEW_RECEIVED',
  'ACCOUNT_SUSPENDED'
);

-- Create notifications table
CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL DEFAULT 'INFO',
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "actionLink" TEXT,
  "actionText" TEXT,
  "metadata" JSONB,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- Add foreign key constraint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add notification settings to user model
ALTER TABLE "users" ADD COLUMN "notificationSettings" JSONB NOT NULL DEFAULT '{"email": true, "inApp": true, "commission": true, "subscription": true, "jobs": true, "reviews": true}';
