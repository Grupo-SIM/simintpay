-- Additive, opt-in settlement. No legacy balances or payment events are migrated.
CREATE TABLE "EbookBeneficiaryIdentity" (
  "externalUserId" TEXT PRIMARY KEY,
  document TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"(id),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "EbookSettlement" (
  id TEXT PRIMARY KEY,
  "manifestId" TEXT NOT NULL UNIQUE,
  "orderNumber" TEXT NOT NULL UNIQUE,
  "manifestHash" TEXT NOT NULL,
  manifest JSONB NOT NULL,
  identities JSONB NOT NULL,
  "capabilityHash" TEXT NOT NULL,
  funding JSONB,
  "providerCredentialHash" TEXT,
  state TEXT NOT NULL DEFAULT 'ENROLLED',
  "providerPaymentId" TEXT UNIQUE,
  "transactionId" TEXT UNIQUE REFERENCES "Transaction"(id),
  revision INTEGER NOT NULL DEFAULT 0,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "EbookSettlementReceipt" (
  id TEXT PRIMARY KEY,
  "settlementId" TEXT NOT NULL REFERENCES "EbookSettlement"(id),
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EbookSettlementReceipt_pending_idx" ON "EbookSettlementReceipt" ("deliveredAt", "createdAt");
