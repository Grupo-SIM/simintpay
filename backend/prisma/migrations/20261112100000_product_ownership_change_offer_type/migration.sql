-- Allows the ownership audit to record reassignments of Offer rows. Constraint-only change.
BEGIN;
ALTER TABLE "ProductOwnershipChange"
  DROP CONSTRAINT "ProductOwnershipChange_productType_check";
ALTER TABLE "ProductOwnershipChange"
  ADD CONSTRAINT "ProductOwnershipChange_productType_check"
  CHECK ("productType" IN ('PaymentLink', 'SubscriptionLink', 'Plan', 'PixCreditPlan', 'Boleto', 'Offer'));
COMMIT;
