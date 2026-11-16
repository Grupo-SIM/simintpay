# Migração completa para Ofertas: apagar as tabelas antigas

Plano proposto em 2026-11-06. **Nada foi executado. Nenhuma autorização de escrita em banco real.** Continua o [plano 0021](0021-oferta-unica-recorrencia-propria.md) (modelo `Offer`, `Charge`, `BillingContract`) e substitui a ideia de "ofertas-sombra com UUID novo" por uma migração definitiva.

## 1. Objetivo e decisões do dono

- `Offer` passa a ser a **única** tabela de produto. Planos, Planos PIX, Links de pagamento, Links de assinatura e Boletos deixam de existir como tabelas, código e rotas.
- **O `id` antigo vira o `id` da `Offer`** (os `id`s são UUIDs, e a base atual não tem colisão entre eles). Tudo que hoje aponta para o id antigo continua apontando, sem reescrever referências.
- Boleto é um meio de pagamento normal da oferta, sem caso especial (em andamento).
- A coluna `Offer.kind` e o enum `OfferKind` saem (em andamento). `legacyType` e `legacyId` também saem no fim, porque deixam de ter função quando o id é o mesmo.
- **Decisões do dono (2026-11-06):**
  - **Portar:** arquivos, cupons, funil (order bump, upsell, downsell), crédito de dias do plano PIX e pausa de assinatura.
  - **Descontinuar:** comunidade e provisionamento CONTROLE-*/BETAI. Somem com as tabelas e o código.
  - **Taxa individual por link:** aceitar a política financeira (o link com taxa própria passa a pagar a taxa da plataforma). Sem campo novo.
  - **Rotas REST legadas** (`/links-pagamento`, `/links-assinatura`): manter adaptadores por um tempo, para o `saas-netflix-back` (AreaFlix) continuar criando links.
- O dono executa a migração de dados. Este plano define a ordem, as condições de cada fase e o que precisa estar pronto antes.

## 2. Estado verificado (consulta agregada de leitura, 2026-11-06)

| Item                                                                                                                                                   | Valor                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Migrations de ofertas no banco real                                                                                                                    | **já aplicadas** (até `20261109100000_drop_user_dom_token`)                                                           |
| `Offer`, `Charge`, `BillingContract`                                                                                                                   | **0 linhas**                                                                                                          |
| `PaymentLink`                                                                                                                                          | 16, todos ativos; 15 nas taxas padrão e **1 com taxa própria** (1,52% a 1x, 15,56% a 12x, `isStandalone` falso)       |
| `SubscriptionLink`                                                                                                                                     | 13 (10 `isStandalone`, 3 ligados a plataforma); `SubscriptionLinkOrder` 5 (PIX, anuais, pagas, sem assinatura na DOM) |
| `Boleto`                                                                                                                                               | 1 (já pago)                                                                                                           |
| `Plan`, `PixCreditPlan`, `Subscription`                                                                                                                | 0                                                                                                                     |
| `Voucher`, `Community*`, `PaymentLinkOffer`, `PaymentLinkFile`, `PixPlanLinkCode`, `CustomerPlanAccess`, `SubscriptionPause`, `ProductOwnershipChange` | **0 linhas**                                                                                                          |
| `PaymentLinkOfferSale`                                                                                                                                 | 3 (histórico)                                                                                                         |
| `Transaction` com `paymentLinkId`                                                                                                                      | 5                                                                                                                     |
| Acordos de coprodução                                                                                                                                  | 3 (1 em link de pagamento, 2 em plataformas)                                                                          |
| Colisão de `id` entre os cinco produtos                                                                                                                | nenhuma                                                                                                               |
| Colisão de `code`                                                                                                                                      | nenhuma                                                                                                               |
| Plataformas por produto                                                                                                                                | no máximo 1 (nenhum link multi-plataforma)                                                                            |
| `code` igual ao `id`                                                                                                                                   | **nunca** (relevante, ver 4)                                                                                          |

Consequência: o volume é mínimo, então o risco está no **código, nos joins silenciosos e nos sistemas vizinhos**, não nos dados.

## 3. Princípios

1. **Expandir, migrar, contrair.** Nunca criar e apagar na mesma entrega.
2. **Sem dual-write financeiro.** Em cada fase só um caminho grava dinheiro. Leituras podem ser duplas.
3. **Congelar os escritores legados** antes da cópia final, e copiar o delta depois do congelamento.
4. **Renomear antes de apagar:** `PaymentLink` vira `PaymentLink_legacy` e fica sem leitor por semanas. Só depois `DROP`.
5. **Paridade medida, não presumida:** contagens e somas antes e depois (seção 10).
6. Backup completo e ponto de restauração antes de cada fase que contrai.

## 4. Defeito a corrigir primeiro: a URL antiga não acha a oferta

O checkout reescreve `?simLinkCode=<valor>` para `?ofertaCode=<valor>` (commit `8c7ef2c`), mas a busca pública procura só por `Offer.code`. O link de pagamento antigo carrega o **id**, e o `code` dele é outro UUID. Hoje nenhum `code` é igual ao `id`, então esses links dão 404.

Correção (Fase 0): `GET /ofertas/public/:code` resolve por `code` e, se não achar, por `id`. O que cada parâmetro antigo carrega:

| Parâmetro antigo         | Carrega                 | Resolve por             |
| ------------------------ | ----------------------- | ----------------------- |
| `simLinkCode`            | `PaymentLink.id`        | id                      |
| `subscriptionLinkCode`   | `SubscriptionLink.code` | code                    |
| `simBoletoCode`          | `Boleto.id`             | id                      |
| `simPlanCode`            | `Plan.code`             | code                    |
| `?code=PX-…` (plano PIX) | `PixPlanLinkCode.code`  | alias de código (ver 6) |

O `ofertaCode` dos links novos continua sendo o `code`. A documentação `migracao-para-ofertas.md` afirma que não há redirecionamento automático e hoje contradiz o commit: corrigir junto.

## 5. Mapeamento de colunas (o que cada coluna antiga vira)

| Coluna antiga                                                                   | Destino                                                        | Observação                                                                  |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `id`, `code`, `userId`, `createdByUserId`                                       | `Offer.id`, `code`, `ownerUserId`, `createdByUserId`           | `createdByUserId` é obrigatório na oferta: preencher com o dono quando nulo |
| `titulo`/`nome`/`description`, `descricao`, `valor`/`preco`/`price`             | `name`, `description`, `amountCents`                           | valor exato em centavos                                                     |
| `aceitaCartao/Debito/Pix`, `paymentMethods`                                     | `acceptedMethods`                                              |                                                                             |
| `parcelasMax`                                                                   | `maxInstallments`                                              |                                                                             |
| `plataformas[]`, `platformTag`, `tenantTag`                                     | `platformTag`                                                  | nenhum caso multi-plataforma hoje; **recusar** se aparecer                  |
| `maxUses`, `currentUses`, `dataExpiracao`                                       | `maxUses`, `usedCount`, `expiresAt`                            |                                                                             |
| `frequencia`/`tipo`/`frequency_type`, `repeticoes`, `diasRetentativa`           | `intervalType`, `intervalCount`, `repetitions`, `retryDays`    | `Plan.frequency` multiplica o intervalo                                     |
| `webhookUrl`, `redirectUrl`, `emailBody`                                        | `fulfillment`                                                  | já migrados pelo mapeador                                                   |
| `vencimentoDias`                                                                | `metadata.boletoDueDays`                                       |                                                                             |
| `domPaymentLinkId`, `domPlanId`                                                 | `ExternalRef` (`PAYMENT_LINK`, `PLAN`)                         | preservar, senão o link na DOM perde o dono                                 |
| `domSubscriptionId`, `domPixPaymentId`                                          | `ExternalRef` ou `BillingContract.externalSubscriptionId`      | webhooks da DOM consultam por eles                                          |
| `platformFee1x..12x`, `cashbackFee`, `debitFee*`, `platformFee`, `isStandalone` | **sem destino**                                                | ver decisão 1                                                               |
| `PaymentLinkOffer` (bump, upsell, downsell)                                     | `Offer.fulfillment.bumps` (ofertas de verdade, com id próprio) | 0 linhas hoje                                                               |
| `PaymentLinkFile`, imagens                                                      | **sem destino**                                                | ver decisão 2                                                               |

## 6. O que a oferta precisa ganhar

Todas vazias em produção hoje. Decisão do dono: portar as cinco primeiras, descontinuar as duas últimas.

| Capacidade                                                                                                             | Decisão                                                         | Quem usa                        | Esforço                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| Arquivos de entrega e imagens de bump                                                                                  | **portar**                                                      | links de pagamento com PDF      | médio: upload e remoção, tabela própria ou `fulfillment.files` com tamanho          |
| Cupons (`Voucher`, validação no checkout e na plataforma PAGATG)                                                       | **portar**                                                      | checkout, `api-pagatg`          | médio: serviço consciente de oferta; desconto entra no cálculo de taxa e coprodução |
| Funil: order bump, upsell, downsell                                                                                    | **portar** (o backend já aceita `bumpCodes` e `parentChargeId`) | checkout                        | pequeno a médio: tela de pós-compra, seleção de bumps e imagens no checkout         |
| Crédito de dias do plano PIX (`CustomerPlanAccess`, códigos `PX-`, decremento, rotas de acesso, notificação ao PAGATG) | **portar**                                                      | `api-pagatg` (maior dependente) | **grande**: tabela de acesso, aliases de código, rotas de compatibilidade           |
| Pausa de assinatura                                                                                                    | **portar**                                                      | admin e vendedor                | pequeno: campos no contrato, retomar recalcula o período                            |
| Evento `subscription_activated`                                                                                        | **portar**                                                      | AreaFlix                        | pequeno: emitir também no fluxo de oferta                                           |
| Comunidade (`CommunityLinkBinding`)                                                                                    | **descontinuar**                                                | links de assinatura             | remover tabelas, cron, relatórios e telas                                           |
| Provisionamento CONTROLE-* e BETAI                                                                                     | **descontinuar**                                                | plataformas SaaS                | remover `platform-betai`, `platform-saas-access` e capacidades de assinatura        |
| Taxa individual por link                                                                                               | **política financeira**                                         | 1 link                          | nenhum                                                                              |
| Boleto na oferta                                                                                                       | em andamento                                                    | todos                           | em andamento                                                                        |
| Telas de assinantes e de cupons na área de ofertas                                                                     | portar                                                          | dashboard                       | médio                                                                               |

## 7. Fases

Cada fase termina em commits atômicos e deixa o sistema funcionando. As fases 3 a 5 gravam no banco real e exigem **sua autorização por fase**.

### Fase 0: pré-requisitos de código (sem banco real)

Primeira leva, **concluída e em `main`** (2026-11-07):

- [x] Remover `Offer.kind` e `OfferKind` (migration `20261111110000_drop_offer_kind`), com a tela: sem a coluna e o filtro "Tipo", atalhos só no cliente e etiqueta derivada na listagem.
- [x] Boleto como meio normal da oferta: cobrança no checkout público (vencimento de `metadata.boletoDueDays`, endereço obrigatório), taxa igual à do boleto legado provada por teste (R$ 100: líquido 95, taxa 5), tela com linha digitável e PDF, ferramentas de migração sem caso especial de boleto. Boleto em oferta recorrente é recusado.
- [x] Busca pública por `code` e, na falta, por `id`; a recusa `ID_COLLISION` quando o mesmo id aparece em duas tabelas; `offer-migration-apply` cria a oferta com o id antigo; auditoria e reatribuição de titularidade aceitam `Offer` (migration `20261112100000_product_ownership_change_offer_type`); guia corrigido para `?oferta=<código>`.
- [x] Crédito de dias do plano PIX: `OfferAccess`, `OfferAccessEvent` e `OfferCodeAlias`, crédito ao pagar, decremento diário, notificação ao PAGATG e rotas de compatibilidade atrás de `OFFER_PIXPLAN_COMPAT` (desligado por padrão).
- [x] Adaptadores REST legados (`/links-pagamento`, `/links-assinatura`) atrás de `OFFER_LEGACY_LINKS_COMPAT` (desligado por padrão) e evento `subscription_activated` pelo mecanismo de webhook da plataforma.

Pontos que a primeira leva deixou em aberto:

- [x] **Coprodução na migração:** `offer-migration-apply` renomeia acordos e revisões (`links-pagamento`, `links-assinatura`, `boletos`, `planos`, `planos-pix` para `ofertas`, mesmo `productId`) na mesma transação que cria a `Offer`; recusa com `COPRODUCTION_CONFLICT` se já existir acordo diferente em `ofertas`; `--verify` acusa acordo que sobrou na chave antiga. `coproductionKeyFor` não depende mais de `legacyType` (sempre `ofertas` + id da oferta).
- [x] Os adaptadores REST gravam a `coproduction` enviada na criação (`OfferService.create(actor, dto, { coproduction })`, na mesma transação da oferta). `DELETE` continua desativando em vez de apagar, por decisão.
- [x] O webhook da plataforma envia `x-simintpay-signature`, e o `saas-netflix-back` espera `x-simpay-token`. Resolvido no consumidor (verificado, sem mudança nesta repo): o `saas-netflix-back` já tem `POST /webhooks-simintpay` (HMAC-SHA256 do corpo bruto em `x-simintpay-signature`, segredo `SIMINTPAY_WEBHOOK_SECRET` = `WEBHOOK_SECRET` da plataforma). Os emissores legados de link continuam em `x-simpay-token` para `/webhooks-simpay`. Pendente do ops: apontar a URL do webhook da plataforma AREAFLIX para `/webhooks-simintpay` e configurar o segredo.
  - Reforço no emissor (esta leva): `PlatformSalesEventsService` envia também `x-simpay-token` (valor de `SIMPAY_WEBHOOK_TOKEN`, como o fluxo legado) em `purchase_approved`, `purchase_refunded` e `subscription_activated` (mesmo outbox da oferta), mantendo a assinatura em todos os eventos. O `saas-netflix-back` também tem `POST /webhooks-simintpay` que valida só a assinatura (`SIMINTPAY_WEBHOOK_SECRET`). Pendente do dono: definir `SIMPAY_WEBHOOK_TOKEN` no ambiente e apontar a URL da plataforma para `/webhooks-simpay` (ou usar `/webhooks-simintpay`).
- [x] Testes de integração de renovação/reativação, ledger do ciclo, preço do ciclo, `stored-card-vault` e `charge-reconciler` passam em Postgres descartável local (não estavam quebrados). Os 21 testes de equivalência de rota de `platform-core/tests` e outros 12 testes unitários estavam obsoletos e foram atualizados. `offer-checkout-boleto`, `payment-link-charge-characterization`, `offer-migration`, `offer-subscribe` e `ebook-settlement` foram corrigidos e passam em Postgres descartável (todas as causas eram fixtures obsoletas, sem bug de código; `offer-migration` falhava só pela ordenação por collation do banco). Ainda falham em Postgres descartável (fixtures anteriores à política financeira nova ou ao trigger do ledger): `wallet-attribution`, `wallet-ledger-trigger` (2), `wallet-ledger` (2), `coproduction`, `financial-policy`, `acquirer-fees.service` (1).

Segunda leva (mexem em arquivos da primeira, começam agora):

- [x] Arquivos de entrega e imagens de bump.
  - Armazenados em `Offer.fulfillment.files` (`id`, `fileName`, `fileSize`, `fileUrl`; máximo de 10 PDFs de 25 MB) e `Offer.fulfillment.imageUrl` (imagem de até 5 MB), sem tabela nova nem migration; mesmo storage do link de pagamento (`offer-files/` e `offer-images/`).
  - Rotas do titular: `GET/POST /ofertas/:id/arquivos`, `DELETE /ofertas/:id/arquivos/:fileId`, `POST/DELETE /ofertas/:id/imagem`; imagem pública em `GET /ofertas/public/:code/imagem`. A edição da oferta mantém arquivos e imagem (só as rotas de upload os alteram).
  - Entrega ao pagar já usava `fulfillment.files` (`OfferFulfillmentService`); `PublicBump.imageUrl` chega ao checkout.
  - Pendente: a migração dos dados antigos (`PaymentLinkFile`/`PaymentLinkOfferFile` e `PaymentLinkOffer.imageUrl`) para `fulfillment` é da Fase 2 (hoje 0 linhas).
- [x] Cupons: `POST /ofertas/public/:code/validate-voucher`, desconto antes das taxas na cobrança avulsa e no primeiro ciclo da assinatura, uso registrado ao pagar (idempotente por transação), campo de cupom no checkout, CRUD e capacidade PAGATG com ofertas.
- [x] Funil no checkout: seleção de bumps, tela de pós-compra de upsell e downsell (`OfferFunnelScreen`, cobrança filha com `parentChargeId` no mesmo cartão ou PIX; recusar o upsell oferece o downsell). A imagem do bump aparece na tela de upsell/downsell (`imageUrl` do bump público).
- [x] Pausa e retomada de assinatura, e lista de assinantes de ofertas para o vendedor.
  - `BillingContract` ganha o status `PAUSED`, `pausedAt` e `pausedRemainingDays` (migration `20261119090000_billing_contract_pause`, só arquivo, não aplicada). Pausar (só contrato `ACTIVE`, sem cobrança em aberto) guarda os dias restantes e zera `nextChargeAt`; o cron de ciclo e o lembrete só olham `ACTIVE`/`PAST_DUE`, então não cobram contrato pausado; o link de renovação recusa contrato pausado. Retomar conta os dias guardados a partir de agora e devolve o contrato ao ciclo.
  - Rotas `GET /ofertas/assinantes` (filtros: status, frequência, plataforma, busca, oferta, datas) e `PUT /ofertas/assinantes/:id/pause|resume`, do titular da oferta ou admin. Tela `/ofertas/assinantes`, ligada por botão na listagem de ofertas. O frontend não tem i18n (textos em português no código).
  - [x] Pausar/retomar notifica o `api-pagatg` (`SIGNATURE-PAUSED`/`SIGNATURE-RESUMED` em `/webhook/signature`, via `PagatgNotifier.notifySignature`; falha não desfaz a mudança).
  - Pendente: migrar as pausas de `SubscriptionPause` existentes (hoje só DOM, sem contrato de oferta).
- [x] Remover comunidade e provisionamento (código, cron, relatórios, telas) e as tabelas.
  - Código removido: `CommunityManagementService`, `CommunityAccessCron`, rotas `/admin/comunidades*` e `backfill-comunidade`, `PlatformReportingService` (só servia comunidade), `PlatformAccessService`, provisionamento CONTROLE-MOTORISTA/PATRIMONIAL/BETAI nos webhooks da DOM, `PlatformBetai*`, `PlatformSaasAccessService`, `InternalBetaiModule`, capacidades `saas/*` de assinatura, telas `comunidades`, `betai-dashboard`, `BetaiReportPanel` e `api/betai`.
  - Migration `20261116110000_drop_community_and_saas_provisioning` (testada só em Postgres descartável): remove `Community`, `CommunityLinkBinding`, `CommunityAccess`, `CommunitySubscriptionEvent`, `PlatformSubscriberAccess`, os enums `CommunitySource`, `CommunityLinkType`, `CommunityStatus`, `CommunityEventType` e as FKs dessas tabelas.
  - Pendente do dono: aplicar a migration no banco real (hoje 0 linhas em `Community*`; `PlatformSubscriberAccess` não foi contada).
- [ ] Corrigir os pontos em aberto acima.

### Fase 1: expandir o schema (migration aditiva)

- [x] `Transaction.offerId` (nulo, indexado, FK para `Offer`), preenchido por `UPDATE ... SET "offerId" = "paymentLinkId"`. As vendas de assinatura já se ligam pela `Charge` criada na migração de contratos. Migration `20261118110000_transaction_offer_id` (só arquivo, **não aplicada em banco real**): o backfill só preenche links cujo `Offer` já existe (a FK recusaria o resto) e pelas `Charge`; é idempotente, então rode de novo depois do `offer-migration-apply`. Testada só em Postgres descartável local (`backend/tests/transaction-offer-id.integration.test.ts`). Nenhum escritor grava `offerId` ainda.
- [x] ~~`CommunityLinkBinding.offerId`~~: não se aplica, a comunidade foi descontinuada e a tabela removida.
- [ ] Qualquer coluna nova de `Offer` decidida na Fase 0.
- [ ] Ensaio: restaurar um backup em Postgres descartável, `migrate deploy`, rodar a fase inteira e a paridade da seção 10.

### Fase 2: copiar os produtos para `Offer` com o id antigo

- [ ] Relatório e `--verify` sem bloqueios (os `BLOCKED_*` de dados que não migram viram erro de parada).
- [ ] Criar as ofertas (dry-run, aplicar, verificar) e os `ExternalRef` da DOM.
- [ ] Migrar os 5 contratos de assinatura (script já existente).
- [x] Reescrever `CoproductionAgreement` e `CoproductionRevision` (`product = 'ofertas'`, mesmo `productId`), na mesma transação (feito no `offer-migration-apply`). Os snapshots já gravados em transações mantêm o valor antigo de `product`; os leitores de snapshot não dependem do acordo.

### Fase 3: reescrever os leitores (classe B), atrás de um flag

Todos continuam lendo as tabelas antigas até a paridade fechar. Principais grupos:

- [x] **Webhooks da DOM (código pronto, flag desligado por padrão):** `OFFER_WEBHOOK_RESOLUTION=true` liga a resolução por `ExternalRef` (`PAYMENT_LINK`/`SUBSCRIPTION`, adquirente `DOM`) e por `Offer.id` (`modules/billing-core/webhook-offer-resolution.ts`), usada em `subscription-webhook.service`, `process-dom-webhook` (link sem linha legada) e `link-settlement` (`sameLinkOwner` aceita `offerId`). Webhook sem correspondência registra `[OFFER_WEBHOOK_UNRESOLVED] handler=... reference=...` (nível error, com contador por handler) em `process-dom-webhook`, `process-webhook` e `subscription-webhook.service`, com o flag ligado ou não. Sem gravação financeira nova; leitura nas tabelas antigas continua o padrão. Pendente: reproduzir corpos de webhook guardados contra o flag ligado (seção 10). Alvo original: `process-dom-webhook`, `process-webhook`, `subscription-webhook.service`, `link-settlement`. Trocar a consulta por `domPaymentLinkId`/`domSubscriptionId` por `ExternalRef`; o webhook que não resolve nada hoje é aceito e perdido, então acrescentar métrica e alerta.
- **Relatórios:** `owned-report-source` (faz `LEFT JOIN "PaymentLink"` e perde a venda em silêncio), `platform-reporting`, `platform-seller-reports`, `platform-overview-reports`, `dashboard-summary`, `list-dom-transactions-direct` (manter os parsers de `cod_external` históricos).
  - [x] **Relatórios (código):** flag `OFFERS_READ_ENABLED` (`1`/`true`; padrão desligado, leitura antiga) em `backend/src/shared/utils/offer-read-flag.ts`. Com o flag, `owned-report-source` junta `Offer` por `coalesce(Transaction.offerId, paymentLinkId)` e por `SubscriptionLinkOrder.subscriptionLinkId` (mesmo id), `platform-seller-reports` e `list-dom-transactions-direct` resolvem a tag por `Offer` (parsers de `cod_external` mantidos). `platform-reporting` não existe mais; `platform-overview-reports` e `dashboard-summary` não leem tabelas de produto, nada a mudar. Paridade coberta por testes (`owned-report-source.test.ts`, `platform-seller-reports.offer-read.test.ts`, `offer-report-parity.integration.test.ts`, este último em banco descartável local). Pendente: medir paridade na cópia restaurada (seção 10) antes de ligar o flag.
- **Plataformas:** `platform-core/*` (claim de links, administração, BETAI, capacidades de assinatura, vouchers), `unified-platform/*`, `internal-areaflix-finance`.
- **Coprodução:** `productTables`, `coproduction.service`, `coproduction-view` (SQL com nome de tabela).
- **Admin:** `admin-clientes`, `admin.controller` (links, comunidades, vínculos).

#### Progresso da Fase 3: plataformas, coprodução e admin (2026-11-16)

Flag `OFFER_PLATFORM_READS=1` (`modules/offer/offer-read-flag.ts`), **desligado por padrão**: com ele ligado, esses leitores resolvem o mesmo id pela `Offer` (`Offer.id` = id antigo; link de pagamento = `renewalMode NONE`, link de assinatura = recorrente, plano PIX = `legacyType 'PixCreditPlan'`). Sem dual-write financeiro: o flag só troca de onde se lê e a transferência de titularidade (não financeira); quem grava dinheiro continua um só. Ligar só depois da Fase 2 (produtos copiados e acordos renomeados para `ofertas`). Testes de paridade com o flag desligado e ligado em cada item.

- [x] **Coprodução:** `canonicalProduct` leva as cinco chaves antigas para `ofertas`; `coproduction.service` (`get`, `save`, `authorize`, `captureCoproduction`) e `coproduction-view` (`effectiveAgreements`, `sharedProductIds`, `coproductionInfo`) passam a usar a tabela `"Offer"`, a coluna `ownerUserId`, o `platformTag` e a chave de acordo `ofertas`. A expressão SQL de tag saiu para `productTagSql`. Teste: o SQL de cada chave antiga com o flag ligado é igual ao de `ofertas`; desligado, continua com a tabela antiga.
- [x] **platform-core:** claim de links (`platform-link-claim`, `claimSelectors`: mesma seleção por id e plataforma, troca de dono em `Offer`), `platform-links.controller` (`GET links/:id` e o replay idempotente da criação leem `Offer`; criar, editar e anexar arquivos seguem nos use cases antigos até a Fase 4), `platform-subscription-capabilities.paymentStatus` (cobrança `PAID` da oferta no lugar do pedido pago), `platform-administration` (`plansCount` por `legacyType`), vouchers (`VoucherService.findResourceOwner`: dono por id, código ou alias `PX-` da oferta).
- [x] **unified-platform:** `platform-payments.service` valida o `linkId` contra a oferta (valor em centavos, plataforma, ativa, não recorrente). `internal-areaflix-finance` e `legacy-areaflix-finance` só repassam os ids ao claim, sem consulta própria.
- [x] **Admin:** `admin-clientes` (auditoria `planos`, `planos-pix`, `links-pagamento`, `links-assinatura` e o backfill de plataforma SIMINTPAY por `Offer`), `admin.controller` (`areaflix/orders` e clientes AreaFlix ativos a partir de cobranças `PAID` de ofertas recorrentes da plataforma AREAFLIX; filtro `paymentLink` de transações casa `paymentLinkId` ou `offerId`).
- Fora deste lote (outros agentes): webhooks (`process-dom-webhook`, `process-webhook`, `subscription-webhook.service`, `link-settlement`) e relatórios (`owned-report-source`, `platform-*-reports`, `dashboard-summary`, `list-dom-transactions-direct`).

**O que resta para a Fase 3 (levantamento de 2026-11-16, grep de SQL cru, `Prisma.raw` e delegates em `backend/src`, `backend/scripts` e `prisma/migrations`):**

SQL cru com nome de tabela antigo em `src` (só um arquivo):

- [ ] `application/services/owned-report-source.ts` (3 ocorrências): `LEFT JOIN "PaymentLink" l ON l.id = t."paymentLinkId"` (linha 47, perde venda em silêncio) e `JOIN "SubscriptionLink" sl ON sl.id = o."subscriptionLinkId"` (linhas 50 e 84). Com o teste `owned-platform-reports.sql.test.ts` (7 ocorrências). Grupo de relatórios.

`Prisma.raw` com nome de tabela:

- [x] `coproduction.service.ts` (2) e `coproduction-view.ts` (1): resolvem `"Offer"` com o flag. Ficam as entradas antigas de `productTables` até a Fase 6.
- [ ] `scripts/reassign-products.ts` (`Prisma.raw` da tabela por `productType`): aceita `Offer`, mas ainda lê as antigas; revisar na Fase 4, quando os escritores cortarem.

Scripts e SQL avulsos (ferramentas de migração e diagnóstico; devem continuar lendo as tabelas antigas até a Fase 5, depois ser removidos ou reapontados):

- [ ] `scripts/diagnose-checkout-platforms.sql` (`FROM "PaymentLink" l`), `scripts/audit-product-ownership.ts` (consultas em `"paymentLinkId"`, `"subscriptionLinkId"`, `"planId"`, `"pixCreditPlanId"`), `scripts/offer-contract-migration.ts` (digest de `"SubscriptionLinkOrder"`) e `scripts/sql/migrate-paid-subscription-orders.sql` (`o."subscriptionLinkId"`). Fixtures SQL de teste: `coproduction/tests/coproduction-push.sql` (`CREATE TABLE "Plan"`) e `sale-push/tests/approval-trigger.sql`.

Migrations (`backend/prisma/migrations`): 22 arquivos citam as tabelas antigas, todos DDL (criação, `ALTER`, FKs `REFERENCES`); **nenhuma função, trigger ou view lê as tabelas antigas** (única função que cita uma delas, `202610140001_sale_push`, só faz `ALTER TABLE "Plan"`). A Fase 5 precisa de uma migration nova para soltar as FKs e renomear; as antigas não se editam.

Leitores por delegate do Prisma ainda nas tabelas antigas (47 arquivos no levantamento, sem contar testes), fora os já tratados acima:

- Webhooks e liquidação (outro agente): `webhook/process-dom-webhook.use-case.ts`, `webhook/process-webhook.use-case.ts`, `subscription/subscription-webhook.service.ts`, `platform-core/link-settlement.ts`.
- Relatórios (outro agente): `admin/list-dom-transactions-direct.use-case.ts`, `report/dashboard-summary.use-case.ts`, `platform-core/platform-seller-reports.ts`, `platform-core/platform-overview-reports.ts`.
- Escritores e checkouts públicos (**Fase 4**, não migrar no flag): `payment-link/*` (charge, list, files, delivery, offers helper), `subscription-link/*` (checkout cartão e PIX, e-mail de acesso), `plan/*`, `pix-plan/pix-plan.service.ts`, `subscription/*` (cancelar, retomar, listar assinantes), `boleto/list-boletos`, `billing/billing.service.ts`, `cliente/delete-cliente`, `cliente/get-cliente-plan-access`, `infrastructure/cron/expiration-reminder.cron.ts`, os repositórios `prisma-{boleto,payment-link,pix-plan,plan,subscription-link,subscription}.repository.ts` e os controllers `payment-link`, `subscription-link`, `subscription`, `checkout`.
- Escritas de plataforma que seguem nos use cases antigos até a Fase 4: `platform-links.controller` (criar, editar, arquivos), `platform-subscription-capabilities.createPlan` e `PlatformFinanceService.mirrorPlan` (gravam `Plan`/`SubscriptionLink`), `platform-payments.service` (grava `Transaction.paymentLinkId`; passar a gravar `offerId` no corte) e `admin.controller` (`ensureCobrancaPaymentLinks` e a criação de `PaymentLink` de cobrança, com `simLinkCode`).
- `Transaction.paymentLinkId` ainda é a chave dos filtros e junções de leitura; o backfill para `offerId` é da migration `20261118110000_transaction_offer_id` (não aplicada em banco real).

### Fase 4: congelar, copiar o delta e cortar os escritores

- [ ] Congelar: desativar os links legados (`isActive = false`) e ligar um flag de manutenção nos checkouts, nos controllers de CRUD e nas rotas de plataforma. Os contadores de uso ficam obsoletos na cópia: copiar de novo no fim.
- [ ] Cópia do delta, `--verify` e paridade (seção 10).
- [ ] Cortar: checkouts públicos, webhooks e CRUD passam a gravar só em `Offer`. Manter os **adaptadores REST** que sistemas vizinhos chamam (seção 9) respondendo a partir de `Offer`.

### Fase 5: repontar chaves e renomear

- [ ] Soltar as FKs para as tabelas antigas e criar as novas `NOT VALID`, depois `VALIDATE`.
- [ ] `ALTER TABLE ... RENAME TO "..._legacy"`. Nenhum código lê as tabelas renomeadas.

### Fase 6: observar e apagar

- [ ] 2 a 4 semanas observando: webhooks sem correspondência, diferenças de relatório, erros 404 de URL antiga, chamadas dos sistemas vizinhos.
- [ ] `DROP`, na ordem folha-primeiro (seção 8), e remover o código classe C, os módulos e as rotas legadas.
- [ ] Remover `legacyType`, `legacyId`, `ExternalRef` de produto que ficar sem uso, `Transaction.paymentLinkId`, `PlanType` (se `PixPlanOrder` sair) e `CommunityLinkType`.

## 8. Ordem de DROP (folhas primeiro)

1. `PaymentLinkOfferFile`, `PaymentLinkFile`, `PaymentLinkOfferSale`, `PaymentLinkOffer`.
2. `VoucherUsage`, `Voucher` (ou manter e reapontar).
3. `PixPlanLinkCode`, `PixPlanOrder`, `CustomerPlanAccess`, `PixCreditPlan`.
4. `SubscriptionPause`, `SubscriptionHistoryExclusion`, `Subscription`, depois `Plan`.
5. `CommunitySubscriptionEvent`, `SubscriptionLinkOrder` (só depois de a comunidade apontar para `Offer`), depois `SubscriptionLink`.
6. `Transaction.paymentLinkId` e a FK, depois `PaymentLink` e `Boleto`.
7. Enums e constraints de produto.
8. Relações de `User` para as tabelas removidas.

Atenção: as FKs com `ON DELETE CASCADE` (`CommunityLinkBinding`, `PaymentLinkFile`, `PaymentLinkOffer`) apagam dados em cascata se o pai cair antes de reapontar. Não apagar o pai antes das filhas.

## 9. Contratos externos que não podem quebrar

| Contrato                                                                                | Regra                                                                                         |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Webhook `purchase_approved`/`purchase_refunded` (`x-simpay-token`), campo `linkId`      | continua o id antigo, porque a oferta tem o mesmo id; o `saas-netflix-back` casa por `linkId` |
| Webhook `subscription_activated`                                                        | hoje só o fluxo legado emite; precisa ser emitido pela oferta antes de cortar                 |
| `cod_external` e `[LINK_CHARGE:<uuid>]`                                                 | manter; os padrões históricos (`pix-link-…`, `sub-link-pix-…`) continuam sendo lidos          |
| URLs divulgadas (`simLinkCode`, `subscriptionLinkCode`, `simBoletoCode`, `simPlanCode`) | continuam via redirecionamento e busca por id ou code                                         |
| `/internal/billing/*` (teron)                                                           | não mexer                                                                                     |

Sistemas vizinhos (em `/home/hyoretsu/Projects/@jb`) que guardam ids ou chamam rotas legadas:

| Projeto                                                                     | Dependência                                                                                                           | Ação                                                                        |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `saas-netflix-back` (AreaFlix)                                              | `POST/GET /links-pagamento` e `/links-assinatura`, URLs `?simLinkCode=` e `?subscriptionLinkCode=`, `linkId` em banco | manter adaptadores REST ou migrar o cliente para `/ofertas`                 |
| `saas-netflix-admin`, `saas-controle-patrimonial-front`, `betai`, `simback` | UUIDs de `subscriptionLinkCode` no código ou `.env`                                                                   | continuam funcionando pelo redirecionamento; trocar quando puder            |
| `rastrewin`, `sim-produtos-digitais`                                        | `?simLinkCode=` e `POST /links-pagamento`                                                                             | idem                                                                        |
| `api-pagatg`                                                                | `/payments/pix-plan*`, `/payments/plan-access`, códigos `PX-`, validação de cupom                                     | **maior dependência**: só descontinuar o plano PIX se o PAGATG migrar antes |
| `teron`                                                                     | `/internal/billing/*`                                                                                                 | não afetado                                                                 |

Os ids guardados em banco desses projetos não aparecem numa busca por código: conferir `saas-netflix-back` (`linkId`) e `sim-produtos-digitais` (SQLite).

## 10. Paridade (antes e depois de cada fase que grava)

Em uma cópia restaurada de produção, nunca no banco real:

- Contagem por tabela antiga contra `Offer` por origem, e zero órfãos em cada chave repontada.
- Soma de `amount` e `netAmount` das `Transaction`, agrupada por status, meio e produto, igual antes e depois.
- Relatórios de plataforma e de vendedor comparados linha a linha.
- Soma de `CoproductionAllocation` por usuário e saldos de `Wallet`/`BalanceLog`, sem mudança.
- Zero `(product, productId)` de coprodução apontando para nada.
- Reprodução dos corpos de webhook da DOM guardados contra o schema novo.
- Teste de canário: um PIX do valor mínimo por `?ofertaCode=` e por cada forma antiga de URL.
- Baseline de testes: 12 testes de equivalência de rota em `platform-core/tests/` já falham em `main`; registrar antes e depois.

## 11. Riscos, em ordem

1. **Crítico:** URL antiga 404 (seção 4).
2. **Crítico:** SQL cru e `Prisma.raw` com nome de tabela (relatórios e coprodução) falham ou devolvem `NULL` sem erro. Buscar `"PaymentLink"`, `"SubscriptionLink"`, `"Boleto"`, `"Plan"`, `"PixCreditPlan"` em `src`, `scripts` e migrations.
3. **Crítico:** `ON DELETE CASCADE` apagando dado se o pai cair antes das filhas.
4. **Alto:** escrita nos checkouts legados durante a janela; contadores `usedCount` ficam obsoletos.
5. **Alto:** webhook da DOM sem correspondência é aceito e perdido.
6. **Alto:** capacidades a portar ou descontinuar (seção 6), principalmente o plano PIX do PAGATG.
7. **Alto:** fluxo de cartão recorrente nunca validado contra a DOM real.
8. **Médio:** chave primária `(product, productId)` da coprodução e a constraint de `product`.
9. **Médio:** `plataformas[]` perdendo valores (hoje não ocorre).
10. **Baixo:** `PaymentLinkOffer` (funil) e `Offer` parecem o mesmo conceito e não são: coluna `PaymentLinkOfferSale.offerId` aponta para o funil, nunca para `Offer`. Não repontar.

## 12. Decisões

Respondidas em 2026-11-06:

1. Taxa individual por link: aceitar a política financeira.
2. Funcionalidades: portar arquivos, cupons, funil, crédito de dias e pausa; descontinuar comunidade e provisionamento.
3. Rotas REST legadas: manter adaptadores por um tempo.

Ainda abertas:

4. **Por quanto tempo** manter os adaptadores REST, e quando migrar o `saas-netflix-back` para `/ofertas`.
5. **Janela de congelamento** e **tempo de retenção** das tabelas `*_legacy` antes do `DROP`.
6. **Quando aplicar** cada fase em produção (cada uma exige a sua autorização).

## 13. Esforço indicativo

| Fase | Porte           | Observação                                                           |
| ---- | --------------- | -------------------------------------------------------------------- |
| 0    | médio           | depende do que for "portar"                                          |
| 1    | pequeno         | migration aditiva                                                    |
| 2    | pequeno         | scripts já existem, ajuste do id                                     |
| 3    | **grande**      | cerca de 47 arquivos leem `paymentLink`; é a maior parte do trabalho |
| 4    | médio           | congelamento e delta                                                 |
| 5    | pequeno a médio | FKs e renomeação                                                     |
| 6    | pequeno         | remoção, mas só depois da observação                                 |

A fase 3 domina. Descontinuar as capacidades da seção 6 reduz a fase 0 e boa parte da 3.
