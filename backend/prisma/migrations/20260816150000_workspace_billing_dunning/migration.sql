ALTER TYPE "BillingContractStatus" ADD VALUE IF NOT EXISTS 'PAST_DUE';
ALTER TYPE "BillingContractStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

ALTER TABLE "BillingContract"
  ADD COLUMN "pastDueAt" TIMESTAMP(3),
  ADD COLUMN "graceEndsAt" TIMESTAMP(3),
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "accessEndsAt" TIMESTAMP(3);

CREATE TABLE "BillingContractEvent" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "eventKey" VARCHAR(191) NOT NULL,
  "type" VARCHAR(80) NOT NULL,
  "payload" JSONB NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingContractEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingContractEvent_eventKey_key" ON "BillingContractEvent"("eventKey");
CREATE INDEX "BillingContractEvent_contractId_deliveredAt_idx" ON "BillingContractEvent"("contractId", "deliveredAt");
ALTER TABLE "BillingContractEvent" ADD CONSTRAINT "BillingContractEvent_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "BillingContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
