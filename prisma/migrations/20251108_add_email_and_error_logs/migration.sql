-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ErrorLevel" AS ENUM ('ERROR', 'WARNING', 'INFO');

-- CreateTable
CREATE TABLE IF NOT EXISTS "email_logs" (
    "id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "error_logs" (
    "id" TEXT NOT NULL,
    "level" "ErrorLevel" NOT NULL DEFAULT 'ERROR',
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "endpoint" TEXT,
    "method" TEXT,
    "statusCode" INTEGER,
    "userId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_logs_recipient_idx" ON "email_logs"("recipient");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_logs_status_idx" ON "email_logs"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_logs_type_idx" ON "email_logs"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_logs_sentAt_idx" ON "email_logs"("sentAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "error_logs_level_idx" ON "error_logs"("level");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "error_logs_source_idx" ON "error_logs"("source");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "error_logs_statusCode_idx" ON "error_logs"("statusCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "error_logs_createdAt_idx" ON "error_logs"("createdAt");

