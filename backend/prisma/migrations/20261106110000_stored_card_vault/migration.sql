
-- CreateEnum
CREATE TYPE "StoredCardStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "StoredCard" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "contractId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "brand" VARCHAR(30),
    "last4" VARCHAR(4) NOT NULL,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "status" "StoredCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredCardToken" (
    "id" TEXT NOT NULL,
    "storedCardId" TEXT NOT NULL,
    "acquirerCode" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredCardToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoredCard_ownerUserId_idx" ON "StoredCard"("ownerUserId");

-- CreateIndex
CREATE INDEX "StoredCard_contractId_status_idx" ON "StoredCard"("contractId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StoredCardToken_storedCardId_acquirerCode_key" ON "StoredCardToken"("storedCardId", "acquirerCode");

-- AddForeignKey
ALTER TABLE "StoredCard" ADD CONSTRAINT "StoredCard_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "BillingContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredCardToken" ADD CONSTRAINT "StoredCardToken_storedCardId_fkey" FOREIGN KEY ("storedCardId") REFERENCES "StoredCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredCardToken" ADD CONSTRAINT "StoredCardToken_acquirerCode_fkey" FOREIGN KEY ("acquirerCode") REFERENCES "AcquirerCatalogue"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

