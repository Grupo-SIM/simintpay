-- CreateTable
CREATE TABLE "OfferAccess" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerDocument" TEXT NOT NULL,
    "customerName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "frozenDays" INTEGER NOT NULL DEFAULT 0,
    "totalDaysCredited" INTEGER NOT NULL DEFAULT 0,
    "lastChargeId" TEXT,
    "lastTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferAccessEvent" (
    "id" TEXT NOT NULL,
    "accessId" TEXT NOT NULL,
    "eventKey" VARCHAR(191) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferCodeAlias" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferCodeAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferAccess_offerId_idx" ON "OfferAccess"("offerId");

-- CreateIndex
CREATE INDEX "OfferAccess_ownerUserId_isActive_idx" ON "OfferAccess"("ownerUserId", "isActive");

-- CreateIndex
CREATE INDEX "OfferAccess_customerEmail_idx" ON "OfferAccess"("customerEmail");

-- CreateIndex
CREATE INDEX "OfferAccess_isActive_expiresAt_idx" ON "OfferAccess"("isActive", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferAccess_offerId_customerDocument_key" ON "OfferAccess"("offerId", "customerDocument");

-- CreateIndex
CREATE UNIQUE INDEX "OfferAccess_offerId_customerId_key" ON "OfferAccess"("offerId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferAccessEvent_eventKey_key" ON "OfferAccessEvent"("eventKey");

-- CreateIndex
CREATE INDEX "OfferAccessEvent_accessId_type_idx" ON "OfferAccessEvent"("accessId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "OfferCodeAlias_code_key" ON "OfferCodeAlias"("code");

-- CreateIndex
CREATE INDEX "OfferCodeAlias_offerId_isActive_idx" ON "OfferCodeAlias"("offerId", "isActive");

-- AddForeignKey
ALTER TABLE "OfferAccess" ADD CONSTRAINT "OfferAccess_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCodeAlias" ADD CONSTRAINT "OfferCodeAlias_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

