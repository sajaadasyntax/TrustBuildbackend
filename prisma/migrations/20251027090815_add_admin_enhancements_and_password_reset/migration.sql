-- AlterTable
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "isMainSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "contractor_kyc" ADD COLUMN IF NOT EXISTS "companyDocPath" TEXT,
ADD COLUMN IF NOT EXISTS "insuranceDocPath" TEXT;

-- AlterTable
ALTER TABLE "contractors" ADD COLUMN IF NOT EXISTS "manualApprovalDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "manualApprovalReason" TEXT,
ADD COLUMN IF NOT EXISTS "manuallyApprovedBy" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "password_resets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "password_resets_token_key" ON "password_resets"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "password_resets_token_idx" ON "password_resets"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "password_resets_userId_idx" ON "password_resets"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "password_resets_expiresAt_idx" ON "password_resets"("expiresAt");

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
