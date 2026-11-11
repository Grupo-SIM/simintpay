# Runbook: migração dos produtos legados para `Offer`

> Para executar a migração, siga primeiro o guia passo a passo [migracao-para-ofertas.md](migracao-para-ofertas.md). Este runbook traz o detalhe técnico dos scripts.

Escopo: criar as `Offer` "sombra" a partir de `PaymentLink`, `SubscriptionLink`, `Plan`, `PixCreditPlan` e `Boleto` (plano [0021](../../plans/0021-oferta-unica-recorrencia-propria.md), fase 4). A migração é **aditiva**: nenhuma linha legada é alterada ou apagada, e o legado continua sendo a fonte viva. Nada lê `Offer` ainda, então a migração não muda nenhum comportamento em produção.

Script: `backend/scripts/offer-migration-apply.ts`. Mapeamento: `backend/src/modules/offer/legacy-offer-mapper.ts`. Relatório prévio (somente leitura): `backend/scripts/offer-migration-report.ts`.

## O que o script faz

- Cria uma `Offer` por produto legado, preservando o código público (`PixCreditPlan`: `PixPlanLinkCode` ativo mais antigo) reutilizando o ID legado como `Offer.id`; `legacyType`/`legacyId` não são mais gravados. Linhas cujo ID já existe em `Offer` são puladas (idempotente). Offers migradas antes com ID aleatório não são reconhecidas: o código delas aparece como `DUPLICATE_CODE` e o `--verify` as acusa.
- Para produtos com `domPaymentLinkId` (link de pagamento, boleto) ou `domPlanId` (link de assinatura, plano) grava um `ExternalRef` (adquirente `DOM`, tipo `PAYMENT_LINK` ou `PLAN`, `entityType` `Offer`). Requer `AcquirerCatalogue` com código `DOM`; sem ele a transação daquele tipo é abortada sem escrever nada. Se a `Offer` já existe e falta só o `ExternalRef`, ele é criado.
- **Recusa** (não cria, lista no plano): `INVALID_AMOUNT`, `MISSING_CODE`, `MISSING_OWNER` (inclusive dono inexistente) `DUPLICATE_CODE` (código igual em outra `Offer` ou compartilhado por várias linhas legadas; o script não escolhe vencedor) `COPRODUCTION_CONFLICT` (acordo diferente já em `ofertas`) e `ID_COLLISION` (o mesmo ID aparece em mais de uma das cinco tabelas legadas, ou já existe uma `Offer` com esse ID e outro código).
- Acordos de coprodução: na mesma transação que cria a `Offer`, `CoproductionAgreement` e `CoproductionRevision` do produto legado (`links-pagamento`, `links-assinatura`, `boletos`, `planos`, `planos-pix`) são renomeados para `ofertas`, mesmo `productId` (com lock advisory, idempotente). Se já existir acordo (ou revisão) diferente em `ofertas` para o id, o produto é `REFUSED` com `COPRODUCTION_CONFLICT` e nada é sobrescrito; conteúdo idêntico só descarta a cópia legada. `--verify` reporta acordo que sobrou na chave antiga. O rollback por id (seção Rollback) não desfaz a renomeação: para voltar, renomeie as linhas de volta ao produto legado.
- **BLOCKED**: produtos cujo dono é `ADMIN` (plano [0009](../../plans/0009-titularidade-ofertas-cobrancas.md)). Nunca reatribui donos; a transferência é feita antes, por `scripts/reassign-products.ts`, com mapa aprovado.
- **Carrega a entrega**: `redirectUrl` e `emailBody` (só os preenchidos; o `webhookUrl` legado não é migrado, a oferta não tem webhook próprio) de link de pagamento, link de assinatura, plano e plano PIX viram `Offer.fulfillment`, validados por `parseOfferFulfillment` (inclui as checagens de SSRF). Boleto também grava `metadata = { boletoDueDays: vencimentoDias (0-90, 0 = sem vencimento), requiresBuyerAddress: true }`; o checkout de oferta cobra boleto (vencimento = `boletoDueDays`, endereço completo obrigatório). Valor que não passa na validação **recusa** o produto (`INVALID_FULFILLMENT: <campo>: <motivo>`, ou `INVALID_BOLETO_DUE_DAYS`); nada é descartado em silêncio.
- **BLOCKED (pré-checagem "perderia dados")**, no relatório e no apply (mesma função): produto que carrega algo que a `Offer` ainda não representa nunca é migrado. Ver a tabela de códigos abaixo.
- **Avisos** (não bloqueiam): valor abaixo de R$ 14,99 (reflete o legado fielmente) e códigos extras de `PixCreditPlan`.

### Códigos de bloqueio (`BLOCKED`)

| Código                          | Quando                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLOCKED_HAS_FUNNEL_OFFERS`     | `PaymentLink` com `PaymentLinkOffer` (order bump, upsell, downsell) não removido                                                                                                                                            |
| `BLOCKED_HAS_FILES`             | `PaymentLink` com `PaymentLinkFile`                                                                                                                                                                                         |
| `BLOCKED_HAS_VOUCHERS`          | `Voucher` ligado ao produto: `allowedLinkCodes` contém o código (ou id) do produto ou um código `PX-` do plano PIX, ou `applicablePlans` contém o id                                                                        |
| `BLOCKED_HAS_COMMUNITY`         | `CommunityLinkBinding` do link de pagamento ou de assinatura                                                                                                                                                                |
| `BLOCKED_HAS_PIX_ACCESS`        | `PixCreditPlan` com `PixPlanOrder` ou `CustomerPlanAccess` (a oferta ainda não concede nem desconta dias de acesso)                                                                                                         |
| `BLOCKED_LIVE_DOM_SUBSCRIPTION` | `SubscriptionLink`/`Plan` com `SubscriptionLinkOrder`/`Subscription` com `domSubscriptionId` e status ainda ativo (fora de cancelled, canceled, inactive, expired, failed, deactivated, disabled). Só a contagem é impressa |

Produto `BLOCKED` aparece como `BLOCKED` no dry-run/apply e como "BLOCKED (data loss)" no relatório. Se já existir `Offer` de um produto que passou a ser `BLOCKED`, o `--verify` aponta a `Offer` sem linha elegível. Vendas históricas (`PaymentLinkOfferSale`, `Transaction.paymentLinkId`) não são tocadas nem bloqueiam.

**Nota não bloqueante `FEE_OVERRIDE_NOT_CARRIED`**: `PaymentLink` (`platformFee1x..12x`, `cashbackFee`, `debitFeePercent`, `debitFeeFixed`, `isStandalone`) ou `SubscriptionLink` (`platformFee`, `isStandalone`) com algum valor diferente do padrão da plataforma. A `Offer` ignora essas taxas por link e usa a cotação da política financeira.

### Flags

| Flag                                 | Script                 | Efeito                                                                                                   |
| ------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `--database-url=...`                 | ambos                  | Obrigatória (o relatório aceita também `OFFER_REPORT_DATABASE_URL`)                                      |
| `--apply --i-understand-this-writes` | apply                  | Escreve                                                                                                  |
| `--verify`                           | apply                  | Compara contagens, valor, código, dono, `ExternalRef`, `fulfillment` e `metadata`; sai com 1 se divergir |
| `--allow-blocked`                    | relatório e `--verify` | Sem a flag, qualquer produto `BLOCKED` faz o relatório e o `--verify` saírem com código 1                |
| `--json`                             | relatório              | Saída em JSON                                                                                            |

## Segurança

- Exige `--database-url=...` explícito; nunca lê `.env` nem `DATABASE_URL`. Imprime `host:porta/banco` antes de qualquer consulta.
- Padrão é **dry-run** (transação somente leitura que imprime o plano). Escrever exige `--apply` **e** `--i-understand-this-writes`.
- Uma transação por tipo legado; falha em um tipo desfaz só aquele tipo.

## Passos

1. **Antes de tudo, o dono confere** (ver abaixo) e aplica no banco alvo as migrations `20261105120000_external_ref`, `20261105130000_offer_charge_core` (e dependências). Essas migrations ainda não foram aplicadas; isso exige autorização separada.
2. Ensaie em cópia local descartável (Postgres em Docker, `127.0.0.1`, porta própria), `bunx prisma migrate deploy` (não `db push`, para existirem os triggers reais) e a suíte `OFFER_MIGRATION_TEST_DATABASE_URL=postgresql://...127.0.0.1... bun test tests/offer-migration.integration.test.ts`.
3. Relatório de conflitos: `bun --no-env-file scripts/offer-migration-report.ts --database-url=...`.
4. Dry-run: `bun --no-env-file scripts/offer-migration-apply.ts --database-url=...`. Revise cada `REFUSED`/`BLOCKED` (códigos acima); o relatório sai com código 1 enquanto houver `BLOCKED`.
5. Aplicar: `... --apply --i-understand-this-writes`.
6. Verificar: `... --verify`. Compara contagens, valor em centavos, código, dono e `ExternalRef` entre legado e `Offer`; sai com código 1 em qualquer divergência (ou `Offer` órfã).
7. Repetir o passo 5 é seguro (idempotente), por exemplo depois de corrigir um item recusado.

## Rollback

Nada referencia `Offer` ainda (`BillingContract.offerId` e `Charge.offerId` estão vazios), então basta apagar as sombras; as linhas legadas não são tocadas:

```sql
BEGIN;
DELETE FROM "ExternalRef" WHERE "entityType" = 'Offer';
DELETE FROM "Offer" WHERE "id" IN (
  SELECT "id" FROM "PaymentLink" UNION SELECT "id" FROM "SubscriptionLink" UNION SELECT "id" FROM "Plan"
  UNION SELECT "id" FROM "PixCreditPlan" UNION SELECT "id" FROM "Boleto"
);
COMMIT;
```

Para desfazer só um tipo, filtre pelos IDs da tabela legada correspondente (e apague os `ExternalRef` cujo `entityId` pertence a ele antes). Se já existirem `BillingContract`/`Charge` apontando para `Offer`, **não** use este rollback: a `Offer` é protegida por chave estrangeira e o apagamento falhará.

## O que o dono deve checar antes de rodar em banco real

- Banco alvo correto (o script imprime `host:porta/banco`; confirme que não é o de outro ambiente) e backup recente.
- Migrations de `Offer`/`ExternalRef` aplicadas e `AcquirerCatalogue` `DOM` presente.
- Produtos `BLOCKED` de dono `ADMIN`: decidir destino e rodar a reatribuição (0009) antes; o script não move donos.
- Itens `REFUSED`: corrigir o código (códigos duplicados entre tabelas, `Plan` sem código, `PixCreditPlan` sem `PixPlanLinkCode` ativo) ou aceitar que ficam de fora.
- Valores abaixo do mínimo (R$ 14,99) e códigos extras de plano PIX: confirmar que são intencionais.
- Que a migração é só sombra: nenhum fluxo de pagamento passa a usar `Offer` até o corte de fase posterior.

## Depois de migrar: trocar as URLs e desativar o link legado

A migração cria a `Offer` e preserva o código público, mas **não** redireciona nada:

| Produto            | URL legada                       | URL da oferta      |
| ------------------ | -------------------------------- | ------------------ |
| Link de pagamento  | `?simLinkCode=<id>`              | `?oferta=<código>` |
| Link de assinatura | `?subscriptionLinkCode=<código>` | `?oferta=<código>` |
| Boleto             | `?simBoletoCode=<id>`            | `?oferta=<código>` |
| Plano              | `?simPlanCode=<código>`          | `?oferta=<código>` |

1. Troque a URL divulgada (site, e-mail, campanhas) pela da oferta.
2. Desative o link legado (`isActive = false`) quando a URL nova estiver no ar. Enquanto o link antigo estiver ativo, **um cartão pago nele continua criando uma assinatura na DOM**, e essa assinatura cobra por fora do agendador novo. Compradores que já pagaram nele seguem o playbook [subscription-migration-playbook.md](subscription-migration-playbook.md).
3. Links com cartão recorrente só devem ser trocados depois de a sandbox da DOM validar o token com `customer_id` (ver o plano 0021).
