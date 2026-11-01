BEGIN;
-- Keep certification and trigger installation atomic, excluding concurrent writers.
LOCK TABLE "User", "Wallet", "BalanceLog" IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Wallet" w
    FULL JOIN (
      SELECT "userId", SUM("balanceDelta") AS balance, SUM("lockedDelta") AS locked
      FROM "BalanceLog" GROUP BY "userId"
    ) l ON l."userId" = w."userId"
    WHERE w."userId" IS NULL
       OR w.balance IS DISTINCT FROM COALESCE(l.balance, 0)
       OR w."lockedBalance" IS DISTINCT FROM COALESCE(l.locked, 0)
  ) THEN
    RAISE EXCEPTION 'Existing Wallet ledger inconsistency; refusing guard installation';
  END IF;
END;
$$;

-- Check final state, not the queued row image. Ledger corrections remain mutable:
-- UPDATE/DELETE must restore the matching Wallet in the same transaction.
CREATE FUNCTION wallet_assert_ledger_consistency(p_user_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  cached_balance numeric;
  cached_locked numeric;
  ledger_balance numeric;
  ledger_locked numeric;
BEGIN
  PERFORM 1 FROM "Wallet" WHERE "userId" = p_user_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtext('wallet-ledger:' || p_user_id));
  SELECT "balance", "lockedBalance" INTO cached_balance, cached_locked
    FROM "Wallet" WHERE "userId" = p_user_id;
  -- Missing Wallet is valid during user cascade deletion, not for a live user.
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM "User" WHERE id = p_user_id) THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM("balanceDelta"), 0), COALESCE(SUM("lockedDelta"), 0)
    INTO ledger_balance, ledger_locked FROM "BalanceLog" WHERE "userId" = p_user_id;
  IF cached_balance IS DISTINCT FROM ledger_balance
     OR cached_locked IS DISTINCT FROM ledger_locked THEN
    RAISE EXCEPTION 'Wallet ledger inconsistency for user %', p_user_id
      USING ERRCODE = '23514', CONSTRAINT = 'wallet_ledger_consistency';
  END IF;
END;
$$;

CREATE FUNCTION wallet_check_final_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM wallet_assert_ledger_consistency(OLD."userId");
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM wallet_assert_ledger_consistency(NEW."userId");
  ELSIF TG_OP = 'UPDATE' AND NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    PERFORM wallet_assert_ledger_consistency(NEW."userId");
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER wallet_ledger_consistency
AFTER INSERT OR UPDATE OR DELETE ON "Wallet"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION wallet_check_final_consistency();

-- A ledger-only correction must not leave an unchecked stale cache.
CREATE CONSTRAINT TRIGGER balance_log_wallet_consistency
AFTER INSERT OR UPDATE OR DELETE ON "BalanceLog"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION wallet_check_final_consistency();

COMMIT;
