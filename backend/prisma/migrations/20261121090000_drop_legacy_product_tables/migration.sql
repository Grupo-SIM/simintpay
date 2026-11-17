-- Plan 0023, final phase: drop the legacy product tables, "Transaction"."paymentLinkId",
-- "Offer"."legacyType"/"legacyId" and the "PlanType" enum. DESTRUCTIVE AND IRREVERSIBLE.
--
-- Every DROP is a plain DROP TABLE (never CASCADE), children before parents, so a forgotten
-- dependency fails the migration instead of taking something else along. The whole file runs in
-- one transaction. Each table is resolved to "<name>" or, when an earlier phase already renamed
-- it, to "<name>_legacy".

-- 1. Pre-checks: abort (RAISE EXCEPTION) with the full list of problems.
DO $$
DECLARE
  problems text[] := '{}';
  t text;
  r regclass;
  n bigint;
  n2 bigint;
BEGIN
  -- 1.1 The five products: every row must have an Offer with the same id.
  FOREACH t IN ARRAY ARRAY['PaymentLink', 'SubscriptionLink', 'Plan', 'PixCreditPlan', 'Boleto'] LOOP
    r := coalesce(to_regclass(format('public.%I', t || '_legacy')), to_regclass(format('public.%I', t)));
    IF r IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM %s', r) INTO n;
    EXECUTE format('SELECT count(*) FROM %s p WHERE NOT EXISTS (SELECT 1 FROM "Offer" o WHERE o.id = p.id)', r) INTO n2;
    RAISE NOTICE '%: % row(s), % without an Offer of the same id', r, n, n2;
    IF n2 > 0 THEN
      problems := problems || format('%s row(s) of %s without an Offer of the same id', n2, r);
    END IF;
  END LOOP;

  -- 1.2 Auxiliary tables are dropped with their rows; report what goes away.
  FOREACH t IN ARRAY ARRAY[
    'PaymentLinkOfferFile', 'PaymentLinkFile', 'PaymentLinkOfferSale', 'PaymentLinkOffer',
    'PixPlanLinkCode', 'PixPlanOrder', 'CustomerPlanAccess', 'SubscriptionPause',
    'SubscriptionHistoryExclusion', 'Subscription', 'SubscriptionLinkOrder'
  ] LOOP
    r := coalesce(to_regclass(format('public.%I', t || '_legacy')), to_regclass(format('public.%I', t)));
    IF r IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM %s', r) INTO n;
    RAISE NOTICE '%: % row(s) will be dropped', r, n;
  END LOOP;

  -- 1.3 "Transaction"."paymentLinkId" only carries a link the offer already carries.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'Transaction' AND column_name = 'paymentLinkId') THEN
    SELECT count(*) INTO n FROM "Transaction"
     WHERE "paymentLinkId" IS NOT NULL AND "offerId" IS DISTINCT FROM "paymentLinkId";
    IF n > 0 THEN
      problems := problems || format('%s Transaction row(s) with paymentLinkId different from offerId (dropping the column would lose the link)', n);
    END IF;
  END IF;

  -- 1.4 No function, trigger body or view mentions the legacy tables or the dropped columns.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND (p.prosrc ~ '"(PaymentLink|SubscriptionLink|Plan|PixCreditPlan|Boleto|PaymentLinkOfferFile|PaymentLinkFile|PaymentLinkOfferSale|PaymentLinkOffer|PixPlanLinkCode|PixPlanOrder|CustomerPlanAccess|SubscriptionPause|SubscriptionHistoryExclusion|Subscription|SubscriptionLinkOrder)(_legacy)?"'
          OR p.prosrc ~* 'paymentLinkId|legacyType|legacyId');
  IF n > 0 THEN problems := problems || format('%s function(s) mention a legacy table or dropped column', n); END IF;
  SELECT count(DISTINCT v.oid) INTO n
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
    JOIN pg_class tc ON tc.oid = d.refobjid
   WHERE d.classid = 'pg_rewrite'::regclass AND tc.relnamespace = 'public'::regnamespace
     AND (tc.relname IN ('PaymentLink', 'SubscriptionLink', 'Plan', 'PixCreditPlan', 'Boleto',
                         'PaymentLinkOfferFile', 'PaymentLinkFile', 'PaymentLinkOfferSale', 'PaymentLinkOffer',
                         'PixPlanLinkCode', 'PixPlanOrder', 'CustomerPlanAccess', 'SubscriptionPause',
                         'SubscriptionHistoryExclusion', 'Subscription', 'SubscriptionLinkOrder', 'Transaction', 'Offer')
          OR tc.relname LIKE '%\_legacy');
  IF n > 0 THEN problems := problems || format('%s view(s) depend on a legacy table, "Transaction" or "Offer"', n); END IF;

  -- 1.5 The PlanType enum is only used by columns that go away with the legacy tables.
  SELECT count(*) INTO n FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
    JOIN pg_type ty ON (ty.oid = a.atttypid OR ty.typarray = a.atttypid)
   WHERE ty.typname = 'PlanType' AND a.attnum > 0 AND NOT a.attisdropped
     AND c.relname NOT IN ('SubscriptionLink', 'Plan', 'PixCreditPlan', 'PixPlanOrder',
                           'SubscriptionLink_legacy', 'Plan_legacy', 'PixCreditPlan_legacy', 'PixPlanOrder_legacy');
  IF n > 0 THEN problems := problems || format('%s column(s) outside the legacy tables still use the PlanType enum', n); END IF;

  -- 1.6 Offer.metadata must be an object (or null) where the legacy origin is folded into it.
  SELECT count(*) INTO n FROM "Offer"
   WHERE "legacyType" IS NOT NULL AND metadata IS NOT NULL AND jsonb_typeof(metadata) <> 'object';
  IF n > 0 THEN problems := problems || format('%s Offer row(s) with legacyType and a non-object metadata', n); END IF;

  -- 1.7 Coproduction: old product keys are rewritten to 'ofertas'; refuse on a primary key collision.
  SELECT count(*) INTO n FROM "CoproductionAgreement" a
   WHERE a.product IN ('links-pagamento', 'links-assinatura', 'boletos', 'planos', 'planos-pix')
     AND EXISTS (SELECT 1 FROM "CoproductionAgreement" b
                  WHERE b."productId" = a."productId" AND b.product <> a.product
                    AND b.product IN ('ofertas', 'links-pagamento', 'links-assinatura', 'boletos', 'planos', 'planos-pix'));
  IF n > 0 THEN
    problems := problems || format('%s CoproductionAgreement row(s) would collide on (product, productId) when rewritten to ofertas', n);
  END IF;
  SELECT count(*) INTO n FROM "CoproductionRevision" a
   WHERE a.product IN ('links-pagamento', 'links-assinatura', 'boletos', 'planos', 'planos-pix')
     AND EXISTS (SELECT 1 FROM "CoproductionRevision" b
                  WHERE b."productId" = a."productId" AND b.version = a.version AND b.product <> a.product
                    AND b.product IN ('ofertas', 'links-pagamento', 'links-assinatura', 'boletos', 'planos', 'planos-pix'));
  IF n > 0 THEN
    problems := problems || format('%s CoproductionRevision row(s) would collide on (product, productId, version) when rewritten to ofertas', n);
  END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION E'Dropping legacy product tables aborted, % problem(s):\n  - %',
      cardinality(problems), array_to_string(problems, E'\n  - ');
  END IF;
  RAISE NOTICE 'Pre-checks OK';
END $$;

-- 2. Keep the origin of migrated offers (consumers read it from metadata from now on).
UPDATE "Offer"
   SET metadata = coalesce(metadata, '{}'::jsonb)
                  || jsonb_build_object('legacyType', "legacyType", 'legacyId', "legacyId")
 WHERE "legacyType" IS NOT NULL;

-- 3. Coproduction keys: only 'ofertas' and 'plataformas' remain valid.
ALTER TABLE "CoproductionAgreement" DROP CONSTRAINT IF EXISTS "CoproductionAgreement_product_check";
UPDATE "CoproductionAgreement" SET product = 'ofertas'
 WHERE product IN ('links-pagamento', 'links-assinatura', 'boletos', 'planos', 'planos-pix');
UPDATE "CoproductionRevision" SET product = 'ofertas'
 WHERE product IN ('links-pagamento', 'links-assinatura', 'boletos', 'planos', 'planos-pix');
ALTER TABLE "CoproductionAgreement" ADD CONSTRAINT "CoproductionAgreement_product_check"
  CHECK (product IN ('plataformas', 'ofertas'));

-- 4. "Offer" legacy columns (the unique index goes with them).
DROP INDEX IF EXISTS "Offer_legacyType_legacyId_key";
ALTER TABLE "Offer" DROP COLUMN "legacyType", DROP COLUMN "legacyId";

-- 5. "Transaction"."paymentLinkId" (FK, index and column) before PaymentLink.
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_paymentLinkId_fkey";
DROP INDEX IF EXISTS "Transaction_paymentLinkId_idx";
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "paymentLinkId";

-- 6. Tables, leaf first. Plain DROP TABLE: no CASCADE.
DO $$
DECLARE
  t text;
  r regclass;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- payment link funnel and files
    'PaymentLinkOfferFile', 'PaymentLinkFile', 'PaymentLinkOfferSale', 'PaymentLinkOffer',
    -- PIX credit plan
    'PixPlanLinkCode', 'PixPlanOrder', 'CustomerPlanAccess', 'PixCreditPlan',
    -- plan and subscription
    'SubscriptionPause', 'SubscriptionHistoryExclusion', 'Subscription', 'Plan',
    -- subscription link
    'SubscriptionLinkOrder', 'SubscriptionLink',
    -- payment link and boleto
    'PaymentLink', 'Boleto'
  ] LOOP
    r := coalesce(to_regclass(format('public.%I', t || '_legacy')), to_regclass(format('public.%I', t)));
    IF r IS NOT NULL THEN
      EXECUTE format('DROP TABLE %s', r);
    END IF;
  END LOOP;
END $$;

-- 7. Enum left without users.
DROP TYPE "PlanType";

-- 8. Post-checks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class
              WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
                AND (relname LIKE '%\_legacy' OR relname IN ('PaymentLink', 'Boleto', 'Plan', 'Subscription', 'SubscriptionLink'))) THEN
    RAISE EXCEPTION 'Legacy product tables are still present';
  END IF;
  IF to_regclass('public."Offer"') IS NULL OR to_regclass('public."BillingContract"') IS NULL THEN
    RAISE EXCEPTION 'Offer/BillingContract are missing';
  END IF;
END $$;
