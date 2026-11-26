# Central de produtos digitais — API de vendas

Contrato opt-in para plataformas com WEBHOOK_SECRET cifrado em PlatformIntegration. Dono e acquirer derivam do contexto autenticado; não são escolhidos pelo corpo.

- POST /platforms/:tag/links: escopo links:write, CreatePaymentLinkDto, idempotency-key obrigatório. Id do link estável por plataforma/chave; mínimo R$ 14,99, juros do comprador. Retorna data e checkoutUrl.
- GET/PATCH /platforms/:tag/links/:id: links:read/write, isolamento por dono + tag.
- POST /platforms/:tag/links/:id/files: links:write, multipart files, PDFs até 20 MB, no máximo 20 por envio. Hash no nome evita duplicidade de conteúdo reenviado.
- GET /platforms/:tag/pricing/simulation?amountCents=: reports:read. Mesma política de juros da criação canônica.
- POST /platforms/:tag/payments aceita linkId opcional. Quando presente, link precisa estar ativo, pertencer à plataforma e ter o mesmo valor; consulta devolve netAmountCents.
- Checkout PIX/cartão aceita tracking no corpo ou query: utm*\*, src, fbclid, fbc, fbp. Allowlist e limite de 500 caracteres por valor. Não aceitar campos financeiros em tracking. `aff` (alias `ref`, normalizado para `aff`, formato `[A-Za-z0-9*-]{3,40}`, descartado em silêncio se inválido) identifica um afiliado da plataforma; vale também no `tracking`de`POST /platforms/:tag/payments` (ver [afiliados](afiliados.md)).
- GET /platforms/:tag/event-history?cursor=: events:read, páginas de 100 snapshots. SSE /events existente preservado.

Worker a cada 30 segundos reconstrói eventos a partir de estado/histórico financeiro. PlatformSalesEvent persiste payload/eventId, tentativas e conclusão de webhook/e-mail. HMAC-SHA256 hexadecimal do JSON exato em x-simintpay-signature. Para `purchase_approved`, `purchase_refunded` e `subscription_activated` envia também `x-simpay-token` (valor do `WEBHOOK_SECRET` da própria plataforma, o mesmo usado na assinatura), que é o que o receptor legado `POST /webhooks-simpay` do saas-netflix-back valida; a assinatura continua em todos os eventos. Nenhum CPF/documento/cartão no payload. Valores em centavos, calculados na transação. Retentativa com backoff e lease de dois minutos.

Eventos: purchase_approved, purchase_refunded, chargeback, refund_requested (mediação), card_declined, pix_generated (código/validade), pix_expired. E-mails com PDFs só após COMPLETED; histórico anterior à criação do segredo não reenvia e-mails antigos. Falha SMTP retenta; SMTP oferece entrega pelo menos uma vez, podendo repetir após interrupção entre envio e gravação.

Configurar SIMPAY_CHECKOUT_URL, WEBHOOK_SECRET, WEBHOOK_URL (para cobranças sem link), armazenamento e SMTP. Administrador deve liberar links:read/write em INBOUND_OPERATIONS. Configurar mesmo segredo na Central.

Migração 20261015000100_platform_sales_events foi preparada, não aplicada. Revisar e aplicar pelo processo normal antes de subir aplicação. Não há acesso a banco ou deploy nos testes novos: mocks e Bun. Validar adquirente/SMTP em homologação antes de operar.

Checkout consumidor precisa encaminhar tracking ao criar cobrança. Patch reproduzível está no repositório sim-produtos-digitais, integrations/checkout/tracking.patch. Cupons, bumps e assinaturas permanecem fase futura; afiliados estão em [afiliados.md](afiliados.md).

## Webhook do link da oferta (contrato legado)

Além do canal assinado, cada oferta pode ter uma URL própria em `Offer.metadata.webhookUrl` (gravada por `webhookUrl` em `/links-pagamento` e `/links-assinatura`, ou pela importação de plano da plataforma). Ela recebe o mesmo `POST` JSON que o link legado enviava, com o header `x-simpay-token` igual ao `WEBHOOK_SECRET` da plataforma da oferta (nunca o `SIMPAY_WEBHOOK_TOKEN` global; sem segredo configurado o header é omitido). Valores em **reais**, sem sufixo `Cents`; `linkId` é o `Offer.id` (igual ao id do link migrado); o CPF/CNPJ do comprador vai como `cpf`/`cnpj` (só dígitos), como no legado. Implementação: `modules/offer/offer-legacy-webhook*.ts`, chamada pelo `OfferFulfillmentService`.

| Evento                                   | Quando                                                                                       | Campos                                                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `purchase_approved`, `purchase_refunded` | oferta sem recorrência, cobrança paga ou transação estornada/contestada                      | `event`, `customerEmail`, `customerName`, `planName`, `items[]` (`tipo`, `offerId?`, `titulo`, `valor`), `paymentMethod`, `amountCharged`, `netAmount`, `orderId` (id da transação), `linkId`, `cpf`/`cnpj`, `phone` |
| `subscription_activated`                 | primeiro ciclo pago do contrato e cobrança de reativação paga                                | `event`, `customerEmail`, `customerName`, `planName`, `paymentMethod`, `frequencyType`, `amountCharged`, `netAmount`, `orderId` (transação), `linkId`, `cpf`/`cnpj`, `phone`                                         |
| `subscription_renewed`                   | cada ciclo seguinte pago                                                                     | mesmos campos de `subscription_activated`; `orderId` é a transação do ciclo (único por ciclo)                                                                                                                        |
| `subscription_expired`                   | contrato `SUSPENDED`, `CANCELLED` com `accessEndsAt` vencido ou `INACTIVE` com período findo | `event`, `customerEmail`, `customerName`, `planName`, `paymentMethod`, `frequencyType`, `amountCharged: 0`, `netAmount: 0`, `orderId` (id do contrato), `linkId`                                                     |

Destino sem URL própria: quando a oferta não tem `metadata.webhookUrl`, `subscription_renewed` e `subscription_expired` (que o outbox não emite) vão ao `WEBHOOK_URL` (HTTPS) da plataforma da oferta, com `x-simpay-token` = `WEBHOOK_SECRET` da plataforma e a mesma validação `unsafeUrlReason`/DNS. URL própria da oferta tem prioridade. Sem `WEBHOOK_URL` ou sem `WEBHOOK_SECRET` não há o que enviar (sucesso, aviso no log uma vez por plataforma). `purchase_approved`, `purchase_refunded` e `subscription_activated` nunca saem por este caminho para o `WEBHOOK_URL` da plataforma: vão pelo outbox assinado (corpo abaixo), o que evita duplicidade.

Garantias: um envio por Charge e evento (marcador em `Charge.snapshot.fulfillment`), com nova tentativa quando o receptor responde 5xx, 408, 429 ou não responde (ciclo de 250 ms a 5 min na memória; a expiração é varrida a cada 5 minutos). 4xx definitivo e URL insegura (esquema não http(s), credenciais, host interno ou DNS que resolve para rede privada) contam como tratados e não repetem. Sem URL não há envio. Se a URL da oferta for igual ao `WEBHOOK_URL` HTTPS de uma plataforma com `WEBHOOK_SECRET`, `purchase_approved`, `purchase_refunded` e `subscription_activated` vão só pelo canal assinado (sem duplicar); renovação e expiração não existem no outbox e sempre seguem pela URL da oferta.

### Corpo do outbox é superconjunto do legado

O receptor do formato antigo (`saas-netflix-back`, `POST /webhooks-simpay`, valida `x-simpay-token`) lê `event`, `customerEmail`, `customerName`, `planName`, `paymentMethod`, `frequencyType`, `amountCharged` (reais), `netAmount` (reais), `orderId`, `linkId` e `phone`; ignora `cpf`/`cnpj`/`document` e eventos desconhecidos. O corpo do outbox (centavos, `eventId`, `occurredAt`, `tracking`, `affiliate`, `items`…) ganhou, de forma aditiva, o que faltava, e a assinatura HMAC cobre o corpo final. Um único envio ao `WEBHOOK_URL` serve aos dois receptores (o novo ignora os campos extras).

| Campo legado                                                                  | `purchase_approved` / `purchase_refunded`                                            | `subscription_activated` |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------ |
| `event`, `orderId`, `paymentMethod`, `phone`, `customerEmail`, `customerName` | já existiam, mesmo nome e valor                                                      | já existiam              |
| `linkId`                                                                      | já existia (id do link legado migrado ou `Offer.id`)                                 | já existia (`Offer.id`)  |
| `planName`                                                                    | **novo**: nome da oferta (sem oferta, omitido)                                       | já existia               |
| `amountCharged`                                                               | **novo**: reais (`amountCents / 100`)                                                | já existia               |
| `netAmount`                                                                   | **novo**: reais (`netAmountCents / 100`)                                             | já existia               |
| `frequencyType`                                                               | não se aplica (pagamento avulso)                                                     | já existia               |
| `cpf` / `cnpj`                                                                | fora do outbox por política (sem documento no payload); o receptor antigo não os usa | idem                     |

Os campos novos (`amountCents`, `netAmountCents`, `eventId`, `occurredAt`, `tracking`, `affiliate`, `items`, `offerId`, `chargeId`) permanecem sem alteração. Receptores do formato novo (ex.: Rastrewin) recebem o mesmo corpo de antes mais `planName`, `amountCharged` e `netAmount`. `chargeback`, `refund_requested`, `card_declined` e `pix_*` não ganham campos legados (o receptor antigo os ignora). Corpo montado por `legacyCompatFields` em `modules/offer/offer-legacy-webhook.ts`.

## Estorno parcial (contrato proposto, não implementado)

Plano: `plans/0024-estorno-parcial.md`. Valores em centavos no webhook assinado; o webhook não assinado do link usa reais e o token `x-simpay-token`, com os mesmos campos sem o sufixo `Cents` (`refundedAmount` etc.).

Estorno parcial gera `purchase_partially_refunded` e **não** revoga acesso. `purchase_refunded` continua sendo estorno total e é o evento que deve revogar acesso (junto com `chargeback`). A venda segue `COMPLETED` até o saldo estornável zerar.

Campos novos, em `purchase_partially_refunded` e em `purchase_refunded`:

| Campo                      | Significado                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| `refundedAmountCents`      | Valor bruto devolvido neste estorno.                                     |
| `refundedNetAmountCents`   | Parte do líquido do lojista revertida neste estorno.                     |
| `totalRefundedAmountCents` | Soma de todos os estornos da venda, incluindo este.                      |
| `remainingAmountCents`     | `amountCents` menos `totalRefundedAmountCents`.                          |
| `refundSequence`           | Número do estorno na venda (1, 2, 3…).                                   |
| `fullyRefunded`            | `false` em `purchase_partially_refunded`; `true` em `purchase_refunded`. |

`amountCents` e `netAmountCents` continuam sendo os valores originais da venda, não o saldo restante. O estorno que zera o saldo emite `purchase_refunded` (não `purchase_partially_refunded`). Estorno total feito de uma vez traz `refundSequence=1` e `refundedAmountCents` igual a `amountCents`.

Exemplo de `purchase_partially_refunded`:

```json
{
  "eventId": "9f2c…",
  "occurredAt": "2026-11-13T14:02:11.000Z",
  "event": "purchase_partially_refunded",
  "orderId": "b1c7e0a4-…",
  "linkId": "d3a9…",
  "amountCents": 10000,
  "netAmountCents": 9100,
  "refundedAmountCents": 2500,
  "refundedNetAmountCents": 2275,
  "totalRefundedAmountCents": 2500,
  "remainingAmountCents": 7500,
  "refundSequence": 1,
  "fullyRefunded": false,
  "paymentMethod": "PIX",
  "customerEmail": "cliente@exemplo.com",
  "customerName": "Maria",
  "phone": "+5511999999999",
  "tracking": {},
  "items": []
}
```

Quando a venda tem comissão de afiliado, `purchase_approved`, `purchase_refunded`, `chargeback` e
`refund_requested` incluem `"affiliate": { "code": "Ab3_xY9z", "commissionCents": 1000, "name": "Maria" }`
(`name` opcional). O campo não existe sem comissão (inclusive renovação com `commissionOnRenewals`
desmarcado) e nunca traz e-mail nem valores de terceiros.

Exemplo do `purchase_refunded` que fecha o total após o estorno acima (demais campos como no exemplo anterior):

```json
{
  "event": "purchase_refunded",
  "refundedAmountCents": 7500,
  "refundedNetAmountCents": 6825,
  "totalRefundedAmountCents": 10000,
  "remainingAmountCents": 0,
  "refundSequence": 2,
  "fullyRefunded": true
}
```

Idempotência: `eventId` de estorno parcial inclui `refundSequence`; reentrega do mesmo estorno repete o `eventId`, estornos distintos geram `eventId` distintos. O `eventId` do estorno total histórico não muda. Assinatura e ausência de CPF/documento/cartão como nos demais eventos. `refundedNetAmountCents` assume devolução proporcional ao bruto; confirmar com a Dom (MDR retido) antes de implementar.
