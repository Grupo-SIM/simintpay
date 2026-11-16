-- Plano 0023, Fase 6: APAGAR as tabelas de produto antigas (renomeadas para "..._legacy" na Fase 5).
--
-- DESTRUTIVO E IRREVERSIVEL. Fora de prisma/migrations de proposito (o auto-migrate nao pode rodar
-- isto). Rode so depois da janela de observacao (plano 0023, secao 7, Fase 6), com backup/PITR
-- recente e o codigo classe C (leitores e escritores das tabelas antigas) ja removido.
-- Ver prisma/phase-sql/README.md.
--
--   # ensaio (padrao): executa tudo e termina em ROLLBACK
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm="DROP-LEGACY:<nome do banco>" \
--        -f prisma/phase-sql/phase6-drop.sql
--   # apagar de verdade
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm="DROP-LEGACY:<nome do banco>" \
--        -v finish=COMMIT -f prisma/phase-sql/phase6-drop.sql
--
-- Variaveis:
--   confirm=DROP-LEGACY:<current_database()>   OBRIGATORIA. Digitar o nome do banco impede rodar
--                                              no banco errado por engano.
--   finish=ROLLBACK|COMMIT                     padrao ROLLBACK.
--   accept_loss=<tabela>[,<tabela>...]|all     tabelas ..._legacy que ainda tem linhas e que o dono
--                                              aceita perder (ex.: PaymentLinkOfferSale_legacy,
--                                              SubscriptionLinkOrder_legacy). Sem isso, qualquer
--                                              tabela que nao seja um dos cinco produtos e tenha
--                                              linhas ABORTA. Os cinco produtos sao conferidos por
--                                              paridade de id com "Offer".
--
-- Ordem (secao 8 do plano, folha primeiro; nenhum DROP usa CASCADE, entao uma dependencia
-- esquecida faz o comando falhar em vez de levar outra coisa junto):
--   1. PaymentLinkOfferFile, PaymentLinkFile, PaymentLinkOfferSale, PaymentLinkOffer
--   2. (Voucher e VoucherUsage FICAM: cupons foram portados e nao tem FK para produto)
--   3. PixPlanLinkCode, PixPlanOrder, CustomerPlanAccess, PixCreditPlan
--   4. SubscriptionPause, SubscriptionHistoryExclusion, Subscription, Plan
--   5. SubscriptionLinkOrder, SubscriptionLink
--   6. "Transaction"."paymentLinkId" (FK e coluna), PaymentLink, Boleto
--   7. enum "PlanType" (so ele ficou sem uso; os demais enums sao compartilhados)
--
-- Sobre ON DELETE CASCADE ("PaymentLinkFile", "PaymentLinkOffer", "PaymentLinkOfferFile" e
-- "Voucher"/"VoucherUsage"): a acao em cascata so dispara em DELETE/TRUNCATE, nunca em DROP TABLE.
-- Mesmo assim o script apaga os filhos antes dos pais e nunca emite DELETE, TRUNCATE ou CASCADE.
--
-- Fora do escopo (migration normal do Prisma, junto do release de codigo): o CHECK
-- "CoproductionAgreement_product_check" (passar a aceitar so 'ofertas' e 'plataformas'), colunas
-- "Offer"."legacyType"/"legacyId" e seu indice unico, e ExternalRef (a DOM ainda resolve por ele).
--
-- ROLLBACK: depois do COMMIT so existe restaurar o backup/PITR. Antes do COMMIT basta nao
-- confirmar (finish=ROLLBACK ou qualquer falha desfaz tudo, DDL do Postgres e transacional).

\set ON_ERROR_STOP on
\if :{?finish}
\else
  \set finish ROLLBACK
\endif
\if :{?confirm}
\else
  \set confirm ''
\endif
\if :{?accept_loss}
\else
  \set accept_loss ''
\endif
SELECT upper(:'finish') IN ('COMMIT', 'ROLLBACK') AS finish_ok,
       (:'confirm' = 'DROP-LEGACY:' || current_database()) AS confirm_ok,
       current_database() AS dbname \gset
\if :finish_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'finish deve ser COMMIT ou ROLLBACK'; END $$;
\endif
\if :confirm_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'Recusado: passe -v confirm="DROP-LEGACY:<nome do banco>" para confirmar o banco alvo'; END $$;
\endif

\echo '== Fase 6: apagar tabelas legadas em' :dbname '(termina em' :finish ')'

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';
SELECT set_config('phase6.accept_loss', :'accept_loss', true);

DO $$
DECLARE
  t text;
  missing text[] := '{}';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'PaymentLink', 'SubscriptionLink', 'Plan', 'PixCreditPlan', 'Boleto',
    'PaymentLinkOfferFile', 'PaymentLinkFile', 'PaymentLinkOfferSale', 'PaymentLinkOffer',
    'PixPlanLinkCode', 'PixPlanOrder', 'CustomerPlanAccess', 'SubscriptionPause',
    'SubscriptionHistoryExclusion', 'Subscription', 'SubscriptionLinkOrder'
  ] LOOP
    IF to_regclass(format('public.%I', t || '_legacy')) IS NULL THEN
      missing := missing || (t || '_legacy');
    END IF;
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      RAISE EXCEPTION 'Fase 6 abortada: "%" ainda existe com o nome original (a Fase 5 nao foi aplicada)', t;
    END IF;
  END LOOP;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'Fase 6 abortada: tabela(s) ausente(s) (ja apagadas?): %', array_to_string(missing, ', ');
  END IF;
END $$;

LOCK TABLE "Offer", "Transaction" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE
  "PaymentLink_legacy", "SubscriptionLink_legacy", "Plan_legacy", "PixCreditPlan_legacy", "Boleto_legacy",
  "PaymentLinkOfferFile_legacy", "PaymentLinkFile_legacy", "PaymentLinkOfferSale_legacy", "PaymentLinkOffer_legacy",
  "PixPlanLinkCode_legacy", "PixPlanOrder_legacy", "CustomerPlanAccess_legacy", "SubscriptionPause_legacy",
  "SubscriptionHistoryExclusion_legacy", "Subscription_legacy", "SubscriptionLinkOrder_legacy"
  IN ACCESS EXCLUSIVE MODE;

-- Pre-checagens que ABORTAM (acumuladas).
DO $$
DECLARE
  problems text[] := '{}';
  accept text := lower(coalesce(current_setting('phase6.accept_loss', true), ''));
  t text;
  n bigint;
  n2 bigint;
BEGIN
  -- 1. Os cinco produtos: toda linha tem Offer de mesmo id (paridade minima; rode tambem
  --    scripts/offer-parity-check.ts antes).
  FOREACH t IN ARRAY ARRAY['PaymentLink', 'SubscriptionLink', 'Plan', 'PixCreditPlan', 'Boleto'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t || '_legacy') INTO n;
    EXECUTE format(
      'SELECT count(*) FROM %I p WHERE NOT EXISTS (SELECT 1 FROM "Offer" o WHERE o.id = p.id)', t || '_legacy'
    ) INTO n2;
    RAISE NOTICE '%_legacy : % linhas, % sem Offer de mesmo id', t, n, n2;
    IF n2 > 0 THEN
      problems := problems || format('%s linha(s) de "%s_legacy" sem Offer de mesmo id', n2, t);
    END IF;
  END LOOP;

  -- 2. As demais tabelas: so apaga vazia ou com aceite explicito.
  FOREACH t IN ARRAY ARRAY[
    'PaymentLinkOfferFile', 'PaymentLinkFile', 'PaymentLinkOfferSale', 'PaymentLinkOffer',
    'PixPlanLinkCode', 'PixPlanOrder', 'CustomerPlanAccess', 'SubscriptionPause',
    'SubscriptionHistoryExclusion', 'Subscription', 'SubscriptionLinkOrder'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t || '_legacy') INTO n;
    RAISE NOTICE '%_legacy : % linhas', t, n;
    IF n > 0 AND accept <> 'all'
       AND NOT (lower(t || '_legacy') = ANY (string_to_array(replace(accept, ' ', ''), ','))) THEN
      problems := problems || format('"%s_legacy" tem %s linha(s) e nao foi aceita (-v accept_loss=%s_legacy)', t, n, t);
    END IF;
  END LOOP;

  -- 3. Nenhuma tabela viva referencia tabela legada (so as proprias legadas entre si).
  SELECT count(*) INTO n FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_class parent ON parent.oid = c.confrelid
   WHERE c.contype = 'f' AND parent.relname LIKE '%\_legacy' AND child.relname NOT LIKE '%\_legacy';
  IF n > 0 THEN problems := problems || format('%s FK(s) de tabela viva apontam para tabela _legacy', n); END IF;

  -- 4. "Transaction"."paymentLinkId": a FK ja e para Offer e nada se perde ao apagar a coluna
  --    ("offerId" tem o mesmo valor onde a coluna esta preenchida).
  IF (SELECT confrelid::regclass::text FROM pg_constraint
       WHERE conname = 'Transaction_paymentLinkId_fkey' AND conrelid = '"Transaction"'::regclass) IS DISTINCT FROM '"Offer"' THEN
    problems := problems || 'Transaction_paymentLinkId_fkey nao aponta para Offer (Fase 5 aplicada?)';
  END IF;
  SELECT count(*) INTO n FROM "Transaction"
   WHERE "paymentLinkId" IS NOT NULL AND "offerId" IS DISTINCT FROM "paymentLinkId";
  IF n > 0 THEN
    problems := problems || format('%s Transaction com paymentLinkId sem o mesmo offerId (apagar a coluna perderia o vinculo)', n);
  END IF;

  -- 5. Nenhuma funcao, trigger ou view cita as tabelas (ja renomeadas) ou a coluna a apagar.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND (p.prosrc ~ '"(PaymentLink|SubscriptionLink|Plan|PixCreditPlan|Boleto|PaymentLinkOfferFile|PaymentLinkFile|PaymentLinkOfferSale|PaymentLinkOffer|PixPlanLinkCode|PixPlanOrder|CustomerPlanAccess|SubscriptionPause|SubscriptionHistoryExclusion|Subscription|SubscriptionLinkOrder)(_legacy)?"'
          OR p.prosrc ~* 'paymentLinkId');
  IF n > 0 THEN problems := problems || format('%s funcao(oes) citam tabela legada ou "paymentLinkId"', n); END IF;
  SELECT count(DISTINCT v.oid) INTO n
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
    JOIN pg_class tc ON tc.oid = d.refobjid
   WHERE d.classid = 'pg_rewrite'::regclass AND tc.relnamespace = 'public'::regnamespace
     AND (tc.relname LIKE '%\_legacy' OR tc.relname = 'Transaction');
  IF n > 0 THEN problems := problems || format('%s view(s) dependem de tabela legada ou de "Transaction"', n); END IF;

  -- 6. O enum PlanType so e usado pelas colunas que vao embora.
  SELECT count(*) INTO n FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
    JOIN pg_type ty ON (ty.oid = a.atttypid OR ty.typarray = a.atttypid)
   WHERE ty.typname = 'PlanType' AND a.attnum > 0 AND NOT a.attisdropped
     AND c.relname NOT LIKE '%\_legacy';
  IF n > 0 THEN problems := problems || format('%s coluna(s) viva(s) ainda usam o enum PlanType', n); END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION E'Fase 6 abortada, % problema(s):\n  - %', cardinality(problems), array_to_string(problems, E'\n  - ');
  END IF;
  RAISE NOTICE 'Pre-checagens OK';
END $$;

-- 1. Funil e arquivos (filhos de PaymentLink).
DROP TABLE "PaymentLinkOfferFile_legacy";
DROP TABLE "PaymentLinkFile_legacy";
DROP TABLE "PaymentLinkOfferSale_legacy";
DROP TABLE "PaymentLinkOffer_legacy";

-- 3. Plano PIX.
DROP TABLE "PixPlanLinkCode_legacy";
DROP TABLE "PixPlanOrder_legacy";
DROP TABLE "CustomerPlanAccess_legacy";
DROP TABLE "PixCreditPlan_legacy";

-- 4. Plano e assinatura DOM.
DROP TABLE "SubscriptionPause_legacy";
DROP TABLE "SubscriptionHistoryExclusion_legacy";
DROP TABLE "Subscription_legacy";
DROP TABLE "Plan_legacy";

-- 5. Link de assinatura.
DROP TABLE "SubscriptionLinkOrder_legacy";
DROP TABLE "SubscriptionLink_legacy";

-- 6. Chave em "Transaction", depois PaymentLink e Boleto.
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_paymentLinkId_fkey";
ALTER TABLE "Transaction" DROP COLUMN "paymentLinkId";
DROP TABLE "PaymentLink_legacy";
DROP TABLE "Boleto_legacy";

-- 7. Enum sem uso.
DROP TYPE "PlanType";

-- Pos-checagens.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM pg_class
   WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname LIKE '%\_legacy';
  IF n > 0 THEN RAISE EXCEPTION '% tabela(s) _legacy sobraram', n; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'Transaction' AND column_name = 'paymentLinkId') THEN
    RAISE EXCEPTION 'Transaction.paymentLinkId sobrou';
  END IF;
  -- Offer e o que o historico financeiro aponta continuam intactos.
  IF to_regclass('public."Offer"') IS NULL OR to_regclass('public."Voucher"') IS NULL THEN
    RAISE EXCEPTION 'Offer/Voucher sumiram';
  END IF;
  RAISE NOTICE 'Pos-checagens OK';
END $$;

:finish;
\echo '== Fase 6 terminou em' :finish
