# Oferta única, recorrência própria e adquirente substituível

Plano proposto em 2026-11-05. **Nenhuma implementação, migração ou comando contra banco remoto autorizado.** Refina e substitui as fases D–F do [plano 0010](0010-unificacao-ofertas-cobrancas.md) com três decisões novas: (1) recorrência e planos são sempre da SimIntPay, nunca do adquirente; (2) `BillingContract` passa a ser a assinatura de uma oferta; (3) o escopo é a unificação completa, em fases. Depende de [0009](0009-titularidade-ofertas-cobrancas.md) (titularidade) e se apoia em [0008](0008-taxas-adquirentes-lucro.md)/[0018](0018-safe-acquirer-retry-breaker.md).

## 1. Decisões

1. **Plano e recorrência são nossos.** A agenda, o estado do contrato, tentativas, carência, pausa e cancelamento vivem no banco da SimIntPay. O adquirente só executa cobranças avulsas (cartão, PIX, boleto) e, no máximo, guarda token de cartão. Trocar de adquirente não pode exigir migrar assinaturas.
2. **`BillingContract` é a instância recorrente de uma oferta**, não um modelo paralelo. Hoje ele serve só à API de quantidade/SaaS; será generalizado.
3. **Nada de colunas `dom*` em modelos novos.** IDs externos ficam numa tabela `(acquirer, tipo, idExterno)`.
4. Compatibilidade: rotas, códigos, URLs públicas e IDs existentes ficam intactos via adaptadores (regras do 0010 mantidas: um só caminho de escrita por etapa, sem dual-write financeiro).

## 2. Diagnóstico do banco (somente leitura, SELECT agregado, 2026-11-05)

| Item                                                                          | Linhas                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `PaymentLink`                                                                 | 13 (todos aceitam cartão, débito e PIX)                                    |
| `SubscriptionLink`                                                            | 13 (6 mensais, 7 anuais; todos `BOTH`)                                     |
| `SubscriptionLinkOrder`                                                       | 5 (todos `paid`)                                                           |
| `Boleto`                                                                      | 1                                                                          |
| `Plan`, `Subscription`, `PixCreditPlan`, `PixPlanOrder`, `CustomerPlanAccess` | 0                                                                          |
| `BillingContract`, `BillingQuantityChange`                                    | 0                                                                          |
| `PaymentAttempt`                                                              | 5                                                                          |
| `Transaction`                                                                 | 6631: DOM/PIX 5769, DOM/cartão 861, DOM/boleto 1; só 5 com `paymentLinkId` |

Consequências:

- **Quase não há dado a migrar nos modelos recorrentes.** Planos, planos PIX e `BillingContract` estão vazios; os "planos" que importam hoje são os 13 links de assinatura e suas 5 ordens. O custo é de código, não de dados.
- Só 5 de 6631 transações apontam para um link. O grosso do volume (PIX, cartão) vem de outras origens (integrações/API). A oferta não pode ser requisito de toda `Transaction`; a ligação deve ser opcional.
- `Transaction` já tem colunas genéricas (`acquirer`, `externalPaymentId`, `externalTransactionId`) convivendo com `domTransactionId`/`domPaymentId`. É o caminho certo; as colunas `dom*` viram legado.
- `Acquirer` é um enum com `DOM` e `FRENDZ`, e existe `AcquirerCatalogue` (tabela). Para suportar mais adquirentes sem migração de enum, novos modelos devem referenciar `AcquirerCatalogue.code` (string), não o enum.
- `PaymentAttempt` já modela tentativas com lease, idempotência e `provider`; é a base da tentativa de cobrança de cada ciclo.

## 3. Modelo-alvo (conceitual; validar no desenho do schema)

| Modelo                                          | Papel                                                                                                                                                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Offer`                                         | Catálogo: titular/executor (0009), plataforma opcional, código público, preço, estado, `kind` (preset), meios aceitos, parcelamento máximo, `expiresAt`, `maxUses`, `accessDays`, `fulfillment` (arquivos, comunidade, e-mail, webhook) |
| `OfferSchedule` (ou campos em `Offer`)          | Recorrência: `NONE`, `PERIODIC`; intervalo, repetições, trial, primeira cobrança, dias de retentativa, `renewalMode`                                                                                                                    |
| `BillingContract` (generalizado)                | Assinatura de um comprador a uma oferta: `offerId`, comprador, agenda (`currentPeriod*`, próxima cobrança), `pastDueAt`, `graceEndsAt`, `accessEndsAt`, versão. `resourceType/resourceId` continua para a API de terceiros              |
| `Charge` (nome distinto da projeção `Cobranca`) | Cobrança canônica de um ciclo ou avulsa: valor, vencimento, pagador, titular congelado, snapshot de taxas/coprodução, `contractId?`, `offerId?`                                                                                         |
| `PaymentAttempt` (existente)                    | Tentativa no adquirente para uma `Charge`                                                                                                                                                                                               |
| `ExternalRef`                                   | `(acquirerCode, kind, externalId)` → entidade interna; substitui `dom*`                                                                                                                                                                 |
| `Transaction`, `Wallet`, `BalanceLog`           | Contabilidade existente; sem segundo ledger                                                                                                                                                                                             |

`renewalMode`:

- `AUTO_CHARGE`: a SimIntPay emite a cobrança do ciclo no cartão tokenizado.
- `MANUAL_PAY`: a SimIntPay emite PIX/boleto a cada ciclo e envia ao comprador (generaliza o plano PIX atual).
- `NONE`: compra única; `accessDays` opcional dá acesso por prazo.

Presets que reproduzem os cinco produtos: link de pagamento (`NONE`), link de assinatura (`PERIODIC` + `AUTO_CHARGE`), plano (idem, sem URL pública), plano PIX (`MANUAL_PAY` + `accessDays`), boleto (cobrança avulsa nominal, sem oferta pública reutilizável).

### Scheduler próprio

Job idempotente que seleciona contratos com ciclo vencendo, cria a `Charge` do ciclo (chave `contractId + período`), emite a tentativa e aplica retentativa/carência/suspensão. Roda sobre `PaymentAttempt` e o breaker do 0018. Substitui o decremento via endpoint externo do plano PIX e os eventos `SIGNATURE-*`/`CHARGE-APPROVED` como fonte de verdade da renovação.

### Capacidades por adquirente

Interface declara: métodos suportados, parcelamento, tokenização de cartão reutilizável (cobrança off-session), PIX, boleto. Oferta `AUTO_CHARGE` só pode ser criada se o adquirente roteado suportar cobrança com token; senão rejeita. Ponto de falha conhecido: se o token é guardado no adquirente, a troca exige re-tokenização (ver dúvida 1).

## 4. Fases

Cada fase termina em commit atômico e deixa o sistema funcionando.

### Fase 0 — Pré-requisitos

- [ ] Plano 0009 (titularidade) concluído ou ao menos o contrato `ownerUserId/createdByUserId` definido.
- [ ] Responder as dúvidas da seção 6.
- [ ] Ensaiar com cópia local sanitizada; nunca testar em banco remoto.

### Fase 1 — Consolidar duplicações (sem schema)

- [x] Um único helper de frequência→dias: `accessDaysForFrequency` (`application/helpers/billing-frequency.helper.ts`) substitui as cópias de `pix-plan.service.ts`, `process-dom-webhook` e `platform-access.service.ts`. `advanceSubscriptionPeriod` (soma de calendário, não de dias) permanece à parte. Efeito: `DAILY` passa a valer 1 dia nos dois consumidores que antes davam 30.
- [x] "Meios aceitos" do plano e do link de assinatura passam pelo helper `accepted-payment-methods.helper.ts`. Os booleanos `aceita*` do link de pagamento e do boleto ficam para a Fase 4, quando `Offer` unificar o formato.
- [ ] Movido para a Fase 3: fundir o fluxo PIX copiado em link de pagamento, boleto e link de assinatura. Eles divergem em regra de dinheiro (o boleto tem um caminho legado sem `FINAL_NET`; o link tem Areaflix e order bumps), então só devem ser fundidos com cenários de integração cobrindo cada ramo.
- [ ] Movido para a Fase 5: o checkout do Plano só chama o endpoint de cartão. Respeitar `paymentMethods` com PIX exige um fluxo PIX para planos, que ainda não existe.

### Fase 2 — Contrato de adquirente

- [x] `acquirerCapabilities` (`core/services/acquirer-capabilities.ts`) declara meios, parcelamento e cobrança de cartão salvo por adquirente; exposto em `PaymentGatewayResolver.capabilitiesFor`. O `IPaymentGateway` já existia e foi mantido como porta.
- [x] Tabela `ExternalRef` + `ExternalRefService` (`modules/billing-core`). Migration `20261105120000_external_ref`, **não aplicada em nenhum banco**.
- [ ] Gravar `ExternalRef` ao criar planos/links/assinaturas e ler por ela nos webhooks: depende da Fase 4 (os fluxos atuais só mudam junto com o corte para `Offer`).

### Fase 3 — Núcleo de cobrança (`Charge`)

- [x] Schema aditivo de `Charge` (liga a `Transaction`, `Offer` e `BillingContract`; unicidade `(contractId, cycleKey)`). Migration `20261105130000_offer_charge_core`, **não aplicada**.
- [ ] Piloto: link de pagamento sem recorrência emitindo `Charge`. Depois boleto e PIX avulso. Inclui fundir o fluxo PIX triplicado. **Corte de fluxo de dinheiro: aguarda decisão.**

### Fase 4 — `Offer` e presets

- [x] Schema aditivo de `Offer` (enums `OfferKind`, `RenewalMode`), com `(legacyType, legacyId)` único para o mapa legado.
- [x] Módulo `modules/offer`: validador puro, presets dos 5 produtos, gerador de código, `OfferService`, controller `ofertas` (+ `GET public/:code`). SDK do frontend **não** regenerado.
- [x] Mapeadores legado→`Offer` e `scripts/offer-migration-report.ts` (somente leitura; exige `--database-url` explícito; nunca executado contra banco). Resolvido: o código de `PixCreditPlan` vem de `PixPlanLinkCode` (o `PX-...` do checkout; vale o ativo mais antigo, extras viram nota no relatório) e `Plan.frequency` multiplica o intervalo de `type` ("a cada N"), igual ao `frequency` enviado à DOM.
- [ ] Checkout público da `Offer`; migração real dos 13 links de pagamento; wizard no dashboard.

### Fase 5 — Recorrência própria

- [x] `BillingContract` generalizado: `offerId`, `nextChargeAt`, `retryCount`, dados do comprador; `externalSubscriptionId` agora é opcional (contratos de workspace continuam exigindo-o via `requireExternalSubscriptionId`). **Não foi preciso mudar o `teron`**: a resposta atual da API não muda.
- [x] Agendador próprio: `cycle-policy.ts` (função pura) e `BillingCycleService` (`subscribe`, `settle` idempotente, `runDue`). Cobertos por `tests/billing-cycle.integration.test.ts` (banco descartável) e `cycle-policy.test.ts`.
- [x] Cofre de cartões (`StoredCard`/`StoredCardToken`, migration `20261106110000_stored_card_vault`, **não aplicada**), `StoredCardVaultService` e `StoredCardCycleExecutor` (chave de idempotência `cycle:<chargeId>:<attempts>`; resultado `PAID|FAILED|UNKNOWN`, e `UNKNOWN` deixa a cobrança PENDING sem mexer no contrato). Ligado no `BillingCycleCron`; contratos cujo adquirente não suporta são ignorados.
- [ ] Lacunas do cofre: (a) nenhum checkout hoje devolve token de cartão reutilizável (o token do link é descartável do frontend; o reutilizável da DOM só sai de `customers/:id/card-token` com PAN no servidor ou da assinatura DOM), então nada chama `StoredCardVaultService.save` ainda; (b) `chargeStoredCardToken` da DOM reaproveita o `POST /transactions` com `upsell: true` das assinaturas, não validado com token avulso; (c) ~~ciclo próprio sem `Transaction`~~ resolvido: `settle(PAID)` cria a `Transaction` FINAL_NET pelo mesmo `settleFinalNet` dos links (`cycle-ledger.ts`, produto de coprodução `ofertas`, migration `20261107100000_coproduction_ofertas`, **não aplicada**); (d) conciliador `ChargeReconciler` (cron horário) liquida `UNKNOWN` via porta `ChargeStatusLookup`; a implementação DOM (`DomChargeStatusLookup`) **não está implementada** e devolve sempre `UNKNOWN` (o `ApiDomClient` só lê transação por id DOM e a listagem não filtra por `cod_external`); sem ela, cobranças `UNKNOWN` há mais de 48h só geram o evento `CHARGE_UNRESOLVED`.
- [x] Job horário `BillingCycleCron` (lock advisory entre réplicas; AUTO_CHARGE sem executor é pulado, não falhado) e entrega de `CHARGE_DUE` via `BuyerNotifier` (padrão só loga; nenhum e-mail enviado).
- [ ] Notificador real, migração dos 13 links de assinatura / 5 ordens (tratadas como ativas na DOM; nada é cancelado) e planos PIX como `MANUAL_PAY`.

### Fase 6 — Retirada gradual

- [ ] Medir uso de rotas legadas; só desativar após zero consumo.
- [ ] Remover colunas `dom*` e a dependência de `Plan`/`createPlan` do gateway em etapa separada, aditiva até lá.
- [ ] Rollback não reemite cobranças nem desfaz o ledger.

## 5. Validação

- Webhook duplicado/fora de ordem; concorrência de tentativas; timeout após aceite do adquirente; retentativa de ciclo; reembolso parcial/total; expiração e cancelamento.
- Dois cenários de ciclo no mesmo período não geram duas cobranças.
- Troca de adquirente no ambiente de teste: contrato existente cobra pelo adquirente novo sem alterar a agenda.
- Contagens, IDs públicos, totais financeiros e alocações iguais antes/depois; leituras sombra não emitem cobrança.
- Checkout e dashboard no navegador; i18n sincronizado; hooks e type-check/build dos pacotes afetados antes da integração.

## 6. Dúvidas em aberto

1. **Cartão recorrente:** o adquirente permite cobrar com token/cartão salvo sem o comprador (off-session)? O token pertence a nós (vault próprio) ou ao adquirente? Isso decide se `AUTO_CHARGE` é viável e como as assinaturas DOM existentes migram. Se não for, o fallback é `MANUAL_PAY` para cartão também.
2. **Assinaturas DOM ativas:** as 5 ordens `paid` têm assinatura viva na DOM cobrando hoje? Migrar exige cancelar lá e assumir a cobrança aqui sem cobrar duas vezes.
3. **API de terceiros (`BillingContract`):** os clientes da API dependem do formato atual de `externalSubscriptionId` (campo `@unique` obrigatório)? Ele precisa virar opcional.
4. **Boleto:** seguirá sem oferta (cobrança nominal) ou deve poder ser gerado a partir de uma oferta?
5. **Coprodução:** `productTables` mapeia 5 tabelas; passa a mapear `Offer`? Acordos existentes por produto precisam de ponte.
6. **Estimativa:** o 0010 estima 6–10 semanas para a unificação incremental completa. Retirar a dependência da recorrência do adquirente adiciona o scheduler e o tratamento de tokens; reavaliar após a resposta da dúvida 1.

## 7. Bugs de dinheiro encontrados pelos testes de caracterização

Corrigidos em 2026-11-05 por autorização expressa (valor cobrado e líquido do vendedor inalterados):

- [x] Endpoint genérico valida `aceitaPix`/`aceitaCartao`/`aceitaDebito` (`b90d3e3`).
- [x] PIX: `domFee` vem de `MDR_PIX` (0,98%), não da taxa de cartão; débito: `domFee` só com o custo DOM (3,49% + R$1). `domFee`/`totalFee`/`platformFee` arredondados a 2 casas (`b90d3e3`).
- [x] Link de assinatura: PIX e cartão recusam método não aceito; taxa calculada sobre o valor com cupom (`1845233`). `SubscriptionLink` não tem `expiresAt`, logo não há expiração a validar.

Corrigidos em 2026-11-05 (autorização expressa):

- [x] Boleto-PIX segue a regra do PIX de link de pagamento (líquido 87,00 em R$100, antes 83,00; sem cashback R$3 nem fixa R$1 extras; `domFee` = MDR_PIX), tem o ramo Areaflix (89,01) e sempre liquida `FINAL_NET` com rascunho.
- [x] Areaflix cartão 1x: líquido sobre a base do link (R$100 -> 87,00; antes 91,54 sobre o total do comprador).
- [x] Areaflix débito: `platformFee` limitado a zero; o subsídio (0,49 em R$100) fica em `financialSnapshot.subsidy`, líquido inalterado (96,00).

Ainda **não corrigido**: boleto-PIX sem order bump/funil (decisão de produto, dúvida 4).

## 8. Cofre de cartões (`StoredCard`, `StoredCardToken`)

Migration `20261106110000_stored_card_vault` (não aplicada). `StoredCardCycleExecutor` cobra com chave de idempotência `cycle:<chargeId>:<attempts>`; falha ambígua = `UNKNOWN` (cobrança fica `PENDING`, contrato intacto). **Lacunas:** nada grava token reutilizável hoje (o checkout DOM só repassa token de uso único); não confirmado que a DOM aceite token avulso em `/transactions` (testar em sandbox); ciclo pago cria a `Transaction` no ledger único (taxas, coprodução e carteira uma só vez); conciliador de `UNKNOWN` pronto, aguardando consulta real na DOM.

## 9. Estado após a rodada de 2026-11-05/06

Em `main` (commits locais, nenhuma migration aplicada em banco real):

- [x] Checkout público de compra única da `Offer` (`POST ofertas/public/:code/charge`: PIX, crédito, débito), com `Charge` + `Transaction` FINAL_NET, taxas corrigidas e reserva atômica de uso.
- [x] `Charge` é marcada paga/falha/expirada quando a `Transaction` liquida pelos três caminhos: webhook DOM, webhook genérico e polling (`markChargeSettled`).
- [x] Ciclo pago de contrato lança no ledger único (`cycle-ledger.ts`, coprodução `ofertas`); migration `20261107100000_coproduction_ofertas` amplia a restrição de produto.
- [x] Conciliador de cobranças pendentes após resultado desconhecido (`ChargeReconciler`), 1 h de tolerância para "não encontrado"; `CHARGE_UNRESOLVED` após 48 h.
- [x] Script de migração legado→`Offer` (`scripts/offer-migration-apply.ts`, dry-run por padrão, `--verify`) e runbook (`docs/guides/offer-migration-runbook.md`). Nunca executado contra banco real.

Pendente, por dependência externa ou decisão:

- [ ] **Token de cartão reutilizável:** nada grava `StoredCardToken`. Decidir a origem do token (PAN no nosso servidor ou assinatura DOM) e validar em sandbox que a DOM aceita token avulso em `/transactions`.
- [ ] `DomChargeStatusLookup` só devolve `UNKNOWN`: `ApiDomClient` não consulta por `cod_external`.
- [ ] Entrega (`fulfillment`: e-mail/webhook) e order bumps não ligados a `Offer`; `pix-status` público não conhece ofertas.
- [ ] Checkout de ofertas recorrentes (assinatura) e SDK/dashboard do frontend (wizard por presets).
- [ ] Fase 6: medir uso das rotas legadas antes de retirá-las.
- [ ] Bugs ainda fixados nos testes (seção 7): boleto-PIX, Areaflix cartão 1x e débito.

## 10. Estado após a segunda rodada (2026-11-06)

Decisões do dono do produto: token de cartão vem da DOM (via assinatura; `createCardToken` como alternativa por `OFFER_CARD_TOKEN_SOURCE`); Areaflix cartão 1x calcula o líquido sobre a base (R$ 87,00 por R$ 100, antes R$ 91,54); boleto-PIX rende o mesmo que um link PIX.

Em `main`:

- [x] `POST ofertas/public/:code/subscribe` (AUTO_CHARGE com cartão, MANUAL_PAY com PIX), idempotente por (oferta, e-mail); `markChargeSettled` agora também avança o contrato; primeira cobrança que falha em contrato sem ciclo pago cancela o contrato.
- [x] `CardTokenSource` (assinatura DOM ou `createCardToken`); token guardado no cofre; só marca/bandeira/últimos 4/validade no banco, nunca PAN/CVV.
- [x] `Offer.fulfillment` validado (`offer-fulfillment.ts`); entrega por e-mail/arquivos/webhook após `Charge` paga, idempotente por etapa; order bumps e upsell/downsell no checkout de ofertas (mesmos números do link legado, provado por teste). Webhooks de oferta têm proteção SSRF (o fluxo legado não tem: pendência separada).
- [x] `DomChargeStatusLookup` real (pagina até 10 páginas / 3 dias; resolve o token como o executor).
- [x] Bugs de taxa: boleto-PIX igual ao link PIX e sempre FINAL_NET; Areaflix 1x sobre a base; Areaflix débito sem `platformFee` negativo (diferença em `financialSnapshot.subsidy`).
- [x] Frontend: seção `ofertas` no dashboard (lista, wizard por presets, desativar) e checkout `?ofertaCode=` para compra única. Não há SDK gerado nem i18n neste repositório (strings pt-BR fixas, `endpoints.ts` escrito à mão).

Pendências e riscos conhecidos:

- [ ] **Nada foi validado contra a DOM real.** Formato da resposta de `createSubscriptionFromCheckout`, local de `card.token`, aceitação de token avulso em `/transactions`, `repetitions: 1` não recobrar sozinho, filtros do lookup.
- [ ] `completeCardCapture` não é chamado automaticamente depois de liquidação por webhook (precisa de gancho ou varredura).
- [ ] Ciclos seguintes cobram `offer.amountCents` pelo `chargeStoredCardToken`, mas o primeiro cobra o total com taxas: valores divergem quando a política soma taxas.
- [ ] `offer-pricing.ts` duplica a precificação de `offer-checkout.service.ts`: unificar.
- [ ] `trialDays > 0` bloqueado no checkout público de assinatura; `pix-status` público não conhece ofertas; checkout de ofertas recorrentes no frontend segue "indisponível".
- [ ] Boleto-PIX ainda ignora `orderBumpIds`/`offerId`; `LINK_COST_1X` vs `TAXA_LINK_PERCENT` só diverge em plataformas com override de um dos dois.
- [ ] Migrations ainda não aplicadas em nenhum banco real (7 pendentes); migração de dados legada e das 5 ordens de assinatura ativas na DOM continuam dependendo de decisão do dono.
