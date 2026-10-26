-- CreateEnum
CREATE TYPE "BillingIntervalType" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "BillingContractStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingQuantityChangeStatus" AS ENUM (
    'PENDING_PAYMENT',
    'PENDING_RECURRENCE_UPDATE',
    'SCHEDULED',
    'APPLIED',
    'FAILED',
    'COMPENSATION_REQUIRED'
);

-- CreateTable
CREATE TABLE "BillingContract" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceType" VARCHAR(50) NOT NULL,
    "resourceId" VARCHAR(191) NOT NULL,
    "priceKey" VARCHAR(100),
    "pricingVersion" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "baseAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unitAmount" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "pendingQuantity" INTEGER,
    "minimumQuantity" INTEGER NOT NULL DEFAULT 1,
    "intervalType" "BillingIntervalType" NOT NULL DEFAULT 'MONTH',
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "status" "BillingContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "acquirer" "Acquirer" NOT NULL DEFAULT 'DOM',
    "externalPlanId" TEXT,
    "externalSubscriptionId" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingQuantityChange" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "idempotencyKey" VARCHAR(191) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "expectedVersion" INTEGER NOT NULL,
    "previousQuantity" INTEGER NOT NULL,
    "targetQuantity" INTEGER NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "remainingRatio" DECIMAL(20,10) NOT NULL,
    "previousRecurringAmount" DECIMAL(12,2) NOT NULL,
    "nextRecurringAmount" DECIMAL(12,2) NOT NULL,
    "prorationAmount" DECIMAL(12,2) NOT NULL,
    "status" "BillingQuantityChangeStatus" NOT NULL,
    "transactionId" TEXT,
    "externalPaymentId" TEXT,
    "externalPlanId" TEXT,
    "externalSubscriptionId" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "calculationSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingQuantityChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingContract_resourceType_resourceId_key" ON "BillingContract"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingContract_externalSubscriptionId_key" ON "BillingContract"("externalSubscriptionId");

-- CreateIndex
CREATE INDEX "BillingContract_userId_idx" ON "BillingContract"("userId");

-- CreateIndex
CREATE INDEX "BillingContract_status_idx" ON "BillingContract"("status");

-- CreateIndex
CREATE INDEX "BillingContract_currentPeriodEnd_idx" ON "BillingContract"("currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "BillingQuantityChange_transactionId_key" ON "BillingQuantityChange"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingQuantityChange_contractId_idempotencyKey_key" ON "BillingQuantityChange"("contractId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingQuantityChange_contractId_status_idx" ON "BillingQuantityChange"("contractId", "status");

-- CreateIndex
CREATE INDEX "BillingQuantityChange_scheduledFor_status_idx" ON "BillingQuantityChange"("scheduledFor", "status");

-- AddForeignKey
ALTER TABLE "BillingContract" ADD CONSTRAINT "BillingContract_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingQuantityChange" ADD CONSTRAINT "BillingQuantityChange_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "BillingContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingQuantityChange" ADD CONSTRAINT "BillingQuantityChange_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
