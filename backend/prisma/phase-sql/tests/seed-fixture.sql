-- Fixture para ensaiar phase5/phase6 e offer-parity-check.ts num Postgres DESCARTAVEL local.
-- Aplicar so sobre um banco criado por `prisma migrate deploy` e de nome `phase_*`.
--   createdb phase_fixture && DATABASE_URL=.../phase_fixture bunx prisma migrate deploy
--   psql .../phase_fixture -v ON_ERROR_STOP=1 -f prisma/phase-sql/tests/seed-fixture.sql
-- Variavel opcional: -v frozen=0 deixa os produtos legados ativos (cobre allow_active).
\set ON_ERROR_STOP on
\if :{?frozen}
\else
  \set frozen 1
\endif
SELECT current_database() LIKE 'phase\_%' AS ok \gset
\if :ok
\else
  \echo 'Recusado: o banco precisa se chamar phase_*'
  \quit 1
\endif
SELECT (:'frozen' = '0') AS active \gset

BEGIN;
INSERT INTO "User" (id, name, email, password, "updatedAt") VALUES
  ('u1', 'Vendedor', 'v@example.test', 'x', now()),
  ('u2', 'Coprodutor', 'c@example.test', 'x', now());

-- Produtos antigos (ids distintos entre si) ----------------------------------------------------
INSERT INTO "PaymentLink" (id, "userId", code, title, amount, "maxInstallments", "isActive", "domPaymentLinkId",
  "aceitaCartao", "aceitaPix", "aceitaDebito", "currentUses", "maxUses", plataformas, "updatedAt")
VALUES
  ('pl-1', 'u1', 'PL-ONE', 'Link um', 100.00, 3, :'active', 'dom-pl-1', true, true, false, 2, 10, ARRAY['PLAT_A'], now()),
  ('pl-2', 'u1', 'PL-TWO', 'Link dois', 49.90, 1, :'active', NULL, true, true, true, 0, NULL, ARRAY[]::text[], now());
INSERT INTO "SubscriptionLink" (id, "userId", code, name, amount, "frequencyType", "isActive", "domPlanId",
  "paymentMethods", "currentUses", "platformTag", "updatedAt")
VALUES ('sl-1', 'u1', 'SL-ONE', 'Assinatura anual', 600.00, 'ANUAL', :'active', 'dom-plan-sl-1', 'PIX', 1, 'PLAT_A', now());
INSERT INTO "Plan" (id, "userId", name, price, type, "isActive", "domPlanId", code, "paymentMethods", frequency, "updatedAt")
VALUES ('plan-1', 'u1', 'Plano mensal', 29.90, 'MONTHLY', :'active', 'dom-plan-p-1', 'PLAN-ONE', 'CREDIT_CARD', 2, now());
INSERT INTO "PixCreditPlan" (id, "userId", type, price, description, status, "tenantTag", "updatedAt")
VALUES ('pix-1', 'u1', 'MONTHLY', 19.9, 'Plano PIX', CASE WHEN :'active'::boolean THEN 'ACTIVE' ELSE 'INACTIVE' END, 'PLAT_B', now());
INSERT INTO "PixPlanLinkCode" (id, code, "pixCreditPlanId", "isActive", "updatedAt") VALUES ('pc-1', 'PX-ONE', 'pix-1', true, now());
INSERT INTO "Boleto" (id, "userId", code, title, amount, "vencimentoDias", "isActive", "domPaymentLinkId", "currentUses", "updatedAt")
VALUES ('bol-1', 'u1', 'BOL-ONE', 'Boleto um', 250.00, 5, :'active', 'dom-bol-1', 1, now());

-- Ofertas espelho: mesmo id, mesmos valores -----------------------------------------------------
INSERT INTO "Offer" (id, "ownerUserId", "createdByUserId", "platformTag", code, name, description, "amountCents", "isActive",
  "acceptedMethods", "maxInstallments", "maxUses", "usedCount", "renewalMode", "intervalType", "intervalCount", "updatedAt", metadata)
VALUES
  ('pl-1', 'u1', 'u1', 'PLAT_A', 'PL-ONE', 'Link um', NULL, 10000, :'active', '{CREDIT_CARD,PIX}', 3, 10, 2, 'NONE', NULL, NULL, now(), NULL),
  ('pl-2', 'u1', 'u1', NULL, 'PL-TWO', 'Link dois', NULL, 4990, :'active', '{CREDIT_CARD,DEBIT_CARD,PIX}', 1, NULL, 0, 'NONE', NULL, NULL, now(), NULL),
  ('sl-1', 'u1', 'u1', 'PLAT_A', 'SL-ONE', 'Assinatura anual', NULL, 60000, :'active', '{PIX}', 1, NULL, 1, 'AUTO_CHARGE', 'YEAR', 1, now(), NULL),
  ('plan-1', 'u1', 'u1', NULL, 'PLAN-ONE', 'Plano mensal', NULL, 2990, :'active', '{CREDIT_CARD}', 1, NULL, 0, 'AUTO_CHARGE', 'MONTH', 2, now(), NULL),
  ('pix-1', 'u1', 'u1', 'PLAT_B', 'PX-ONE', 'Plano PIX', 'Plano PIX', 1990, :'active', '{PIX}', 1, NULL, 0, 'MANUAL_PAY', 'MONTH', 1, now(), NULL),
  ('bol-1', 'u1', 'u1', NULL, 'BOL-ONE', 'Boleto um', NULL, 25000, :'active', '{BOLETO}', 1, NULL, 1, 'NONE', NULL, NULL, now(),
    '{"boletoDueDays": 5, "requiresBuyerAddress": true}');
INSERT INTO "ExternalRef" (id, "acquirerCode", kind, "externalId", "entityType", "entityId") VALUES
  ('er-1', 'DOM', 'PAYMENT_LINK', 'dom-pl-1', 'Offer', 'pl-1'),
  ('er-2', 'DOM', 'PLAN', 'dom-plan-sl-1', 'Offer', 'sl-1'),
  ('er-3', 'DOM', 'PLAN', 'dom-plan-p-1', 'Offer', 'plan-1'),
  ('er-4', 'DOM', 'PAYMENT_LINK', 'dom-bol-1', 'Offer', 'bol-1');

-- Vendas -----------------------------------------------------------------------------------------
INSERT INTO "Transaction" (id, "userId", amount, "netAmount", status, "paymentMethod", "paymentLinkId", "offerId", "updatedAt") VALUES
  ('t-1', 'u1', 100.00, 91.00, 'PENDING', 'PIX', 'pl-1', 'pl-1', now()),
  ('t-2', 'u1', 100.00, 91.00, 'PENDING', 'CREDIT_CARD', 'pl-1', 'pl-1', now()),
  ('t-3', 'u1', 250.00, 237.50, 'PENDING', 'BOLETO', NULL, 'bol-1', now()),
  ('t-4', 'u1', 600.00, 546.00, 'PENDING', 'PIX', NULL, 'sl-1', now()),
  ('t-5', 'u1', 15.00, 13.00, 'PENDING', 'PIX', NULL, NULL, now());
UPDATE "Transaction" SET status = 'COMPLETED' WHERE id IN ('t-1', 't-3');

-- Assinatura de PIX anual: pedido legado + contrato/cobranca de oferta -------------------------------
INSERT INTO "SubscriptionLinkOrder" (id, "subscriptionLinkId", "userId", "customerName", "customerEmail", "customerDocument",
  "paymentMethod", status, "amountCharged", "updatedAt")
VALUES ('slo-1', 'sl-1', 'u1', 'Cliente', 'cli@example.test', '000', 'PIX', 'paid', 600.00, now());

-- Coproducao ja renomeada para "ofertas" ---------------------------------------------------------
INSERT INTO "CoproductionAgreement" (product, "productId", version, participants, "actorId", mode)
VALUES ('ofertas', 'pl-1', 1, '[{"userId":"u2","percent":10}]', 'u1', 'OWN');
INSERT INTO "CoproductionRevision" (product, "productId", version, participants, "actorId", mode)
VALUES ('ofertas', 'pl-1', 1, '[{"userId":"u2","percent":10}]', 'u1', 'OWN');
COMMIT;
