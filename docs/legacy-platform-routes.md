# Inventário dos contratos legados de plataformas

Registro de caracterização dos controllers existentes antes da unificação. Cada entrada registra contrato declarado, não execução de serviços externos. Paths sem prefixo global (`main.ts` não define prefixo). A coluna de operação equivalente conserva a família identificada na caracterização original. Mapeamento final dos 136 contratos ativos, rotas canônicas concretas e evidências comportamentais: [legacy-platform-equivalence.md](legacy-platform-equivalence.md). Oito proxies administrativos BetAI foram retirados por orientação explícita; inventário histórico original permanece com 144 entradas.

## Convenções preservadas

- GET/PUT: 200; POST: 201, salvo `@HttpCode` explícito. SSE: GET 200, `text/event-stream`. Setup desativado: 410. Erros financeiros/validação: 400; token inválido: 401; recurso ausente: 404. Exceções dos serviços e adquirentes seguem filtro global.
- Erro global: `{ statusCode, message, error, timestamp, path, correlationId }`; `message` pode ser string ou lista. Respostas externas Axios conservam HTTP status do adquirente. Não converter corpo de erro em resposta de sucesso.
- Guard global é `ThrottlerGuard`, não autenticação. Controllers sem guard/token são anônimos mesmo com `admin` no path. Preservar essa permissão somente nos aliases inventariados. APIs canônicas exigem autorização própria.
- `R$` significa reais decimais, não centavos. `price`, `amount`, `valor`, `balance`, `lockedBalance`, `fee`, `grossAmount`, `netAmount`, `netPayout` legados usam reais salvo contrato explicitamente `*Cents`. Taxas corporativas podem ser proporções ou percentuais: preservar unidade do serviço/DTO indicado; não converter por nome. APIs canônicas usam centavos inteiros e taxas decimais.
- Não normalizar indiscriminadamente envelopes, paginação, nomes portugueses, status string ou valores zero. Expressões de retorno abaixo identificam envelopes e delegações originais; schemas referenciados permanecem fonte do detalhe de campos/validação.
- Inputs indicam assinatura literal (incluindo opcionais/defaults). DTOs de classes passam pelo ValidationPipe global (whitelist, forbidNonWhitelisted, transform). Objetos TypeScript inline não fornecem validação de DTO em runtime.

## Autenticação legada

| Grupo | Credencial |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --- | -------------------------- | --- | ----------------------- |
| internal/atlas, renovada, pagatg, betai e reconciliação Renovada | `x-internal-token` = `API_MACHINE_INTERNAL_TOKEN                                      |     | INTERNAL_SERVICE_TOKEN` |
| internal/bosque, ebook, areaflix | `x-internal-token` = integração `INTERNAL_TOKEN` da plataforma correspondente |
| internal/integrations | `x-internal-token` = `SIM_DELIVERY_INTERNAL_TOKEN                                     |     | API_MACHINE_INTERNAL_TOKEN |     | INTERNAL_SERVICE_TOKEN` |
| payments corporativos, dashboards, mail e SSE | Anônimo; nenhum JwtAuthGuard declarado |
| Webhooks inventariados | Headers/payload conforme handler; ausência de guard não implica assinatura verificada |

Nenhum vínculo `INBOUND_TOKEN` deve ser inferido a partir dessas credenciais. Nunca registrar valores de tokens, cartão ou headers de autenticação em telemetria de aliases.

## Checkout compartilhado legado

`CheckoutPixDto`: `price:number >= 0.01` (R$), `document`, `document_type`, `email` válido, `name` obrigatórios; `mobile_phone?`, `description?`, `store?`. Cartão adiciona `holder_name`, `token`, `bin`, `brand` obrigatórios e `installments:number >= 1`. Não confundir `token` de cartão com autenticação da API. Atlas usa `description` para classificar DOMAIN/HOSTING.

## SSE

Atlas/Bosque/Renovada/Revalida: heartbeat imediato e cada 20s, evento `heartbeat`, data `{type:'heartbeat'}`; transações `new-transaction`, id `tx.id`, data transação; saques `new-withdrawal`, data saque. Atlas/Revalida id `w.id ?? 'withdrawal'`; Bosque/Renovada id `w.withdrawId ?? w.id ?? 'withdraw'`. Headers: `X-Accel-Buffering:no`, `Cache-Control:no-cache, no-store`, `Connection:keep-alive`. Preservar nomes, ids, frequência, anonimato legado e isolamento de plataforma.

## Rotas

### dashboard/atlas

Fonte: [src/modules/atlas/controllers/atlas-dashboard.controller.ts](../backend/src/modules/atlas/controllers/atlas-dashboard.controller.ts).

| Método / caminho                           | Auth    | Operação equivalente no núcleo | HTTP / unidade            |
| ------------------------------------------ | ------- | ------------------------------ | ------------------------- |
| GET `/dashboard/atlas/stats`               | anônimo | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| GET `/dashboard/atlas/sales`               | anônimo | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| GET `/dashboard/atlas/withdrawals`         | anônimo | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| GET `/dashboard/atlas/summary`             | anônimo | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| POST `/dashboard/atlas/setup`              | anônimo | `/platforms/:tag/maintenance`  | 410 / R$ quando monetário |
| POST `/dashboard/atlas/sync-external-user` | anônimo | `/platforms/:tag/sync`         | 201 / R$ quando monetário |
| POST `/dashboard/atlas/sync-full`          | anônimo | `/platforms/:tag/sync`         | 201 / R$ quando monetário |
| POST `/dashboard/atlas/wallet-balance`     | anônimo | `/platforms/:tag/maintenance`  | 201 / R$ quando monetário |
| POST `/dashboard/atlas/wallet-zerar`       | anônimo | `/platforms/:tag/maintenance`  | 201 / R$ quando monetário |

**`getStats`** (linha 18). Entrada: `@Query('period') period?: string`.

Retorno declarado: `this.dashboardService.getDashboardData(period)`.

**`getSales`** (linha 24). Entrada: `@Query('page') page?: string, @Query('limit') limit?: string`.

Retorno declarado: `this.dashboardService.getSales(Number(page ?? 1), Number(limit ?? 10))`.

**`getWithdrawals`** (linha 33). Entrada: `@Query('page') page?: string, @Query('limit') limit?: string`.

Retorno declarado: `this.dashboardService.getWithdrawals(Number(page ?? 1), Number(limit ?? 10))`.

**`getSummary`** (linha 42). Entrada: sem parâmetros.

Retorno declarado: `this.dashboardService.getSummary()`.

**`setup`** (linha 48). Entrada: sem parâmetros.

Retorno declarado: nenhum retorno; operação lança exceção.

Exceções no handler: `new GoneException('Cadastre a plataforma e atribua um dono existente pelo admin.')`. Exceções de serviços delegados também se propagam.

**`syncExternalUser`** (linha 54). Entrada: sem parâmetros.

Retorno declarado: `{ success: false, error: 'Plataforma não cadastrada com dono no admin' }`; ``{ success: false, error: `Usuário com id ${userId} não encontrado` }``; `{ success: true, externalUserId: extUser.id, userId: user.id, name: user.name, platform: 'atlas', balance, }`.

**`syncFull`** (linha 99). Entrada: sem parâmetros.

Retorno declarado: `this.syncService.syncFull()`.

**`setBalance`** (linha 105). Entrada: `@Body() data: { balance: number }`.

Retorno declarado: `this.syncService.setWalletBalance(data.balance)`.

**`zeroWallet`** (linha 111). Entrada: sem parâmetros.

Retorno declarado: `{ success: false, error: result.error }`; `{ success: true, message: result.alreadyZero === true ? 'Carteira Atlas já estava zerada.' : 'Carteira Atlas zerada.', userId: result.userId, balanceAntes: result.balanceBefore, lockedAntes: result.lockedBefore, alreadyZero: result.alreadyZero === true, }`.

### atlas/mail

Fonte: [src/modules/atlas/controllers/atlas-mail.controller.ts](../backend/src/modules/atlas/controllers/atlas-mail.controller.ts).

| Método / caminho             | Auth    | Operação equivalente no núcleo           | HTTP / unidade            |
| ---------------------------- | ------- | ---------------------------------------- | ------------------------- |
| POST `/atlas/mail/vm-access` | anônimo | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |

**`sendVmAccess`** (linha 11). Entrada: `@Body() body: SendVmAccessDto`.

Retorno declarado: `{ success: true, message: 'E-mail de acesso enviado com sucesso' }`.

### atlas/payments

Fonte: [src/modules/atlas/controllers/atlas-payment.controller.ts](../backend/src/modules/atlas/controllers/atlas-payment.controller.ts).

| Método / caminho                               | Auth    | Operação equivalente no núcleo | HTTP / unidade            |
| ---------------------------------------------- | ------- | ------------------------------ | ------------------------- |
| POST `/atlas/payments/pix`                     | anônimo | `/platforms/:tag/payments`     | 201 / R$ quando monetário |
| POST `/atlas/payments/credit-card`             | anônimo | `/platforms/:tag/payments`     | 201 / R$ quando monetário |
| GET `/atlas/payments/status/:paymentId`        | anônimo | `/platforms/:tag/payments`     | 200 / R$ quando monetário |
| GET `/atlas/payments/pix-status/:domPaymentId` | anônimo | `/platforms/:tag/payments`     | 200 / R$ quando monetário |

**`createPix`** (linha 24). Entrada: `@Body() body: CheckoutPixDto`.

Retorno declarado: `this.paymentService.createPaymentPix(await this.ownerUserId(), body)`.

**`createCreditCard`** (linha 30). Entrada: `@Body() body: CheckoutCreditCardDto`.

Retorno declarado: `this.paymentService.createPaymentCreditCard(await this.ownerUserId(), body)`.

**`checkStatus`** (linha 36). Entrada: `@Param('paymentId') paymentId: string`.

Retorno declarado: `{ paymentId, status: 'NOT_FOUND' }`; `{ paymentId: tx.domPaymentId, status: tx.status }`.

**`checkPixStatusDirect`** (linha 51). Entrada: `@Param('domPaymentId') domPaymentId: string`.

Retorno declarado: `this.paymentService.checkPixStatusDirect(domPaymentId)`.

### admin/atlas/real-time

Fonte: [src/modules/atlas/controllers/atlas-realtime.controller.ts](../backend/src/modules/atlas/controllers/atlas-realtime.controller.ts).

| Método / caminho                                | Auth    | Operação equivalente no núcleo | HTTP / unidade       |
| ----------------------------------------------- | ------- | ------------------------------ | -------------------- |
| GET (SSE) `/admin/atlas/real-time/transactions` | anônimo | `/platforms/:tag/events`       | 200 / payload legado |
| GET (SSE) `/admin/atlas/real-time/withdrawals`  | anônimo | `/platforms/:tag/events`       | 200 / payload legado |

**`sseTransactions`** (linha 21). Entrada: `@Res({ passthrough: true }) res: Response`.

Retorno declarado: `merge(heartbeat$, stream$)`.

**`sseWithdrawals`** (linha 30). Entrada: `@Res({ passthrough: true }) res: Response`.

Retorno declarado: `merge(heartbeat$, stream$)`.

### bosque/payments

Fonte: [src/modules/bosque/controllers/bosque-payment.controller.ts](../backend/src/modules/bosque/controllers/bosque-payment.controller.ts).

| Método / caminho                         | Auth    | Operação equivalente no núcleo | HTTP / unidade            |
| ---------------------------------------- | ------- | ------------------------------ | ------------------------- |
| POST `/bosque/payments/pix`              | anônimo | `/platforms/:tag/payments`     | 201 / R$ quando monetário |
| POST `/bosque/payments/credit-card`      | anônimo | `/platforms/:tag/payments`     | 201 / R$ quando monetário |
| GET `/bosque/payments/status/:paymentId` | anônimo | `/platforms/:tag/payments`     | 200 / R$ quando monetário |
| GET `/bosque/payments/test`              | anônimo | `/platforms/:tag/payments`     | 200 / R$ quando monetário |

**`createPix`** (linha 24). Entrada: `@Body() body: CheckoutPixDto`.

Retorno declarado: `this.paymentService.createPaymentPix(await this.ownerUserId(), body)`.

**`createCreditCard`** (linha 30). Entrada: `@Body() body: CheckoutCreditCardDto`.

Retorno declarado: `this.paymentService.createPaymentCreditCard(await this.ownerUserId(), body)`.

**`checkStatus`** (linha 36). Entrada: `@Param('paymentId') paymentId: string`.

Retorno declarado: `{ paymentId, status: 'PENDING' }`; `{ paymentId: tx.domPaymentId, status: tx.status }`.

**`test`** (linha 51). Entrada: sem parâmetros.

Retorno declarado: `{ message: '[BOSQUE] Payments API working', timestamp: new Date().toISOString(), environment: process.env.NODE_ENV \|\| 'development', module: 'Bosque', }`.

### admin/bosque/real-time

Fonte: [src/modules/bosque/controllers/bosque-realtime.controller.ts](../backend/src/modules/bosque/controllers/bosque-realtime.controller.ts).

| Método / caminho                                 | Auth    | Operação equivalente no núcleo | HTTP / unidade       |
| ------------------------------------------------ | ------- | ------------------------------ | -------------------- |
| GET (SSE) `/admin/bosque/real-time/transactions` | anônimo | `/platforms/:tag/events`       | 200 / payload legado |
| GET (SSE) `/admin/bosque/real-time/withdrawals`  | anônimo | `/platforms/:tag/events`       | 200 / payload legado |

**`sseTransactions`** (linha 21). Entrada: `@Res({ passthrough: true }) res: Response`.

Retorno declarado: `merge(heartbeat$, stream$)`.

**`sseWithdrawals`** (linha 30). Entrada: `@Res({ passthrough: true }) res: Response`.

Retorno declarado: `merge(heartbeat$, stream$)`.

### bosque/webhook

Fonte: [src/modules/bosque/controllers/bosque-webhook.controller.ts](../backend/src/modules/bosque/controllers/bosque-webhook.controller.ts).

| Método / caminho           | Auth    | Operação equivalente no núcleo | HTTP / unidade              |
| -------------------------- | ------- | ------------------------------ | --------------------------- |
| POST `/bosque/webhook/dom` | anônimo | `/platforms/:tag/webhooks`     | 200 / payload do adquirente |
| POST `/bosque/webhook`     | anônimo | `/platforms/:tag/webhooks`     | 200 / payload do adquirente |

**`domWebhook`** (linha 11). Entrada: `@Body() body: any`.

Retorno declarado: `await this.webhookService.processWebhook(body)`.

**`webhook`** (linha 18). Entrada: `@Body() body: any, @Headers() headers: Record<string, string>`.

Retorno declarado: `await this.webhookService.processWebhook(body)`.

Exceções no handler: `new Error('Assinatura inválida')`. Exceções de serviços delegados também se propagam.

### admin/plataformas/cliente

Fonte: [src/modules/cliente/cliente-dashboard.controller.ts](../backend/src/modules/cliente/cliente-dashboard.controller.ts).

| Método / caminho                           | Auth            | Operação equivalente no núcleo | HTTP / unidade            |
| ------------------------------------------ | --------------- | ------------------------------ | ------------------------- |
| GET `/admin/plataformas/cliente/dashboard` | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |

**`getDashboard`** (linha 12). Entrada: `@CurrentUser() user: JwtPayload, @Query('period') period = 'hoje'`.

Retorno declarado: `this.dashboard.getDashboardData(period, user)`.

### internal/integrations/:integrationKey/merchants/:externalMerchantId

Fonte: [src/modules/integrations/integration-finance.controller.ts](../backend/src/modules/integrations/integration-finance.controller.ts).

| Método / caminho                                                                                             | Auth             | Operação equivalente no núcleo | HTTP / unidade            |
| ------------------------------------------------------------------------------------------------------------ | ---------------- | ------------------------------ | ------------------------- |
| PUT `/internal/integrations/:integrationKey/merchants/:externalMerchantId`                                   | x-internal-token | `/platforms/:tag/finance`      | 200 / centavos            |
| POST `/internal/integrations/:integrationKey/merchants/:externalMerchantId/payments/pix`                     | x-internal-token | `/platforms/:tag/payments`     | 201 / R$ quando monetário |
| POST `/internal/integrations/:integrationKey/merchants/:externalMerchantId/payments/credit-card`             | x-internal-token | `/platforms/:tag/payments`     | 201 / R$ quando monetário |
| GET `/internal/integrations/:integrationKey/merchants/:externalMerchantId/payments/:paymentId`               | x-internal-token | `/platforms/:tag/payments`     | 200 / R$ quando monetário |
| GET `/internal/integrations/:integrationKey/merchants/:externalMerchantId/finance/summary`                   | x-internal-token | `/platforms/:tag/finance`      | 200 / centavos            |
| POST `/internal/integrations/:integrationKey/merchants/:externalMerchantId/finance/withdrawals/quote`        | x-internal-token | `/platforms/:tag/finance`      | 201 / centavos            |
| POST `/internal/integrations/:integrationKey/merchants/:externalMerchantId/finance/withdrawals`              | x-internal-token | `/platforms/:tag/finance`      | 201 / centavos            |
| GET `/internal/integrations/:integrationKey/merchants/:externalMerchantId/finance/withdrawals`               | x-internal-token | `/platforms/:tag/finance`      | 200 / centavos            |
| GET `/internal/integrations/:integrationKey/merchants/:externalMerchantId/finance/withdrawals/:withdrawalId` | x-internal-token | `/platforms/:tag/finance`      | 200 / centavos            |
| POST `/internal/integrations/:integrationKey/merchants/:externalMerchantId/finance/reconciliation/payments`  | x-internal-token | `/platforms/:tag/payments`     | 201 / R$ quando monetário |

**`provision`** (linha 20). Entrada: `@Param() params: { integrationKey: string; externalMerchantId: string }, @Body() body: { cnpj: string; legalName: string }, @Headers('x-internal-token') token?: string`.

Retorno declarado: `this.finance.provision(params.integrationKey, params.externalMerchantId, body)`.

**`pix`** (linha 26). Entrada: `@Param() params: { integrationKey: string; externalMerchantId: string }, @Body() body: CheckoutPixDto, @Headers('x-internal-token') token?: string`.

Retorno declarado: `this.payments.createPaymentPix(merchant.userId, body)`.

**`card`** (linha 33). Entrada: `@Param() params: { integrationKey: string; externalMerchantId: string }, @Body() body: CheckoutCreditCardDto, @Headers('x-internal-token') token?: string`.

Retorno declarado: `this.payments.createPaymentCreditCard(merchant.userId, body)`.

**`paymentStatus`** (linha 40). Entrada: `@Param() params: { integrationKey: string; externalMerchantId: string; paymentId: string }, @Headers('x-internal-token') token?: string`.

Retorno declarado: `this.reconcilePayments.reconcilePayment(params.paymentId, merchant.userId, (getPlatformIntegrationValue('ZERO-GRAU', 'DOM_TOKEN') ?? undefined))`.

**`summary`** (linha 49). Entrada: `@Param() params: { integrationKey: string; externalMerchantId: string }, @Headers('x-internal-token') token?: string`.

Retorno declarado: `this.finance.summary(params.integrationKey, params.externalMerchantId)`.

**`quote`** (linha 55). Entrada: `@Body() body: { grossAmountCents: number }, @Headers('x-internal-token') token?: string`.

Retorno declarado: `this.finance.quote(body.grossAmountCents)`.

**`withdraw`** (linha 61). Entrada: `@Param() params: { integrationKey: string; externalMerchantId: string }, @Body() body: { grossAmountCents: number; pixKey: string; requestId: string }, @Headers('x-internal-token') token?: string`.

Retorno declarado: `this.finance.requestWithdrawal(params.integrationKey, params.externalMerchantId, body)`.

**`withdrawals`** (linha 67). Entrada: `@Param() params: { integrationKey: string; externalMerchantId: string }, @Query('page') page = '1', @Query('pageSize') pageSize = '10', @Headers('x-internal-token') token?: string`.

Retorno declarado: `this.finance.listWithdrawals(params.integrationKey, params.externalMerchantId, Number(page), Number(pageSize))`.

**`withdrawal`** (linha 73). Entrada: `@Param() params: { integrationKey: string; externalMerchantId: string; withdrawalId: string }, @Headers('x-internal-token') token?: string`.

Retorno declarado: `this.finance.getWithdrawal(params.integrationKey, params.externalMerchantId, params.withdrawalId)`.

**`reconcile`** (linha 79). Entrada: `@Param() params: { integrationKey: string; externalMerchantId: string }, @Body() body: { dryRun?: boolean; paymentIds: string[] }, @Headers('x-internal-token') token?: string`.

Retorno declarado: `this.finance.reconcilePayments(params.integrationKey, params.externalMerchantId, body.paymentIds ?? [], body.dryRun !== false)`.

### webhook

Fonte: [src/modules/master/controllers/master-webhook.controller.ts](../backend/src/modules/master/controllers/master-webhook.controller.ts).

| Método / caminho       | Auth    | Operação equivalente no núcleo | HTTP / unidade              |
| ---------------------- | ------- | ------------------------------ | --------------------------- |
| POST `/webhook/master` | anônimo | `/platforms/:tag/webhooks`     | 200 / payload do adquirente |

**`handle`** (linha 17). Entrada: `@Body() body: unknown`.

Retorno declarado: `{ status: 'ok' }`.

### pagatg/webhook

Fonte: [src/modules/pagatg/pagatg-webhook.controller.ts](../backend/src/modules/pagatg/pagatg-webhook.controller.ts).

| Método / caminho           | Auth    | Operação equivalente no núcleo | HTTP / unidade              |
| -------------------------- | ------- | ------------------------------ | --------------------------- |
| POST `/pagatg/webhook/dom` | anônimo | `/platforms/:tag/webhooks`     | 200 / payload do adquirente |
| POST `/pagatg/webhook`     | anônimo | `/platforms/:tag/webhooks`     | 200 / payload do adquirente |

**`domWebhook`** (linha 15). Entrada: `@Body() body: unknown`.

Retorno declarado: `{ status: 'ok' }`.

**`webhook`** (linha 22). Entrada: `@Body() body: unknown`.

Retorno declarado: `{ status: 'ok' }`.

### admin/plataformas

Fonte: [src/modules/renovada/controllers/renovada-dashboard.controller.ts](../backend/src/modules/renovada/controllers/renovada-dashboard.controller.ts).

| Método / caminho                             | Auth    | Operação equivalente no núcleo | HTTP / unidade            |
| -------------------------------------------- | ------- | ------------------------------ | ------------------------- |
| GET `/admin/plataformas/:tag/dashboard`      | anônimo | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/:tag/saques`         | anônimo | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/:tag/seller-stats`   | anônimo | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/:tag/sellers-ativos` | anônimo | `/platforms/:tag/reports`      | 200 / R$ quando monetário |

**`getStats`** (linha 35). Entrada: `@Param('tag') tag: string, @Query('period') period?: string, @Query('dataInicio') dataInicio?: string, @Query('dataFim') dataFim?: string`.

Retorno declarado: `this.dashboardService.getDashboardData(tag, period, dataInicio, dataFim)`.

**`getSaques`** (linha 46). Entrada: `@Param('tag') tag: string, @Query('dataInicio') dataInicio?: string, @Query('dataFim') dataFim?: string`.

Retorno declarado: `this.dashboardService.getSaquesDetalhados(tag, dataInicio, dataFim)`.

**`getSellerStats`** (linha 58). Entrada: `@Param('tag') tag: string`.

Retorno declarado: `{ totalContas: 0, sellersAtivos: 0 }`; `res.json() as Promise<{ totalContas: number; sellersAtivos: number }>`; `{ totalContas: clientesTotais.length, sellersAtivos: assinantesAtivos.length }`; `this.platformReporting.getCommunityCustomerStats( upperTag, community.id, )`.

**`getActiveSellers`** (linha 126). Entrada: `@Param('tag') tag: string, @Query('page') page = '1', @Query('pageSize') pageSize = '20', @Query('apenasAtivos') apenasAtivos = 'true', @Query('fonteSaldo') fonteSaldo?: string`.

Retorno declarado: `empty`; `{ data: paged.map((o) => ({ name: o.customerName, email: o.customerEmail, cpf: o.customerDocument, balance: Number(walletMap.get(o.customerEmail)?.balance ?? 0), lockedBalance: Number(walletMap.get(o.customerEmail)?.lockedBalance ?? 0), createdAt: o.createdAt, })), total, page: pageNum, pageSize: size, }`; `{ data: ebookUsers.map((u: any) => ({ name: u.name ?? '', email: u.email ?? '', cpf: u.cpf ?? '', balance: Number(walletMap.get(u.cpf)?.balance ?? 0), lockedBalance: Number(walletMap.get(u.cpf)?.lockedBalance ?? 0), createdAt: u.createdAt, })), total, page: pageNum, pageSize: size, }`; `this.platformReporting.listCommunityCustomers( upperTag, community.id, { page: pageNum, pageSize: size, onlyActive: somenteAtivos }, )`; `{ data: paged.map((o) => ({ name: o.customerName, email: o.customerEmail, cpf: o.customerDocument, balance: Number(o.amountCharged) - Number(o.platformFeeAmount), lockedBalance: 0, createdAt: o.createdAt, })), total, page: pageNum, pageSize: size, }`; `res.json() as Promise<{ data: any[]; total: number; page: number; pageSize: number }>`; `{ data: [ { name: owner.name ?? upperTag, email: owner.email ?? '', cpf: owner.cpf ?? '', balance: Number(Math.max(0, disponivel).toFixed(2)), lockedBalance: Number(wallet?.lockedBalance ?? 0), createdAt: owner.createdAt, }, ], total: 1, page: pageNum, pageSize: size, }`; `{ data: extUsers.map((u) => ({ name: u.user?.name ?? u.name, email: u.user?.email ?? '', cpf: u.user?.cpf ?? u.cpf, balance: Number(u.wallet?.balance ?? 0), lockedBalance: Number(u.wallet?.lockedBalance ?? 0), createdAt: u.user?.createdAt ?? u.createdAt, })), total, page: pageNum, pageSize: size, }`.

### renovada/payments

Fonte: [src/modules/renovada/controllers/renovada-payment.controller.ts](../backend/src/modules/renovada/controllers/renovada-payment.controller.ts).

| Método / caminho                           | Auth    | Operação equivalente no núcleo | HTTP / unidade            |
| ------------------------------------------ | ------- | ------------------------------ | ------------------------- |
| POST `/renovada/payments/pix`              | anônimo | `/platforms/:tag/payments`     | 201 / R$ quando monetário |
| POST `/renovada/payments/credit-card`      | anônimo | `/platforms/:tag/payments`     | 201 / R$ quando monetário |
| GET `/renovada/payments/status/:paymentId` | anônimo | `/platforms/:tag/payments`     | 200 / R$ quando monetário |
| GET `/renovada/payments/test`              | anônimo | `/platforms/:tag/payments`     | 200 / R$ quando monetário |

**`createPix`** (linha 24). Entrada: `@Body() body: CheckoutPixDto`.

Retorno declarado: `this.paymentService.createPaymentPix(await this.ownerUserId(), body)`.

**`createCreditCard`** (linha 30). Entrada: `@Body() body: CheckoutCreditCardDto`.

Retorno declarado: `this.paymentService.createPaymentCreditCard(await this.ownerUserId(), body)`.

**`checkStatus`** (linha 36). Entrada: `@Param('paymentId') paymentId: string`.

Retorno declarado: `{ paymentId, status: 'PENDING' }`; `{ paymentId: tx.domPaymentId, status: tx.status }`.

**`test`** (linha 51). Entrada: sem parâmetros.

Retorno declarado: `{ message: '[RENOVADA] Payments API working', timestamp: new Date().toISOString(), environment: process.env.NODE_ENV \|\| 'development', module: 'Renovada', }`.

### admin/renovada/real-time

Fonte: [src/modules/renovada/controllers/renovada-realtime.controller.ts](../backend/src/modules/renovada/controllers/renovada-realtime.controller.ts).

| Método / caminho                                   | Auth    | Operação equivalente no núcleo | HTTP / unidade       |
| -------------------------------------------------- | ------- | ------------------------------ | -------------------- |
| GET (SSE) `/admin/renovada/real-time/transactions` | anônimo | `/platforms/:tag/events`       | 200 / payload legado |
| GET (SSE) `/admin/renovada/real-time/withdrawals`  | anônimo | `/platforms/:tag/events`       | 200 / payload legado |

**`sseTransactions`** (linha 21). Entrada: `@Res({ passthrough: true }) res: Response`.

Retorno declarado: `merge(heartbeat$, stream$)`.

**`sseWithdrawals`** (linha 30). Entrada: `@Res({ passthrough: true }) res: Response`.

Retorno declarado: `merge(heartbeat$, stream$)`.

### renovada/webhook

Fonte: [src/modules/renovada/controllers/renovada-webhook-new.controller.ts](../backend/src/modules/renovada/controllers/renovada-webhook-new.controller.ts).

| Método / caminho             | Auth    | Operação equivalente no núcleo | HTTP / unidade              |
| ---------------------------- | ------- | ------------------------------ | --------------------------- |
| POST `/renovada/webhook/dom` | anônimo | `/platforms/:tag/webhooks`     | 200 / payload do adquirente |
| POST `/renovada/webhook`     | anônimo | `/platforms/:tag/webhooks`     | 200 / payload do adquirente |

**`domWebhook`** (linha 17). Entrada: `@Body() body: unknown`.

Retorno declarado: `{ status: 'ok' }`.

**`webhook`** (linha 24). Entrada: `@Body() body: unknown`.

Retorno declarado: `{ status: 'ok' }`.

### webhook

Fonte: [src/modules/renovada/controllers/renovada-webhook.controller.ts](../backend/src/modules/renovada/controllers/renovada-webhook.controller.ts).

| Método / caminho         | Auth    | Operação equivalente no núcleo | HTTP / unidade              |
| ------------------------ | ------- | ------------------------------ | --------------------------- |
| POST `/webhook/renovada` | anônimo | `/platforms/:tag/webhooks`     | 200 / payload do adquirente |

**`handle`** (linha 17). Entrada: `@Body() body: unknown`.

Retorno declarado: `{ status: 'ok' }`.

### dashboard/revalida

Fonte: [src/modules/revalida/controllers/revalida-dashboard.controller.ts](../backend/src/modules/revalida/controllers/revalida-dashboard.controller.ts).

| Método / caminho                              | Auth    | Operação equivalente no núcleo | HTTP / unidade            |
| --------------------------------------------- | ------- | ------------------------------ | ------------------------- |
| GET `/dashboard/revalida/stats`               | anônimo | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| GET `/dashboard/revalida/sales`               | anônimo | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| GET `/dashboard/revalida/withdrawals`         | anônimo | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| GET `/dashboard/revalida/summary`             | anônimo | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| POST `/dashboard/revalida/setup`              | anônimo | `/platforms/:tag/maintenance`  | 410 / R$ quando monetário |
| POST `/dashboard/revalida/sync-external-user` | anônimo | `/platforms/:tag/sync`         | 201 / R$ quando monetário |
| POST `/dashboard/revalida/sync-full`          | anônimo | `/platforms/:tag/sync`         | 201 / R$ quando monetário |
| POST `/dashboard/revalida/wallet-balance`     | anônimo | `/platforms/:tag/maintenance`  | 201 / R$ quando monetário |
| POST `/dashboard/revalida/wallet-zerar`       | anônimo | `/platforms/:tag/maintenance`  | 201 / R$ quando monetário |

**`getStats`** (linha 18). Entrada: `@Query('period') period?: string`.

Retorno declarado: `this.dashboardService.getDashboardData(period)`.

**`getSales`** (linha 24). Entrada: `@Query('page') page?: string, @Query('limit') limit?: string`.

Retorno declarado: `this.dashboardService.getSales(Number(page ?? 1), Number(limit ?? 10))`.

**`getWithdrawals`** (linha 33). Entrada: `@Query('page') page?: string, @Query('limit') limit?: string`.

Retorno declarado: `this.dashboardService.getWithdrawals(Number(page ?? 1), Number(limit ?? 10))`.

**`getSummary`** (linha 42). Entrada: sem parâmetros.

Retorno declarado: `this.dashboardService.getSummary()`.

**`setup`** (linha 48). Entrada: sem parâmetros.

Retorno declarado: nenhum retorno; operação lança exceção.

Exceções no handler: `new GoneException('Cadastre a plataforma e atribua um dono existente pelo admin.')`. Exceções de serviços delegados também se propagam.

**`syncExternalUser`** (linha 54). Entrada: sem parâmetros.

Retorno declarado: `{ success: false, error: 'Plataforma não cadastrada com dono no admin' }`; ``{ success: false, error: `Usuário com id ${userId} não encontrado` }``; `{ success: true, externalUserId: extUser.id, userId: user.id, name: user.name, platform: 'revalida', balance, }`.

**`syncFull`** (linha 109). Entrada: sem parâmetros.

Retorno declarado: `this.syncService.syncFull()`.

**`setBalance`** (linha 115). Entrada: `@Body() data: { balance: number }`.

Retorno declarado: `this.syncService.setWalletBalance(data.balance)`.

**`zeroWallet`** (linha 121). Entrada: sem parâmetros.

Retorno declarado: `{ success: false, error: result.error }`; `{ success: true, message: result.alreadyZero === true ? 'Carteira Revalida já estava zerada (ExternalPlatformWallet alinhada).' : 'Carteira Revalida zerada.', userId: result.userId, balanceAntes: result.balanceBefore, lockedAntes: result.lockedBefore, alreadyZero: result.alreadyZero === true, }`.

### admin/revalida/real-time

Fonte: [src/modules/revalida/controllers/revalida-realtime.controller.ts](../backend/src/modules/revalida/controllers/revalida-realtime.controller.ts).

| Método / caminho                                   | Auth    | Operação equivalente no núcleo | HTTP / unidade       |
| -------------------------------------------------- | ------- | ------------------------------ | -------------------- |
| GET (SSE) `/admin/revalida/real-time/transactions` | anônimo | `/platforms/:tag/events`       | 200 / payload legado |
| GET (SSE) `/admin/revalida/real-time/withdrawals`  | anônimo | `/platforms/:tag/events`       | 200 / payload legado |

**`sseTransactions`** (linha 21). Entrada: `@Res({ passthrough: true }) res: Response`.

Retorno declarado: `merge(heartbeat$, stream$)`.

**`sseWithdrawals`** (linha 30). Entrada: `@Res({ passthrough: true }) res: Response`.

Retorno declarado: `merge(heartbeat$, stream$)`.

### zero-grau/payments

Fonte: [src/modules/zero-grau/controllers/zero-grau-payment.controller.ts](../backend/src/modules/zero-grau/controllers/zero-grau-payment.controller.ts).

| Método / caminho                                   | Auth    | Operação equivalente no núcleo | HTTP / unidade            |
| -------------------------------------------------- | ------- | ------------------------------ | ------------------------- |
| POST `/zero-grau/payments/pix`                     | anônimo | `/platforms/:tag/payments`     | 201 / R$ quando monetário |
| POST `/zero-grau/payments/credit-card`             | anônimo | `/platforms/:tag/payments`     | 201 / R$ quando monetário |
| GET `/zero-grau/payments/status/:paymentId`        | anônimo | `/platforms/:tag/payments`     | 200 / R$ quando monetário |
| GET `/zero-grau/payments/pix-status/:domPaymentId` | anônimo | `/platforms/:tag/payments`     | 200 / R$ quando monetário |

**`createPix`** (linha 24). Entrada: `@Body() body: CheckoutPixDto`.

Retorno declarado: `this.paymentService.createPaymentPix(this.zeroGrauUserId, body)`.

**`createCreditCard`** (linha 30). Entrada: `@Body() body: CheckoutCreditCardDto`.

Retorno declarado: `this.paymentService.createPaymentCreditCard(this.zeroGrauUserId, body)`.

**`checkStatus`** (linha 36). Entrada: `@Param('paymentId') paymentId: string`.

Retorno declarado: `this.reconcile.reconcilePayment(paymentId, this.zeroGrauUserId, (getPlatformIntegrationValue('ZERO-GRAU', 'DOM_TOKEN') ?? undefined))`.

**`checkPixStatusDirect`** (linha 43). Entrada: `@Param('domPaymentId') domPaymentId: string`.

Retorno declarado: `this.paymentService.checkPixStatusDirect(domPaymentId)`.

### admin

Fonte: [src/presentation/controllers/admin.controller.ts](../backend/src/presentation/controllers/admin.controller.ts).

| Método / caminho                                        | Auth            | Operação equivalente no núcleo | HTTP / unidade            |
| ------------------------------------------------------- | --------------- | ------------------------------ | ------------------------- |
| GET `/admin/plataformas/saldos-resumo`                  | anônimo         | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/taxas`                          | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| PATCH `/admin/plataformas/taxas/:tag`                   | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/simintpay-clientes`             | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/taxas/:tag`                     | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/minhas-taxas`                   | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/plataformas`                                | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/:tag/comunidades`               | anônimo         | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/atlas/breakdown`                | anônimo         | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/:tag/distribuicao-metodo`       | anônimo         | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/:tag/transacoes`                | anônimo         | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/plataformas/:tag/usuarios`                  | anônimo         | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| PATCH `/admin/plataformas/:tag/usuarios/:userId/toggle` | anônimo         | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/admin/relatorios/plataforma-consolidado`          | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |

**`getPlataformasSaldosResumo`** (linha 3537). Entrada: sem parâmetros.

Retorno declarado: `{ resumo }`.

**`listPlatformTaxas`** (linha 5536). Entrada: sem parâmetros.

Retorno declarado: `this.platformTaxas.getTaxasResponse()`.

**`patchPlatformTaxas`** (linha 5546). Entrada: `@Param('tag') tag: string, @Body() body: Record<string, unknown>`.

Retorno declarado: `this.platformTaxas.patchPlatform(tag, body)`.

**`listSimIntPayClientes`** (linha 5560). Entrada: `@Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string`.

Retorno declarado: `{ data, page: pageNum, pageSize: size, hasMore }`.

**`getPlatformTaxasByTag`** (linha 6152). Entrada: `@Param('tag') tag: string`.

Retorno declarado: `this.platformTaxas.getTaxasResponse([tag])`.

**`getMinhasTaxas`** (linha 6161). Entrada: `@CurrentUser() user: JwtPayload \| undefined`.

Retorno declarado: `{ email: u.email, platform: slug ? slug.toUpperCase() : 'SIM INT PAY', data: resolved.data, }`.

Exceções no handler: `new BadRequestException('Usuário não autenticado')`; `new BadRequestException('Usuário não encontrado')`. Exceções de serviços delegados também se propagam.

**`listPlataformas`** (linha 6191). Entrada: sem parâmetros.

Retorno declarado: ``{ data: await Promise.all(platforms.map(async (platform) => ({ ...platform, cpf: platform.owner.cpf ?? platform.owner.cnpj ?? '', firstSeen: platform.createdAt, plansCount: await this.prisma.pixCreditPlan.count({ where: { tenantTag: platform.tag } }), transactionsCount: await this.prisma.transaction.count({ where: { description: { contains: `[TENANT:${platform.tag}]`, mode: 'insensitive' }, } }), }))) }``.

**`listPlataformaComunidades`** (linha 6215). Entrada: `@Param('tag') tag: string`.

Retorno declarado: `{ data: [] }`; `{ data: Array.from(communityMap.values()) }`.

**`getAtlasBreakdown`** (linha 6293). Entrada: `@Query('dataInicio') dataInicio?: string, @Query('dataFim') dataFim?: string`.

Retorno declarado: `{ clientesUnicos: uniqueEmails.size, dominios: calcGroup(domainTxs), hospedagem: { ...calcGroup(hostTxs), porProduto: Array.from(byProduct.entries()).map(([nome, s]) => ({ nome, ...s })).sort((a, b) => b.receita - a.receita), }, outros: calcGroup(otherTxs), }`.

**`getPlataformaDistribuicaoMetodo`** (linha 6364). Entrada: `@Param('tag') tag: string, @Query('dataInicio') dataInicio?: string, @Query('dataFim') dataFim?: string`.

Retorno declarado: `this.platformReporting.getCommunityPaymentDistribution( upperTag, commDist.id, { start: dataInicio ? parseYmdSp(dataInicio).startOf('day').toDate() : undefined, end: dataFim ? parseYmdSp(dataFim).endOf('day').toDate() : undefined, }, )`; `{ total, items }`.

**`listPlataformaTransacoes`** (linha 6453). Entrada: `@Param('tag') tag: string, @Query('page') page = '1', @Query('pageSize') pageSize = '20', @Query('status') status?: string, @Query('dataInicio') dataInicio?: string, @Query('dataFim') dataFim?: string, @Query('codigoTransacao') codigoTransacao?: string, @Query('codigoReferencia') codigoReferencia?: string, @Query('compradorNome') compradorNome?: string, @Query('compradorDocumento') compradorDocumento?: string, @Query('compradorEmail') compradorEmail?: string, @Query('periodType') periodType?: string, @Query('tipoTransacao') tipoTransacao?: string, @Query('metodoPagamento') metodoPagamento?: string`.

Retorno declarado: `{ data, page: pageNum, pageSize: size, total }`.

**`listPlataformaUsuarios`** (linha 7219). Entrada: `@Param('tag') tag: string, @Query('status') status = 'all', @Query('page') page = '1', @Query('limit') limit = '20'`.

Retorno declarado: `{ users, total, page: pageNum, pageSize, totalPages: Math.ceil(total / pageSize) }`.

Exceções no handler: ``new NotFoundException(`Plataforma ${tag} não suporta listagem de usuários`)``. Exceções de serviços delegados também se propagam.

**`togglePlataformaUsuario`** (linha 7269). Entrada: `@Param('tag') tag: string, @Param('userId') userId: string`.

Retorno declarado: `{ toggled: true, isActive: updated.isActive, remainingDays: this.calcRemainingDays(updated.expiresAt, updated.frozenDays, updated.isActive), frozenDays: updated.frozenDays, expiresAt: updated.expiresAt, }`.

Exceções no handler: ``new NotFoundException(`Plataforma ${tag} não suporta toggle de usuários`)``; `new NotFoundException('Assinante não encontrado')`; `new Error('Não há dias guardados para retomar')`. Exceções de serviços delegados também se propagam.

**`getPlataformaConsolidado`** (linha 7426). Entrada: `@Query('tag') tagParam?: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string, @Query('metodoPagamento') metodoPagamento?: string, allowAtlasInternally = false`.

Retorno declarado: `{ error: 'Use /admin/relatorios/atlas-consolidado for ATLAS' }`; `breakdown`.

### admin/betai — removido

Oito aliases removidos por solicitação explícita do usuário: sistema fora do ar e endpoints upstream `/internal/mensalidade/*` inexistentes. Sem substituto canônico; rotas deixam de ser registradas (404). Tabela e contratos abaixo são somente registro histórico, não APIs disponíveis. Controller original: `src/presentation/controllers/betai-admin.controller.ts` (removido).

| Método / caminho                       | Auth            | Operação equivalente no núcleo | HTTP / unidade            |
| -------------------------------------- | --------------- | ------------------------------ | ------------------------- |
| GET `/admin/betai/mensalidades`        | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| POST `/admin/betai/mensalidades/run`   | guard explícito | `/platforms/:tag/finance`      | 201 / R$ quando monetário |
| GET `/admin/betai/cobranca`            | guard explícito | `/platforms/:tag/payments`     | 200 / R$ quando monetário |
| PUT `/admin/betai/cobranca`            | guard explícito | `/platforms/:tag/payments`     | 200 / R$ quando monetário |
| GET `/admin/betai/investors`           | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| POST `/admin/betai/cobrar`             | guard explícito | `/platforms/:tag/finance`      | 201 / R$ quando monetário |
| PATCH `/admin/betai/mensalidades/:id`  | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| DELETE `/admin/betai/mensalidades/:id` | guard explícito | `/platforms/:tag/finance`      | 200 / R$ quando monetário |

**`mensalidades`** (linha 39). Entrada: sem parâmetros.

Retorno declarado: `resp.json()`.

Exceções no handler: `new InternalServerErrorException('BETAI_URL não configurado no api-machine')`; ``new InternalServerErrorException(`Betai respondeu ${resp.status}`)``. Exceções de serviços delegados também se propagam.

**`run`** (linha 53). Entrada: sem parâmetros.

Retorno declarado: `resp.json()`.

Exceções no handler: `new InternalServerErrorException('BETAI_URL não configurado no api-machine')`; ``new InternalServerErrorException(`Betai respondeu ${resp.status}`)``. Exceções de serviços delegados também se propagam.

**`cobranca`** (linha 68). Entrada: sem parâmetros.

Retorno declarado: `resp.json()`.

Exceções no handler: `new InternalServerErrorException('BETAI_URL não configurado no api-machine')`; ``new InternalServerErrorException(`Betai respondeu ${resp.status}`)``. Exceções de serviços delegados também se propagam.

**`saveCobranca`** (linha 80). Entrada: `@Body() body: unknown`.

Retorno declarado: `resp.json()`.

Exceções no handler: `new InternalServerErrorException('BETAI_URL não configurado no api-machine')`; ``new InternalServerErrorException(`Betai respondeu ${resp.status}`)``. Exceções de serviços delegados também se propagam.

**`investors`** (linha 94). Entrada: `@Query('q') q: string`.

Retorno declarado: `resp.json()`.

Exceções no handler: `new InternalServerErrorException('BETAI_URL não configurado no api-machine')`; ``new InternalServerErrorException(`Betai respondeu ${resp.status}`)``. Exceções de serviços delegados também se propagam.

**`cobrar`** (linha 106). Entrada: `@Body() body: unknown`.

Retorno declarado: `resp.json()`.

Exceções no handler: `new InternalServerErrorException('BETAI_URL não configurado no api-machine')`; ``new InternalServerErrorException(`Betai respondeu ${resp.status}`)``. Exceções de serviços delegados também se propagam.

**`editMensalidade`** (linha 120). Entrada: `@Param('id') id: string, @Body() body: unknown`.

Retorno declarado: `resp.json()`.

Exceções no handler: `new InternalServerErrorException('BETAI_URL não configurado no api-machine')`; ``new InternalServerErrorException(`Betai respondeu ${resp.status}`)``. Exceções de serviços delegados também se propagam.

**`deleteMensalidade`** (linha 134). Entrada: `@Param('id') id: string`.

Retorno declarado: `resp.json()`.

Exceções no handler: `new InternalServerErrorException('BETAI_URL não configurado no api-machine')`; ``new InternalServerErrorException(`Betai respondeu ${resp.status}`)``. Exceções de serviços delegados também se propagam.

### webhook/frendz

Fonte: [src/presentation/controllers/frendz-webhook.controller.ts](../backend/src/presentation/controllers/frendz-webhook.controller.ts).

| Método / caminho       | Auth                     | Operação equivalente no núcleo | HTTP / unidade              |
| ---------------------- | ------------------------ | ------------------------------ | --------------------------- |
| POST `/webhook/frendz` | token Frendz condicional | `/platforms/:tag/webhooks`     | 200 / payload do adquirente |

**`handle`** (linha 49). Entrada: `@Body() body: Record<string, unknown>, @Headers('x-webhook-token') tokenHeader: string \| undefined`.

Retorno declarado: `{ status: 'ignored' }`; `{ status: 'ok' }`.

### internal/areaflix/finance

Fonte: [src/presentation/controllers/internal-areaflix-finance.controller.ts](../backend/src/presentation/controllers/internal-areaflix-finance.controller.ts).

| Método / caminho                                    | Auth             | Operação equivalente no núcleo           | HTTP / unidade            |
| --------------------------------------------------- | ---------------- | ---------------------------------------- | ------------------------- |
| GET `/internal/areaflix/finance/wallet`             | x-internal-token | `/platforms/:tag/finance`                | 200 / R$ quando monetário |
| GET `/internal/areaflix/finance/account`            | x-internal-token | `/platforms/:tag/finance`                | 200 / R$ quando monetário |
| GET `/internal/areaflix/finance/withdrawals`        | x-internal-token | `/platforms/:tag/finance`                | 200 / R$ quando monetário |
| GET `/internal/areaflix/finance/withdrawals/totals` | x-internal-token | `/platforms/:tag/finance`                | 200 / R$ quando monetário |
| POST `/internal/areaflix/finance/claim-links`       | x-internal-token | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |
| POST `/internal/areaflix/finance/withdraw`          | x-internal-token | `/platforms/:tag/finance`                | 201 / R$ quando monetário |

**`wallet`** (linha 68). Entrada: `@Query('cpf') cpf: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ accountExists: false, balance: 0, lockedBalance: 0, availableBalance: 0 }`; `{ accountExists: true, balance: Number(balance.toFixed(2)), lockedBalance: Number(locked.toFixed(2)), availableBalance: Number(Math.max(0, balance - locked).toFixed(2)), }`.

**`accountStatus`** (linha 95). Entrada: `@Query('cpf') cpf: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ accountExists: userIds.length > 0, minimumWithdrawalAmount: areaflixWithdrawMin(), withdrawalFeeBrl: areaflixWithdrawFee(), }`.

**`withdrawals`** (linha 109). Entrada: `@Query('cpf') cpf: string, @Query('page') page = '1', @Query('limit') limit = '20', @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ withdrawals: [], meta: { currentPage: 1, itemsPerPage: 20, totalItems: 0, totalPages: 1 } }`; `{ withdrawals: items.map((w) => ({ id: w.id, amount: Number(w.amount), grossAmount: Number(w.grossAmount), fee: Number(w.fee), status: w.status, pixKey: w.pixKey, rejectionReason: w.rejectionReason ?? null, createdAt: w.createdAt, updatedAt: w.updatedAt, })), meta: { currentPage: pageNum, itemsPerPage: size, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / size)), }, }`.

**`withdrawalTotals`** (linha 158). Entrada: `@Query('cpf') cpf: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ pendingGross: 0, completedGross: 0 }`; `{ pendingGross: Number(pending._sum.grossAmount ?? 0), completedGross: Number(completed._sum.grossAmount ?? 0), }`.

**`claimLinks`** (linha 191). Entrada: `@Body() body: { cpf: string; paymentLinkIds?: string[]; subscriptionLinkIds?: string[]; /** Saldo líquido acumulado antes do vínculo — transferido da conta de serviço para o admin (uma única vez). */ retroactiveAmount?: number; /** Email da conta de serviço da areaflix (dona original dos links/saldo). */ serviceAccountEmail?: string; /** Nome do admin areaflix — exibido na tela de donos por CPF (Leads). */ adminName?: string; }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ claimed: false, reason: 'Nenhuma conta simpay para este CPF/CNPJ' }`; `{ claimed: true, targetUserId, transferred: { paymentLinks, subscriptionLinks, orders, transactions }, retroactiveTransferred, }`.

**`requestWithdraw`** (linha 410). Entrada: `@Body() body: { cpf: string; amount: number; pixKey: string }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, id: created.id }`.

Exceções no handler: `new BadRequestException('Nenhuma conta simintpay encontrada para este CPF/CNPJ')`; `new BadRequestException('Valor inválido')`; ``new BadRequestException(`Valor mínimo para saque é de R$ ${areaflixWithdrawMin().toFixed(2)}`)``; `new BadRequestException('Chave PIX é obrigatória')`; `new BadRequestException('Já existe uma solicitação de saque em andamento. Aguarde a conclusão.')`; ``new BadRequestException( `Valor insuficiente para cobrir a taxa de saque (R$ ${areaflixWithdrawFee().toFixed(2)})`, )``; ``new BadRequestException( `Saldo insuficiente na carteira simintpay. Disponível: R$ ${Math.max(0, available).toFixed(2)}`, )``. Exceções de serviços delegados também se propagam.

### internal/atlas/finance

Fonte: [src/presentation/controllers/internal-atlas-finance.controller.ts](../backend/src/presentation/controllers/internal-atlas-finance.controller.ts).

| Método / caminho                           | Auth             | Operação equivalente no núcleo | HTTP / unidade            |
| ------------------------------------------ | ---------------- | ------------------------------ | ------------------------- |
| GET `/internal/atlas/finance/health`       | anônimo          | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/internal/atlas/finance/summary`      | x-internal-token | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| POST `/internal/atlas/finance/withdraw`    | x-internal-token | `/platforms/:tag/finance`      | 201 / R$ quando monetário |
| GET `/internal/atlas/finance/withdraw/:id` | x-internal-token | `/platforms/:tag/finance`      | 200 / R$ quando monetário |

**`health`** (linha 22). Entrada: sem parâmetros.

Retorno declarado: `{ status: 'ok', service: 'atlas-finance-internal' }`.

**`summary`** (linha 73). Entrada: `@Query('cpf') cpf: string, @Query('email') email?: string, @Query('userId') userId?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ userExists: false, availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0 }`; `{ userExists: true, availableBalance: Math.max(0, Number((balanceNet - lockedNet).toFixed(2))), pendingWithdraws: Number(pendingGross.toFixed(2)), lockedBalance: Number(lockedNet.toFixed(2)), }`.

**`requestWithdraw`** (linha 107). Entrada: `@Body() body: { cpf?: string; email?: string; userId?: string; amount: number; pixKey: string }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, id: created.id, netPayout }`.

Exceções no handler: `new BadRequestException( 'Usuário não encontrado na SimPay. Por favor, crie uma conta na SimPay com este e-mail/CPF para poder solicitar saques.' )`; `new BadRequestException('Valor inválido')`; `new BadRequestException('PIX é obrigatório')`; ``new BadRequestException(`Valor insuficiente para cobrir a taxa de R$ ${fee.toFixed(2)}`)``. Exceções de serviços delegados também se propagam.

**`getWithdrawStatus`** (linha 157). Entrada: `@Param('id') id: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `withdraw`.

Exceções no handler: `new NotFoundException('Saque não encontrado')`. Exceções de serviços delegados também se propagam.

### internal/betai

Fonte: [src/presentation/controllers/internal-betai.controller.ts](../backend/src/presentation/controllers/internal-betai.controller.ts).

| Método / caminho                            | Auth             | Operação equivalente no núcleo           | HTTP / unidade            |
| ------------------------------------------- | ---------------- | ---------------------------------------- | ------------------------- |
| POST `/internal/betai/cobranca`             | x-internal-token | `/platforms/:tag/payments`               | 201 / R$ quando monetário |
| POST `/internal/betai/plano`                | x-internal-token | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |
| POST `/internal/betai/plano/cancelar`       | x-internal-token | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |
| GET `/internal/betai/cobranca/:code/status` | x-internal-token | `/platforms/:tag/payments`               | 200 / R$ quando monetário |

**`criarCobranca`** (linha 52). Entrada: `@Body() body: { valor: number; titulo?: string; dueDate?: string; email?: string }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: ``{ linkCode: link.id, checkoutUrl: `${process.env.SIMPAY_CHECKOUT_URL}/?simLinkCode=${link.id}`, }``.

Exceções no handler: `new BadRequestException('Valor inválido')`; `new BadRequestException('Conta master não encontrada')`. Exceções de serviços delegados também se propagam.

**`criarPlano`** (linha 126). Entrada: `@Body() body: { valor: number; label?: string }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: ``{ code, checkoutUrl: `${process.env.SIMPAY_CHECKOUT_URL}/?subscriptionLinkCode=${code}`, }``.

Exceções no handler: `new BadRequestException('Valor inválido')`; `new BadRequestException('Conta master não encontrada')`; `new BadRequestException('Falha ao criar plano de assinatura')`. Exceções de serviços delegados também se propagam.

**`cancelarPlano`** (linha 159). Entrada: `@Body() body: { code?: string }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ encontrada: false, canceladas: 0 }`; `{ encontrada: true, canceladas }`.

Exceções no handler: `new BadRequestException('code obrigatório')`. Exceções de serviços delegados também se propagam.

**`statusCobranca`** (linha 194). Entrada: `@Param('code') code: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ pago: true, pagoEm: tx.updatedAt }`; `{ pago: true, pagoEm: order.createdAt }`; `{ pago: false, pagoEm: null }`.

### internal/bosque/finance

Fonte: [src/presentation/controllers/internal-bosque-finance.controller.ts](../backend/src/presentation/controllers/internal-bosque-finance.controller.ts).

| Método / caminho                                 | Auth             | Operação equivalente no núcleo | HTTP / unidade            |
| ------------------------------------------------ | ---------------- | ------------------------------ | ------------------------- |
| GET `/internal/bosque/finance/summary`           | x-internal-token | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/internal/bosque/finance/transactions`      | x-internal-token | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| GET `/internal/bosque/finance/withdrawals`       | x-internal-token | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| POST `/internal/bosque/finance/withdraw`         | x-internal-token | `/platforms/:tag/finance`      | 201 / R$ quando monetário |
| POST `/internal/bosque/finance/zerar-disponivel` | x-internal-token | `/platforms/:tag/maintenance`  | 201 / R$ quando monetário |
| GET `/internal/bosque/finance/wallet`            | x-internal-token | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| POST `/internal/bosque/finance/fix-balance`      | x-internal-token | `/platforms/:tag/maintenance`  | 201 / R$ quando monetário |
| GET `/internal/bosque/finance/reconcile`         | x-internal-token | `/platforms/:tag/maintenance`  | 200 / R$ quando monetário |

**`summary`** (linha 125). Entrada: `@Query('cpf') cpf: string, @Query('userId') userId?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0, netLockedBalance: 0 }`; `{ availableBalance, pendingWithdraws: Number(pendingGross.toFixed(2)), lockedBalance: Number(pendingGross.toFixed(2)), netLockedBalance: Number(pendingNet.toFixed(2)), }`.

**`transactions`** (linha 157). Entrada: `@Query('cpf') cpf: string, @Query('userId') userId?: string, @Query('page') page = '1', @Query('limit') limit = '10', @Query('startDate') startDate?: string, @Query('endDate') endDate?: string, @Query('status') status?: string, @Query('description') description?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ transactions: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } }`; `{ transactions: items.map((t) => { const netBase = Number(t.netAmount ?? t.amount); // TAXA_SERVICO (R$4 Sim Int Pay) — BOSQUE cobra a partir de 2026-05-29, igual à Renovada. const svcRaw = getPlatformTaxaEffective('BOSQUE', 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO); const taxaServico = svcRaw > 0 && t.createdAt >= BOSQUE_TAXA_SERVICO_DATE ? svcRaw : 0; return { id: t.id, userId: t.userId, amount: Number(t.amount), name: t.customerName ?? null, email: t.customerEmail ?? null, status: t.status, description: t.description ?? null, appliedGlobalFee: false, fee: Number(t.platformFee ?? 0), dom_fee: Number(t.domFee ?? 0), payment_method: t.paymentMethod, amountWithoutAllFee: Number((netBase - taxaServico).toFixed(2)), walletId: null, createdAt: t.createdAt, paymentId: t.domPaymentId ?? t.domTransactionId ?? null, updatedAt: t.updatedAt, }; }), meta: { currentPage: pageNum, itemsPerPage: size, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / size)), }, }`.

**`withdrawals`** (linha 246). Entrada: `@Query('cpf') cpf: string, @Query('userId') userId?: string, @Query('page') page = '1', @Query('limit') limit = '10', @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ withdrawals: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } }`; `{ withdrawals: items.map((w) => ({ id: w.id, userId: w.userId, amount: Number(w.amount), status: w.status, pixKey: w.pixKey, rejectionReason: w.rejectionReason ?? null, createdAt: w.createdAt, user: { name: w.user?.name ?? '-', email: w.user?.email ?? '-' }, })), meta: { currentPage: pageNum, itemsPerPage: size, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / size)), }, }`.

**`requestWithdraw`** (linha 293). Entrada: `@Body() body: { cpf?: string; userId?: string; amount: number; pixKey: string }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, id: created.id }`.

Exceções no handler: `new BadRequestException('Nenhuma conta encontrada')`; `new BadRequestException('Valor inválido')`; `new BadRequestException('PIX é obrigatório')`; ``new BadRequestException( `O valor solicitado é insuficiente para cobrir a taxa (taxa: R$ ${taxaSaque.toFixed(2)})`, )``; `new BadRequestException('Carteira não encontrada para este usuário')`; ``new BadRequestException( `Saldo insuficiente. Disponível: R$ ${available.toFixed(2)}, solicitado: R$ ${grossAmount.toFixed(2)}`, )``. Exceções de serviços delegados também se propagam.

**`zerarDisponivel`** (linha 363). Entrada: `@Body() body: { userId?: string; email?: string; cpf?: string; reason?: string; valor?: number } = {}, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, message: 'O disponível já está zerado.', antes: Number(available.toFixed(2)), depois: 0 }`; `{ success: true, baselineWithdrawId: created.id, antes: Number(available.toFixed(2)), abatido: valor, depois }`.

Exceções no handler: `new BadRequestException('Conta do Bosque não encontrada. Informe userId, email ou cpf.')`. Exceções de serviços delegados também se propagam.

**`inspectWallet`** (linha 422). Entrada: `@Query('userId') userId?: string, @Query('email') email?: string, @Query('cpf') cpf?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ accountExists: false, balance: 0, lockedBalance: 0, availableBalance: 0 }`; `{ accountExists: !!wallet, userId: resolvedId, balance: Number(balance.toFixed(2)), lockedBalance: Number(locked.toFixed(2)), availableBalance: Number(Math.max(0, balance - locked).toFixed(2)), }`.

**`fixBalance`** (linha 453). Entrada: `@Body() body: { userId?: string; email?: string; cpf?: string; balance?: number; delta?: number; lockedBalance?: number; reason?: string; } = {}, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, userId: resolvedId, before: { balance: Number(balanceBefore.toFixed(2)), lockedBalance: Number(lockedBefore.toFixed(2)), availableBalance: Number(Math.max(0, balanceBefore - lockedBefore).toFixed(2)), }, after: { balance: Number(balanceAfter.toFixed(2)), lockedBalance: Number(lockedAfter.toFixed(2)), availableBalance: Number(Math.max(0, balanceAfter - lockedAfter).toFixed(2)), }, }`.

Exceções no handler: `new BadRequestException('Informe "balance" (definir), "delta" (somar/subtrair) ou "lockedBalance".')`; `new BadRequestException('Use apenas um: "balance" (definir) OU "delta" (somar/subtrair).')`; `new BadRequestException('Conta do Bosque não encontrada. Informe userId, email ou cpf.')`; `new BadRequestException('Carteira não encontrada para esta conta.')`; `new BadRequestException('Valores inválidos.')`. Exceções de serviços delegados também se propagam.

**`reconcile`** (linha 581). Entrada: `@Query('userId') userId?: string, @Query('email') email?: string, @Query('cpf') cpf?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ userId: resolvedId, walletExists: !!wallet, current: { balance: round(balanceNow), lockedBalance: round(lockedNow), availableBalance: round(Math.max(0, balanceNow - lockedNow)), }, credits: { completedCount, transactionsWithoutNetAmount: nullNetCount, grossCredits: round(grossCredits), netCredits: round(netCredits), }, withdrawals: { approvedGross: round(withdrawnApproved), pendingGross: round(pendingGross), }, suggested: { net: { balance: suggestedBalanceNet, availableBalance: round(Math.max(0, suggestedBalanceNet - pendingGross)), }, gross: { balance: suggestedBalanceGross, availableBalance: round(Math.max(0, suggestedBalanceGross - pendingGross)), }, }, note: 'Somente leitura. Saldo atual é creditado BRUTO no sync/webhook. ' + 'Se o correto for líquido, aplique suggested.net via POST /internal/bosque/finance/fix-balance.', }`.

Exceções no handler: `new BadRequestException('Conta do Bosque não encontrada. Informe userId, email ou cpf.')`. Exceções de serviços delegados também se propagam.

### internal/ebook/finance

Fonte: [src/presentation/controllers/internal-ebook-finance.controller.ts](../backend/src/presentation/controllers/internal-ebook-finance.controller.ts).

| Método / caminho                                   | Auth             | Operação equivalente no núcleo           | HTTP / unidade            |
| -------------------------------------------------- | ---------------- | ---------------------------------------- | ------------------------- |
| GET `/internal/ebook/finance/summary`              | x-internal-token | `/platforms/:tag/finance`                | 200 / R$ quando monetário |
| GET `/internal/ebook/finance/transactions`         | x-internal-token | `/platforms/:tag/reports`                | 200 / R$ quando monetário |
| GET `/internal/ebook/finance/withdrawals`          | x-internal-token | `/platforms/:tag/finance`                | 200 / R$ quando monetário |
| POST `/internal/ebook/finance/pending-transaction` | x-internal-token | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |
| GET `/internal/ebook/finance/config`               | x-internal-token | `/platforms/:tag/finance`                | 200 / R$ quando monetário |
| POST `/internal/ebook/finance/credit-commission`   | x-internal-token | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |
| POST `/internal/ebook/finance/withdraw`            | x-internal-token | `/platforms/:tag/finance`                | 201 / R$ quando monetário |

**`summary`** (linha 83). Entrada: `@Query('cpf') cpf: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0, minimumWithdrawalAmount: EbookSimConfig.saque.minValor, withdrawalFeeBrl: EbookSimConfig.saque.taxaFixa, pixFeePercent: Number(((1 - EbookSimConfig.saque.fatorLiquidez) * 100).toFixed(2)), transactionFeeBrl: getPlatformTaxaEffective('EBOOK', 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO), accountExists: false, }`; `{ availableBalance: Number((totalReceived - totalCompletedWithdraw - pendingGross).toFixed(2)), pendingWithdraws: Number(pendingAmount.toFixed(2)), lockedBalance: Number(pendingGross.toFixed(2)), minimumWithdrawalAmount: EbookSimConfig.saque.minValor, withdrawalFeeBrl: EbookSimConfig.saque.taxaFixa, pixFeePercent: Number(((1 - EbookSimConfig.saque.fatorLiquidez) * 100).toFixed(2)), transactionFeeBrl: getPlatformTaxaEffective('EBOOK', 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO), accountExists: userIds.length > 0, }`.

**`transactions`** (linha 145). Entrada: `@Query('cpf') cpf: string, @Query('page') page = '1', @Query('limit') limit = '10', @Query('startDate') startDate?: string, @Query('endDate') endDate?: string, @Query('status') status?: string, @Query('description') description?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ transactions: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } }`; `{ transactions: items.map((t) => { let name = t.customerName ?? null; let email = t.customerEmail ?? null; const orderNumber = this.extractOrderNumberFromText(t.description); const domCandidates = orderNumber ? domByOrderNumber.get(orderNumber) ?? [] : []; if (domCandidates.length > 0) { const txCreatedAt = t.createdAt instanceof Date ? t.createdAt.getTime() : Date.now(); let best = domCandidates[0]; let bestDistance = Number.MAX_SAFE_INTEGER; for (const candidate of domCandidates) { const candDate = this.parseDomCreatedAt(candidate.created_at); const dist = candDate ? Math.abs(candDate.getTime() - txCreatedAt) : Number.MAX_SAFE_INTEGER - 1; if (dist < bestDistance) { bestDistance = dist; best = candidate; } } name = best.customer_name ?? name; email = best.customer_email ?? email; } const isAffiliateCommission = /\[AFFILIATE_COMMISSION\]/i.test(t.description ?? ''); const netBase = Number(t.netAmount ?? t.amount); const taxaServico = isAffiliateCommission ? 0 : getEbookTaxaServico(); return { id: t.id, userId: t.userId, amount: Number(t.amount), name, email, status: t.status, description: t.description ?? null, appliedGlobalFee: false, fee: Number(t.platformFee ?? 0), dom_fee: Number(t.domFee ?? 0), payment_method: t.paymentMethod, taxa_fixa_transacao: Number(taxaServico.toFixed(2)), taxa_cashback: 0, amountWithoutAllFee: Number((netBase - taxaServico).toFixed(2)), walletId: null, createdAt: t.createdAt, paymentId: t.domPaymentId ?? t.domTransactionId ?? null, updatedAt: t.updatedAt, }; }), meta: { currentPage: pageNum, itemsPerPage: size, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / size)), }, }`.

**`withdrawals`** (linha 293). Entrada: `@Query('cpf') cpf: string, @Query('page') page = '1', @Query('limit') limit = '10', @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ withdrawals: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } }`; `{ withdrawals: items.map((w) => ({ id: w.id, userId: w.userId, amount: Number(w.amount), status: w.status, pixKey: w.pixKey, rejectionReason: w.rejectionReason ?? null, createdAt: w.createdAt, user: { name: w.user?.name ?? '-', email: w.user?.email ?? '-' }, })), meta: { currentPage: pageNum, itemsPerPage: size, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / size)), }, }`.

**`createPendingTransaction`** (linha 339). Entrada: `@Body() body: { orderNumber: string; amount: number; ownerCpf?: string; ownerName?: string; paymentMethod?: string; buyerName?: string; buyerEmail?: string; buyerDocument?: string; installments?: number; }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, id: existing.id, created: false }`; `{ success: true, id: tx.id, created: true }`.

Exceções no handler: `new BadRequestException('Valor inválido')`; `new BadRequestException('orderNumber é obrigatório')`; `new BadRequestException('Plataforma EBOOK sem dono ativo')`; `new BadRequestException('Plataforma Ebook sem dono cadastrado')`. Exceções de serviços delegados também se propagam.

**`getConfig`** (linha 415). Entrada: `@Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ liquidez: EbookSimConfig.saque.fatorLiquidez, mdrPix: EbookSimConfig.mdr.pix, transactionFeeBrl: getPlatformTaxaEffective('EBOOK', 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO), taxaFixaTransacao: taxaFixaSummary, taxaCashback: taxaCashbackSummary, affiliateCommissionRate: Number( (getPlatformTaxaEffective('EBOOK', 'TAXA_COMISSAO_AFILIADO', PLATFORM_TAXA_DEFAULTS.TAXA_COMISSAO_AFILIADO) * 100).toFixed(2), ), }`.

**`creditCommission`** (linha 432). Entrada: `@Body() body: { referenceId: string; // ex: `AFF-<orderId>-<bookId>` — usado para idempotência cpf?: string; cnpj?: string; amount: number; description?: string; }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, id: existing.id, created: false }`; `{ success: true, id: tx.id, created: true }`.

Exceções no handler: `new BadRequestException('Valor inválido')`; `new BadRequestException('referenceId é obrigatório')`; `new BadRequestException('cpf ou cnpj é obrigatório')`; `new BadRequestException('Nenhuma conta Sim Int Pay encontrada para este CPF/CNPJ')`. Exceções de serviços delegados também se propagam.

**`requestWithdraw`** (linha 481). Entrada: `@Body() body: { cpf: string; amount: number; pixKey: string }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, id: created.id }`.

Exceções no handler: `new BadRequestException('Nenhuma conta encontrada para este CPF')`; `new BadRequestException('Valor inválido')`; ``new BadRequestException(`Valor mínimo para saque é de R$ ${EbookSimConfig.saque.minValor}`)``; `new BadRequestException('PIX é obrigatório')`. Exceções de serviços delegados também se propagam.

### internal/pagatg/finance

Fonte: [src/presentation/controllers/internal-pagatg-finance.controller.ts](../backend/src/presentation/controllers/internal-pagatg-finance.controller.ts).

| Método / caminho                                    | Auth             | Operação equivalente no núcleo           | HTTP / unidade            |
| --------------------------------------------------- | ---------------- | ---------------------------------------- | ------------------------- |
| GET `/internal/pagatg/finance/summary`              | x-internal-token | `/platforms/:tag/finance`                | 200 / R$ quando monetário |
| GET `/internal/pagatg/finance/transactions`         | x-internal-token | `/platforms/:tag/reports`                | 200 / R$ quando monetário |
| GET `/internal/pagatg/finance/withdrawals`          | x-internal-token | `/platforms/:tag/finance`                | 200 / R$ quando monetário |
| POST `/internal/pagatg/finance/withdraw`            | x-internal-token | `/platforms/:tag/finance`                | 201 / R$ quando monetário |
| POST `/internal/pagatg/finance/plans`               | x-internal-token | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |
| POST `/internal/pagatg/finance/record-transaction`  | x-internal-token | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |
| GET `/internal/pagatg/finance/vouchers`             | x-internal-token | `/platforms/:tag/capacidade corporativa` | 200 / R$ quando monetário |
| POST `/internal/pagatg/finance/vouchers`            | x-internal-token | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |
| POST `/internal/pagatg/finance/vouchers/validate`   | x-internal-token | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |
| POST `/internal/pagatg/finance/vouchers/update/:id` | x-internal-token | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |
| POST `/internal/pagatg/finance/vouchers/delete/:id` | x-internal-token | `/platforms/:tag/capacidade corporativa` | 201 / R$ quando monetário |

**`summary`** (linha 96). Entrada: `@Query('cpf') cpf: string, @Query('userId') userId?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0 }`; `{ availableBalance: Number((totalReceived - totalCompletedWithdraw - pendingAmount).toFixed(2)), pendingWithdraws: Number(pendingAmount.toFixed(2)), lockedBalance: Number(pendingGross.toFixed(2)), minimumWithdrawalAmount: PagaTGConfig.saque.minValor, withdrawalFeeBrl: PagaTGConfig.saque.taxaFixa, accountExists: userIds.length > 0, }`.

**`transactions`** (linha 157). Entrada: `@Query('cpf') cpf: string, @Query('userId') userId?: string, @Query('page') page = '1', @Query('limit') limit = '10', @Query('startDate') startDate?: string, @Query('endDate') endDate?: string, @Query('status') status?: string, @Query('description') description?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ transactions: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } }`; `{ transactions: items.map((t: any) => { const netBase = Number(t.netAmount ?? t.amount); return { id: t.id, userId: t.userId, customerId: t.pixPlanOrder?.customerId ?? null, amount: Number(t.amount), name: t.customerName ?? null, email: t.customerEmail ?? null, status: t.status, description: t.description ?? null, pixCode: (t.description ?? '').split(':')[1]?.split(' ')[0] ?? null, appliedGlobalFee: false, fee: Number(t.platformFee ?? 0), dom_fee: Number(t.domFee ?? 0), payment_method: t.paymentMethod, taxa_fixa_transacao: Number(taxaFixa.toFixed(2)), taxa_cashback: Number(taxaCashback.toFixed(2)), amountWithoutAllFee: Number((netBase - taxaServico).toFixed(2)), walletId: null, createdAt: t.createdAt, paymentId: t.domPaymentId ?? t.domTransactionId ?? null, updatedAt: t.updatedAt, }; }), meta: { currentPage: pageNum, itemsPerPage: size, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / size)), }, }`.

**`withdrawals`** (linha 252). Entrada: `@Query('cpf') cpf: string, @Query('userId') userId?: string, @Query('page') page = '1', @Query('limit') limit = '10', @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ withdrawals: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } }`; `{ withdrawals: items.map((w) => ({ id: w.id, userId: w.userId, amount: Number(w.amount), status: w.status, pixKey: w.pixKey, rejectionReason: w.rejectionReason ?? null, createdAt: w.createdAt, user: { name: w.user?.name ?? '-', email: w.user?.email ?? '-' }, })), meta: { currentPage: pageNum, itemsPerPage: size, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / size)), }, }`.

**`requestWithdraw`** (linha 299). Entrada: `@Body() body: { cpf: string; userId?: string; amount: number; pixKey: string }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, id: created.id }`.

Exceções no handler: `new BadRequestException('Nenhuma conta encontrada para este CPF')`; `new BadRequestException('Valor inválido')`; ``new BadRequestException(`Valor mínimo para saque é de R$ ${PagaTGConfig.saque.minValor}`)``; `new BadRequestException('PIX é obrigatório')`. Exceções de serviços delegados também se propagam.

**`upsertPlan`** (linha 334). Entrada: `@Body() body: { cpf: string; userId?: string; code: string; name: string; price: number; type: 'MENSAL' \| 'TRIMESTRAL' \| 'SEMESTRAL' \| 'ANUAL'; domPlanId: string; redirectUrl?: string \| null; webhookUrl?: string \| null; paymentMethods?: string \| null; isActive?: boolean; }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, id: updated.id, created: false }`; `{ success: true, id: created.id, created: true }`.

Exceções no handler: `new BadRequestException('code é obrigatório')`; `new BadRequestException('name é obrigatório')`; `new BadRequestException('price inválido')`; `new BadRequestException('Nenhuma conta encontrada para este CPF/userId')`. Exceções de serviços delegados também se propagam.

**`recordTransaction`** (linha 417). Entrada: `@Body() body: { cpf: string; userId?: string; domPaymentId: string; domSubscriptionId?: string; amount: number; netAmount?: number; planDescription: string; customerName?: string; customerEmail?: string; customerDocument?: string; paymentMethod?: string; }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, id: existing.id, created: false }`; `{ success: true, id: tx.id, created: true }`.

Exceções no handler: `new BadRequestException('domPaymentId é obrigatório')`; `new BadRequestException('amount inválido')`; `new BadRequestException('Nenhuma conta encontrada para este CPF/userId')`. Exceções de serviços delegados também se propagam.

**`listVouchers`** (linha 494). Entrada: `@Query('cpf') cpf: string, @Query('userId') userId?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `[]`; `this.voucherService.listVouchers(userIds[0], 'USER')`.

**`createVoucher`** (linha 506). Entrada: `@Body() body: { cpf: string; userId?: string; dto: CreateVoucherDto }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `this.voucherService.createVoucher(userIds[0], body.dto)`.

Exceções no handler: `new BadRequestException('Usuário não encontrado')`. Exceções de serviços delegados também se propagam.

**`validateVoucher`** (linha 517). Entrada: `@Body() body: { cpf: string; userId?: string; dto: ValidateVoucherDto }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `this.voucherService.validateVoucher(userIds[0], body.dto)`.

Exceções no handler: `new BadRequestException('Usuário não encontrado')`. Exceções de serviços delegados também se propagam.

**`updateVoucher`** (linha 528). Entrada: `@Param('id') id: string, @Body() body: { cpf: string; userId?: string; dto: UpdateVoucherDto }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `this.voucherService.updateVoucher(userIds[0], 'USER', id, body.dto)`.

Exceções no handler: `new BadRequestException('Usuário não encontrado')`. Exceções de serviços delegados também se propagam.

**`deleteVoucher`** (linha 540). Entrada: `@Param('id') id: string, @Body() body: { cpf: string; userId?: string }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `this.voucherService.deleteVoucher(userIds[0], 'USER', id)`.

Exceções no handler: `new BadRequestException('Usuário não encontrado')`. Exceções de serviços delegados também se propagam.

### internal/renovada/finance

Fonte: [src/presentation/controllers/internal-reconcile.controller.ts](../backend/src/presentation/controllers/internal-reconcile.controller.ts).

| Método / caminho                            | Auth             | Operação equivalente no núcleo | HTTP / unidade            |
| ------------------------------------------- | ---------------- | ------------------------------ | ------------------------- |
| POST `/internal/renovada/finance/reconcile` | x-internal-token | `/platforms/:tag/maintenance`  | 201 / R$ quando monetário |

**`reconcile`** (linha 22). Entrada: `@Query('userId') userId?: string, @Query('horas') horas?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `this.reconcilePending.execute({ userId: userId \|\| undefined, sinceHours, limit: 500 })`.

### internal/renovada/finance

Fonte: [src/presentation/controllers/internal-renovada-finance.controller.ts](../backend/src/presentation/controllers/internal-renovada-finance.controller.ts).

| Método / caminho                              | Auth             | Operação equivalente no núcleo | HTTP / unidade            |
| --------------------------------------------- | ---------------- | ------------------------------ | ------------------------- |
| GET `/internal/renovada/finance/summary`      | x-internal-token | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| GET `/internal/renovada/finance/transactions` | x-internal-token | `/platforms/:tag/reports`      | 200 / R$ quando monetário |
| GET `/internal/renovada/finance/withdrawals`  | x-internal-token | `/platforms/:tag/finance`      | 200 / R$ quando monetário |
| POST `/internal/renovada/finance/withdraw`    | x-internal-token | `/platforms/:tag/finance`      | 201 / R$ quando monetário |

**`summary`** (linha 78). Entrada: `@Query('cpf') cpf: string, @Query('userId') userId?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0 }`; `{ availableBalance: Math.max(0, Number((balanceNet - lockedNet).toFixed(2))), pendingWithdraws: Number(pendingGross.toFixed(2)), lockedBalance: Number(lockedNet.toFixed(2)), }`.

**`transactions`** (linha 112). Entrada: `@Query('cpf') cpf: string, @Query('userId') userId?: string, @Query('page') page = '1', @Query('limit') limit = '10', @Query('startDate') startDate?: string, @Query('endDate') endDate?: string, @Query('status') status?: string, @Query('description') description?: string, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ transactions: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } }`; `{ transactions: items.map((t) => { const netBase = Number(t.netAmount ?? t.amount); const taxaServico = svcRaw > 0 && t.createdAt >= TAXA_SERVICO_EFFECTIVE_DATE ? svcRaw : 0; return { id: t.id, userId: t.userId, amount: Number(t.amount), name: t.customerName ?? null, email: t.customerEmail ?? null, status: t.status, description: t.description ?? null, appliedGlobalFee: false, fee: Number(t.platformFee ?? 0), dom_fee: Number(t.domFee ?? 0), payment_method: t.paymentMethod, amountWithoutAllFee: Number((netBase - taxaServico).toFixed(2)), walletId: null, createdAt: t.createdAt, paymentId: t.domPaymentId ?? t.domTransactionId ?? null, updatedAt: t.updatedAt, }; }), meta: { currentPage: pageNum, itemsPerPage: size, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / size)), }, }`.

**`withdrawals`** (linha 204). Entrada: `@Query('cpf') cpf: string, @Query('userId') userId?: string, @Query('page') page = '1', @Query('limit') limit = '10', @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ withdrawals: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } }`; `{ withdrawals: items.map((w) => ({ id: w.id, userId: w.userId, amount: Number(w.amount), status: w.status, pixKey: w.pixKey, rejectionReason: w.rejectionReason ?? null, createdAt: w.createdAt, user: { name: w.user?.name ?? '-', email: w.user?.email ?? '-' }, })), meta: { currentPage: pageNum, itemsPerPage: size, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / size)), }, }`.

**`requestWithdraw`** (linha 251). Entrada: `@Body() body: { cpf?: string; userId?: string; amount: number; pixKey: string }, @Headers('x-internal-token') internalToken?: string`.

Retorno declarado: `{ success: true, id: created.id, netPayout }`.

Exceções no handler: `new BadRequestException('Nenhuma conta encontrada')`; `new BadRequestException('Valor inválido')`; `new BadRequestException('PIX é obrigatório')`; ``new BadRequestException(`Valor insuficiente para cobrir a taxa de R$ ${fee.toFixed(2)}`)``; `new BadRequestException('Carteira não encontrada para este usuário')`; ``new BadRequestException( `Saldo insuficiente. Disponível: R$ ${available.toFixed(2)}, solicitado: R$ ${grossAmount.toFixed(2)}`, )``. Exceções de serviços delegados também se propagam.

### webhook

Fonte: [src/presentation/controllers/webhook.controller.ts](../backend/src/presentation/controllers/webhook.controller.ts).

| Método / caminho                           | Auth                                        | Operação equivalente no núcleo | HTTP / unidade              |
| ------------------------------------------ | ------------------------------------------- | ------------------------------ | --------------------------- |
| POST `/webhook/eventos`                    | segredo webhook / assinatura quando exigida | `/platforms/:tag/webhooks`     | 200 / payload do adquirente |
| POST `/webhook/ebook/payment-confirmation` | segredo webhook / assinatura quando exigida | `/platforms/:tag/webhooks`     | 200 / payload do adquirente |

**`handle`** (linha 32). Entrada: `@Body() body: unknown, @Headers('x-webhook-signature') signature: string \| undefined, @Headers('x-webhook-secret') secretHeader: string \| undefined, @Req() req: Request & { rawBody?: Buffer }`.

Retorno declarado: `{ status: 'ok' }`.

Exceções no handler: `new UnauthorizedException('Webhook not configured')`; `new UnauthorizedException('Invalid webhook secret')`; `new UnauthorizedException('Missing signature or body')`; `new UnauthorizedException('Invalid webhook signature')`. Exceções de serviços delegados também se propagam.

**`handleEbookPaymentConfirmation`** (linha 84). Entrada: `@Body() body: { orderNumber?: string; status?: string; email?: string; store?: string }, @Headers('x-webhook-secret') secretHeader: string \| undefined`.

Retorno declarado: `{ status: 'ok', forwarded: true }`.

Exceções no handler: `new UnauthorizedException('Invalid webhook secret')`; `new BadRequestException('orderNumber e status são obrigatórios')`; `new InternalServerErrorException('BACK_EBOOK_URL/API_MACHINE_INTERNAL_TOKEN não configurados')`; ``new BadRequestException(`Falha ao encaminhar webhook para back-ebook: ${response.status} ${text}`)``. Exceções de serviços delegados também se propagam.

## Administração preservada

`PlatformsController` conserva GET/POST `/platforms`, PATCH `/platforms/:tag`, PATCH `/platforms/:tag/customer-interest-rates` e GET `/platforms/:tag/customer-interest-rates/simulation?amount=`. JwtAuthGuard, contexto CurrentUser e autorização do serviço; criação/configuração não são aliases de checkout. Simulação legada recebe amount em R$. `PlatformIntegrationsController` conserva GET `/platforms/:id/integrations` e PUT `/platforms/:id/integrations/:key` com `{value}`; JWT de usuário ativo, dono/admin, modo integration proibido; saída omite segredo na listagem. Tags corporativas reservadas ao admin na API canônica.

## Limites de migração

- Setup Atlas/Revalida permanece 410; não recriar contas técnicas.
- Integrações de comerciantes correspondem a `/platforms/:tag/merchants/:externalMerchantId/...`. Implementação legada injeta ZeroGrauPaymentService e usa DOM_TOKEN de ZERO-GRAU para status; remover esse acoplamento no serviço compartilhado sem alterar contrato do alias.
- Alias deve chamar diretamente operação compartilhada e traduzir contrato. Sem redirect, loopback HTTP, cálculo financeiro duplicado ou acesso canônico anônimo.
- Manutenção que substitui/zera/recalcula carteira compartilhada deve bloquear; histórico sem plataforma identificada não recebe plataforma arbitrária.
- Inventário histórico cobre 136 declarações de rotas corporativas/internas; 128 permanecem registradas e oito aliases administrativos BetAI foram removidos. Serviços retornados por delegação e DTOs referenciados integram contrato e precisam de testes de equivalência antes de substituir implementação.

## Delegação implementada na continuação: BetAI

Inventário acima mantém caracterização original. Agora os quatro aliases internos usam PlatformBetaiService compartilhado com APIs canônicas, sem HTTP interno/redirecionamento. Header `x-internal-token` permanece exclusivo dos aliases; status HTTP continuam 201 em POST e 200 em GET.

| Alias                                       | Operação canônica                                    | Tradução                                                                                              |
| ------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| POST `/internal/betai/cobranca`             | POST `/platforms/BETAI/billing`                      | `valor` em reais → `amountCents`; `titulo` → `title`; resposta `{ linkCode, checkoutUrl }` preservada |
| POST `/internal/betai/plano`                | POST `/platforms/BETAI/subscriptions/plans`          | `valor` → centavos; `label` → `name`; frequência MENSAL; resposta antiga `{ code, checkoutUrl }`      |
| POST `/internal/betai/plano/cancelar`       | POST `/platforms/BETAI/billing/subscriptions/cancel` | `{ code }`; alias retorna `{ encontrada, canceladas }`; canônico `{ found, cancelled }`               |
| GET `/internal/betai/cobranca/:code/status` | GET `/platforms/BETAI/billing/:code/status`          | alias `{ pago, pagoEm }`; canônico `{ paid, paidAt }`                                                 |

Dono e credenciais agora exigem cadastro ativo BETAI, sem inferência de master por e-mail. Registros antigos sem tag explícita não recebem atribuição automática. Falha no registro opcional de link DOM mantém checkout local; ausência de configuração não faz fallback global. Testes cobrem tradução reais/centavos, igualdade da operação compartilhada, auth do alias, isolamento de dono/tag e capacidade ausente.
