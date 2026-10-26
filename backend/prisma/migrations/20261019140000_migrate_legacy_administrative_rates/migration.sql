BEGIN;
-- Snapshot legacy administrative rates into immutable financial revisions.
-- Preserve explicit financial lanes/owner rules. Never alter historical charge snapshots.
CREATE TEMP TABLE "_legacy_financial_defaults" ("key" text PRIMARY KEY, "value" numeric NOT NULL) ON COMMIT DROP;
INSERT INTO "_legacy_financial_defaults" VALUES
('MDR_PIX', 0.0098::numeric),
('TAXA_SAQUE_FIXA', 3.5::numeric),
('TAXA_SAQUE_DOM', 3.5::numeric),
('TAXA_SAQUE_PERCENT', 0::numeric),
('SAQUE_MIN', 100::numeric),
('LIQUIDEZ', 0.9301::numeric),
('TAXA_FIXA_TRANSACAO', 1::numeric),
('TAXA_CASHBACK', 3::numeric),
('TAXA_SERVICO', 4::numeric),
('TAXA_COMISSAO_AFILIADO', 0.1::numeric),
('TAXA_LINK_PERCENT', 0.09::numeric),
('TAXA_LINK_FIXA', 4::numeric),
('TAXA_ASSINATURA', 9::numeric),
('TAXA_DEBITO_PERCENT', 0.02::numeric),
('TAXA_DEBITO_FIXA', 2::numeric),
('TAXA_BOLETO_FIXA', 7::numeric),
('TAXA_BOLETO_TRANSACAO', 2::numeric),
('TAXA_BOLETO_DOM', 3.49::numeric),
('TAXA_BOLETO_DOM_FIXA', 1::numeric),
('MDR_CC_1X', 0::numeric),
('MDR_CC_2X', 0.083::numeric),
('MDR_CC_3X', 0.0968::numeric),
('MDR_CC_4X', 0.1104::numeric),
('MDR_CC_5X', 0.1237::numeric),
('MDR_CC_6X', 0.1367::numeric),
('MDR_CC_7X', 0.1495::numeric),
('MDR_CC_8X', 0.1621::numeric),
('MDR_CC_9X', 0.1744::numeric),
('MDR_CC_10X', 0.1864::numeric),
('MDR_CC_11X', 0.1983::numeric),
('MDR_CC_12X', 0.2099::numeric),
('LINK_COST_1X', 0.09::numeric),
('LINK_COST_2X', 0.09::numeric),
('LINK_COST_3X', 0.09::numeric),
('LINK_COST_4X', 0.09::numeric),
('LINK_COST_5X', 0.09::numeric),
('LINK_COST_6X', 0.09::numeric),
('LINK_COST_7X', 0.09::numeric),
('LINK_COST_8X', 0.09::numeric),
('LINK_COST_9X', 0.09::numeric),
('LINK_COST_10X', 0.09::numeric),
('LINK_COST_11X', 0.09::numeric),
('LINK_COST_12X', 0.09::numeric),
('MDR_LINK_1X', 0::numeric),
('MDR_LINK_2X', 0.0352::numeric),
('MDR_LINK_3X', 0.0573::numeric),
('MDR_LINK_4X', 0.0916::numeric),
('MDR_LINK_5X', 0.1104::numeric),
('MDR_LINK_6X', 0.1299::numeric),
('MDR_LINK_7X', 0.1371::numeric),
('MDR_LINK_8X', 0.132::numeric),
('MDR_LINK_9X', 0.1303::numeric),
('MDR_LINK_10X', 0.129::numeric),
('MDR_LINK_11X', 0.1483::numeric),
('MDR_LINK_12X', 0.1556::numeric),
('MDR_CC_MASTER_1X', 0.0152::numeric),
('MDR_CC_MASTER_2X', 0.0352::numeric),
('MDR_CC_MASTER_3X', 0.0573::numeric),
('MDR_CC_MASTER_4X', 0.0916::numeric),
('MDR_CC_MASTER_5X', 0.1104::numeric),
('MDR_CC_MASTER_6X', 0.1299::numeric),
('MDR_CC_MASTER_7X', 0.1371::numeric),
('MDR_CC_MASTER_8X', 0.132::numeric),
('MDR_CC_MASTER_9X', 0.1303::numeric),
('MDR_CC_MASTER_10X', 0.129::numeric),
('MDR_CC_MASTER_11X', 0.1483::numeric),
('MDR_CC_MASTER_12X', 0.1556::numeric),
('POS_MDR_PIX', 0.01::numeric),
('POS_MDR_DEBITO', 0.0349::numeric),
('POS_TAXA_DOM_FIXA', 1::numeric),
('POS_MDR_CC_1X', 0.0349::numeric),
('POS_MDR_CC_2X', 0.062::numeric),
('POS_MDR_CC_3X', 0.0695::numeric),
('POS_MDR_CC_4X', 0.0767::numeric),
('POS_MDR_CC_5X', 0.0838::numeric),
('POS_MDR_CC_6X', 0.0995::numeric),
('POS_MDR_CC_7X', 0.1061::numeric),
('POS_MDR_CC_8X', 0.1126::numeric),
('POS_MDR_CC_9X', 0.1181::numeric),
('POS_MDR_CC_10X', 0.1251::numeric),
('POS_MDR_CC_11X', 0.131::numeric),
('POS_MDR_CC_12X', 0.1369::numeric),
('POS_TAXA_PIX_PERCENT', 0.09::numeric),
('POS_TAXA_DEBITO_PERCENT', 0.09::numeric),
('POS_TAXA_CREDITO_1X', 0.09::numeric),
('POS_TAXA_CREDITO_2X', 0.1171::numeric),
('POS_TAXA_CREDITO_3X', 0.1246::numeric),
('POS_TAXA_CREDITO_4X', 0.1318::numeric),
('POS_TAXA_CREDITO_5X', 0.1389::numeric),
('POS_TAXA_CREDITO_6X', 0.1546::numeric),
('POS_TAXA_CREDITO_7X', 0.1612::numeric),
('POS_TAXA_CREDITO_8X', 0.1677::numeric),
('POS_TAXA_CREDITO_9X', 0.1732::numeric),
('POS_TAXA_CREDITO_10X', 0.1802::numeric),
('POS_TAXA_CREDITO_11X', 0.1861::numeric),
('POS_TAXA_CREDITO_12X', 0.192::numeric),
('POS_ABSORVER_TAXAS', 1::numeric);

CREATE OR REPLACE FUNCTION pg_temp.legacy_financial_rate(scope text, rate_key text) RETURNS numeric
LANGUAGE sql AS $$
 SELECT COALESCE(
   (SELECT "value"::numeric FROM "PlatformTaxaOverride" WHERE "tag" = scope AND "key" = rate_key),
   (SELECT "value"::numeric FROM "PlatformTaxaOverride" WHERE "tag" = 'GLOBAL' AND "key" = rate_key),
   (SELECT "value" FROM "_legacy_financial_defaults" WHERE "key" = rate_key), 0
 );
$$;

DO $$
DECLARE
 scope text; method text; channel text; n integer; k text;
 acquirer text; previous jsonb; generated jsonb; next_document jsonb;
 rate numeric; fixed numeric; dom_rate numeric; dom_fixed numeric;
 interest numeric; total_rate numeric; total_fixed numeric;
 latest_version integer; global_lanes jsonb;
BEGIN
 SELECT COALESCE("document"->'lanes', '{}'::jsonb) INTO global_lanes
 FROM "FinancialPolicyRevision" WHERE "tag" = 'GLOBAL' ORDER BY "version" DESC LIMIT 1;
 global_lanes := COALESCE(global_lanes, '{}'::jsonb);
 FOR scope IN
   SELECT 'GLOBAL'
   UNION SELECT "tag" FROM "Platform"
   UNION SELECT "tag" FROM "PlatformTaxaOverride" WHERE "tag" <> 'GLOBAL' AND "tag" IN (SELECT "tag" FROM "Platform")
 LOOP
   SELECT "version", "document" INTO latest_version, previous
   FROM "FinancialPolicyRevision" WHERE "tag" = scope ORDER BY "version" DESC LIMIT 1;
   latest_version := COALESCE(latest_version, 0);
   previous := COALESCE(previous, '{"schemaVersion":1,"lanes":{},"owner":{}}'::jsonb);
   generated := '{}'::jsonb;
   SELECT COALESCE(p."acquirer"::text, 'DOM') INTO acquirer FROM "Platform" p WHERE p."tag" = scope;
   acquirer := COALESCE(acquirer, 'DOM');
   -- Legacy rates are DOM-specific. Do not invent contracts for another processor.
   IF acquirer <> 'DOM' THEN CONTINUE; END IF;
   FOREACH method IN ARRAY ARRAY['PIX','DEBIT_CARD','BOLETO','CREDIT_CARD'] LOOP
     FOREACH channel IN ARRAY ARRAY['ONLINE','POS'] LOOP
       IF method = 'BOLETO' AND channel = 'POS' THEN CONTINUE; END IF;
       FOR n IN 1..(CASE WHEN method = 'CREDIT_CARD' THEN 12 ELSE 1 END) LOOP
         k := acquirer || '/' || method || '/' || channel || '/' || n;
         -- Keep platform inheritance unless that platform had legacy admin overrides.
         IF scope <> 'GLOBAL' AND NOT EXISTS (SELECT 1 FROM "PlatformTaxaOverride" WHERE "tag" = scope)
           THEN CONTINUE; END IF;
         -- A global financial lane is newer than legacy platform settings.
         IF scope <> 'GLOBAL' AND global_lanes ? k THEN CONTINUE; END IF;
         rate := 0; fixed := 0; dom_rate := 0; dom_fixed := 0; interest := 0;
         total_rate := NULL; total_fixed := NULL;
         IF channel = 'POS' THEN
           dom_rate := pg_temp.legacy_financial_rate(scope, CASE method
             WHEN 'PIX' THEN 'POS_MDR_PIX' WHEN 'DEBIT_CARD' THEN 'POS_MDR_DEBITO'
             ELSE 'POS_MDR_CC_' || n || 'X' END);
           dom_fixed := CASE WHEN method = 'PIX' THEN 0 ELSE pg_temp.legacy_financial_rate(scope, 'POS_TAXA_DOM_FIXA') END;
           total_rate := pg_temp.legacy_financial_rate(scope, CASE method
             WHEN 'PIX' THEN 'POS_TAXA_PIX_PERCENT' WHEN 'DEBIT_CARD' THEN 'POS_TAXA_DEBITO_PERCENT'
             ELSE 'POS_TAXA_CREDITO_' || n || 'X' END);
           total_fixed := 0;
           IF pg_temp.legacy_financial_rate(scope, 'POS_ABSORVER_TAXAS') = 0 THEN
             total_rate := total_rate + dom_rate; total_fixed := dom_fixed;
           END IF;
         ELSIF method = 'CREDIT_CARD' THEN
           rate := pg_temp.legacy_financial_rate(scope, 'LINK_COST_' || n || 'X');
           fixed := pg_temp.legacy_financial_rate(scope, 'TAXA_LINK_FIXA');
           dom_rate := (ARRAY[0,0.0451,0.0604,0.0759,0.0915,0.1072,0.1231,0.1392,0.1554,0.1717,0.1882,0.2048]::numeric[])[n];
           dom_fixed := CASE WHEN n > 1 THEN 1 ELSE 0 END;
           interest := CASE WHEN n = 1 THEN 0 ELSE pg_temp.legacy_financial_rate(scope, 'MDR_LINK_' || n || 'X') END;
         ELSIF method = 'DEBIT_CARD' THEN
           rate := pg_temp.legacy_financial_rate(scope, 'TAXA_DEBITO_PERCENT');
           fixed := pg_temp.legacy_financial_rate(scope, 'TAXA_DEBITO_FIXA');
           dom_rate := 0.0349; dom_fixed := 1;
         ELSIF method = 'BOLETO' THEN
           dom_fixed := pg_temp.legacy_financial_rate(scope, 'TAXA_BOLETO_DOM') + pg_temp.legacy_financial_rate(scope, 'TAXA_BOLETO_DOM_FIXA');
           total_rate := 0;
           total_fixed := pg_temp.legacy_financial_rate(scope, 'TAXA_BOLETO_FIXA') + pg_temp.legacy_financial_rate(scope, 'TAXA_BOLETO_TRANSACAO');
         ELSE
           dom_rate := pg_temp.legacy_financial_rate(scope, 'MDR_PIX');
           total_rate := 1 - pg_temp.legacy_financial_rate(scope, 'LIQUIDEZ');
           total_fixed := pg_temp.legacy_financial_rate(scope, 'TAXA_FIXA_TRANSACAO') + pg_temp.legacy_financial_rate(scope, 'TAXA_CASHBACK') + pg_temp.legacy_financial_rate(scope, 'TAXA_SERVICO');
         END IF;
         generated := generated || jsonb_build_object(k,
           jsonb_build_object('active', true,
             'contract', jsonb_build_object('fixedCents', round(dom_fixed*100), 'ratePpm', round(dom_rate*1000000), 'cashbackCents', 0, 'interestPpm', 0, 'base', 'ORIGINAL', 'reference', 'Migrado da tabela administrativa'),
             'sim', jsonb_build_object('fixedCents', round(fixed*100), 'ratePpm', round(rate*1000000), 'interestPpm', round(interest*1000000)))
           || CASE WHEN total_rate IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('total', jsonb_build_object('fixedCents', round(total_fixed*100), 'ratePpm', round(total_rate*1000000))) END);
       END LOOP;
     END LOOP;
   END LOOP;
   next_document := previous || jsonb_build_object('lanes', generated || COALESCE(previous->'lanes', '{}'::jsonb));
   IF next_document IS DISTINCT FROM previous THEN
     INSERT INTO "FinancialPolicyRevision" ("id","tag","version","document","actorId")
     VALUES ('legacy-rates-' || md5(scope || ':' || (latest_version+1)), scope, latest_version+1, next_document, 'LOCAL_MIGRATION');
   END IF;
 END LOOP;
END $$;

COMMIT;
