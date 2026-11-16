-- Plano 0023, Fase 5: ROLLBACK de phase5-repoint-and-rename.sql (so vale antes da Fase 6).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/phase-sql/phase5-rollback.sql                    # ensaio
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v finish=COMMIT -f prisma/phase-sql/phase5-rollback.sql   # aplica
--
-- Desfaz, numa transacao: renomeia as 16 tabelas "..._legacy" de volta e devolve a FK
-- "Transaction_paymentLinkId_fkey" para "PaymentLink" (NOT VALID + VALIDATE).
--
-- Aborta se:
--   - alguma tabela "..._legacy" nao existe ou o nome original ja esta em uso (Fase 5 nao aplicada
--     ou Fase 6 ja apagou);
--   - existe Transaction com paymentLinkId que nao esta em "PaymentLink_legacy" (vendas feitas
--     depois do corte so apontam para Offer; nesse caso volte so com o backup ou limpe a coluna
--     conscientemente: UPDATE "Transaction" SET "paymentLinkId" = NULL WHERE ...).
--
-- Depois do rollback o codigo precisa voltar a ler as tabelas antigas (release anterior ao corte).

\set ON_ERROR_STOP on
\if :{?finish}
\else
  \set finish ROLLBACK
\endif
SELECT upper(:'finish') IN ('COMMIT', 'ROLLBACK') AS finish_ok \gset
\if :finish_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'finish deve ser COMMIT ou ROLLBACK'; END $$;
\endif

\echo '== Rollback da Fase 5 (termina em' :finish ')'

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';

DO $$
DECLARE
  t text;
  problems text[] := '{}';
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'PaymentLink', 'SubscriptionLink', 'Plan', 'PixCreditPlan', 'Boleto',
    'PaymentLinkOfferFile', 'PaymentLinkFile', 'PaymentLinkOfferSale', 'PaymentLinkOffer',
    'PixPlanLinkCode', 'PixPlanOrder', 'CustomerPlanAccess', 'SubscriptionPause',
    'SubscriptionHistoryExclusion', 'Subscription', 'SubscriptionLinkOrder'
  ] LOOP
    IF to_regclass(format('public.%I', t || '_legacy')) IS NULL THEN
      problems := problems || format('"%s_legacy" nao existe', t);
    END IF;
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      problems := problems || format('"%s" ja existe', t);
    END IF;
  END LOOP;
  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION E'Rollback abortado:\n  - %', array_to_string(problems, E'\n  - ');
  END IF;

  SELECT count(*) INTO n FROM "Transaction" x
   WHERE x."paymentLinkId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "PaymentLink_legacy" p WHERE p.id = x."paymentLinkId");
  IF n > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % Transaction com paymentLinkId que nao esta em PaymentLink_legacy', n;
  END IF;
END $$;

LOCK TABLE "Transaction" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE
  "PaymentLink_legacy", "SubscriptionLink_legacy", "Plan_legacy", "PixCreditPlan_legacy", "Boleto_legacy",
  "PaymentLinkOfferFile_legacy", "PaymentLinkFile_legacy", "PaymentLinkOfferSale_legacy", "PaymentLinkOffer_legacy",
  "PixPlanLinkCode_legacy", "PixPlanOrder_legacy", "CustomerPlanAccess_legacy", "SubscriptionPause_legacy",
  "SubscriptionHistoryExclusion_legacy", "Subscription_legacy", "SubscriptionLinkOrder_legacy"
  IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "Boleto_legacy"                       RENAME TO "Boleto";
ALTER TABLE "PaymentLink_legacy"                  RENAME TO "PaymentLink";
ALTER TABLE "SubscriptionLink_legacy"             RENAME TO "SubscriptionLink";
ALTER TABLE "SubscriptionLinkOrder_legacy"        RENAME TO "SubscriptionLinkOrder";
ALTER TABLE "Plan_legacy"                         RENAME TO "Plan";
ALTER TABLE "Subscription_legacy"                 RENAME TO "Subscription";
ALTER TABLE "SubscriptionHistoryExclusion_legacy" RENAME TO "SubscriptionHistoryExclusion";
ALTER TABLE "SubscriptionPause_legacy"            RENAME TO "SubscriptionPause";
ALTER TABLE "PixCreditPlan_legacy"                RENAME TO "PixCreditPlan";
ALTER TABLE "CustomerPlanAccess_legacy"           RENAME TO "CustomerPlanAccess";
ALTER TABLE "PixPlanOrder_legacy"                 RENAME TO "PixPlanOrder";
ALTER TABLE "PixPlanLinkCode_legacy"              RENAME TO "PixPlanLinkCode";
ALTER TABLE "PaymentLinkOffer_legacy"             RENAME TO "PaymentLinkOffer";
ALTER TABLE "PaymentLinkOfferSale_legacy"         RENAME TO "PaymentLinkOfferSale";
ALTER TABLE "PaymentLinkFile_legacy"              RENAME TO "PaymentLinkFile";
ALTER TABLE "PaymentLinkOfferFile_legacy"         RENAME TO "PaymentLinkOfferFile";

ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_paymentLinkId_fkey";
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_paymentLinkId_fkey"
  FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"(id)
  ON UPDATE CASCADE ON DELETE SET NULL
  NOT VALID;
ALTER TABLE "Transaction" VALIDATE CONSTRAINT "Transaction_paymentLinkId_fkey";

:finish;
\echo '== Rollback terminou em' :finish
