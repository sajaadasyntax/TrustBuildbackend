-- Add insurance and company document support to KYC
ALTER TABLE "contractor_kyc" 
ADD COLUMN IF NOT EXISTS "insuranceDocPath" TEXT,
ADD COLUMN IF NOT EXISTS "companyDocPath" TEXT;

