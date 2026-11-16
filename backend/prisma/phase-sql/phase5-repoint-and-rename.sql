-- Plano 0023, Fase 5: repontar chaves para "Offer" e renomear as tabelas de produto antigas.
--
-- NAO e uma migration do Prisma (fica fora de prisma/migrations de proposito: o auto-migrate
-- do deploy nao pode aplicar isto sozinho). Quem executa e o dono, por psql, depois da Fase 4
-- (escritores cortados, links legados congelados) e da paridade (scripts/offer-parity-check.ts).
-- Ver prisma/phase-sql/README.md.
--
--   # ensaio (padrao): executa tudo e termina em ROLLBACK
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/phase-sql/phase5-repoint-and-rename.sql
--   # aplicar de verdade
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v finish=COMMIT -f prisma/phase-sql/phase5-repoint-and-rename.sql
--
-- Variaveis (todas opcionais):
--   finish=ROLLBACK|COMMIT   como a transacao termina (padrao ROLLBACK)
--   allow_active=1           aceita produto legado ainda ativo (padrao: aborta; o congelamento da
--                            Fase 4 desativa os links)
--
-- O que faz, numa unica transacao (qualquer falha desfaz tudo):
--   1. Trava as tabelas (SHARE ROW EXCLUSIVE nas que sobrevivem, ACCESS EXCLUSIVE nas legadas).
--   2. Pre-checagens que ABORTAM: tabelas presentes e ainda nao renomeadas, toda linha antiga com
--      Offer de mesmo id, sem colisao de id entre os cinco produtos, sem orfao em
--      "Transaction"."paymentLinkId", ExternalRef da DOM presente, coproducao sem chave antiga,
--      produtos legados inativos, funil/arquivos sem dados nao migrados.
--   3. Solta a FK "Transaction"_paymentLinkId_fkey (PaymentLink) e cria a nova para "Offer"
--      NOT VALID, depois VALIDATE (mesma semantica: ON UPDATE CASCADE, ON DELETE SET NULL).
--      As demais FKs para as tabelas antigas vem de tabelas que tambem viram legado; elas
--      acompanham o RENAME e caem juntas na Fase 6. Nao se aponta nenhuma para "Offer" (um
--      RESTRICT/CASCADE de dado morto sobre Offer travaria ou apagaria oferta viva).
--   4. ALTER TABLE ... RENAME TO "..._legacy" nas 16 tabelas de produto.
--   5. Pos-checagens: FK validada, nenhuma tabela viva referencia tabela legada.
--
-- Fica de fora de proposito: "Voucher" e "VoucherUsage" (cupons foram portados para Offer, sem FK
-- para produto) e as tabelas de oferta (OfferAccess, OfferAccessEvent, OfferCodeAlias).
--
-- Bloqueio: ADD CONSTRAINT/VALIDATE seguram SHARE ROW EXCLUSIVE em "Transaction" ate o COMMIT
-- (leituras seguem, escritas esperam). O volume e pequeno; lock_timeout evita ficar pendurado.
--
-- Rollback depois do COMMIT: prisma/phase-sql/phase5-rollback.sql.

\set ON_ERROR_STOP on

\if :{?finish}
\else
  \set finish ROLLBACK
\endif
\if :{?allow_active}
\else
  \set allow_active 0
\endif

SELECT upper(:'finish') IN ('COMMIT', 'ROLLBACK') AS finish_ok \gset
\if :finish_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'finish deve ser COMMIT ou ROLLBACK'; END $$;
\endif

\echo '== Fase 5: repontar e renomear (termina em' :finish ')'

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';
SELECT set_config('phase5.allow_active', :'allow_active', true);

-- 1. Travas. Falha cedo se alguma tabela nao existir (pre-checagem abaixo explica melhor, mas o
--    LOCK precisa dos nomes; por isso a existencia e verificada antes).
DO $$
DECLARE
  t text;
  missing text[] := '{}';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Offer', 'Transaction', 'ExternalRef', 'CoproductionAgreement', 'CoproductionRevision',
    'PaymentLink', 'SubscriptionLink', 'Plan', 'PixCreditPlan', 'Boleto',
    'PaymentLinkOfferFile', 'PaymentLinkFile', 'PaymentLinkOfferSale', 'PaymentLinkOffer',
    'PixPlanLinkCode', 'PixPlanOrder', 'CustomerPlanAccess', 'SubscriptionPause',
    'SubscriptionHistoryExclusion', 'Subscription', 'SubscriptionLinkOrder'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      missing := missing || t;
    END IF;
  END LOOP;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'Fase 5 abortada: tabela(s) ausente(s) (ja renomeadas?): %', array_to_string(missing, ', ');
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'PaymentLink', 'SubscriptionLink', 'Plan', 'PixCreditPlan', 'Boleto',
    'PaymentLinkOfferFile', 'PaymentLinkFile', 'PaymentLinkOfferSale', 'PaymentLinkOffer',
    'PixPlanLinkCode', 'PixPlanOrder', 'CustomerPlanAccess', 'SubscriptionPause',
    'SubscriptionHistoryExclusion', 'Subscription', 'SubscriptionLinkOrder'
  ] LOOP
    IF to_regclass(format('public.%I', t || '_legacy')) IS NOT NULL THEN
      RAISE EXCEPTION 'Fase 5 abortada: "%" ja existe (a fase ja foi aplicada?)', t || '_legacy';
    END IF;
  END LOOP;
END $$;

LOCK TABLE "Offer", "Transaction", "ExternalRef", "CoproductionAgreement", "CoproductionRevision"
  IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE
  "PaymentLink", "SubscriptionLink", "Plan", "PixCreditPlan", "Boleto",
  "PaymentLinkOfferFile", "PaymentLinkFile", "PaymentLinkOfferSale", "PaymentLinkOffer",
  "PixPlanLinkCode", "PixPlanOrder", "CustomerPlanAccess", "SubscriptionPause",
  "SubscriptionHistoryExclusion", "Subscription", "SubscriptionLinkOrder"
  IN ACCESS EXCLUSIVE MODE;

-- 2. Pre-checagens. Acumula tudo e aborta uma vez, para o dono ver todos os problemas.
DO $$
DECLARE
  problems text[] := '{}';
  allow_active boolean := coalesce(current_setting('phase5.allow_active', true), '0') = '1';
  t text;
  n bigint;
  n2 bigint;
BEGIN
  -- 2.1 Toda linha antiga tem Offer com o mesmo id.
  FOREACH t IN ARRAY ARRAY['PaymentLink', 'SubscriptionLink', 'Plan', 'PixCreditPlan', 'Boleto'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    EXECUTE format(
      'SELECT count(*) FROM %I p WHERE NOT EXISTS (SELECT 1 FROM "Offer" o WHERE o.id = p.id)', t
    ) INTO n2;
    RAISE NOTICE '% : % linhas, % sem Offer de mesmo id', t, n, n2;
    IF n2 > 0 THEN
      problems := problems || format('%s linha(s) de "%s" sem Offer de mesmo id', n2, t);
    END IF;
  END LOOP;

  -- 2.2 Sem colisao de id entre os cinco produtos (um id so pode ser uma oferta).
  SELECT count(*) INTO n FROM (
    SELECT id FROM (
      SELECT id FROM "PaymentLink" UNION ALL SELECT id FROM "SubscriptionLink"
      UNION ALL SELECT id FROM "Plan" UNION ALL SELECT id FROM "PixCreditPlan"
      UNION ALL SELECT id FROM "Boleto"
    ) u GROUP BY id HAVING count(*) > 1
  ) d;
  IF n > 0 THEN problems := problems || format('%s id(s) repetido(s) entre os cinco produtos', n); END IF;

  -- 2.3 Orfaos na unica chave que sobrevive e e repontada.
  SELECT count(*) INTO n FROM "Transaction" x
   WHERE x."paymentLinkId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "Offer" o WHERE o.id = x."paymentLinkId");
  IF n > 0 THEN
    problems := problems || format('%s Transaction com paymentLinkId sem Offer (a FK nova nao validaria)', n);
  END IF;
  SELECT count(*) INTO n FROM "Transaction"
   WHERE "paymentLinkId" IS NOT NULL AND "offerId" IS DISTINCT FROM "paymentLinkId";
  IF n > 0 THEN
    problems := problems || format('%s Transaction com offerId diferente de paymentLinkId (rode o backfill da migration 20261118110000)', n);
  END IF;

  -- 2.4 ExternalRef da DOM para quem tinha id na DOM (senao o link na DOM perde o dono).
  SELECT count(*) INTO n FROM (
    SELECT id, "domPaymentLinkId" AS ext, 'PAYMENT_LINK' AS kind FROM "PaymentLink" WHERE "domPaymentLinkId" IS NOT NULL
    UNION ALL SELECT id, "domPaymentLinkId", 'PAYMENT_LINK' FROM "Boleto" WHERE "domPaymentLinkId" IS NOT NULL
    UNION ALL SELECT id, "domPlanId", 'PLAN' FROM "SubscriptionLink" WHERE "domPlanId" IS NOT NULL
    UNION ALL SELECT id, "domPlanId", 'PLAN' FROM "Plan" WHERE "domPlanId" IS NOT NULL
  ) s
  WHERE NOT EXISTS (
    SELECT 1 FROM "ExternalRef" r
     WHERE r."acquirerCode" = 'DOM' AND r.kind = s.kind AND r."externalId" = s.ext
       AND r."entityType" = 'Offer' AND r."entityId" = s.id
  );
  IF n > 0 THEN problems := problems || format('%s id(s) da DOM sem ExternalRef apontando para a Offer', n); END IF;

  -- 2.5 Coproducao: nada sobrando nas chaves antigas, nada apontando para oferta inexistente.
  SELECT (SELECT count(*) FROM "CoproductionAgreement" WHERE product IN ('links-pagamento','links-assinatura','boletos','planos','planos-pix'))
       + (SELECT count(*) FROM "CoproductionRevision" WHERE product IN ('links-pagamento','links-assinatura','boletos','planos','planos-pix'))
    INTO n;
  IF n > 0 THEN problems := problems || format('%s acordo(s)/revisao(oes) de coproducao ainda em chave antiga', n); END IF;
  SELECT count(*) INTO n FROM "CoproductionAgreement" a
   WHERE a.product = 'ofertas' AND NOT EXISTS (SELECT 1 FROM "Offer" o WHERE o.id = a."productId");
  IF n > 0 THEN problems := problems || format('%s acordo(s) de coproducao em "ofertas" sem Offer', n); END IF;

  -- 2.6 Congelamento: nenhum produto legado ainda ativo.
  IF NOT allow_active THEN
    SELECT (SELECT count(*) FROM "PaymentLink" WHERE "isActive")
         + (SELECT count(*) FROM "SubscriptionLink" WHERE "isActive")
         + (SELECT count(*) FROM "Plan" WHERE "isActive")
         + (SELECT count(*) FROM "Boleto" WHERE "isActive")
         + (SELECT count(*) FROM "PixCreditPlan" WHERE upper(status) = 'ACTIVE')
      INTO n;
    IF n > 0 THEN
      problems := problems || format('%s produto(s) legado(s) ainda ativo(s) (congele na Fase 4 ou use -v allow_active=1)', n);
    END IF;
  END IF;

  -- 2.7 Dados que nenhuma Offer substitui ainda (mesmos bloqueios do offer-migration-apply).
  SELECT (SELECT count(*) FROM "PaymentLinkOffer") + (SELECT count(*) FROM "PaymentLinkFile")
       + (SELECT count(*) FROM "PaymentLinkOfferFile") INTO n;
  IF n > 0 THEN problems := problems || format('%s linha(s) de funil/arquivos antigos ainda sem destino na Offer', n); END IF;
  SELECT count(*) INTO n FROM "Subscription"
   WHERE "domSubscriptionId" IS NOT NULL
     AND lower(status) NOT IN ('cancelled','canceled','inactive','expired','failed','deactivated','disabled');
  IF n > 0 THEN problems := problems || format('%s assinatura(s) DOM viva(s) em "Subscription"', n); END IF;
  SELECT count(*) INTO n FROM "SubscriptionLinkOrder" o
   WHERE o."domSubscriptionId" IS NOT NULL
     AND lower(o.status) NOT IN ('cancelled','canceled','inactive','expired','failed','deactivated','disabled')
     AND NOT EXISTS (SELECT 1 FROM "BillingContract" c WHERE c."externalSubscriptionId" = o."domSubscriptionId");
  IF n > 0 THEN problems := problems || format('%s pedido(s) de link de assinatura vivo(s) sem BillingContract', n); END IF;
  SELECT count(*) INTO n FROM "CustomerPlanAccess" a
   WHERE a."isActive" AND NOT EXISTS (
     SELECT 1 FROM "OfferAccess" x WHERE x."offerId" = a."pixPlanId"
   );
  IF n > 0 THEN problems := problems || format('%s acesso(s) de plano PIX ativo(s) sem OfferAccess', n); END IF;

  -- 2.8 Nenhuma funcao do schema public cita as tabelas que vao mudar de nome.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosrc ~ '"(PaymentLink|SubscriptionLink|Plan|PixCreditPlan|Boleto|PaymentLinkOfferFile|PaymentLinkFile|PaymentLinkOfferSale|PaymentLinkOffer|PixPlanLinkCode|PixPlanOrder|CustomerPlanAccess|SubscriptionPause|SubscriptionHistoryExclusion|Subscription|SubscriptionLinkOrder)"';
  IF n > 0 THEN problems := problems || format('%s funcao(oes) citam tabela antiga pelo nome', n); END IF;

  -- 2.9 Nenhuma view depende das tabelas antigas.
  SELECT count(DISTINCT v.oid) INTO n
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
    JOIN pg_class tc ON tc.oid = d.refobjid
   WHERE d.classid = 'pg_rewrite'::regclass AND tc.relnamespace = 'public'::regnamespace
     AND tc.relname IN ('PaymentLink','SubscriptionLink','Plan','PixCreditPlan','Boleto','Subscription','SubscriptionLinkOrder');
  IF n > 0 THEN problems := problems || format('%s view(s) dependem das tabelas antigas', n); END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION E'Fase 5 abortada, % problema(s):\n  - %', cardinality(problems), array_to_string(problems, E'\n  - ');
  END IF;
  RAISE NOTICE 'Pre-checagens OK';
END $$;

-- 3. Repontar "Transaction"."paymentLinkId": PaymentLink -> Offer (mesmo id, mesma semantica).
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_paymentLinkId_fkey";
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_paymentLinkId_fkey"
  FOREIGN KEY ("paymentLinkId") REFERENCES "Offer"(id)
  ON UPDATE CASCADE ON DELETE SET NULL
  NOT VALID;
ALTER TABLE "Transaction" VALIDATE CONSTRAINT "Transaction_paymentLinkId_fkey";

-- 4. Renomear (as FKs entre as tabelas legadas acompanham). Folhas primeiro, por clareza.
ALTER TABLE "PaymentLinkOfferFile"        RENAME TO "PaymentLinkOfferFile_legacy";
ALTER TABLE "PaymentLinkFile"             RENAME TO "PaymentLinkFile_legacy";
ALTER TABLE "PaymentLinkOfferSale"        RENAME TO "PaymentLinkOfferSale_legacy";
ALTER TABLE "PaymentLinkOffer"            RENAME TO "PaymentLinkOffer_legacy";
ALTER TABLE "PixPlanLinkCode"             RENAME TO "PixPlanLinkCode_legacy";
ALTER TABLE "PixPlanOrder"                RENAME TO "PixPlanOrder_legacy";
ALTER TABLE "CustomerPlanAccess"          RENAME TO "CustomerPlanAccess_legacy";
ALTER TABLE "PixCreditPlan"               RENAME TO "PixCreditPlan_legacy";
ALTER TABLE "SubscriptionPause"           RENAME TO "SubscriptionPause_legacy";
ALTER TABLE "SubscriptionHistoryExclusion" RENAME TO "SubscriptionHistoryExclusion_legacy";
ALTER TABLE "Subscription"                RENAME TO "Subscription_legacy";
ALTER TABLE "Plan"                        RENAME TO "Plan_legacy";
ALTER TABLE "SubscriptionLinkOrder"       RENAME TO "SubscriptionLinkOrder_legacy";
ALTER TABLE "SubscriptionLink"            RENAME TO "SubscriptionLink_legacy";
ALTER TABLE "PaymentLink"                 RENAME TO "PaymentLink_legacy";
ALTER TABLE "Boleto"                      RENAME TO "Boleto_legacy";

-- 5. Pos-checagens.
DO $$
DECLARE n bigint;
BEGIN
  IF NOT (SELECT convalidated FROM pg_constraint
           WHERE conname = 'Transaction_paymentLinkId_fkey' AND conrelid = '"Transaction"'::regclass) THEN
    RAISE EXCEPTION 'Transaction_paymentLinkId_fkey nao ficou validada';
  END IF;
  IF (SELECT confrelid::regclass::text FROM pg_constraint
       WHERE conname = 'Transaction_paymentLinkId_fkey' AND conrelid = '"Transaction"'::regclass) <> '"Offer"' THEN
    RAISE EXCEPTION 'Transaction_paymentLinkId_fkey nao aponta para Offer';
  END IF;
  -- nenhuma tabela viva (nao legada) referencia tabela legada
  SELECT count(*) INTO n FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_class parent ON parent.oid = c.confrelid
   WHERE c.contype = 'f' AND parent.relname LIKE '%\_legacy' AND child.relname NOT LIKE '%\_legacy';
  IF n > 0 THEN
    RAISE EXCEPTION '% FK(s) de tabela viva ainda apontam para tabela _legacy', n;
  END IF;
  RAISE NOTICE 'Pos-checagens OK';
END $$;

:finish;
\echo '== Fase 5 terminou em' :finish
