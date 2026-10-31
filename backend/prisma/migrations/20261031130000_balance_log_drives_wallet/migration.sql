-- BalanceLog drives Wallet (plans/0019-balancelog-read-source.md).
-- An AFTER INSERT trigger on "BalanceLog" recomputes "Wallet" from SUM(balanceDelta) / SUM(lockedDelta)
-- of the user's log, under a per-user advisory lock. Existing writers still update "Wallet" themselves;
-- the recompute is idempotent for them (same sums -> no write, no version bump).
-- BalanceLog is intentionally NOT append-only (owner decision).
--
-- WARNING: the guard below aborts this migration while any Wallet differs from SUM(BalanceLog).
-- Because the container start runs `prisma migrate deploy`, the new version will not boot until the
-- divergences are reconciled (scripts/reconcile-wallets.ts); the previous version keeps serving.

-- wallet-ledger-divergence-guard:begin
DO $$
DECLARE
  divergent integer;
BEGIN
  SELECT count(*) INTO divergent
  FROM "Wallet" w
  LEFT JOIN (
    SELECT "userId", SUM("balanceDelta") AS balance, SUM("lockedDelta") AS locked
    FROM "BalanceLog"
    GROUP BY "userId"
  ) l ON l."userId" = w."userId"
  WHERE w."balance" IS DISTINCT FROM COALESCE(l.balance, 0)
     OR w."lockedBalance" IS DISTINCT FROM COALESCE(l.locked, 0);

  IF divergent > 0 THEN
    RAISE EXCEPTION 'Cannot enable BalanceLog-driven wallets: % wallet(s) differ from SUM(BalanceLog). Reconcile them first (scripts/reconcile-wallets.ts --apply); balances are never rewritten automatically.', divergent;
  END IF;
END
$$;
-- wallet-ledger-divergence-guard:end

-- Covering index so the per-insert SUM is an index-only scan. Same name/column as the Prisma
-- @@index([userId]) so schema.prisma needs no change.
DROP INDEX IF EXISTS "BalanceLog_userId_idx";
CREATE INDEX "BalanceLog_userId_idx" ON "BalanceLog" ("userId") INCLUDE ("balanceDelta", "lockedDelta");

-- Lock order (shared with app code, see wallet-ledger.ts lockWalletLedger):
--   1. row lock on the user's "Wallet" (when it exists), 2. pg_advisory_xact_lock(hashtext('wallet-ledger:' || userId)).
-- Legacy writers already take the Wallet row lock first (wallet.update, then balanceLog.create); keeping the
-- same order here avoids a lock-order inversion (row -> advisory vs advisory -> row) between old and new writers.
CREATE OR REPLACE FUNCTION balance_log_sync_wallet() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  total_balance numeric(12, 2);
  total_locked numeric(12, 2);
BEGIN
  PERFORM 1 FROM "Wallet" WHERE "userId" = NEW."userId" FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtext('wallet-ledger:' || NEW."userId"));

  SELECT COALESCE(SUM("balanceDelta"), 0), COALESCE(SUM("lockedDelta"), 0)
  INTO total_balance, total_locked
  FROM "BalanceLog"
  WHERE "userId" = NEW."userId";

  INSERT INTO "Wallet" ("id", "userId", "balance", "lockedBalance", "version", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, NEW."userId", total_balance, total_locked, 1, now(), now())
  ON CONFLICT ("userId") DO UPDATE
  SET "balance" = EXCLUDED."balance",
      "lockedBalance" = EXCLUDED."lockedBalance",
      "version" = "Wallet"."version" + 1,
      "updatedAt" = now()
  WHERE "Wallet"."balance" IS DISTINCT FROM EXCLUDED."balance"
     OR "Wallet"."lockedBalance" IS DISTINCT FROM EXCLUDED."lockedBalance";

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS balance_log_sync_wallet ON "BalanceLog";
CREATE TRIGGER balance_log_sync_wallet
  AFTER INSERT ON "BalanceLog"
  FOR EACH ROW EXECUTE FUNCTION balance_log_sync_wallet();
