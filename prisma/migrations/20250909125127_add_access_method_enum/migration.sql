/*
  Warnings:

  - The `accessMethod` column on the `job_access` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "AccessMethod" AS ENUM ('CREDIT', 'PAYMENT', 'SUBSCRIPTION');

-- AlterTable
ALTER TABLE "job_access" DROP COLUMN "accessMethod",
ADD COLUMN     "accessMethod" "AccessMethod" NOT NULL DEFAULT 'PAYMENT';
