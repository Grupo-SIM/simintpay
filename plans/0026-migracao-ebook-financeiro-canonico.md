# Migração financeira do back-ebook para as rotas canônicas por vendedor

Plano proposto em 2026-11-14 (base `0c3ad4b3`). **Nada aqui autoriza migration, comando contra banco remoto, deploy, push ou configuração em produção.** Cada passo marcado `[ ]` é do dono/ops ou do repositório `back-ebook` e só roda com autorização explícita. Complementa [0025](0025-retirada-legado-ofertas-webhooks.md) (item 12 dos webhooks: back-ebook fica fora daquele plano e é tratado aqui).

## 1. Objetivo

O `back-ebook` é um marketplace NestJS com vários vendedores identificados por CPF/CNPJ. Hoje fala com o SimIntPay pelas rotas legadas `/internal/ebook/finance/*` (token `x-internal-token`, `?cpf=`, valores em reais). Elas serão aposentadas em favor das rotas canônicas por vendedor (`/platforms/EBOOK/merchants/:externalMerchantId/finance/*`), autenticadas pela credencial `INBOUND_TOKEN` da plataforma com escopos `INBOUND_OPERATIONS`, em centavos inteiros.

## 2. Inventário

### 2.1 back-ebook chama o SimIntPay (`API_MACHINE_URL`, `API_MACHINE_INTERNAL_TOKEN`/`INTERNAL_SERVICE_TOKEN`)

| #   | Arquivo (back-ebook)                                                  | Chamada legada                                                                                           | Para quê                                                                            | Substituto canônico                                                                                            |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `src/common/seller-fees.ts:44`                                        | `GET /internal/ebook/finance/summary?cpf=` (lê `pixFeePercent`, `transactionFeeBrl`, `withdrawalFeeBrl`) | Líquido do vendedor no checkout (`calcNetAmount`)                                   | `GET .../finance/fees` (`processingRatePpm` do PIX + `transaction.serviceFeeCents` + `withdrawal`)             |
| 2   | `src/checkout/checkout.service.ts:58`                                 | `POST /internal/ebook/finance/pending-transaction`                                                       | Cria a venda `PENDING` (`EBOOK_PENDING_<orderNumber>`) que o webhook DOM completa   | `POST .../finance/entries` com `kind: "pending"`                                                               |
| 3   | `src/checkout/checkout.service.ts:215,244`                            | `GET /internal/ebook/finance/config` (lê `liquidez`, `transactionFeeBrl`)                                | Fallback de líquido quando o `summary` falha                                        | `GET /platforms/EBOOK/finance/config` (`liquidityRate`, `transactionFeeCents`)                                 |
| 4   | `src/affiliate/commission-delivery.ts:28`                             | `POST /internal/ebook/finance/credit-commission`                                                         | Registra comissão de afiliado (`EBOOK_AFFCOMM_<referenceId>`), `LEGACY_RECORD_ONLY` | `POST .../finance/entries` com `kind: "commission"` (afiliado provisionado como vendedor)                      |
| 5   | `src/payments/payments.controller.ts:391`                             | `GET .../summary?cpf=`                                                                                   | Painel financeiro: saldo, `accountExists`, taxas                                    | `GET .../finance/summary` + `GET .../finance/fees` (404 = sem conta, substitui `accountExists`)                |
| 6   | `payments.controller.ts:336,590,616`                                  | `GET .../transactions?cpf=&page=1&limit=5000`                                                            | Histórico, exportação Excel; mescla com pedidos locais                              | `GET .../finance/transactions` (limite máximo 200: paginar)                                                    |
| 7   | `payments.controller.ts:542`                                          | `GET .../withdrawals?cpf=`                                                                               | Lista de saques                                                                     | `GET .../finance/withdrawals`                                                                                  |
| 8   | `payments.controller.ts:562`                                          | `POST .../withdraw` `{cpf, amount, pixKey}`                                                              | Pedido de saque                                                                     | `POST .../finance/withdrawals/quote` e `POST .../finance/withdrawals` (com `idempotencyKey`)                   |
| 9   | `payments.controller.ts:144`                                          | `GET /admin/transacoes-dom`                                                                              | Admin: transações DOM                                                               | Fora deste plano (rota admin; decidir com o dono)                                                              |
| 10  | `src/checkout/checkout.service.ts:399-411`                            | `POST /checkout/ebook-url` `{settlement}`                                                                | Matrícula de liquidação e URL de checkout                                           | Fora deste plano (protocolo de liquidação, `ebook-settlement`; sem substituto financeiro por vendedor)         |
| 11  | `src/auth/auth.service.ts` e `auth.controller.ts` (`API_MACHINE_URL`) | `/auth/register`, `/auth/generate-token`, `/auth/list-tokens`, `/custom-fees`                            | Criar conta SimIntPay do vendedor, token e taxa customizada                         | `PUT .../merchants/:externalMerchantId` agora cria/associa a conta (Fase A2); token e `/custom-fees` obsoletos |
| 12  | `src/checkout/checkout.service.ts:157,tryReconcileEbookOrderPaid`     | `getApiMachineBaseUrl()` para conciliar pagamento                                                        | Conciliação de pedido pago                                                          | `GET .../payments/:paymentId` / `POST .../finance/reconciliation/payments` (revisar)                           |

### 2.2 SimIntPay chama o back-ebook (sentido inverso, sem mudança)

- `backend/src/modules/platform-core/ebook-receipt-outbox.service.ts:36` → `POST <BACKEND_URL>/internal/ebook/settlements/receipts` (`INTERNAL_TOKEN` da plataforma). Recebido em `back-ebook/src/checkout/settlement-receipts.controller.ts` (`API_MACHINE_INTERNAL_TOKEN`).
- `process-dom-webhook.use-case.ts:1023`: avisos ao back-ebook (`x-internal-token`). Fora do escopo.
- `back-ebook/src/internal/internal-stats.controller.ts`, `webhook/dom/dom-webhook.controller.ts`: rotas que o SimIntPay/DOM consomem; usam o mesmo token.

### 2.3 Lado SimIntPay (legado a remover no fim)

- `backend/src/presentation/controllers/internal-ebook-finance.controller.ts` (`/internal/ebook/finance/*`) e `backend/src/modules/unified-platform/finance/legacy-ebook-finance.service.ts`.
- Inventário `backend/src/modules/platform-core/legacy-platform-contracts.ts`, `docs/legacy-platform-routes.md`, `docs/legacy-platform-equivalence.md` e os testes que os cobrem (`legacy-finance-alias-equivalence.test.ts`, `platform-finance-read-contracts.test.ts`, `platform-import-equivalence.test.ts`, `platform-withdrawal-contracts.test.ts`).
- `backend/src/presentation/checkout.module.ts` e `checkout.controller.ts:190,233,538` mencionam `EBOOK_PENDING_` (a chave canônica é a mesma, não muda).

## 3. Contrato final (centavos, `unit: "cents"`)

Base: `/platforms/EBOOK/merchants/:externalMerchantId`. Credencial: `Authorization`/token de integração da plataforma (`INBOUND_TOKEN`), com os escopos abaixo em `INBOUND_OPERATIONS` (explícitos substituem o padrão: **listar todos**). `externalMerchantId`: sugestão = CPF/CNPJ só dígitos do vendedor (mesmo identificador que o back-ebook já usa).

| Rota                                  | Escopo             | Notas                                                                                                      |
| ------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `PUT /`                               | `merchants:manage` | Associa o vendedor a uma conta ativa pelo CNPJ (`{cnpj, legalName}`). Existente.                           |
| `GET /finance/summary`                | `finance:read`     | Saldo **por plataforma** (ver 3.1). Existente, estendido.                                                  |
| `GET /finance/fees`                   | `finance:read`     | **Novo.** Taxas reais (ver 3.2).                                                                           |
| `GET /finance/transactions`           | `finance:read`     | **Novo.** Histórico do vendedor (ver 3.3).                                                                 |
| `POST /finance/entries`               | `ledger:write`     | **Novo.** Venda pendente e comissão (ver 3.4). `ledger:write` não está no padrão: precisa estar explícito. |
| `GET /finance/withdrawals`            | `finance:read`     | Existente.                                                                                                 |
| `GET /finance/withdrawals/:id`        | `finance:read`     | Existente.                                                                                                 |
| `POST /finance/withdrawals/quote`     | `finance:read`     | Existente. `{amountCents}`.                                                                                |
| `POST /finance/withdrawals`           | `finance:withdraw` | Existente. Saldo validado por plataforma (3.1).                                                            |
| `GET /platforms/EBOOK/finance/config` | `finance:read`     | Plataforma. Estendido com `withdrawal`.                                                                    |

`INBOUND_OPERATIONS` sugerido: `merchants:manage,finance:read,finance:withdraw,ledger:write` (acrescentar `payments:*` só se o back-ebook passar a criar pagamentos pela rota canônica).

### 3.1 Saldo por plataforma (`GET /finance/summary`)

A carteira é do vendedor e compartilhada entre as plataformas dele. Para EBOOK o saldo exibido e sacável é só o da plataforma, pela projeção existente `PlatformAttributedBalance` (por `Transaction.platformTag`), agora com um modo "vendedor" (`readSnapshot(..., merchantUserId)`); a verificação de dono da plataforma continua valendo para quem chama pelo dono. Regras do modo vendedor: só vendas `COMPLETED` com tag `EBOOK`; abate a taxa de serviço por venda (`TAXA_SERVICO`, igual ao crédito real na carteira); comissão de afiliado só registrada (sem crédito de carteira) não conta; saques considerados são os da plataforma (`withdrawRequest.platform` = `ebook`/`ebooksim`); histórico sem tag nunca é atribuído. `availableBalanceCents` = `min(saldo da plataforma − reservas, saldo disponível da carteira)`.

```json
{
  "currency": "BRL",
  "unit": "cents",
  "walletScope": "merchant-platform",
  "ownerUserId": "<platform owner>",
  "sharedWallet": false,
  "balanceCents": 14200,
  "availableBalanceCents": 14200,
  "lockedBalanceCents": 0,
  "earnedCents": 14200,
  "withdrawnGrossCents": 0,
  "poolBalanceCents": 50000,
  "poolAvailableBalanceCents": 50000,
  "historicalAttributionComplete": false,
  "pendingPlatformWithdrawalsCents": 0,
  "canRequest": true,
  "blockReason": null,
  "processingCount": 0,
  "processingGrossCents": 0,
  "feePolicy": { "fixedCents": 350, "rate": 0 }
}
```

`poolBalanceCents`/`poolAvailableBalanceCents` são informativos (carteira inteira do vendedor); o back-ebook deve exibir `availableBalanceCents`. Saque (`POST /finance/withdrawals`): dentro da trava do ledger, rejeita com 400 `Saldo insuficiente na plataforma` se o valor bruto exceder o disponível da plataforma, mesmo que a carteira tenha mais; nenhuma linha e nenhuma reserva são gravadas. Plataformas fora de `PLATFORM_SCOPED_BALANCE_TAGS` (`platform-merchant-balance.ts`, hoje só `EBOOK`) mantêm a carteira agregada (`walletScope: "merchant-user"`).

### 3.2 Taxas (`GET /finance/fees`)

Fonte: a mesma cotação do checkout (`loadChargePolicy` + `quoteFinancialCharge`), logo a taxa alvo ("taxa alvo", ex. 14,99%) vale. A `Platform.targetFeePpm` (override; `null` herda, `0` desliga) e o alvo GLOBAL (`FinancialPolicyRevision` do tag `GLOBAL`, `targetFeePpm` em milionésimos) substituem a taxa SimIntPay manual (`target-fee.ts`); o alvo e o custo da adquirente mais cara vêm da tabela sincronizada. **Não** usa o atalho `LIQUIDEZ` (0,9301 → `pixFeePercent` 6,99). Taxas por modalidade: referência de R$ 100,00; `processingRatePpm` = custo de processamento (adquirente + SimIntPay + adicionais, taxas fixas incluídas) sobre a referência, em milionésimos (149900 = 14,99%). `interestCostCents`/`buyer*` seguem o cálculo normal de juros. `available: false` quando a modalidade não está configurada.

```json
{
  "unit": "cents",
  "withdrawal": {
    "minimumCents": 10000,
    "fixedFeeCents": 350,
    "percentFee": 0
  },
  "transaction": {
    "serviceFeeCents": 400,
    "fixedFeeCents": 100,
    "cashbackCents": 0
  },
  "referenceAmountCents": 10000,
  "platformFeeMode": null,
  "globalTargetFeePpm": 149900,
  "platformTargetFeePpm": null,
  "effectiveTargetFeePpm": 149900,
  "pix": {
    "available": true,
    "processingFeeCents": 1499,
    "processingRatePpm": 149900,
    "interestCostCents": 0,
    "buyerInterestRatePpm": 0,
    "buyerInterestCents": 0,
    "buyerTotalCents": 10000,
    "installmentCents": 10000,
    "netCents": 8501
  },
  "debit": { "available": true, "...": "mesma forma" },
  "boleto": { "available": false },
  "credit": [
    { "installments": 1, "available": true, "...": "mesma forma" },
    {
      "installments": 12,
      "available": true,
      "processingRatePpm": 149900,
      "interestCostCents": 120,
      "...": "..."
    }
  ]
}
```

Equivalência com o líquido do legado: `líquido = bruto − bruto × (processingRatePpm / 1e6) − transaction.serviceFeeCents / 100`. `withdrawal.fixedFeeCents` = taxa de saque do maior custo ativo de adquirente + extra do admin (`resolveWithdrawalFixedFee`); `minimumCents` = `SAQUE_MIN`; `serviceFeeCents` = `TAXA_SERVICO` (`transactionFeeBrl` do legado); `fixedFeeCents` = `TAXA_FIXA_TRANSACAO`.

### 3.3 Transações (`GET /finance/transactions`)

Query: `page` (1), `limit` (20, máx 200), `startDate`/`endDate` (`YYYY-MM-DD`, fuso America/Sao_Paulo), `status` (`COMPLETED`, `PENDING`, ... ou `ALL`; o legado `PAID` do back-ebook deve ser enviado como `COMPLETED`), `description` (contém, sem caixa; `ALL` ignora). Mesma visibilidade do legado: `userId` do vendedor e `Transaction.platformTag = EBOOK`.

```json
{
  "unit": "cents",
  "data": [
    {
      "id": "…",
      "amountCents": 10000,
      "netAmountCents": 8501,
      "platformFeeCents": 1499,
      "acquirerFeeCents": 0,
      "status": "COMPLETED",
      "paymentMethod": "PIX",
      "description": "ORD-2026-000001 [TENANT:EBOOK]",
      "customerName": "Maria",
      "customerEmail": "m@x.com",
      "customerPhone": null,
      "customerDocument": "12345678901",
      "createdAt": "2026-11-14T12:00:00.000Z",
      "transactionFeeCents": 400,
      "sellerNetCents": 8101
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Mapeamento legado → canônico: `amount`→`amountCents/100`, `fee`→`platformFeeCents`, `dom_fee`→`acquirerFeeCents`, `taxa_fixa_transacao`→`transactionFeeCents` (0 em comissão de afiliado), `amountWithoutAllFee`→`sellerNetCents`, `payment_method`→`paymentMethod`, `name`/`email`→`customerName`/`customerEmail`. Diferenças: não há enriquecimento por nome/e-mail da DOM (o legado consultava a DOM pelo `ORD-…`) nem `paymentId` (`domPaymentId`); o back-ebook já usa `ORD-…` da descrição para mesclar. Exportações grandes: paginar com `limit=200`.

### 3.4 Lançamentos (`POST /finance/entries`)

Reaproveita `PlatformFinanceService.importEntry` (mesma validação e idempotência); o lançamento é atribuído à **conta do vendedor** (não ao dono da plataforma). `ledger:write`, só plataforma `EBOOK` (422 nas demais). Idempotência por `domPaymentId`: `EBOOK_PENDING_<referenceId>` (venda pendente, igual ao legado `EBOOK_PENDING_<orderNumber>`) e `EBOOK_AFFCOMM_<referenceId>` (comissão, igual ao legado). Reenvio idêntico devolve `created: false` com o mesmo `id`; mesma referência com vendedor/valor/líquido diferentes dá 409 `LEDGER_REFERENCE_CONFLICT`. Pendente: `status PENDING`, custo estimado da adquirente; o webhook DOM completa e credita (`EBOOK_PENDING_COMPLETED`). Comissão: registro `COMPLETED` com `[AFFILIATE_COMMISSION]` e **sem** crédito de carteira (igual ao legado e ao comentário de `commission-delivery.ts`).

```json
POST .../merchants/12345678901/finance/entries
{
  "referenceId": "ORD-2026-000001",
  "kind": "pending",
  "amountCents": 5000,
  "netAmountCents": 4250,
  "paymentMethod": "PIX",
  "installments": 1,
  "description": "ORD-2026-000001 [CPF_DONO:12345678901] [NOME_DONO:Maria]",
  "customerName": "Comprador",
  "customerEmail": "c@x.com",
  "customerDocument": "98765432100"
}
→ { "success": true, "id": "…", "created": true }
```

```json
{
  "referenceId": "AFF-1-2",
  "kind": "commission",
  "amountCents": 800,
  "netAmountCents": 800,
  "paymentMethod": "PIX",
  "description": "Comissão de afiliado"
}
```

Diferenças para o legado: o líquido (`netAmountCents`) agora vem do chamador (calcule com `finance/fees`; o legado usava `calculateSellerNetValue` com `LIQUIDEZ`); `paymentMethod` só `PIX`/`CREDIT_CARD` (o legado aceitava qualquer texto); campos desconhecidos são 400; `[TENANT:EBOOK]` é acrescentado pelo servidor e as tags `[CPF_DONO]`/`[NOME_DONO]` ficam por conta do chamador na `description`.

### 3.5 Saques (verificação do item 4)

Cobertura: `POST /finance/withdrawals` `{amountCents, pixKey, idempotencyKey}` → `{id, status, amountCents (líquido), grossAmountCents, feeCents, pixKey, rejectionReason, requestId, createdAt, updatedAt}`; `quote` devolve taxa e líquido sem gravar; lista traz `amountCents` (líquido), `status`, `requestId`. Diferenças para o legado `withdraw`/`withdrawals`: (1) `idempotencyKey` obrigatório (use `ORD`/UUID estável por pedido de saque; reenvio igual devolve o mesmo saque, divergente dá 409); (2) o legado tratava `amount` como valor **líquido** (`gross = amount + taxa`), o canônico trata `amountCents` como **bruto** debitado, taxa fixa descontada (`net = bruto − taxa`); o back-ebook deve decidir qual semântica expor ao vendedor; (3) mínimo e taxa vêm de `fees.withdrawal`/`quote`, não são recalculados no cliente; (4) saque sempre `PENDING` com reserva na carteira (3.1).

### 3.6 Config de plataforma (item 5)

`GET /platforms/EBOOK/finance/config` já carrega o que o back-ebook lê (`liquidityRate` = `liquidez`, `transactionFeeCents` = `transactionFeeBrl` x 100) e ganhou `withdrawal {minimumCents, fixedFeeCents, percentFee}` (aditivo). Atenção: `liquidityRate` é o atalho LIQUIDEZ (0,9301 no padrão); o back-ebook não deve usá-lo como fonte primária de líquido, apenas como fallback atual (3.2 é a fonte correta).

## 4. Fases

### Fase A. Contrato canônico no SimIntPay (feito, local, sem push)

- [x] `GET /finance/transactions` por vendedor (mesma visibilidade e tag do legado, centavos, paginação). Commit `772ad3be`.
- [x] `GET /finance/fees`: taxas reais pela cotação de cobrança (taxa alvo), `platformFeeSchedule` em `financial-policy/platform-fee-schedule.ts`. Commit `772ad3be`.
- [x] `POST /finance/entries` por vendedor reaproveitando `importEntry` (`ledger:write`, só EBOOK, mesmas chaves de idempotência do legado). Commit `772ad3be`.
- [x] `finance/config` da plataforma com `withdrawal`. Commit `772ad3be`.
- [x] Saldo e validação de saque por plataforma (3.1), reaproveitando `PlatformAttributedBalance` em modo vendedor. Commit `1c9d2e7d`.
- [x] Testes: `backend/src/modules/platform-core/platform-merchant-ebook-finance.test.ts`; documentação em `docs/legacy-platform-equivalence.md`.
- [x] Escopo `ledger:write` para `INBOUND_TOKEN`: já existe (só administrador no JWT; o token precisa tê-lo em `INBOUND_OPERATIONS`); nenhuma mudança de código necessária.

Limites conhecidos: (a) o saque por plataforma só vale pela rota canônica por vendedor; os caminhos legados (`withdraw`, caso de uso `request-withdraw`) continuam sobre a carteira agregada e podem consumir fundos de outra plataforma; migrar o back-ebook para o canônico fecha o buraco para o EBOOK, e a proteção "inversa" (outra plataforma não sacar fundos do EBOOK) exige tornar o saque de todas as plataformas escopado ou gravar `BalanceLog.platformTag` nos créditos (plano 0019); (b) `historicalAttributionComplete` fica `false` enquanto houver histórico sem tag; (c) `ExternalPlatformWallet` continua só espelho.

### Fase A2. Conta do vendedor, saldo por liquidação e destino dos itens 9 a 12 (feito, local, sem push)

Investigação nos dois lados (back-ebook somente leitura). Achado central: `/auth/register`, `/auth/generate-token`, `/auth/list-tokens` e `/custom-fees` **não existem neste repositório** (são da api-machine/api-dom, serviço separado); aqui só existe o `PUT` de merchant, que exigia conta prévia. Decisões:

- [x] **Item 11a, conta do vendedor/afiliado.** `PUT /platforms/EBOOK/merchants/:externalMerchantId` (`merchants:manage`) aceita, além de `{cnpj, legalName}`, `email` (opcional) e `adoptByEmail` (opcional, padrão falso). Sem conta com o documento e com `email`: cria o usuário (nome = `legalName`, `clientStatus APPROVED`, carteira vazia) com **senha aleatória descartada** (hash bcrypt de 32 bytes aleatórios, nunca devolvida nem logada): nenhuma credencial vaza e a conta não é acessível até o titular definir a senha por `POST /auth/forgot-password` com o mesmo e-mail (fluxo já existente; o `PUT` não envia e-mail, para continuar idempotente e sem efeito colateral externo). Resposta ganha `accountCreated`. Idempotente (reenvio devolve o mesmo vendedor, `accountCreated: false`); corrida entre duas chamadas vira 409 e o reenvio converge. Segurança: conta existente **nunca** é assumida por e-mail (409) e o e-mail é ignorado quando o documento já pertence a uma conta (a conta é a do documento); exceção opt-in `adoptByEmail: true`, só para conta ativa, `role USER`, **sem CPF/CNPJ**, sem outro merchant (o caso do vendedor que se cadastrou pelo `/auth/register` legado, que não enviava documento): grava o documento, mantém a senha, o login e a carteira, então quem já entrava pelo legado continua entrando igual. Só plataforma EBOOK aceita `email` (422 nas demais). Sem `email` o contrato anterior permanece (400 sem conta). Commit `1074516e`. Back-ebook: chamar o `PUT` na criação da conta de vendedor/afiliado (`auth.service.ts` `createUser` ~984, `user.service.ts` `createUser`, e como rede de segurança em `prepareSettlement`), com `externalMerchantId = users.id` ou o documento, em vez de `syncUserWithApiDom`.
- [x] **Item 11b, tokens (`generate-token`/`list-tokens`).** O token do vendedor/afiliado é gerado e descartado (usado uma única vez para o `/custom-fees`). `admin_tokens` (só ADMIN) é lido apenas para anexar `&adminToken=` na URL de checkout e no corpo de `/checkout/ebook-url`; o SimIntPay só o repassa na query da URL (`checkout.controller.ts`) e não o valida, e não há consumo financeiro. Nenhuma rota canônica é necessária: **propor remoção** de `saveAdminToken`, `getApiDomTokens`, `syncExistingTokens`, `/admin/tokens`, o `adminToken` do checkout e dos endpoints de debug do back-ebook (`test-sync`, `test-connection`, `get-api-dom-tokens`, este último expõe tokens com e-mail+senha), depois de confirmar que o app de checkout (`SIMPAY_CHECKOUT_URL`) não lê `adminToken`.
- [x] **Item 11c, `/custom-fees`.** Back-ebook envia `{percentage: 14.99, fixedFee: 4.00, type: BOTH}` para todo usuário novo, resposta só logada e nunca lida; o líquido já é calculado pela taxa da plataforma. Equivale à taxa alvo da plataforma (`Platform.targetFeePpm`/GLOBAL, 14,99%) + `TAXA_SERVICO` lidas em `GET .../finance/fees`. **Obsoleto**: remover a chamada; taxa por vendedor não existe nem é necessária (a política é por plataforma). Se um dia houver taxa por vendedor, é nova funcionalidade de política, não um `/custom-fees`.
- [x] **Item 9, `/admin/transacoes-dom`.** Uso real: só `reconcileLocalPendingOrdersWithDom` e `tryReconcileEbookOrderPaid` (casam pedido pendente com a DOM por e-mail+valor+título+janela e marcam `paid`), rota sem autenticação, heurística frágil; nada é mesclado na resposta. Substituto: `GET .../finance/transactions?status=COMPLETED&description=<orderNumber>` (a descrição leva o `ORD-AAAA-NNNNNN`; o pagamento chega por `EBOOK_PENDING_<orderNumber>` completado pelo webhook) ou `GET .../payments/:paymentId` + `POST .../finance/reconciliation/payments` (`sync:run`); com a liquidação (`settleEbookPayment`) o recibo `settlements/receipts` já informa `SETTLED`. Recomendação: trocar a heurística por consulta por `orderNumber` e remover o uso da rota admin. Mapeamento de campos consumidos: `status`→`status` (`paid`→`COMPLETED`), `customer_email`→`customerEmail`, `amount`→`amountCents/100`, `created_at`→`createdAt`, `product_first`→(sem equivalente; usar `orderNumber`). Nenhum código novo.
- [x] **Item 10, `/checkout/ebook-url`.** É o protocolo de matrícula da liquidação (`enrollEbook`, `x-internal-token` = `INTERNAL_SERVICE_TOKEN`, manifesto validado, token de capacidade de 7 dias) e não uma rota financeira por vendedor: **mantido como está** (não é legado a aposentar). Dependência que a Fase A2 resolve: `EBOOK_CANONICAL_IDENTITY_REQUIRED` exige exatamente um usuário ativo por CPF/CNPJ de dono e afiliado do manifesto; o `PUT` acima cria essa conta antes. Recibos continuam em `ebook-receipt-outbox.service.ts` (sentido inverso). Rota canônica por `INBOUND_TOKEN` (ex. `payments:create`) fica como evolução opcional, não criada para não inventar superfície sem consumidor.
- [x] **Saldo por liquidação.** Antes, créditos de `settleEbookPayment` (alocações OWNER/AFFILIATE/COPRODUCER, `BalanceLog` `source EBOOK_V1`, `platformTag EBOOK`) **não** entravam no saldo EBOOK do vendedor: a `Transaction` da liquidação pertence ao criador do checkout e a projeção só lia `Transaction` por `userId`. Agora `PlatformAttributedBalance` (modo vendedor) soma `BalanceLog.balanceDelta` de `EBOOK_V1`/`EBOOK` do vendedor (reversões e bloqueios já líquidos) e ignora as `Transaction` `EBOOK_V1`, uma vez só. Sem a taxa por venda (já descontada na alocação). Commit `e2638434`. Teste: `platform-merchant-ebook-finance.test.ts`.
- [x] **Comissões de afiliado x carteira (análise; nenhuma mudança financeira).**
  - Credita carteira: só alocação `AFFILIATE` da liquidação (`EBOOK_V1`), de pedidos com manifesto. Conta no saldo EBOOK (acima).
  - **Não credita:** `credit-commission` legado e `POST .../finance/entries kind: "commission"` (`LEGACY_RECORD_ONLY`): `Transaction COMPLETED` `[AFFILIATE_COMMISSION]` sem `BalanceLog`; o back-ebook só as entrega para pedidos **sem** manifesto. O afiliado as vê no histórico e não consegue sacar. A projeção de vendedor as ignora de propósito (senão o saldo ficaria acima da carteira real; o teto `min(plataforma, carteira)` esconderia, mas não corrigiria).
  - Opções para as record-only: (1) manter (histórico apenas) e migrar todo pedido para manifesto, o caminho correto e sem risco de crédito duplo; (2) novo `kind: "commission-credit"` que credita a carteira com `BalanceLog` `source EBOOK_COMMISSION`, `platformTag EBOOK`, idempotente por `referenceId`; **risco**: dinheiro real sem lastro (quem paga a comissão? o líquido do dono já foi creditado por inteiro no caminho sem manifesto, logo creditar o afiliado criaria saldo sem origem, ou exigiria debitar o dono) e crédito duplo se o pedido depois ganhar manifesto; (3) ajuste manual administrativo. **Superado pela Fase A3**: por decisão do dono, comissões novas pela rota canônica creditam a carteira (opção 2, com dedupe por manifesto); linhas legadas gravadas continuam record-only.
  - Comparação do `summary` legado (soma de `Transaction COMPLETED` EBOOK do usuário, `net − TAXA_SERVICO`, comissão sem taxa, saques) com o novo (projeção atribuída): **dono (sem manifesto)** igual, exceto histórico sem `platformTag` (legado exclui pela mesma tag; o canônico idem) e coprodução: o legado soma o líquido inteiro, o novo aplica `allocateNet` do snapshot (parte do dono). **Dono (com manifesto)**: legado não vê a venda (a `Transaction` é do criador do checkout), novo soma a alocação OWNER. **Afiliado**: legado inclui as comissões record-only (sem lastro, valor maior que o sacável), novo as exclui e soma as alocações AFFILIATE de manifesto. **Coprodutor**: legado não tem `Transaction` própria, saldo zero; novo soma a alocação COPRODUCER só para liquidações (`EBOOK_V1`); a coprodução do caminho `FINAL_NET` não grava `platformTag` no `BalanceLog` e **continua fora** do saldo EBOOK por vendedor (lacuna conhecida, exige gravar `platformTag` nos créditos, plano 0019). Saques: legado soma todas as plataformas, novo só as da plataforma.

### Fase A3. Preço no servidor, juros e comissão com crédito de carteira (feito, local, sem push)

Decisão do dono: comissões novas devem creditar a carteira e as entradas de cartão devem registrar juros. Verificação: o gatilho `balance_log_sync_wallet` (`prisma/migrations/20261031130000_balance_log_drives_wallet`, `AFTER INSERT ON "BalanceLog"`) recalcula `Wallet` por `SUM(balanceDelta/lockedDelta)` sob trava por usuário e cria a carteira se faltar; `applyWalletEntry` (`wallet-ledger.ts`) só insere o `BalanceLog`. Logo, gravar `BalanceLog` basta para creditar.

- [x] `POST .../finance/entries` (só a rota por vendedor; a rota de plataforma e a legada ficam iguais): `amountCents` = **valor pago pelo comprador, juros incluídos**; `netAmountCents` opcional. O servidor deriva o líquido de `paymentMethod` + `installments` + `amountCents` com a cotação do checkout (`loadChargePolicy`/`quoteFinancialCharge`, a mesma de `finance/fees`), invertendo o total pago sobre o valor sem juros (`quotePaidAmount` em `platform-fee-schedule.ts`). Se `netAmountCents` vier e diferir: **409 `LEDGER_NET_MISMATCH`** com `expectedNetAmountCents` (rejeitar, nunca aceitar silenciosamente). Total que nenhuma parcela reproduz (ou PIX com parcelas): 400. Modalidade sem custo/política configurada: 422 `FEE_POLICY_UNAVAILABLE`. Reenvio idempotente usa o líquido gravado na primeira vez (mudança de taxa não vira conflito). Gravado na `Transaction`: `installments`, `amount` (pago), `netAmount`, `totalFee`, `platformFee`, `acquirerFee` (custo cotado) e `financialSnapshot` com a cotação (juros do comprador `buyerInterestCents`, custo de juros etc.).
- [x] O webhook DOM que conclui `EBOOK_PENDING_<ref>` passou a manter o líquido gravado quando a entrada tem `financialSnapshot` (antes recalculava pelo atalho LIQUIDEZ e perderia juros e taxa alvo); o crédito continua `líquido − TAXA_SERVICO`.
- [x] `kind: "commission"`: **credita a carteira** por `BalanceLog` (`source EBOOK_COMMISSION`, `action EBOOK_COMMISSION_CREDITED`, `platformTag EBOOK`, `nature COMMISSION`), idempotente por `EBOOK_AFFCOMM_<referenceId>` (reenvio nunca credita de novo; mesma referência com valor diferente dá 409). Sem taxa nem juros (`netAmountCents`, se enviado, tem de ser igual a `amountCents`). **`orderNumber` obrigatório**: se existir `EbookSettlement` desse pedido, nada é gravado nem creditado (`created: false`, `skipped: "SETTLEMENT_CREDITS_AFFILIATE"`), pois `settleEbookPayment` já credita a alocação AFFILIATE. O risco inverso (liquidação matriculada depois da comissão) é barrado pelo back-ebook (`prepareSettlement` recusa se já existe comissão legada); manter essa trava.
- [x] Saldo EBOOK por vendedor soma `BalanceLog` `EBOOK_COMMISSION` (e `EBOOK_V1`); a `Transaction` da comissão não é somada de novo, e linhas legadas `[AFFILIATE_COMMISSION]` sem `BalanceLog` continuam fora (record-only).
- [x] Origem do dinheiro: o back-ebook decide o valor da comissão; no caminho sem manifesto o líquido do dono ainda é creditado por inteiro, então **este crédito não é debitado do dono** (decisão do dono: crédito novo). Documentado como ponto de atenção financeiro; não há débito automático.
- Testes: `platform-merchant-ebook-finance.test.ts` (preço no servidor, 409 de líquido, parcelas com juros, comissão com `BalanceLog`, idempotência, pulo por liquidação, saldo). A rota legada `credit-commission` continua só registro.

#### Contrato final de `POST /platforms/EBOOK/merchants/:externalMerchantId/finance/entries` (`ledger:write`)

```json
// venda pendente PIX (líquido calculado pelo servidor)
{ "referenceId": "ORD-2026-000001", "kind": "pending", "amountCents": 10000,
  "paymentMethod": "PIX", "description": "ORD-2026-000001 [CPF_DONO:12345678901] [NOME_DONO:Maria]",
  "customerName": "Comprador", "customerEmail": "c@x.com", "customerDocument": "98765432100" }
// venda pendente cartão 12x: amountCents = total pago com juros
{ "referenceId": "ORD-2026-000002", "kind": "pending", "amountCents": 11965,
  "paymentMethod": "CREDIT_CARD", "installments": 12, "netAmountCents": 8100 }
// comissão (credita a carteira; orderNumber obrigatório)
{ "referenceId": "AFF-1-2", "orderNumber": "ORD-2026-000009", "kind": "commission",
  "amountCents": 800, "paymentMethod": "PIX", "description": "Comissão de afiliado" }
```

Campos aceitos: `referenceId, orderNumber (só comissão), kind, amountCents, netAmountCents?, paymentMethod (PIX|CREDIT_CARD), installments (1-12; PIX só 1), description, customerName, customerEmail, customerDocument`; qualquer outro: 400. Respostas: `{success, id, created}`; comissão de pedido com liquidação: `{success, created: false, skipped: "SETTLEMENT_CREDITS_AFFILIATE"}`. Erros: 409 `LEDGER_NET_MISMATCH {expectedNetAmountCents}`, 409 `LEDGER_REFERENCE_CONFLICT`, 422 `FEE_POLICY_UNAVAILABLE`, 400 total/parcelas incoerentes. O valor de `amountCents` do exemplo de 12x é ilustrativo: obtenha o total com `GET .../finance/fees` (`credit[n].buyerTotalCents`) para o valor-base.

### Fase B. Preparação (dono/ops; fora do código)

- [ ] Provisionar **todos** os vendedores existentes: `PUT /platforms/EBOOK/merchants/<cpf|cnpj>` `{cnpj, legalName, email}` (lista a partir do banco do back-ebook; a conta é criada se faltar; afiliados também, para receber comissão). Para vendedores já cadastrados pelo `/auth/register` legado (sem documento no SimIntPay) decidir `adoptByEmail: true` caso a caso (só após confirmar que o e-mail do back-ebook é verificado). Titulares sem senha usam `POST /auth/forgot-password`.
- [ ] Criar o `INBOUND_TOKEN` da plataforma EBOOK e definir `INBOUND_OPERATIONS=merchants:manage,finance:read,finance:withdraw,ledger:write` (painel de integrações da plataforma). Guardar o token no segredo do back-ebook como `SIMINTPAY_TOKEN`.
- [ ] Conferir/ajustar a taxa alvo da plataforma EBOOK em `/admin/taxas` e o custo das adquirentes sincronizado (sem linha, as modalidades saem `available: false`).
- [ ] Validar em ambiente de teste um vendedor com vendas em EBOOK e em outra plataforma: `summary.availableBalanceCents` só EBOOK.

### Fase C. back-ebook (outro repositório; não alterado aqui)

- [ ] `common/seller-fees.ts`: trocar `summary` por `finance/fees` (`percent = pix.processingRatePpm / 10000`, `fixedBrl = transaction.serviceFeeCents / 100`, `withdrawalBrl = withdrawal.fixedFeeCents / 100`), cache por vendedor mantido.
- [ ] `checkout.service.ts` `notifyPendingTransaction`: `POST .../finance/entries` (`kind: pending`, centavos, `referenceId = orderNumber`, `netAmountCents` calculado com `fees`).
- [ ] `checkout.service.ts` fallback de `config`: `GET /platforms/EBOOK/finance/config` (`liquidityRate`, `transactionFeeCents / 100`).
- [ ] `affiliate/commission-delivery.ts`: `POST .../finance/entries` (`kind: commission`, `externalMerchantId` do afiliado), mantendo `referenceId` do snapshot; tratar 404 (afiliado sem vendedor) como erro de reconciliação manual.
- [ ] `payments.controller.ts`: `summary`, `history`/`all-transactions-excel`, `withdrawals`, `withdraw` (`idempotencyKey`, bruto x líquido) pelas rotas por vendedor; centavos para reais na borda; `PAID`→`COMPLETED`; `accountExists` por 404 do `summary`.
- [ ] Aplicar as decisões da Fase A2 no back-ebook: chamar o `PUT` (com `email`) na criação de vendedor/afiliado e remover `syncUserWithApiDom`, tokens (`admin_tokens`, `adminToken`) e `/custom-fees`; trocar `/admin/transacoes-dom` por consulta por `orderNumber`; manter `/checkout/ebook-url`. Confirmar que o app de checkout ignora `adminToken`.
- [ ] Teste de ponta a ponta contra o SimIntPay local (sem banco remoto).

### Fase D. Virada (dono/ops)

- [ ] Apontar `API_MACHINE_URL` do back-ebook (ou a nova variável `SIMINTPAY_URL`) para o SimIntPay com `SIMINTPAY_TOKEN`; observar o tráfego legado até zero (log do interceptor `legacy-platform-usage.interceptor.ts`).
- [ ] Vendedor a vendedor: comparar `summary` legado x canônico (diferenças esperadas em 3.1) antes de liberar saques.

### Fase E. Remoção do legado (só após a Fase D com consumo zero)

- [ ] Remover `internal-ebook-finance.controller.ts`, `legacy-ebook-finance.service.ts` e o registro em módulos.
- [ ] Remover os contratos `/internal/ebook/finance/*` de `legacy-platform-contracts.ts`, as linhas de `docs/legacy-platform-routes.md` e `docs/legacy-platform-equivalence.md`, e os testes/evidências que dependem deles (atualizar as contagens 136/127 dos testes de inventário).
- [ ] Remover `API_MACHINE_URL`, `API_MACHINE_INTERNAL_TOKEN`, `API_MACHINE_INTERNAL_URL` e `INTERNAL_SERVICE_TOKEN` das chamadas financeiras do back-ebook (o token de recebimento de `settlements/receipts` e das rotas internas do back-ebook continua enquanto o sentido inverso existir).
- [ ] Mover este plano para `plans/done/`.

## 5. Dúvidas em aberto

- Semântica do valor de saque exposta ao vendedor (líquido, como no legado, ou bruto), ver 3.5.
- Fim do enriquecimento DOM (nome/e-mail) no histórico: aceitável, dado que `customerName/customerEmail` já são gravados no lançamento?
- Fundos de outras plataformas sacando o saldo do EBOOK (3.1 Limites, item a): exige escopo no saque de todas as plataformas ou `BalanceLog.platformTag`; decisão do dono.
- Comissão de afiliado: resolvida na Fase A3 (nova comissão credita a carteira; pedido com liquidação é pulado).
- Comissões record-only legadas (já gravadas sem `BalanceLog`): decidir se recebem crédito retroativo (backfill) ou ficam só no histórico; novas comissões já creditam (Fase A3).
- `adoptByEmail`: o e-mail do back-ebook é verificado? Só então é seguro vincular contas legadas sem documento.
- Coprodução fora da liquidação (`FINAL_NET`) sem `platformTag` no `BalanceLog`: fora do saldo EBOOK por vendedor.

## 6. Restrições

- Sem push, deploy, migration, seed ou comando contra banco remoto/compartilhado; sem criar credenciais ou alterar integrações de produção a partir daqui.
- Integração/E2E apenas, pelo runner descartável; sem testes unitários novos fora do estilo do repositório.
- O legado não é removido nesta etapa.
