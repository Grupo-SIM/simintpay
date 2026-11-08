CREATE TABLE "AcquirerWithdrawal" (
    "id" TEXT NOT NULL,
    "acquirerCode" TEXT NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "balanceLogId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcquirerWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcquirerWithdrawal_balanceLogId_key" ON "AcquirerWithdrawal"("balanceLogId");
CREATE INDEX "AcquirerWithdrawal_date_idx" ON "AcquirerWithdrawal"("date");

ALTER TABLE "AcquirerWithdrawal" ADD CONSTRAINT "AcquirerWithdrawal_acquirerCode_fkey" FOREIGN KEY ("acquirerCode") REFERENCES "AcquirerCatalogue"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Migrate the manual "Aplicar Taxa DOM" button activations. Each undo cancels the most recent
-- earlier activation of the same amount; cancelled pairs stay in BalanceLog (net zero) and do not
-- become withdrawals. Surviving activations become DOM withdrawals linked to their original log.
DO $$
DECLARE
  undo RECORD;
  target TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "AcquirerCatalogue" WHERE "code" = 'DOM') THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE _dom_apply ON COMMIT DROP AS
    SELECT "id", "createdAt", "bookkeepingAmount", "userId", false AS cancelled
    FROM "BalanceLog"
    WHERE "action" = 'ADMIN_WITHDRAW_FEE_INC'
      AND "source" = 'MASTER_ADMIN_CONTROL'
      AND "metadata"->>'manual' = 'true'
      AND COALESCE("metadata"->>'undo', 'false') <> 'true'
      AND "bookkeepingAmount" > 0;

  FOR undo IN
    SELECT "createdAt", "bookkeepingAmount"
    FROM "BalanceLog"
    WHERE "action" = 'ADMIN_WITHDRAW_FEE_INC'
      AND "source" = 'MASTER_ADMIN_CONTROL'
      AND "metadata"->>'undo' = 'true'
      AND "bookkeepingAmount" < 0
    ORDER BY "createdAt"
  LOOP
    SELECT "id" INTO target FROM _dom_apply
    WHERE NOT cancelled
      AND "bookkeepingAmount" = -undo."bookkeepingAmount"
      AND "createdAt" <= undo."createdAt"
    ORDER BY "createdAt" DESC
    LIMIT 1;
    IF target IS NOT NULL THEN
      UPDATE _dom_apply SET cancelled = true WHERE "id" = target;
    END IF;
  END LOOP;

  INSERT INTO "AcquirerWithdrawal" ("id", "acquirerCode", "feeCents", "date", "balanceLogId", "actorId", "createdAt")
  SELECT gen_random_uuid()::text, 'DOM', ROUND("bookkeepingAmount" * 100)::int,
         ("createdAt" AT TIME ZONE 'America/Sao_Paulo')::date, "id", "userId", "createdAt"
  FROM _dom_apply WHERE NOT cancelled;
END $$;
