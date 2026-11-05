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

- [ ] Interface `AcquirerPort` com capacidades; adaptador DOM sobre o código atual; FRENDZ onde já existir.
- [ ] Tabela `ExternalRef` e leitura por `(acquirer, externalId)` nos webhooks, mantendo `dom*` como fonte transitória.

### Fase 3 — Núcleo de cobrança (`Charge`)

- [ ] Schema aditivo de `Charge` ligado a `Transaction` e `PaymentAttempt`.
- [ ] Piloto: link de pagamento sem recorrência. Depois boleto e PIX avulso.

### Fase 4 — `Offer` e presets

- [ ] Schema aditivo de `Offer`; mapa `(legacyType, legacyId) → offerId` único.
- [ ] Migrar links de pagamento (13), preservando códigos, arquivos, upsells e vouchers.
- [ ] Wizard de criação no dashboard baseado em presets, mantendo as rotas atuais.

### Fase 5 — Recorrência própria

- [ ] Generalizar `BillingContract` (`offerId`, comprador, próxima cobrança); manter a API de quantidade atual funcionando.
- [ ] Scheduler de ciclos com idempotência e retentativa.
- [ ] Migrar os 13 links de assinatura e as 5 ordens para contratos. **Assinaturas de cartão hoje geridas pela DOM continuam lá até haver estratégia de token (dúvida 1);** não cancelar nem recriar cobranças.
- [ ] Planos PIX como `MANUAL_PAY`.

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
