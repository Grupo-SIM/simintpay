-- Migrates legacy PAID PIX SubscriptionLinkOrder rows (no DOM subscription) into
-- BillingContract + Charge (subscription-migration-playbook.md, CENARIO A).
--
-- Idempotent: re-running changes nothing. Writes ONLY "BillingContract" and "Charge".
-- It never touches Wallet, BalanceLog, Transaction, CoproductionAllocation or
-- SubscriptionLinkOrder (the money was settled long ago) and never creates Offers.
--
-- Run through backend/scripts/offer-contract-migration.ts (dry-run by default). Blocks are
-- separated by "-- @@ <section>:<name>" marker lines, one statement per block, so the file is
-- also valid for psql -f (inside a transaction you control).
--
-- Choices:
--   * Settlement timestamp = latest TransactionStatusHistory row with toStatus = 'COMPLETED';
--     if the history has none, Transaction."updatedAt" (the row is not changed after it
--     settles). It is the start of the paid period.
--   * Period end = start + the Offer interval, with the same calendar overflow as
--     advanceInterval (JS setUTCMonth/setUTCFullYear), e.g. Feb 29 + 1 year = Mar 1.
--   * Paid amount = Transaction.amount (exact cents, numeric math, no floats). Orders whose
--     Transaction.amount differs from order.amountCharged, or is not a whole number of cents,
--     are skipped and reported.
--   * Contract key = ('OFFER', offerId || ':' || lower(trim(email))), the key
--     OfferSubscribeService uses. When several orders share it, the earliest settlement wins
--     and the others are skipped (DUPLICATE_CONTRACT_KEY).
--   * cycleKey = period start formatted like JS Date.toISOString(), so the later cycleKey of
--     BillingCycleService.runDue (= currentPeriodEnd.toISOString()) is consistent.

-- @@ migrate:candidates
CREATE TEMP TABLE _occ_src ON COMMIT DROP AS
WITH base AS (
  SELECT
    o.id AS order_id,
    o."customerName",
    o."customerEmail",
    lower(btrim(o."customerEmail")) AS email_key,
    o."customerDocument",
    o."amountCharged",
    t.id AS transaction_id,
    t.amount AS paid_amount,
    date_trunc('milliseconds', COALESCE(
      (SELECT max(h."createdAt") FROM "TransactionStatusHistory" h
        WHERE h."transactionId" = t.id AND h."toStatus" = 'COMPLETED'),
      t."updatedAt")) AS settled_at,
    f.id AS offer_id,
    f."ownerUserId",
    f."intervalType",
    COALESCE(f."intervalCount", 1) AS interval_count
  FROM "SubscriptionLinkOrder" o
  LEFT JOIN "Transaction" t
    ON t."domPaymentId" = o."domPixPaymentId" AND t.status = 'COMPLETED'
  LEFT JOIN "Offer" f
    ON f."legacyType" = 'SubscriptionLink' AND f."legacyId" = o."subscriptionLinkId"
  WHERE o.status = 'paid'
    AND o."paymentMethod" = 'PIX'
    AND o."domSubscriptionId" IS NULL
), ranked AS (
  SELECT b.*,
    row_number() OVER (PARTITION BY b.offer_id, b.email_key
                       ORDER BY b.settled_at, b.order_id) AS rn
  FROM base b
), classified AS (
  SELECT r.*,
    CASE
      WHEN r.transaction_id IS NULL THEN 'NO_SETTLED_TRANSACTION'
      WHEN r.offer_id IS NULL THEN 'OFFER_MISSING'
      WHEN r."intervalType" IS NULL THEN 'OFFER_WITHOUT_INTERVAL'
      WHEN r.paid_amount <> r."amountCharged" THEN 'AMOUNT_MISMATCH'
      WHEN r.paid_amount * 100 <> trunc(r.paid_amount * 100) OR r.paid_amount <= 0
        THEN 'AMOUNT_NOT_WHOLE_CENTS'
      WHEN EXISTS (SELECT 1 FROM "Charge" c WHERE c."transactionId" = r.transaction_id)
        THEN 'ALREADY_MIGRATED'
      WHEN r.rn > 1 THEN 'DUPLICATE_CONTRACT_KEY'
      WHEN EXISTS (SELECT 1 FROM "BillingContract" bc
                    WHERE bc."resourceType" = 'OFFER'
                      AND bc."resourceId" = r.offer_id || ':' || r.email_key)
        THEN 'CONTRACT_KEY_TAKEN'
      ELSE 'MIGRATE'
    END AS decision
  FROM ranked r
)
SELECT c.*,
  CASE c."intervalType"
    WHEN 'DAY' THEN c.settled_at + make_interval(days => c.interval_count)
    WHEN 'WEEK' THEN c.settled_at + make_interval(days => 7 * c.interval_count)
    WHEN 'MONTH' THEN date_trunc('month', c.settled_at) + make_interval(months => c.interval_count)
      + make_interval(days => extract(day FROM c.settled_at)::int - 1) + c.settled_at::time
    WHEN 'YEAR' THEN date_trunc('month', c.settled_at) + make_interval(years => c.interval_count)
      + make_interval(days => extract(day FROM c.settled_at)::int - 1) + c.settled_at::time
  END AS period_end
FROM classified c;

-- @@ migrate:report
SELECT decision, count(*)::int AS orders FROM _occ_src GROUP BY decision ORDER BY decision;

-- @@ migrate:contracts
INSERT INTO "BillingContract" (
  id, "userId", "resourceType", "resourceId", currency, "baseAmount", "unitAmount", quantity,
  "intervalType", "intervalCount", "currentPeriodStart", "currentPeriodEnd", status,
  "accessEndsAt", "nextChargeAt", "externalSubscriptionId", metadata, "offerId",
  "customerName", "customerEmail", "customerDocument", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, s."ownerUserId", 'OFFER', s.offer_id || ':' || s.email_key, 'BRL', 0,
  s.paid_amount, 1, s."intervalType", s.interval_count, s.settled_at, s.period_end,
  CASE WHEN s.period_end > (now() AT TIME ZONE 'UTC')
       THEN 'ACTIVE'::"BillingContractStatus" ELSE 'SUSPENDED'::"BillingContractStatus" END,
  CASE WHEN s.period_end > (now() AT TIME ZONE 'UTC') THEN NULL ELSE s.period_end END,
  CASE WHEN s.period_end > (now() AT TIME ZONE 'UTC') THEN s.period_end ELSE NULL END,
  NULL,
  jsonb_build_object('legacyOrderId', s.order_id, 'migratedBy', 'offer-contract-migration'),
  s.offer_id, s."customerName", s."customerEmail", s."customerDocument",
  now(), now()
FROM _occ_src s
WHERE s.decision = 'MIGRATE'
ON CONFLICT ("resourceType", "resourceId") DO NOTHING;

-- @@ migrate:charges
INSERT INTO "Charge" (
  id, "offerId", "contractId", "ownerUserId", "amountCents", currency, status, method, "dueAt",
  "periodStart", "periodEnd", "cycleKey", attempts, "customerName", "customerEmail",
  "customerDocument", "transactionId", "paidAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, s.offer_id, bc.id, s."ownerUserId",
  (s.paid_amount * 100)::int, 'BRL', 'PAID', 'PIX', s.settled_at,
  s.settled_at, s.period_end,
  to_char(s.settled_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 1, s."customerName",
  s."customerEmail", s."customerDocument", s.transaction_id, s.settled_at, now(), now()
FROM _occ_src s
JOIN "BillingContract" bc
  ON bc."resourceType" = 'OFFER' AND bc."resourceId" = s.offer_id || ':' || s.email_key
 AND bc.metadata ->> 'legacyOrderId' = s.order_id
WHERE s.decision = 'MIGRATE'
  AND NOT EXISTS (SELECT 1 FROM "Charge" c WHERE c."transactionId" = s.transaction_id)
ON CONFLICT DO NOTHING;

-- ==== VERIFY ====================================================================
-- Each block returns rows ONLY on mismatch (check, order_id, detail). Read-only.

-- @@ verify:missing-contract-or-charge
WITH eligible AS (
  SELECT o.id AS order_id, t.id AS transaction_id, f.id AS offer_id,
    lower(btrim(o."customerEmail")) AS email_key
  FROM "SubscriptionLinkOrder" o
  JOIN "Transaction" t ON t."domPaymentId" = o."domPixPaymentId" AND t.status = 'COMPLETED'
  JOIN "Offer" f ON f."legacyType" = 'SubscriptionLink' AND f."legacyId" = o."subscriptionLinkId"
  WHERE o.status = 'paid' AND o."paymentMethod" = 'PIX' AND o."domSubscriptionId" IS NULL
    AND f."intervalType" IS NOT NULL AND t.amount = o."amountCharged"
    AND t.amount > 0 AND t.amount * 100 = trunc(t.amount * 100)
)
SELECT 'MISSING_CONTRACT' AS "check", e.order_id, 'no contract for ' || e.offer_id || ':' || e.email_key AS detail
FROM eligible e
WHERE NOT EXISTS (
  SELECT 1 FROM "BillingContract" bc
  WHERE bc."resourceType" = 'OFFER' AND bc."resourceId" = e.offer_id || ':' || e.email_key)
UNION ALL
SELECT 'MISSING_CHARGE', e.order_id, 'no Charge for transaction ' || e.transaction_id
FROM eligible e
WHERE NOT EXISTS (
  SELECT 1 FROM eligible e2 JOIN "Charge" c ON c."transactionId" = e2.transaction_id
  WHERE e2.offer_id = e.offer_id AND e2.email_key = e.email_key);

-- @@ verify:migrated-rows
SELECT 'CHARGE_MISSING_FOR_CONTRACT' AS "check", bc.metadata ->> 'legacyOrderId' AS order_id,
  'contract ' || bc.id || ' has no Charge' AS detail
FROM "BillingContract" bc
WHERE bc.metadata ->> 'migratedBy' = 'offer-contract-migration'
  AND NOT EXISTS (SELECT 1 FROM "Charge" c WHERE c."contractId" = bc.id)
UNION ALL
SELECT 'TRANSACTION_MISMATCH', bc.metadata ->> 'legacyOrderId',
  'charge ' || c.id || ' transactionId ' || COALESCE(c."transactionId", 'NULL')
    || ' != order transaction ' || COALESCE(t.id, 'NULL')
FROM "BillingContract" bc
JOIN "Charge" c ON c."contractId" = bc.id
LEFT JOIN "SubscriptionLinkOrder" o ON o.id = bc.metadata ->> 'legacyOrderId'
LEFT JOIN "Transaction" t ON t."domPaymentId" = o."domPixPaymentId" AND t.status = 'COMPLETED'
WHERE bc.metadata ->> 'migratedBy' = 'offer-contract-migration'
  AND c."transactionId" IS DISTINCT FROM t.id
UNION ALL
SELECT 'AMOUNT_MISMATCH', bc.metadata ->> 'legacyOrderId',
  'charge cents ' || c."amountCents" || ', contract unitAmount ' || bc."unitAmount"
    || ', transaction amount ' || COALESCE(t.amount::text, 'NULL')
FROM "BillingContract" bc
JOIN "Charge" c ON c."contractId" = bc.id
LEFT JOIN "Transaction" t ON t.id = c."transactionId"
WHERE bc.metadata ->> 'migratedBy' = 'offer-contract-migration'
  AND (t.id IS NULL OR c."amountCents"::numeric <> t.amount * 100
       OR bc."unitAmount" <> t.amount)
UNION ALL
SELECT 'PERIOD_INCONSISTENT', bc.metadata ->> 'legacyOrderId',
  'charge ' || c."periodStart" || '..' || c."periodEnd" || ' vs contract '
    || bc."currentPeriodStart" || '..' || bc."currentPeriodEnd"
FROM "BillingContract" bc
JOIN "Charge" c ON c."contractId" = bc.id
WHERE bc.metadata ->> 'migratedBy' = 'offer-contract-migration'
  AND (c."periodStart" IS NULL OR c."periodEnd" IS NULL
       OR c."periodEnd" <= c."periodStart" OR c."paidAt" IS NULL OR c.status <> 'PAID'
       OR bc."currentPeriodEnd" < c."periodEnd")
UNION ALL
SELECT 'CYCLE_KEY_FORMAT', bc.metadata ->> 'legacyOrderId',
  'cycleKey ' || COALESCE(c."cycleKey", 'NULL') || ' != periodStart ISO'
FROM "BillingContract" bc
JOIN "Charge" c ON c."contractId" = bc.id
WHERE bc.metadata ->> 'migratedBy' = 'offer-contract-migration'
  AND c."cycleKey" IS DISTINCT FROM to_char(c."periodStart", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
UNION ALL
SELECT 'SCHEDULE_INCONSISTENT', bc.metadata ->> 'legacyOrderId',
  'status ' || bc.status || ' nextChargeAt ' || COALESCE(bc."nextChargeAt"::text, 'NULL')
FROM "BillingContract" bc
WHERE bc.metadata ->> 'migratedBy' = 'offer-contract-migration'
  AND bc.status = 'ACTIVE' AND bc."nextChargeAt" IS DISTINCT FROM bc."currentPeriodEnd";

-- @@ verify:duplicates
SELECT 'DUPLICATE_ORDER_CONTRACT' AS "check", bc.metadata ->> 'legacyOrderId' AS order_id,
  count(*) || ' contracts for one order' AS detail
FROM "BillingContract" bc
WHERE bc.metadata ->> 'migratedBy' = 'offer-contract-migration'
GROUP BY bc.metadata ->> 'legacyOrderId' HAVING count(*) > 1
UNION ALL
SELECT 'DUPLICATE_CYCLE_KEY', c."contractId", c."cycleKey" || ' x' || count(*)
FROM "Charge" c
WHERE c."contractId" IS NOT NULL AND c."cycleKey" IS NOT NULL
GROUP BY c."contractId", c."cycleKey" HAVING count(*) > 1;
