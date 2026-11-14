# Mapa do legado e migração dos webhooks para o canal assinado

Plano proposto em 2026-11-13. **Nada aqui autoriza migration, comando contra banco remoto, deploy ou configuração em produção.** Complementa [0023](0023-migracao-completa-para-ofertas.md) (fases de dados) com (1) o inventário do que ainda é legado em 2026-11-13 (HEAD `7402859b`) e (2) a migração dos webhooks externos do token estático `x-simpay-token` para o webhook assinado (`x-simintpay-signature`).

## 1. Webhooks: estado e decisão

Canal alvo: outbox `PlatformSalesEvent`, HMAC-SHA256 do corpo exato, segredo `WEBHOOK_SECRET` e destino `WEBHOOK_URL` da plataforma (`platform-sales-events.service.ts`, `offer-sales-event-outbox.ts`). Corpo em centavos, sem documento; só `subscription_activated` de oferta traz `planName` e valores em reais.

| #   | Emissor (arquivo:linha)                                                                                               | Evento                                           | Auth hoje                 | Destino                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------- |
| 1   | `platform-core/platform-sales-events.service.ts:113-243`                                                              | purchase\_\*, chargeback, pix\_\*, card_declined | HMAC                      | **Alvo.** Já canônico                                                             |
| 2   | `offer/offer-sales-event-outbox.ts:61`                                                                                | `subscription_activated` (oferta)                | HMAC                      | **Alvo.** Descarta em silêncio sem `WEBHOOK_URL`/`WEBHOOK_SECRET`                 |
| 3   | `process-dom-webhook.use-case.ts:1788` (`notifyPaymentLinkExternalWebhook`)                                           | purchase_approved/refunded                       | `x-simpay-token`          | Migrar. Já se cala se a plataforma tem `WEBHOOK_SECRET`                           |
| 4   | `charge-payment-link.use-case.ts:441`                                                                                 | purchase_approved (cartão)                       | `x-simpay-token`          | Migrar. Mesma guarda                                                              |
| 5   | `process-dom-webhook.use-case.ts:1589` (`handleSubscriptionLinkPix`)                                                  | subscription_activated (PIX)                     | `x-simpay-token`          | Migrar. **Sem guarda**: sempre token                                              |
| 6   | `checkout-subscription-link-card.use-case.ts:231`                                                                     | subscription_activated (cartão)                  | `x-simpay-token`          | Migrar. Sem guarda                                                                |
| 7   | `subscription/subscription-webhook.service.ts:642`                                                                    | `subscription_renewed`                           | `x-simpay-token`          | Migrar + criar emissor para contratos próprios                                    |
| 8   | `subscription/subscription-webhook.service.ts:756`                                                                    | `subscription_expired`                           | `x-simpay-token`          | Migrar + criar emissor para contratos próprios                                    |
| 9   | `billing/billing.service.ts:410`                                                                                      | status de contrato Teron                         | HMAC, outbox própria      | Fora do escopo (contrato do `teron`)                                              |
| 10  | `integrations/canonical-merchant-events.worker.ts:70`, `integration-webhook.worker.ts`                                | sim-delivery                                     | HMAC (nomes distintos)    | Fora do escopo. `x-simpay-signature` vs `x-simintpay-signature` a unificar depois |
| 11  | `pix-plan.service.ts:1042-1553`, `offer-access/pagatg-notifier.ts:37`, `pause/resume-subscription.use-case.ts:170,78` | pix-credit, signature para PAGATG                | `x-pagatg-internal-token` | Fora deste plano (depende do `api-pagatg`)                                        |
| 12  | `process-dom-webhook.use-case.ts:1023`, `ebook-receipt-outbox.service.ts:35`                                          | back-ebook                                       | `x-internal-token`        | Fora do escopo                                                                    |

Riscos conhecidos:

- Oferta de plataforma sem `WEBHOOK_URL`+`WEBHOOK_SECRET` não notifica ninguém. `Offer.fulfillment.webhookUrl` foi removido (migration `20261110100000`), e os adaptadores gravam `webhookUrl: null` (`legacy-links.compat.ts:214,411`). Os 8 links Areaflix com `webhookUrl` só continuam avisando o `saas-netflix-back` se a plataforma AREAFLIX tiver os dois itens.
- Contratos próprios não emitem `subscription_renewed` nem `subscription_expired`; só `subscription_activated` (primeiro ciclo).
- `/pagatg/webhook/dom` e `/` não têm autenticação (`pagatg-webhook.controller.ts:15,22`).
- `SIMPAY_WEBHOOK_TOKEN` é lido em 5 arquivos (#3 a #8) e está duplicado em `backend/.env`.

### Passos

- [x] **Consumidor:** `saas-netflix-back` recebe o canal assinado em `POST /webhooks-simintpay` (HMAC com `SIMINTPAY_WEBHOOK_SECRET`, corpo bruto), converte centavos para reais e reaproveita `SimpayWebhookService`. `chargeback` revoga como `purchase_refunded`; `purchase_partially_refunded` e eventos informativos são ignorados. Commit `dee0b17` no `saas-netflix-back` (local, não enviado). `/webhooks-simpay` (token) continua ativo. Os links criados por ele passam a usar `?oferta=`.
- [ ] **Configurar (dono, fora do código):** na plataforma AREAFLIX, `WEBHOOK_URL=https://<areaflix-back>/webhooks-simintpay` e `WEBHOOK_SECRET`; mesmo valor em `SIMINTPAY_WEBHOOK_SECRET` no `saas-netflix-back`. Antes, validar com um evento de teste.
- [ ] **Emissor de ciclo:** estender `OfferSalesEvent` (`offer-sales-event-outbox.ts:12`) com `subscription_renewed` (cada `Charge` paga que não é a primeira do contrato) e `subscription_expired` (contrato `SUSPENDED`/`INACTIVE` ao fim da carência ou cancelamento), com `planName`, `amountCharged`, `netAmount`, `linkId`. `eventId` por `(contrato, ciclo, evento)`.
- [ ] **Corpo canônico:** incluir `planName` e `frequencyType` no corpo de `purchase_approved` (hoje só em `items`), para consumidores não dependerem do item principal.
- [ ] **Cortar #3 a #6:** trocar `notifyExternalWebhook`/`notifyPaymentLinkExternalWebhook` por enfileiramento na outbox; remover a guarda `WEBHOOK_SECRET` e o token. Só depois do passo de configuração e de zero tráfego em `/webhooks-simpay` no `saas-netflix-back` (medir por `SimpayWebhookLog`).
- [ ] **Cortar #7 e #8** junto com a migração dos contratos (seção 2).
- [ ] Aposentar `/webhooks-simpay` e `SIMPAY_WEBHOOK_TOKEN` no `saas-netflix-back` e no simintpay.
- [ ] Autenticar ou remover `/pagatg/webhook/dom`.
- [ ] Avisar integradores sobre `purchase_partially_refunded` (plano 0024).

## 2. Inventário do legado

Dados reais em 2026-11-05: `PaymentLink` 16, `SubscriptionLink` 13, `SubscriptionLinkOrder` 5, `Boleto` 1; `Plan`, `Subscription`, `PixCreditPlan`, `PixPlanOrder`, `CustomerPlanAccess`, `Offer`, `Charge`, `BillingContract` com 0 linhas. O custo restante é de código e de cortes, não de dados.

### Produtos

| Legado                                                | Arquivos principais                                                                                      | Substituto                                | Estado                                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Plan`                                                | `application/use-cases/plan/*`, `plan.controller.ts` (`/planos`), `api-dom.client.ts:834` (`createPlan`) | `Offer` AUTO_CHARGE + `BillingContract`   | Legado; sem adaptador REST. Cartão recorrente nunca validado na DOM real                                                          |
| `Subscription`, `SubscriptionPause`                   | `use-cases/subscription/*`, `/assinantes/*`, `schema.prisma:648,780`                                     | `BillingContract` + `BillingCycleService` | Legado. Pausa/retomada e lista de assinantes de oferta **não portadas**                                                           |
| `PixCreditPlan`, `PixPlanOrder`, `CustomerPlanAccess` | `pix-plan.service.ts` (1598 linhas), `pix-plan.controller.ts`, `expiration-reminder.cron.ts`             | `OfferAccess*` + `OfferAccessCron`        | Adaptador pronto, **desligado** (`OFFER_PIXPLAN_COMPAT`). Ligar exige migrar o `api-pagatg`; não rodar os dois crons              |
| `PaymentLink` (+ funil, arquivos)                     | `use-cases/payment-link/*`, `/links-pagamento`, `owned-report-source.ts:47,50,84`                        | `Offer` NONE, `OfferCheckoutService`      | Adaptador de CRUD pronto, **desligado** (`OFFER_LEGACY_LINKS_COMPAT`). Arquivos, imagens de bump e funil de checkout não portados |
| `SubscriptionLink`, `SubscriptionLinkOrder`           | `use-cases/subscription-link/*`, `/links-assinatura`, `/subscription-links`                              | `Offer` PERIODIC + `BillingContract`      | Adaptador de CRUD pronto, desligado. Cartão pago no link legado ainda cria assinatura na DOM fora do agendador novo               |
| `Boleto`                                              | `use-cases/boleto/*`, `/boletos`                                                                         | boleto como meio da `Offer`               | Migrado em código; `/boletos` sem adaptador REST. Legado tem caminho sem `FINAL_NET`                                              |
| `Voucher`                                             | `voucher.service.ts`                                                                                     | `validate-voucher` da oferta              | Migrado                                                                                                                           |
| Comunidade, CONTROLE-\*, BETAI                        | removidos                                                                                                | n/a                                       | Código removido; migration `20261116110000_drop_community_and_saas_provisioning` não aplicada                                     |

### Dados e chaves

- Colunas `dom*`: `Transaction.domTransactionId/domPaymentId` (~104 arquivos ainda leem) em paralelo a `acquirer/externalTransactionId/externalPaymentId`; `PaymentLink.domPaymentLinkId`, `Boleto.domPaymentLinkId/domLink`, `SubscriptionLink.domPlanId`, `Plan.domPlanId`, `SubscriptionLinkOrder.domSubscriptionId/domPixPaymentId`, `Subscription.domSubscriptionId`, `SubscriptionPause`/`SubscriptionHistoryExclusion.domSubscriptionId`. Substituto: `ExternalRef`, gravado pelo mapeador mas **lido por nenhum webhook**.
- `Transaction.paymentLinkId` (5 linhas) sem `Transaction.offerId` (plano 0023, Fase 1). ~39 arquivos em `src` ainda leem tabelas legadas; relatórios fazem `LEFT JOIN "PaymentLink"`.
- Fora do escopo: `User.domUserId`, `WithdrawRequest.domWithdrawId`, `Customer.domCustomerId`.

### PIX duplicado

Legado: `charge-pix-payment-link.use-case.ts:220`, `charge-boleto-pix.use-case.ts:157`, `checkout-subscription-link-pix.use-case.ts`, `pix-plan.service.ts:223`. Genérico: `checkout.controller.ts:297`. Canônico de oferta: `offer-checkout.service.ts:450`, `offer-subscribe.service.ts:492`, `offer-renewal.service.ts:365`. A fusão ficou para a Fase 3 por divergência em regra de dinheiro (boleto sem `FINAL_NET`, Areaflix e bumps no link).

### Webhooks recebidos

| Rota                                      | Auth                       | Estado                                                                                    |
| ----------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /subscription/webhook`              | JWT da DOM por contrato    | Híbrido: Teron em `BillingContract`, resto legado (`SIGNATURE-*`, `CHARGE-*`)             |
| `POST /webhook/eventos`                   | `x-webhook-secret` + HMAC  | Legado (`process-webhook.use-case.ts`, 602 linhas)                                        |
| `POST /pagatg/webhook/dom`, `/`           | **nenhuma**                | Legado (`process-dom-webhook.use-case.ts`, 1825 linhas; lê `paymentLink`, `domPaymentId`) |
| `POST /platforms/:tag/webhooks/:acquirer` | HMAC / token da plataforma | Canônico                                                                                  |

Nenhum webhook resolve por `ExternalRef`; um evento que não casa é aceito e perdido, sem métrica.

### Crons

Novos: `BillingCycleCron`, `RenewalReminderCron`, `OfferAccessCron`, `PlatformSalesEventsService`. Legado: `ExpirationReminderCron` (09:00) e `POST /payments/plan-access/decrement-all`. `DomChargeStatusLookup` não está implementado: cobrança `UNKNOWN` há mais de 48 h só emite `CHARGE_UNRESOLVED`.

### Frontend e checkout

- Painel: `/ofertas` é o novo. Ainda existem `/links-pagamento`, `/links-assinatura`, `/planos`, `/planos-pix`, `/boletos` e as visões `/cliente/*`, `features/links-pagamento` e `features/assinantes` (fora do menu lateral, mas chamando `endpoints.ts:44-102`). Assinantes e cupons de ofertas não portados.
- Checkout: `proxy.ts` redireciona `simPlanCode`, `simLinkCode`, `simBoletoCode`, `subscriptionLinkCode`, `linkCode`, `subscriptionCode`, `ofertaCode` para `?oferta=` (307). `CheckoutRouter` ainda monta `SimPlanCheckout`, `SimBoletoCheckout`, `SimLinkCheckout`, `SimSubscriptionLinkCheckout` (inalcançáveis pelo proxy), além de `SimPixPlanCheckout` e `CreditCardForm` (vivos).

## 3. Ordem sugerida de retirada

1. Webhooks (seção 1): configurar plataforma, emissores de renovação/expiração, cortar tokens. Independe das fases de dados.
2. Ligar `OFFER_LEGACY_LINKS_COMPAT` em ambiente de teste e validar `saas-netflix-back` ponta a ponta (`id`/`codigo` do adaptador batem com o que ele lê).
3. Portar o que falta em oferta: arquivos e imagens de bump, funil de checkout, pausa, lista de assinantes, `Transaction.offerId`.
4. Reescrever leitores (webhooks por `ExternalRef`, relatórios sem `PaymentLink`) e fundir os PIX (plano 0023, Fase 3).
5. Migrar PAGATG e ligar `OFFER_PIXPLAN_COMPAT`; desligar `ExpirationReminderCron`.
6. Remover telas e rotas legadas após medir consumo zero; só então `DROP` de colunas `dom*` (plano 0023, Fase 6).

## 4. Dúvidas em aberto

- Prazo dos adaptadores REST e janela de congelamento (decisões do dono em 0023).
- `x-simpay-signature` (sim-delivery) e `x-simintpay-signature`: unificar o nome?
- O `saas-netflix-back` precisa saber o `eventId` para deduplicar? Hoje deduplica por `orderId`.
