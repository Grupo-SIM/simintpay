CREATE TABLE "FinancialPolicyRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tag" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "document" JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "FinancialPolicyRevision_tag_version_key" ON "FinancialPolicyRevision"("tag", "version");
ALTER TABLE "Transaction" ADD COLUMN "financialSnapshot" JSONB;
-- Audit previous owner settings; new policy defaults are zero surcharge/full interest pass-through.
-- Existing charges, balances and legacy policy stay untouched until explicit lane activation.
INSERT INTO "FinancialPolicyRevision" ("id", "tag", "version", "document", "actorId")
SELECT 'finance-transition-' || "id", "tag", 1,
 jsonb_build_object('schemaVersion', 1, 'lanes', '{}'::jsonb, 'owner', '{}'::jsonb,
 'interestFree', false, 'legacyAudit', jsonb_build_object('customerInterestRates', "customerInterestRates", 'absorbCustomerInterest', "absorbCustomerInterest")), 'LOCAL_MIGRATION'
FROM "Platform";

ALTER TABLE "SubscriptionLinkOrder" ADD COLUMN "financialSnapshot" JSONB;
ALTER TABLE "Subscription" ADD COLUMN "financialSnapshot" JSONB;
