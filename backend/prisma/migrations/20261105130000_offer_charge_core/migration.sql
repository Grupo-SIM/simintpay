
-- CreateEnum
CREATE TYPE "OfferKind" AS ENUM ('PAYMENT_LINK', 'SUBSCRIPTION_LINK', 'PLAN', 'PIX_PLAN', 'BOLETO');

-- CreateEnum
CREATE TYPE "RenewalMode" AS ENUM ('NONE', 'AUTO_CHARGE', 'MANUAL_PAY');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "BillingContract" ADD COLUMN     "customerDocument" TEXT,
ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "nextChargeAt" TIMESTAMP(3),
ADD COLUMN     "offerId" TEXT,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "externalSubscriptionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "platformTag" TEXT,
    "code" TEXT NOT NULL,
    "kind" "OfferKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "acceptedMethods" "PaymentMethod"[],
    "maxInstallments" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "accessDays" INTEGER,
    "renewalMode" "RenewalMode" NOT NULL DEFAULT 'NONE',
    "intervalType" "BillingIntervalType",
    "intervalCount" INTEGER,
    "repetitions" INTEGER,
    "trialDays" INTEGER,
    "retryDays" INTEGER,
    "graceDays" INTEGER,
    "fulfillment" JSONB,
    "metadata" JSONB,
    "legacyType" TEXT,
    "legacyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "offerId" TEXT,
    "contractId" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod",
    "dueAt" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "cycleKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerDocument" TEXT,
    "transactionId" TEXT,
    "snapshot" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Offer_code_key" ON "Offer"("code");

-- CreateIndex
CREATE INDEX "Offer_ownerUserId_idx" ON "Offer"("ownerUserId");

-- CreateIndex
CREATE INDEX "Offer_kind_idx" ON "Offer"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_legacyType_legacyId_key" ON "Offer"("legacyType", "legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_transactionId_key" ON "Charge"("transactionId");

-- CreateIndex
CREATE INDEX "Charge_offerId_idx" ON "Charge"("offerId");

-- CreateIndex
CREATE INDEX "Charge_ownerUserId_status_idx" ON "Charge"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "Charge_status_dueAt_idx" ON "Charge"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_contractId_cycleKey_key" ON "Charge"("contractId", "cycleKey");

-- CreateIndex
CREATE INDEX "BillingContract_nextChargeAt_status_idx" ON "BillingContract"("nextChargeAt", "status");

-- CreateIndex
CREATE INDEX "BillingContract_offerId_idx" ON "BillingContract"("offerId");

-- AddForeignKey
ALTER TABLE "BillingContract" ADD CONSTRAINT "BillingContract_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "BillingContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
