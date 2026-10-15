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

Configurar SIMPAY_CHECKOUT_URL, DOM_TOKEN da plataforma, WEBHOOK_SECRET, WEBHOOK_URL (para cobranças sem link), armazenamento e SMTP. Administrador deve liberar links:read/write em INBOUND_OPERATIONS. Configurar mesmo segredo na Central.

Migração 20261015000100_platform_sales_events foi preparada, não aplicada. Revisar e aplicar pelo processo normal antes de subir aplicação. Não há acesso a banco ou deploy nos testes novos: mocks e Bun. Validar adquirente/SMTP em homologação antes de operar.

Checkout consumidor precisa encaminhar tracking ao criar cobrança. Patch reproduzível está no repositório sim-produtos-digitais, integrations/checkout/tracking.patch. Cupons, bumps, assinaturas e afiliados permanecem fase futura.
