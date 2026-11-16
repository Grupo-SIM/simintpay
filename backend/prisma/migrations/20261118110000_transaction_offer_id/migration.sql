-- Plan 0023, phase 1: Transaction.offerId (additive, nullable). Legacy writers keep filling
-- "paymentLinkId"; nothing reads the new column yet.
ALTER TABLE "Transaction" ADD COLUMN "offerId" TEXT;

CREATE INDEX "Transaction_offerId_idx" ON "Transaction"("offerId");

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill 1: sales made through a payment link whose Offer already exists with the legacy id
-- (the migrated offer keeps the old id). Links not migrated yet stay NULL (the FK would reject them)
-- and are filled when `offer-migration-apply` runs; this statement is safe to run again then.
UPDATE "Transaction" t
SET "offerId" = t."paymentLinkId"
WHERE t."paymentLinkId" IS NOT NULL
  AND t."offerId" IS NULL
  AND EXISTS (SELECT 1 FROM "Offer" o WHERE o."id" = t."paymentLinkId");

-- Backfill 2: sales settled through a Charge of an Offer (subscription cycles, offer checkouts).
UPDATE "Transaction" t
SET "offerId" = c."offerId"
FROM "Charge" c
WHERE c."transactionId" = t."id"
  AND c."offerId" IS NOT NULL
  AND t."offerId" IS NULL;
