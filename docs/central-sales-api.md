# Central de produtos digitais — API de vendas

Contrato opt-in para plataformas com WEBHOOK_SECRET cifrado em PlatformIntegration. Dono e acquirer derivam do contexto autenticado; não são escolhidos pelo corpo.

- POST /platforms/:tag/links: escopo links:write, CreatePaymentLinkDto, idempotency-key obrigatório. Id do link estável por plataforma/chave; mínimo R$ 14,99, juros do comprador. Retorna data e checkoutUrl.
- GET/PATCH /platforms/:tag/links/:id: links:read/write, isolamento por dono + tag.
- POST /platforms/:tag/links/:id/files: links:write, multipart files, PDFs até 20 MB, no máximo 20 por envio. Hash no nome evita duplicidade de conteúdo reenviado.
- GET /platforms/:tag/pricing/simulation?amountCents=: reports:read. Mesma política de juros da criação canônica.
- POST /platforms/:tag/payments aceita linkId opcional. Quando presente, link precisa estar ativo, pertencer à plataforma e ter o mesmo valor; consulta devolve netAmountCents.
- Checkout PIX/cartão aceita tracking no corpo ou query: utm_*, src, fbclid, fbc, fbp. Allowlist e limite de 500 caracteres por valor. Não aceitar campos financeiros em tracking.
- GET /platforms/:tag/event-history?cursor=: events:read, páginas de 100 snapshots. SSE /events existente preservado.

Worker a cada 30 segundos reconstrói eventos a partir de estado/histórico financeiro. PlatformSalesEvent persiste payload/eventId, tentativas e conclusão de webhook/e-mail. HMAC-SHA256 hexadecimal do JSON exato em x-simintpay-signature. Nenhum CPF/documento/cartão no payload. Valores em centavos, calculados na transação. Retentativa com backoff e lease de dois minutos.

Eventos: purchase_approved, purchase_refunded, chargeback, refund_requested (mediação), card_declined, pix_generated (código/validade), pix_expired. E-mails com PDFs só após COMPLETED; histórico anterior à criação do segredo não reenvia e-mails antigos. Falha SMTP retenta; SMTP oferece entrega pelo menos uma vez, podendo repetir após interrupção entre envio e gravação.

Configurar SIMPAY_CHECKOUT_URL, WEBHOOK_SECRET, WEBHOOK_URL (para cobranças sem link), armazenamento e SMTP. Administrador deve liberar links:read/write em INBOUND_OPERATIONS. Configurar mesmo segredo na Central.

Migração 20261015000100_platform_sales_events foi preparada, não aplicada. Revisar e aplicar pelo processo normal antes de subir aplicação. Não há acesso a banco ou deploy nos testes novos: mocks e Bun. Validar adquirente/SMTP em homologação antes de operar.

Checkout consumidor precisa encaminhar tracking ao criar cobrança. Patch reproduzível está no repositório sim-produtos-digitais, integrations/checkout/tracking.patch. Cupons, bumps, assinaturas e afiliados permanecem fase futura.

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
