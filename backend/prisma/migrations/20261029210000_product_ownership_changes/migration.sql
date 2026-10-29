-- Additive audit of product owner reassignments; no existing table is altered.
BEGIN;
CREATE TABLE "ProductOwnershipChange" (
  "id" TEXT NOT NULL,
  "productType" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "mappingHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductOwnershipChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductOwnershipChange_productType_check"
    CHECK ("productType" IN ('PaymentLink', 'SubscriptionLink', 'Plan', 'PixCreditPlan', 'Boleto')),
  CONSTRAINT "ProductOwnershipChange_distinct_owners_check" CHECK ("fromUserId" <> "toUserId")
);
CREATE INDEX "ProductOwnershipChange_productType_productId_idx"
  ON "ProductOwnershipChange"("productType", "productId");
ALTER TABLE "ProductOwnershipChange"
  ADD CONSTRAINT "ProductOwnershipChange_fromUserId_fkey" FOREIGN KEY ("fromUserId")
  REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProductOwnershipChange_toUserId_fkey" FOREIGN KEY ("toUserId")
  REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
