# Delivery — integração canônica

## Configuração e publicação

Aplicar primeiro as migrations `20261022180000_delivery_platform_registration` e
`20261022190000_canonical_delivery_api` na SIM INT PAY; aplicar migration
`20261022190000_canonical_simpay_api` no Delivery. Comandos deste guia são para operador;
a implementação não aplica migrations nem publica serviços remotamente.

SIM INT PAY exige `PLATFORM_CONFIG_ENCRYPTION_KEY` (32 bytes em hexadecimal),
`SIM_DELIVERY_PROVISIONING_TOKEN`, `JWT_SECRET`/SMTP para senha opcional e
`SIM_DELIVERY_CANONICAL_WEBHOOK_URL=https://<delivery-api>/integrations/simintpay`.
Delivery exige `SIMPAY_API_URL`, `SIMPAY_PROVISIONING_TOKEN` com mesmo valor,
`BETTER_AUTH_SECRETS` já utilizado pela autenticação. Delivery deriva uma chave
específica para SIM INT PAY por HKDF-SHA256 e grava a versão do segredo junto do
ciphertext; ao rotacionar, manter versões anteriores enquanto existirem credenciais
criptografadas por elas. `SIMPAY_CREDENTIALS_ENCRYPTION_KEY` (32 bytes em hexadecimal)
é alternativa dedicada opcional, preservada para registros anteriores no formato v1.
Registros v2 continuam legíveis se uma chave dedicada for adicionada posteriormente.
Segredos ficam somente nos backends. Preservar chaves e versões em backups.

Perfil DOM central: a aquisição usa a mesma conta DOM do admin SIM INT PAY,
configurada por `DOM_TOKEN` (ou alias `API_DOM_MASTER_KEY`). O primeiro bootstrap
empresarial cria automaticamente o perfil `DELIVERY` com essa credencial; nenhuma
variável ou etapa manual adicional é necessária. Carteiras e repasses empresariais
continuam separados no ledger interno, sem exigir contas DOM distintas.
`bun scripts/configure-delivery-profile.ts` inspeciona o perfil (dry-run);
`bun scripts/configure-delivery-profile.ts --apply` permite antecipar essa mesma
inicialização automática. Perfil existente não tem credencial rotacionada, não é
reativado e não troca de adquirente automaticamente.
Não existe herança da configuração de outra plataforma. A conta DOM central é a
origem de aquisição, enquanto as credenciais delegadas delimitam cada empresa.

Publicar SIM INT PAY primeiro. Executar `bun scripts/audit-delivery-canonical.ts` e
`bun scripts/audit-simpay-canonical.ts` no backend Delivery (somente leitura). Resolver
conflitos antes da troca e validar empresa piloto; depois publicar Delivery. Acompanhamento:
reservas pendentes, tentativas em submitting/pending, inbox não processada e eventos com
lastError/nextAttemptAt. Nenhum desses relatórios contém credenciais.

## Bootstrap: origem autenticada Delivery

`x-provisioning-token` usa credencial de serviço, nunca JWT do dono ou ADMIN.
Aliases temporários: `SIMPAY_INTERNAL_TOKEN` no Delivery e `SIM_DELIVERY_INTERNAL_TOKEN`
na SIM INT PAY (incluindo fallbacks legados API_MACHINE_INTERNAL_TOKEN/INTERNAL_SERVICE_TOKEN quando não há chave dedicada), somente para bootstrap. Operações financeiras usam credencial delegada.

- `PUT /platform-registrations/:companyId`: `{ "slug": "estacao-237", "legalName": "Estação 237" }`.
  Retorna `{ id, status: "PENDING_OWNER" }`. Não cria usuário ou carteira.
- `PUT /platform-registrations/:companyId/owner`: mesmo slug/legalName, `email`,
  `password?`, `cnpj?` (CPF/CNPJ opcional). Retorna `{ id, status: "READY", platform:
{ id, tag }, merchant: { id }, credentials: { accessToken, webhookSecret } }`.
  `id` dessa resposta identifica comerciante; usar `platform.id` para plataforma.
- Repetir PUT de reserva após conclusão recupera credenciais existentes. Não rotaciona
  senha, token ou segredo nem zera saldo. Repetir dono sem senha reenvia link próprio.
  Email/documento de outra conta não autoriza associação. Donos adicionais não trocam titular.
- ID da reserva vira ID da plataforma nova; vínculos antigos preservam ID original.
  Namespace só muda automaticamente antes da conclusão. Não enviar IDs de contas no corpo.

Antes de ativar credenciais no Delivery, referências pendentes são verificadas por
`POST /platform-registrations/:companyId/compatibility`, autenticado pelo mesmo token
de provisionamento, `{ "references": ["payment-id"] }` em lotes de até 500.
Operação somente de leitura: retorna `{ compatible, conflicts }`, sem consulta ao
adquirente, sem reatribuir titular e sem mover saldo. Conflito bloqueia armazenamento
de credenciais no Delivery; resolver associação administrativamente antes da troca.

## Operações canônicas

Base `/platforms/:tag/merchants/:companyId`, header `x-access-token` da empresa.
Token não pode acessar outra empresa, plataforma ou rotas financeiras gerais. Permissões:
customers:manage, cards:tokenize, payments:create/read/allocate, finance:read/withdraw,
merchants:manage e sync:run. Plataforma, perfil e titular precisam estar ativos.

| Método / sufixo                       | Contrato                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| PUT raiz                              | `{ cnpj, legalName }`; sincroniza CPF/CNPJ no comerciante existente, inclusive legado                                              |
| POST /customers                       | `{ externalCustomerId, name, email, document, phone? }` → `{ id }` canônico                                                        |
| POST /customers/:id/card-tokens       | `{ number, cvv, expMonth, expYear, holderName, holderDocument }` → token, bin real, last4, brand, validade, holderName, customerId |
| POST /payments                        | contrato abaixo; PIX e CREDIT_CARD na mesma rota                                                                                   |
| GET /payments/:reference              | referência da transação ou do adquirente; status após reconciliação necessária                                                     |
| GET /payment-attempts/:key            | recupera resposta por chave idempotente sem nova cobrança                                                                          |
| GET /finance/summary                  | saldo disponível, bloqueio, processamento; feePolicy.fixedCents e rate decimal                                                     |
| POST /finance/withdrawals/quote       | `{ amountCents }` bruto → grossAmountCents, feeCents, netAmountCents                                                               |
| POST /finance/withdrawals             | `{ amountCents, pixKey, idempotencyKey }` bruto; resposta amountCents é líquido, com requestId e timestamps                        |
| GET /finance/withdrawals              | `page`, `limit`; `{ data, meta: { page, limit, total, totalPages } }`                                                              |
| GET /finance/withdrawals/:id          | inclui bruto, líquido em amountCents, taxa, status e referência                                                                    |
| POST /finance/reconciliation/payments | `{ paymentIds, dryRun: true }`; conflitos sem transferência financeira                                                             |

Exemplo PIX:

```json
{
  "amountCents": 10537,
  "paymentMethod": "PIX",
  "idempotencyKey": "attempt-id",
  "allocation": { "merchantAmountCents": 10000, "platformFeeCents": 537 },
  "description": "Pedido [Unidade - Centro]",
  "customer": {
    "name": "Maria Silva",
    "email": "maria@example.com",
    "document": "52998224725",
    "documentType": "CPF"
  }
}
```

Cartão acrescenta `card: { token, holderName, bin, brand, installments }`. PAN/CVV
só transitam na tokenização; não persistir nem registrar. BIN nunca deriva do token.
Resposta pagamento: transactionId, paymentId, status, amountCents, netAmountCents,
pixContent, qrCode, pixExpire. Todos valores monetários são centavos inteiros.
Divisão Delivery exige total igual soma das parcelas e congela snapshot
SIM_DELIVERY_ALLOCATION_V1. Não acrescenta juros/taxas nem desconta custos do lojista.
API genérica não permite esse override por corpo sem credencial autorizada.

Persistir tentativa antes do envio. Timeout não autoriza nova cobrança: consultar
payment-attempts com mesma chave. PAYMENT_PROCESSING/IDEMPOTENCY_CONFLICT não são
recusa do cartão. Só resultado terminal comprovado permite nova tentativa. Cartão
antigo sem BIN real exige nova digitação; atualização do cartão salvo só com consentimento.

## Eventos e histórico

SIM INT PAY envia POST `${SIM_DELIVERY_CANONICAL_WEBHOOK_URL}/:companyId/events`.
Header `x-simintpay-signature` = HMAC-SHA256 hexadecimal dos bytes exatos do JSON,
com webhookSecret da credencial empresarial. Receiver precisa validar assinatura
antes de interpretar payload; não reserializar JSON para calcular assinatura.
Payload: eventId, kind (`payment.updated`/`withdrawal.updated`), platformId,
externalMerchantId, status, updatedAt, requestId e referências do pagamento/saque.
Validar empresa/plataforma e referências contra registros locais. Inbox deduplica
companyId/eventId; callbacks anteriores à resposta HTTP permanecem para retomada.
Outbox tem lease e retentativa; polling continua como recuperação.

Rotas antigas e receptores antigos continuam durante drenagem. Novas cobranças usam
somente contrato canônico. Vínculos antigos explícitos são lidos sem criar segundo
comerciante, reatribuir histórico, mover saldos ou alterar snapshots. Referência sem
vínculo inequívoco exige revisão administrativa. Bootstrap de empresas históricas
recupera credenciais por companyId, nunca por email. Quando comerciante histórico
não tem `LEGACY_MERCHANT_KEYS`, bootstrap reutiliza a única plataforma já pertencente
ao titular identificado pelo `userId` do comerciante, preservando ID, tag e histórico.
Plataforma desativada, múltiplas plataformas do titular ou vínculo com outra empresa
exigem associação explícita; não criam uma plataforma substituta.

Estorno automático permanece indisponível enquanto operação real do adquirente não
estiver implementada; Delivery conserva alternativa manual existente.

O ID da empresa identifica o cadastro mesmo após mudança de slug no Delivery.
Após ativação, tag e namespace da plataforma permanecem estáveis; repetir bootstrap
com novo slug recupera o vínculo existente. Vínculo histórico único pelo ID da
empresa preserva o namespace original; múltiplos candidatos exigem revisão.

## Coprodução configurada na SimIntPay

Cobranças novas detalham `allocation.itemsAmountCents` e `deliveryAmountCents`;
soma igual a `merchantAmountCents`. Itens já descontam cupom, cashback e pontos;
frete não participa dos percentuais. Payload continua sem participantes/percentuais.
SimIntPay divide exclusivamente base de itens, credita restante e frete integral à
empresa, preservando taxa da plataforma e total pago. Configuração e recebimentos
são privados da SimIntPay; callbacks e contratos públicos Delivery não mudam.

Campos opcionais para contratos anteriores sem acordo ativo. Com coprodução ativa,
ausência/inconsistência bloqueia criação antes do adquirente, com código
COPRODUCTION_BASE_REQUIRED/COPRODUCTION_BASE_INVALID. São erros operacionais, não
recusa de cartão. Tentativas já abertas conservam sua divisão e chave originais.
Publicar backend SimIntPay compatível antes do Delivery; habilitar acordos somente
após envio do detalhamento e auditoria dos vínculos empresariais.
