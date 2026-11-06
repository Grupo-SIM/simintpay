# Migração completa para Ofertas: apagar as tabelas antigas

Plano proposto em 2026-11-06. **Nada foi executado. Nenhuma autorização de escrita em banco real.** Continua o [plano 0021](0021-oferta-unica-recorrencia-propria.md) (modelo `Offer`, `Charge`, `BillingContract`) e substitui a ideia de "ofertas-sombra com UUID novo" por uma migração definitiva.

## 1. Objetivo e decisões do dono

- `Offer` passa a ser a **única** tabela de produto. Planos, Planos PIX, Links de pagamento, Links de assinatura e Boletos deixam de existir como tabelas, código e rotas.
- **O `id` antigo vira o `id` da `Offer`** (os `id`s são UUIDs, e a base atual não tem colisão entre eles). Tudo que hoje aponta para o id antigo continua apontando, sem reescrever referências.
- Boleto é um meio de pagamento normal da oferta, sem caso especial (em andamento).
- A coluna `Offer.kind` e o enum `OfferKind` saem (em andamento). `legacyType` e `legacyId` também saem no fim, porque deixam de ter função quando o id é o mesmo.
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

| Coluna antiga                                                                   | Destino                                                                   | Observação                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `id`, `code`, `userId`, `createdByUserId`                                       | `Offer.id`, `code`, `ownerUserId`, `createdByUserId`                      | `createdByUserId` é obrigatório na oferta: preencher com o dono quando nulo |
| `titulo`/`nome`/`description`, `descricao`, `valor`/`preco`/`price`             | `name`, `description`, `amountCents`                                      | valor exato em centavos                                                     |
| `aceitaCartao/Debito/Pix`, `paymentMethods`                                     | `acceptedMethods`                                                         |                                                                             |
| `parcelasMax`                                                                   | `maxInstallments`                                                         |                                                                             |
| `plataformas[]`, `platformTag`, `tenantTag`                                     | `platformTag`                                                             | nenhum caso multi-plataforma hoje; **recusar** se aparecer                  |
| `maxUses`, `currentUses`, `dataExpiracao`                                       | `maxUses`, `usedCount`, `expiresAt`                                       |                                                                             |
| `frequencia`/`tipo`/`frequency_type`, `repeticoes`, `diasRetentativa`           | `intervalType`, `intervalCount`, `repetitions`, `retryDays`, `accessDays` | `Plan.frequency` multiplica o intervalo                                     |
| `webhookUrl`, `redirectUrl`, `emailBody`                                        | `fulfillment`                                                             | já migrados pelo mapeador                                                   |
| `vencimentoDias`                                                                | `metadata.boletoDueDays`                                                  |                                                                             |
| `domPaymentLinkId`, `domPlanId`                                                 | `ExternalRef` (`PAYMENT_LINK`, `PLAN`)                                    | preservar, senão o link na DOM perde o dono                                 |
| `domSubscriptionId`, `domPixPaymentId`                                          | `ExternalRef` ou `BillingContract.externalSubscriptionId`                 | webhooks da DOM consultam por eles                                          |
| `platformFee1x..12x`, `cashbackFee`, `debitFee*`, `platformFee`, `isStandalone` | **sem destino**                                                           | ver decisão 1                                                               |
| `PaymentLinkOffer` (bump, upsell, downsell)                                     | `Offer.fulfillment.bumps` (ofertas de verdade, com id próprio)            | 0 linhas hoje                                                               |
| `PaymentLinkFile`, imagens                                                      | **sem destino**                                                           | ver decisão 2                                                               |

## 6. O que a oferta precisa ganhar (ou o que a gente descontinua)

Vazias hoje em produção, mas ainda usadas pelo código e por sistemas vizinhos. Para cada uma, o dono decide **portar** ou **descontinuar** (seção 12).

| Capacidade                                                                               | Quem usa                                     | Esforço para portar                                                            |
| ---------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| Cupons (`Voucher`, validação no checkout e na plataforma PAGATG)                         | `validate-voucher` no checkout, `api-pagatg` | médio: serviço consciente de oferta e desconto no cálculo de taxa e coprodução |
| Arquivos e imagens de bump                                                               | links de pagamento com PDF                   | médio: tabela ou `fulfillment.files` com upload                                |
| Comunidade (`CommunityLinkBinding`)                                                      | links de assinatura                          | médio: trocar duas FKs por `offerId` e ligar o consumidor                      |
| Plano PIX com crédito de dias (`CustomerPlanAccess`, `PX-`, decremento, rotas de acesso) | `api-pagatg` (maior dependente)              | **grande**: tabela de acesso, aliases de código, rotas de compatibilidade      |
| Provisionamento CONTROLE-* e BETAI                                                       | plataformas SaaS                             | médio: gancho de liquidação                                                    |
| Pausa de assinatura (`SubscriptionPause`)                                                | admin                                        | pequeno: campo no contrato                                                     |
| Evento `subscription_activated`                                                          | AreaFlix (`saas-netflix-back`)               | pequeno: emitir também no fluxo de oferta                                      |
| Taxa individual por link                                                                 | 1 link hoje                                  | decisão 1                                                                      |
| Boleto na oferta                                                                         | todos                                        | em andamento                                                                   |
| Tela de assinantes, comunidades e cupons na tela de ofertas                              | dashboard                                    | médio                                                                          |

## 7. Fases

Cada fase termina em commits atômicos e deixa o sistema funcionando. As fases 3 a 5 gravam no banco real e exigem **sua autorização por fase**.

### Fase 0: pré-requisitos de código (sem banco real)

- [x] Remover `Offer.kind` e `OfferKind` (agente em andamento; migration nova, pois a antiga já foi aplicada).
- [x] Boleto como meio normal da oferta (agente em andamento).
- [ ] Busca pública por `code` e, na falta, por `id` (seção 4), com teste.
- [ ] Ajustar o `offer-migration-apply` para criar a `Offer` **com o id antigo** (`id = legacyId`), preservando `code`; recusar o produto se o id já existir em `Offer`.
- [ ] Alargar as constraints que enumeram produtos: `ProductOwnershipChange_productType_check` não aceita `'Offer'`.
- [ ] Resolver as decisões 1 a 4 (seção 12) e construir o que for "portar".
- [ ] Corrigir a documentação do redirecionamento.

### Fase 1: expandir o schema (migration aditiva)

- [ ] `Transaction.offerId` (nulo, indexado, FK para `Offer`), preenchido por `UPDATE ... SET "offerId" = "paymentLinkId"`. As vendas de assinatura já se ligam pela `Charge` criada na migração de contratos.
- [ ] `CommunityLinkBinding.offerId` (se a comunidade for portada).
- [ ] Qualquer coluna nova de `Offer` decidida na Fase 0.
- [ ] Ensaio: restaurar um backup em Postgres descartável, `migrate deploy`, rodar a fase inteira e a paridade da seção 10.

### Fase 2: copiar os produtos para `Offer` com o id antigo

- [ ] Relatório e `--verify` sem bloqueios (os `BLOCKED_*` de dados que não migram viram erro de parada).
- [ ] Criar as ofertas (dry-run, aplicar, verificar) e os `ExternalRef` da DOM.
- [ ] Migrar os 5 contratos de assinatura (script já existente).
- [ ] Reescrever `CoproductionAgreement` e `CoproductionRevision` (`product = 'ofertas'`, mesmo `productId`), na mesma transação, e manter os leitores entendendo os valores antigos nos snapshots já gravados.

### Fase 3: reescrever os leitores (classe B), atrás de um flag

Todos continuam lendo as tabelas antigas até a paridade fechar. Principais grupos:

- **Webhooks da DOM:** `process-dom-webhook`, `process-webhook`, `subscription-webhook.service`, `link-settlement`. Trocar a consulta por `domPaymentLinkId`/`domSubscriptionId` por `ExternalRef`; o webhook que não resolve nada hoje é aceito e perdido, então acrescentar métrica e alerta.
- **Relatórios:** `owned-report-source` (faz `LEFT JOIN "PaymentLink"` e perde a venda em silêncio), `platform-reporting`, `platform-seller-reports`, `platform-overview-reports`, `dashboard-summary`, `list-dom-transactions-direct` (manter os parsers de `cod_external` históricos).
- **Plataformas:** `platform-core/*` (claim de links, administração, BETAI, capacidades de assinatura, vouchers), `unified-platform/*`, `internal-areaflix-finance`.
- **Coprodução:** `productTables`, `coproduction.service`, `coproduction-view` (SQL com nome de tabela).
- **Admin:** `admin-clientes`, `admin.controller` (links, comunidades, vínculos).

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

## 12. Decisões que dependem do dono

1. **Taxa individual por link.** Só 1 link tem taxa própria. As ofertas usam a política financeira. Aceitar a política (o link muda de taxa) ou criar o campo `Offer.metadata.feeOverride` e ler no preço?
2. **Arquivos, cupons, comunidade, funil, plano PIX com crédito, pausa, provisionamento CONTROLE/BETAI:** todos estão com **0 linhas** hoje. Portar cada um ou **descontinuar** a funcionalidade junto com as tabelas? Descontinuar encurta muito o plano, mas o `api-pagatg` depende do plano PIX e dos cupons.
3. **Rotas REST legadas** (`/links-pagamento`, `/links-assinatura`) usadas pelo `saas-netflix-back`: manter adaptadores por quanto tempo, ou migrar esse cliente antes de cortar?
4. **Janela de congelamento** e **tempo de retenção** das tabelas `*_legacy` antes do `DROP`.
5. **Quando aplicar** cada fase em produção (cada uma exige a sua autorização).

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
