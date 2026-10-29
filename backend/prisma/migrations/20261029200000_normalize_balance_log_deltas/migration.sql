-- Snapshot differences, not the historically ambiguous nominal amount, define movement.
-- Keep this conversion atomic; never expose partially backfilled ledger rows.
BEGIN;
ALTER TABLE "BalanceLog"
  ADD COLUMN "bookkeepingAmount" DECIMAL(12,2),
  ADD COLUMN "balanceDelta" DECIMAL(12,2),
  ADD COLUMN "lockedDelta" DECIMAL(12,2);

UPDATE "BalanceLog"
SET "bookkeepingAmount" = CASE WHEN "source" = 'MASTER_ADMIN_CONTROL' THEN "amount" ELSE NULL END,
    "balanceDelta" = "balanceAfter" - "balanceBefore",
    "lockedDelta" = "lockedAfter" - "lockedBefore";

-- MASTER_ADMIN_CONTROL normally records zero/zero bookkeeping snapshots. Do not
-- discard real movements (e.g. PURGE_ABSORB) merely because they share this source.
DO $$
DECLARE unexpected_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO unexpected_count FROM "BalanceLog"
  WHERE "source" = 'MASTER_ADMIN_CONTROL'
    AND ("balanceDelta" <> 0 OR "lockedDelta" <> 0);
  IF unexpected_count > 0 THEN
    RAISE NOTICE 'Preserved % nonzero MASTER_ADMIN_CONTROL movements; audit these rows', unexpected_count;
  END IF;
END $$;

-- No synthetic opening entries: preserve IDs, actions, timestamps and metadata.
-- Preexisting balances without ledger support remain visible as reconciliation drift.
ALTER TABLE "BalanceLog"
  ALTER COLUMN "balanceDelta" SET NOT NULL,
  ALTER COLUMN "lockedDelta" SET NOT NULL,
  DROP COLUMN "amount",
  DROP COLUMN "balanceBefore",
  DROP COLUMN "balanceAfter",
  DROP COLUMN "lockedBefore",
  DROP COLUMN "lockedAfter";
COMMIT;
