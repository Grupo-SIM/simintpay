# Cobrança recorrente por quantidade com pró-rata — Design universal

**Data:** 2026-08-15

**Repositório:** `simintpay-back`

**Destino:** handoff para o agente que implementará a integração com workspaces

**Status:** implementado neste repositório; capacidades da DOM confirmadas na documentação oficial em 2026-08-15

---

## 1. Resultado pretendido

Implementar um núcleo de cobrança que não conheça o conceito de workspace. Ele deve servir para qualquer recurso cujo preço recorrente dependa de:

- um preço base opcional;
- um preço unitário;
- uma quantidade contratada;
- um ciclo de cobrança;
- mudanças de quantidade ao longo do ciclo;
- uma política de ajuste temporal, como pró-rata.

O workspace será apenas uma integração de domínio: ele associa seu ID a um contrato de cobrança e transforma a quantidade faturada em limite de pessoas. O mesmo núcleo poderá futuramente atender licenças, dispositivos, unidades, créditos reservados, lojas, projetos ou qualquer outro recurso mensurável.

### Fórmula geral do valor recorrente

```text
valor_recorrente = preco_base + soma(preco_unitario_do_componente * quantidade_do_componente)
```

O primeiro recorte pode ter um único componente variável:

```text
valor_recorrente = preco_base + preco_unitario * quantidade
```

O modelo e os nomes, porém, não devem pressupor que a unidade seja uma pessoa.

Neste documento, `preco_base` é um valor **recorrente** cobrado em todo ciclo, mesmo se a quantidade variável for zero. Uma taxa única de implantação/adesão deve ser outro componente (`setupAmount`) e outra transação; ela não entra na base do pró-rata de quantidade.

---

## 2. Princípios e decisões recomendadas

1. **Preço é resolvido no backend.** O cliente informa a quantidade desejada; nunca informa o valor da cobrança.
2. **A API recebe quantidade final, não apenas delta.** `targetQuantity=15` é mais idempotente e auditável que `add=5`.
3. **Pró-rata e nova recorrência são coisas diferentes.** O pró-rata é um ajuste avulso do período corrente; a nova quantidade altera o valor dos períodos futuros.
4. **O período do gateway é a fonte de verdade.** Usar `currentPeriodStart` e `currentPeriodEnd` retornados/persistidos a partir do provedor. Não inferir o período apenas por `createdAt`.
5. **Acréscimos são cobrados imediatamente por padrão.** O direito adicional só é liberado após confirmação do pagamento e da atualização da recorrência.
6. **Reduções entram no próximo ciclo por padrão.** Não gerar crédito ou estorno automático no MVP. Isso evita uso temporário seguido de redução e simplifica conciliação.
7. **Dinheiro usa `Prisma.Decimal` ou centavos inteiros.** Nunca calcular valores financeiros com `number`/ponto flutuante.
8. **Toda mutação exige idempotência e controle de concorrência.** Repetir uma requisição não pode duplicar cobrança; duas alterações simultâneas não podem sobrescrever uma à outra.
9. **Chamadas externas não ficam dentro de uma transação longa do banco.** Usar operação persistida com estados, no formato saga/outbox.
10. **Webhooks confirmam estado financeiro.** Uma resposta HTTP síncrona do gateway não deve ser a única fonte para liberar o recurso quando o pagamento permanecer pendente.

---

## 3. Vocabulário universal

| Conceito              | Significado                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `BillableResource`    | Recurso externo faturável. Representado por `resourceType` + `resourceId`; não precisa de tabela própria no núcleo. |
| `BillingContract`     | Estado comercial e recorrente vigente para um recurso faturável.                                                    |
| `BillingComponent`    | Componente do preço, por exemplo `BASE` ou `UNIT`. No MVP pode estar embutido no contrato.                          |
| `BillingPeriod`       | Intervalo já pago ou a pagar, delimitado por início e fim.                                                          |
| `QuantityChange`      | Operação auditável que muda a quantidade atual para uma quantidade alvo.                                            |
| `ProrationAdjustment` | Débito ou crédito calculado pela fração restante do período.                                                        |
| `Entitlement`         | Direito de uso concedido ao domínio consumidor. Para workspace, será o limite de pessoas.                           |
| `BillingAnchor`       | Referência de renovação do contrato. O gateway deve ser a fonte preferencial.                                       |

O núcleo de billing não deve importar serviços ou tipos de workspace. A integração deve acontecer por uma porta/evento, por exemplo:

```ts
interface BillingEntitlementPort {
  applyQuantity(input: {
    resourceType: string;
    resourceId: string;
    quantity: number;
    billingChangeId: string;
  }): Promise<void>;
}
```

---

## 4. Cálculo do pró-rata

Para uma alteração efetiva dentro do período atual:

```text
valor_antigo = preco_base + preco_unitario * quantidade_anterior
valor_novo   = preco_base + preco_unitario * quantidade_nova
delta_periodico = valor_novo - valor_antigo

fracao_restante = segundos_entre(data_efetiva, fim_periodo)
                  / segundos_entre(inicio_periodo, fim_periodo)

ajuste_bruto = delta_periodico * fracao_restante
ajuste_final = arredondar_uma_vez(ajuste_bruto, 2 casas)
```

Para uma mudança apenas de quantidade, o preço base se cancela:

```text
ajuste = (quantidade_nova - quantidade_anterior)
         * preco_unitario
         * fracao_restante
```

### Exemplo

```text
preco_base            = R$ 100,00
preco_unitario        = R$ 20,00
quantidade_anterior   = 10
quantidade_nova       = 13
periodo               = 30 dias
tempo_restante        = 12 dias

valor recorrente antigo = 100 + 20 * 10 = R$ 300,00
valor recorrente novo   = 100 + 20 * 13 = R$ 360,00
delta periódico         = R$ 60,00
pró-rata                 = 60 * 12/30 = R$ 24,00
```

Resultado:

- cobra R$ 24,00 agora;
- passa a cobrar R$ 360,00 nos próximos ciclos;
- depois da confirmação, a quantidade efetiva passa de 10 para 13.

### Regras temporais

- Persistir instantes em UTC.
- Usar intervalo semiaberto `[periodStart, periodEnd)`.
- Limitar a fração ao intervalo `0..1`.
- Para ciclos mensais, usar a duração real do período; não assumir sempre 30 dias.
- Preferir períodos retornados pelo gateway para tratar meses de 28–31 dias e âncoras como dia 29, 30 ou 31.
- Se `effectiveAt >= periodEnd`, não há pró-rata do período encerrado; a mudança deve ser aplicada ao ciclo seguinte.
- Arredondar apenas o resultado financeiro final. Persistir também os operandos usados no cálculo para auditoria.

### Políticas do MVP

| Mudança                     | Política recomendada                                           |
| --------------------------- | -------------------------------------------------------------- |
| Aumento de quantidade       | Cobrança positiva imediata e alteração da próxima recorrência. |
| Redução de quantidade       | Agendar para `periodEnd`, sem crédito automático.              |
| Mesma quantidade            | Retornar sucesso idempotente sem criar cobrança.               |
| Quantidade abaixo do mínimo | Rejeitar com 400.                                              |
| Contrato inativo/cancelado  | Rejeitar com 409.                                              |

Crédito proporcional por redução pode ser adicionado depois como uma política explícita (`CREDIT_BALANCE`, `REFUND` ou `NONE`), sem mudar a fórmula central.

---

## 5. API recomendada

### 5.1 Contratação inicial

```http
POST /billing/contracts
Authorization: Bearer <token>
Idempotency-Key: <uuid-ou-chave-estavel>
Content-Type: application/json
```

Body conceitual:

```json
{
  "resourceType": "WORKSPACE",
  "resourceId": "uuid",
  "priceKey": "STANDARD_MONTHLY",
  "initialQuantity": 10,
  "paymentMethodToken": "token-do-gateway"
}
```

- `priceKey` referencia uma configuração comercial conhecida pelo servidor. O backend resolve e salva snapshots de preço base, preço unitário, moeda e intervalo.
- Uma integração fechada pode omitir `resourceType`, `resourceId` e `priceKey` do HTTP e resolvê-los pelo domínio; eles aparecem aqui para mostrar o comando universal.
- Não aceitar `baseAmount`, `unitAmount` nem `recurringAmount` de um frontend não confiável.
- Para recorrência automática no estado atual, a contratação deve usar cartão. O PIX existente em link de assinatura é uma cobrança avulsa, não uma autorização de débitos mensais futuros.

Fluxo inicial recomendado:

```text
validar recurso, permissionamento e idempotência
  → resolver tabela/preço comercial
  → calcular preco_base + preco_unitario * quantidade_inicial
  → criar/reutilizar plano no gateway
  → criar assinatura pré-paga (primeira cobrança agora)
  → persistir contrato e período retornado pelo gateway
  → após confirmação, aplicar quantidade inicial ao recurso
```

Se houver `setupAmount`, criar uma transação avulsa separada e registrar claramente sua natureza. Não somá-la ao preço do plano recorrente.

Resposta resumida:

```json
{
  "contractId": "uuid",
  "status": "ACTIVE",
  "quantity": 10,
  "baseAmount": "100.00",
  "unitAmount": "20.00",
  "recurringAmount": "300.00",
  "periodStart": "2026-08-01T00:00:00.000Z",
  "periodEnd": "2026-09-01T00:00:00.000Z",
  "version": 1
}
```

### 5.2 Mudança de quantidade no núcleo universal

```http
POST /billing/contracts/:contractId/quantity-changes
Authorization: Bearer <token>
Idempotency-Key: <uuid-ou-chave-estavel>
Content-Type: application/json
```

Body:

```json
{
  "targetQuantity": 13,
  "expectedVersion": 4,
  "effectiveAt": "2026-08-15T12:00:00.000Z"
}
```

Recomendações:

- `effectiveAt` deve ser opcional e assumir o horário do servidor.
- Clientes comuns não devem poder enviar uma data passada ou arbitrariamente futura; esse campo pode ser interno/admin-only.
- `expectedVersion` permite detectar uma tela desatualizada e responder 409.
- `Idempotency-Key` é obrigatório para toda mudança que possa cobrar.

Resposta para aumento já confirmado:

```json
{
  "changeId": "uuid",
  "status": "APPLIED",
  "contractId": "uuid",
  "previousQuantity": 10,
  "targetQuantity": 13,
  "effectiveQuantity": 13,
  "periodStart": "2026-08-01T00:00:00.000Z",
  "periodEnd": "2026-09-01T00:00:00.000Z",
  "remainingRatio": "0.5322580645",
  "prorationAmount": "31.94",
  "previousRecurringAmount": "300.00",
  "nextRecurringAmount": "360.00",
  "payment": {
    "transactionId": "uuid",
    "status": "COMPLETED"
  },
  "version": 5
}
```

Resposta quando a cobrança precisa de ação do pagador:

```json
{
  "changeId": "uuid",
  "status": "PENDING_PAYMENT",
  "prorationAmount": "31.94",
  "payment": {
    "transactionId": "uuid",
    "status": "PENDING",
    "checkoutUrl": "https://..."
  }
}
```

Resposta para redução agendada:

```json
{
  "changeId": "uuid",
  "status": "SCHEDULED",
  "previousQuantity": 13,
  "targetQuantity": 8,
  "effectiveQuantity": 13,
  "scheduledFor": "2026-09-01T00:00:00.000Z",
  "prorationAmount": "0.00",
  "nextRecurringAmount": "260.00"
}
```

### 5.3 Adaptador para workspace

O sistema com workspaces pode expor uma rota conveniente:

```http
POST /workspaces/:workspaceId/billing/quantity-changes
```

Ela deve somente:

1. autenticar que o usuário pode administrar o workspace;
2. localizar o `BillingContract` por `resourceType='WORKSPACE'` e `resourceId=workspaceId`;
3. delegar ao mesmo `ChangeBillingQuantityUseCase` universal;
4. aplicar o novo limite no workspace apenas quando a operação estiver `APPLIED`;
5. para redução agendada, manter o limite atual até `scheduledFor`.

Não duplicar cálculo, cobrança ou regras temporais no módulo de workspace.

### 5.4 Consulta recomendada

```http
GET /billing/contracts/:contractId
GET /billing/contracts/:contractId/quantity-changes/:changeId
```

A segunda rota é necessária para polling quando pagamento ou migração da recorrência forem assíncronos.

---

## 6. Modelo de dados recomendado

O schema atual não registra quantidade, preço unitário, período vigente, versão ou histórico de mudança. Não é suficiente usar apenas `SubscriptionLink.amount` ou `SubscriptionLinkOrder.amountCharged`, porque esses valores são snapshots de checkout, e alterar o link não altera assinantes existentes.

### 6.1 `BillingContract`

Proposta Prisma conceitual:

```prisma
model BillingContract {
  id                     String   @id @default(uuid())
  userId                 String
  resourceType           String
  resourceId             String
  priceKey               String?
  pricingVersion         Int?
  currency               String   @default("BRL")
  baseAmount             Decimal  @db.Decimal(12, 2)
  unitAmount             Decimal  @db.Decimal(12, 2)
  quantity               Int
  pendingQuantity        Int?
  minimumQuantity        Int      @default(1)
  intervalType           String   @default("MONTH")
  intervalCount          Int      @default(1)
  currentPeriodStart     DateTime
  currentPeriodEnd       DateTime
  billingAnchor          DateTime?
  status                 String   @default("ACTIVE")
  version                Int      @default(1)
  acquirer               Acquirer @default(DOM)
  externalPlanId         String?
  externalSubscriptionId String?  @unique
  metadata               Json?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  changes                BillingQuantityChange[]

  @@unique([resourceType, resourceId])
  @@index([userId])
  @@index([status])
  @@index([currentPeriodEnd])
}
```

Observações:

- `resourceType/resourceId` mantém o núcleo universal, embora não ofereça FK ao domínio consumidor.
- `userId` representa o dono/merchant no SimintPay; o contrato também pode ganhar `customerId` se a identidade do pagador precisar de relação local.
- Valores comerciais devem ser snapshots no contrato. Uma mudança futura na tabela de preços não pode alterar contratos antigos retroativamente.
- Se houver múltiplos componentes variáveis no curto prazo, extrair `BillingContractItem`; caso contrário, `baseAmount`, `unitAmount` e `quantity` são suficientes para o MVP.

### 6.2 `BillingQuantityChange`

```prisma
model BillingQuantityChange {
  id                        String          @id @default(uuid())
  contractId                String
  idempotencyKey            String
  expectedVersion           Int
  previousQuantity          Int
  targetQuantity            Int
  effectiveAt               DateTime
  scheduledFor              DateTime?
  periodStart               DateTime
  periodEnd                 DateTime
  remainingRatio            Decimal         @db.Decimal(20, 10)
  previousRecurringAmount   Decimal         @db.Decimal(12, 2)
  nextRecurringAmount       Decimal         @db.Decimal(12, 2)
  prorationAmount           Decimal         @db.Decimal(12, 2)
  status                    String
  transactionId             String?         @unique
  externalPaymentId         String?
  externalPlanId            String?
  externalSubscriptionId    String?
  failureCode               String?
  failureMessage            String?
  requestSnapshot           Json
  calculationSnapshot       Json
  createdAt                 DateTime         @default(now())
  updatedAt                 DateTime         @updatedAt
  contract                  BillingContract @relation(fields: [contractId], references: [id])

  @@unique([contractId, idempotencyKey])
  @@index([contractId, status])
  @@index([scheduledFor, status])
}
```

Estados sugeridos:

```text
CREATED
PENDING_PAYMENT
PAYMENT_CONFIRMED
PENDING_RECURRENCE_UPDATE
SCHEDULED
APPLIED
FAILED
COMPENSATION_REQUIRED
```

Não apagar operações que falharam. Elas são parte da trilha financeira e ajudam na reconciliação.

---

## 7. Fluxo transacional recomendado

### 7.1 Aumento de quantidade

```text
requisição autenticada
  → localizar contrato e validar ownership
  → conferir Idempotency-Key
  → conferir expectedVersion
  → sincronizar/validar período atual do gateway
  → calcular pró-rata com função pura
  → persistir BillingQuantityChange(CREATED)
  → criar cobrança avulsa calculada pelo servidor
  → aguardar/confirmar pagamento
  → atualizar valor da recorrência futura no gateway
  → atualizar contrato (quantity, IDs externos, versão)
  → marcar mudança APPLIED
  → emitir BillingQuantityChanged
  → adaptador aplica o entitlement no recurso
```

Se o pagamento for assíncrono, a rota retorna `PENDING_PAYMENT`; webhook ou job retoma a saga.

### 7.2 Redução de quantidade

```text
requisição autenticada
  → validar que targetQuantity respeita mínimo e uso atual do domínio
  → persistir mudança SCHEDULED para currentPeriodEnd
  → manter quantity e entitlement atuais
  → no vencimento: atualizar/migrar recorrência
  → aplicar nova quantity
  → marcar APPLIED e emitir evento
```

O domínio consumidor pode impor uma restrição adicional: por exemplo, não permitir reduzir abaixo da utilização corrente sem que o cliente primeiro remova recursos. Essa é uma validação do adaptador, não do cálculo financeiro.

### 7.3 Ordem e compensação

Há duas operações externas: cobrança avulsa e mudança da recorrência. Nenhuma ordem elimina totalmente o risco de sucesso parcial.

Ordem recomendada para aumento:

1. cobrar o pró-rata;
2. alterar/migrar a recorrência;
3. liberar a quantidade.

Se 1 funcionar e 2 falhar, marcar `COMPENSATION_REQUIRED`; não liberar a quantidade indefinidamente nem esconder o pagamento. A compensação pode ser:

- nova tentativa de atualização da recorrência;
- crédito interno no valor pago;
- estorno, se suportado e aprovado pela regra de negócio.

Jobs de reconciliação devem procurar operações paradas em estados intermediários.

---

## 8. Idempotência, concorrência e segurança

### Idempotência

- Chave única composta por `contractId + Idempotency-Key`.
- Mesma chave e mesmo payload: devolver a operação existente.
- Mesma chave e payload diferente: responder 409.
- Propagar uma chave derivada para o gateway, se ele suportar idempotência.
- Webhooks devem ter deduplicação pelo ID do evento e/ou ID externo do pagamento; o projeto já possui `WebhookEvent` para esse propósito.

### Concorrência

- `expectedVersion` diferente de `BillingContract.version`: responder 409 com a quantidade/versão atuais.
- Ao aplicar, fazer atualização condicional equivalente a:

```text
UPDATE BillingContract
SET quantity = target, version = version + 1
WHERE id = contractId AND version = expectedVersion
```

- Apenas uma mudança mutável (`CREATED`, `PENDING_*`) por contrato deve existir de cada vez, salvo se houver uma fila explícita.

### Segurança

- A rota de domínio valida permissão sobre o recurso antes de revelar o contrato.
- Não aceitar `baseAmount`, `unitAmount`, `prorationAmount`, IDs externos ou status vindos do frontend.
- Não reutilizar diretamente os endpoints públicos `/checkout/pix` e `/checkout/card` para essa operação. Eles aceitam preço na requisição e possuem comportamento legado de `ebook/store`.
- Não armazenar dados brutos de cartão. Usar token/payment method do gateway.
- Evitar dados pessoais e tokens em logs.

---

## 9. Integração com o estado atual deste repositório

### O que já pode ser reaproveitado

- `Transaction` para registrar a cobrança avulsa e acompanhar `PENDING`, `COMPLETED`, `FAILED` e `REFUNDED`.
- Resolução de adquirente por `PaymentGatewayResolver`.
- Webhooks e histórico de status de transação.
- Criação de plano e assinatura recorrente por `IPaymentGateway`.
- Autenticação JWT, ownership por `userId` e padrões NestJS já usados pelos controllers.
- `Prisma.Decimal` e colunas `Decimal(12,2)` existentes.

### O que não atende ao caso sozinho

- `POST /checkout/pix` e `POST /checkout/card` criam cobranças avulsas, mas recebem o preço do chamador e têm lógica de tenant/usuário legado.
- Links de pagamento têm valor fixo e não modelam contrato, quantidade ou período.
- Links de assinatura modelam um plano de valor fixo, não uma composição de preço.
- O checkout PIX de link de assinatura gera uma cobrança PIX avulsa; ele não cria uma recorrência automática.
- O cartão cria uma assinatura recorrente, mas o valor fica associado ao plano usado no checkout.
- Atualizar `SubscriptionLink.valor` zera `domPlanId` para checkouts futuros; assinantes existentes continuam no plano antigo.
- Antes desta entrega, `IPaymentGateway` expunha consulta e cancelamento, mas não migração de plano nem cobrança usando o meio de pagamento salvo.

### Capacidades da DOM confirmadas

A documentação oficial v3 confirma:

1. `GET /recurrence/subscriptions/{id}` retorna o token de cartão e `next_date_invoice`.
2. `POST /transactions` aceita token da carteira e `X-Idempotency-Key`, permitindo cobrar o pró-rata sem solicitar novamente o cartão.
3. `POST /recurrence/subscriptions/{id}/change-plan` migra a assinatura para um novo plano; a assinatura anterior é inativada e um novo ID é gerado.
4. Alterações de assinatura afetam apenas faturas ainda não emitidas.
5. A DOM também possui alteração de valor de fatura e faturamento forçado, mas esses endpoints não foram usados porque processar a “próxima fatura” como pró-rata poderia consumir/antecipar o ciclo recorrente.

Fontes: [criar transação](https://dom-pagamentos.readme.io/reference/criar-uma-transacao), [consultar assinatura](https://dom-pagamentos.readme.io/reference/consultar-assinatura), [alterar plano](https://dom-pagamentos.readme.io/reference/alterar-plano-da-assinatura) e [editar assinatura](https://dom-pagamentos.readme.io/reference/editar-assinatura).

Estratégia implementada: transação avulsa idempotente com o token salvo, seguida da criação de um plano com o novo valor e migração da assinatura. O novo ID é persistido no contrato e propagado aos registros locais legados encontrados.

### Mapa de arquivos atuais para o implementador

| Responsabilidade atual                                 | Arquivo                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Contrato HTTP interno implementado                     | `src/presentation/controllers/billing.controller.ts`                                                             |
| Orquestração, idempotência e saga                      | `src/application/use-cases/billing/billing.service.ts`                                                           |
| Reconciliação periódica                                | `src/application/use-cases/billing/billing-reconciliation.service.ts`                                            |
| Cálculo puro de pró-rata                               | `src/core/billing/proration-calculator.ts`                                                                       |
| Cobrança PIX/cartão avulsa pública                     | `src/presentation/controllers/checkout.controller.ts`                                                            |
| Criação e checkout de link de pagamento                | `src/presentation/controllers/payment-link.controller.ts` e `src/application/use-cases/payment-link/*`           |
| Criação/checkout de assinatura                         | `src/presentation/controllers/subscription-link.controller.ts` e `src/application/use-cases/subscription-link/*` |
| Regra que mantém assinantes existentes no plano antigo | `src/application/use-cases/subscription-link/update-subscription-link.use-case.ts`                               |
| Contrato agnóstico de gateway                          | `src/core/services/payment-gateway.interface.ts`                                                                 |
| Implementação DOM de plano/assinatura                  | `src/infrastructure/http/api-dom.client.ts`                                                                      |
| Persistência financeira e recorrente atual             | `prisma/schema.prisma` (`Transaction`, `SubscriptionLink`, `SubscriptionLinkOrder`, `Subscription`)              |
| Webhook de recorrência                                 | `src/application/use-cases/subscription/subscription-webhook.service.ts`                                         |

O billing foi introduzido como módulo separado e preserva os fluxos legados. O agente integrador deve evitar transformar `SubscriptionLink` em contrato de quantidade, pois o link é uma oferta compartilhável, enquanto o contrato é específico de um pagador/recurso.

Se for preciso criar um novo plano por valor, evitar explosão descontrolada de planos. Reutilizar plano por chave comercial imutável, por exemplo `currency + interval + amount + pricingVersion`, ou desativar planos órfãos com job seguro.

---

## 10. Interfaces sugeridas

Operações semanticamente neutras adicionadas ao gateway:

```ts
interface IPaymentGateway {
  getSubscriptionBillingSnapshot(
    token: string,
    subscriptionId: string,
  ): Promise<SubscriptionBillingSnapshot>;

  chargeSubscriptionPaymentMethod(
    token: string,
    input: StoredPaymentChargeInput,
  ): Promise<StoredPaymentChargeOutput>;

  changeSubscriptionPlan(
    token: string,
    input: { subscriptionId: string; planId: string },
  ): Promise<SubscriptionPlanChangeOutput>;
}
```

Se a DOM exigir migração em vez de update, a implementação de `updateSubscriptionPrice` pode encapsular isso, mas deve retornar novos IDs externos para o contrato local. Não espalhar detalhes da DOM pelo use case universal.

Calculador puro:

```ts
type ProrationInput = {
  baseAmount: Prisma.Decimal;
  unitAmount: Prisma.Decimal;
  previousQuantity: number;
  targetQuantity: number;
  periodStart: Date;
  periodEnd: Date;
  effectiveAt: Date;
};

type ProrationResult = {
  previousRecurringAmount: Prisma.Decimal;
  nextRecurringAmount: Prisma.Decimal;
  remainingRatio: Prisma.Decimal;
  prorationAmount: Prisma.Decimal;
};
```

Esse calculador não deve acessar Prisma, gateway, relógio global ou workspace. O horário entra explicitamente, tornando os testes determinísticos.

---

## 11. Estrutura de arquivos sugerida

```text
src/core/billing/
  billing-contract.types.ts
  billing-gateway.types.ts
  proration-calculator.ts

src/application/use-cases/billing/
  create-billing-contract.use-case.ts
  change-billing-quantity.use-case.ts
  apply-scheduled-quantity-change.use-case.ts
  reconcile-billing-changes.use-case.ts

src/application/dtos/billing/
  change-billing-quantity.dto.ts

src/infrastructure/database/repositories/
  prisma-billing-contract.repository.ts

src/presentation/controllers/
  billing.controller.ts

src/presentation/
  billing.module.ts
```

No projeto que contém workspaces, adicionar apenas o controller/adaptador de workspace e a implementação de `BillingEntitlementPort`.

---

## 12. Erros HTTP e semântica

| Situação                                   | HTTP | Código sugerido               |
| ------------------------------------------ | ---: | ----------------------------- |
| Contrato/recurso inexistente ou sem acesso |  404 | `BILLING_CONTRACT_NOT_FOUND`  |
| Quantidade inválida                        |  400 | `INVALID_TARGET_QUANTITY`     |
| Contrato inativo                           |  409 | `BILLING_CONTRACT_INACTIVE`   |
| Versão desatualizada                       |  409 | `BILLING_VERSION_CONFLICT`    |
| Outra mudança em andamento                 |  409 | `BILLING_CHANGE_IN_PROGRESS`  |
| Idempotency-Key ausente                    |  400 | `IDEMPOTENCY_KEY_REQUIRED`    |
| Mesma chave com payload diferente          |  409 | `IDEMPOTENCY_KEY_REUSED`      |
| Pagamento recusado                         |  402 | `PRORATION_PAYMENT_FAILED`    |
| Gateway temporariamente indisponível       |  503 | `BILLING_GATEWAY_UNAVAILABLE` |
| Sucesso assíncrono                         |  202 | operação em `PENDING_*`       |

Não retornar 500 para recusas esperadas do cartão ou conflitos de negócio.

---

## 13. Eventos e webhooks

Eventos internos sugeridos:

```text
BillingQuantityChangeCreated
BillingProrationPaymentConfirmed
BillingRecurringAmountUpdated
BillingQuantityChanged
BillingQuantityChangeFailed
```

Payload mínimo de `BillingQuantityChanged`:

```json
{
  "eventId": "uuid",
  "contractId": "uuid",
  "changeId": "uuid",
  "resourceType": "WORKSPACE",
  "resourceId": "uuid",
  "previousQuantity": 10,
  "quantity": 13,
  "effectiveAt": "2026-08-15T15:00:00.000Z"
}
```

O consumidor deve ser idempotente por `eventId` ou `changeId`. Se aplicar o entitlement falhar, a operação financeira não deve ser repetida; deve-se repetir apenas a entrega do evento.

---

## 14. Testes obrigatórios

### Unidade — calculador

- aumento no início do período: fração 1;
- aumento no meio do período;
- alteração no instante final: fração 0;
- ciclos de 28, 29, 30 e 31 dias;
- quantidade sem alteração;
- preço base maior que zero;
- arredondamento de valores com dízimas;
- `effectiveAt` fora do intervalo;
- rejeição de período com fim menor/igual ao início;
- propriedade: `0 <= remainingRatio <= 1`;
- propriedade: para aumento, `0 <= prorationAmount <= nextRecurringAmount - previousRecurringAmount`.

### Unidade — use case

- preço vindo do contrato, nunca do DTO;
- ownership;
- mínimo de quantidade;
- `expectedVersion` desatualizado;
- mesma idempotency key/same payload;
- mesma idempotency key/payload diferente;
- aumento, redução agendada e no-op;
- falha de pagamento;
- pagamento confirmado seguido de falha na recorrência;
- atualização condicional de versão.

### Integração/e2e

- uma repetição da mesma requisição cria uma única transação;
- duas mudanças concorrentes: somente uma vence;
- webhook duplicado não aplica quantidade duas vezes;
- pagamento pendente retorna 202 e depois é retomado pelo webhook;
- entitlement só muda após `APPLIED`;
- redução só entra no vencimento;
- job retoma operação presa em estado intermediário;
- conciliação detecta divergência entre contrato local e assinatura externa.

---

## 15. Observabilidade e operação

Logs estruturados devem conter:

```text
contractId, changeId, resourceType, resourceId,
idempotencyKeyHash, previousQuantity, targetQuantity,
prorationAmount, status, acquirer, externalPaymentId,
externalSubscriptionId, correlationId
```

Métricas recomendadas:

- quantidade de mudanças por status;
- pagamentos de pró-rata aprovados/recusados;
- latência até `APPLIED`;
- operações em `COMPENSATION_REQUIRED`;
- divergências de conciliação;
- falhas na entrega de entitlement.

Alertar para operações `PENDING_*` além de um limite operacional e para qualquer `COMPENSATION_REQUIRED`.

---

## 16. Plano de integração para o próximo agente

O núcleo, schema, migration, gateway DOM, reconciliação e endpoints internos já estão implementados neste repositório. O agente do sistema consumidor deve executar apenas a integração descrita no guia técnico complementar:

`docs/guides/generic-billing-workspace-integration.md`

Resumo:

1. registrar um contrato após a primeira assinatura aprovada;
2. expor a rota de domínio que converte o pedido do usuário em `targetQuantity`;
3. usar uma chave idempotente estável;
4. aplicar o novo limite apenas em `APPLIED`;
5. manter reduções pendentes até `scheduledFor`;
6. consultar/reconciliar operações assíncronas.

---

## 17. Critérios de aceite

- O valor nunca é aceito do frontend; é calculado a partir do snapshot comercial do contrato.
- A mesma chave idempotente não gera duas cobranças.
- O cálculo usa o período real e produz snapshot auditável.
- Um aumento pago altera o valor futuro e só então libera a nova quantidade.
- Uma redução não gera crédito no MVP e entra no próximo ciclo.
- Atualizações concorrentes produzem 409, não perda silenciosa de dados.
- Falhas parciais ficam visíveis e reconciliáveis.
- Webhooks duplicados não duplicam efeitos.
- O núcleo não importa nem referencia workspace.
- A adaptação de workspace apenas resolve contrato/permissão e aplica entitlement.
- Há testes para arredondamento, limites temporais, idempotência, concorrência e falhas intermediárias.

---

## 18. Decisões confirmadas e decisões do domínio consumidor

Confirmado na documentação da DOM e incorporado à implementação:

1. O token da carteira retornado pela assinatura pode ser reutilizado em uma venda com `upsell=true`.
2. A assinatura pode migrar para outro plano, e a migração devolve um novo ID de assinatura.
3. A cobrança proporcional é uma transação separada; ela não força nem consome a próxima fatura recorrente.

Políticas adotadas pelo núcleo:

1. Aumento é cobrado imediatamente e só fica efetivo após cobrança e migração.
2. Redução é agendada para o próximo ciclo, sem crédito no MVP.
3. Falha ou resultado incerto após efeito externo entra em `COMPENSATION_REQUIRED`, sem nova cobrança automática.
4. Existe no máximo uma mudança mutável por contrato.

Decisões que permanecem no sistema consumidor/produto:

1. Qual é a quantidade mínima de cada produto ao registrar o contrato?
2. Como comparar redução com o consumo real do recurso? Para workspace, a recomendação é bloquear quantidade menor que membros ocupantes.
3. Qual experiência mostrar durante estados pendentes e reduções agendadas?
4. Futuramente haverá crédito por redução? No MVP, não.
5. Qual procedimento operacional será usado para analisar e compensar `COMPENSATION_REQUIRED`?

Essas políticas não devem introduzir conceitos específicos de workspace dentro do billing.
