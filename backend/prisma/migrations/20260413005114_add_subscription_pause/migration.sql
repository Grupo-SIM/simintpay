-- AlterTable
ALTER TABLE "Plan" ALTER COLUMN "paymentMethods" DROP NOT NULL;

-- CreateTable (IF NOT EXISTS — seguro se a tabela já existir no banco)
CREATE TABLE IF NOT EXISTS "PlatformTaxaOverride" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformTaxaOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformTaxaOverride_tag_key_key" ON "PlatformTaxaOverride"("tag", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlatformTaxaOverride_tag_idx" ON "PlatformTaxaOverride"("tag");

-- CreateTable
CREATE TABLE "SubscriptionPause" (
    "id" TEXT NOT NULL,
    "domSubscriptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriberName" TEXT,
    "description" TEXT,
    "planId" TEXT,
    "valueBrl" DOUBLE PRECISION,
    "frequency" TEXT,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "plataforma" TEXT,
    "firstCharge" TEXT,
    "remainingDays" INTEGER NOT NULL,
    "pausedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPause_domSubscriptionId_key" ON "SubscriptionPause"("domSubscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionPause_userId_idx" ON "SubscriptionPause"("userId");
