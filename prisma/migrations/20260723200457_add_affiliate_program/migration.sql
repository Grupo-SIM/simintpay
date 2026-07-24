-- CreateEnum
CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('CREDITED', 'REVERSED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "referredByCode" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "affiliateCode" TEXT,
ADD COLUMN     "affiliateCommissionPercent" DECIMAL(5,2),
ADD COLUMN     "isAffiliate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referredByUserId" TEXT;

-- CreateTable
CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL,
    "affiliateUserId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "percentApplied" DECIMAL(5,2) NOT NULL,
    "grossPlatformFee" DECIMAL(12,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "status" "AffiliateCommissionStatus" NOT NULL DEFAULT 'CREDITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCommission_transactionId_key" ON "AffiliateCommission"("transactionId");

-- CreateIndex
CREATE INDEX "AffiliateCommission_affiliateUserId_idx" ON "AffiliateCommission"("affiliateUserId");

-- CreateIndex
CREATE INDEX "AffiliateCommission_referredUserId_idx" ON "AffiliateCommission"("referredUserId");

-- CreateIndex
CREATE INDEX "AffiliateCommission_status_idx" ON "AffiliateCommission"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_affiliateCode_key" ON "User"("affiliateCode");

-- CreateIndex
CREATE INDEX "User_referredByUserId_idx" ON "User"("referredByUserId");

-- CreateIndex
CREATE INDEX "User_affiliateCode_idx" ON "User"("affiliateCode");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliateUserId_fkey" FOREIGN KEY ("affiliateUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

