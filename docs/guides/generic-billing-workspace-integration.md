# Guia de integração: cobrança por quantidade com proporcionalidade

## Objetivo

Este backend agora expõe uma API interna e genérica para cobrar um recurso por:

- preço-base fixo;
- preço unitário multiplicado por uma quantidade;
- ciclo recorrente;
- cobrança proporcional imediata quando a quantidade aumenta durante o ciclo;
- redução agendada para o ciclo seguinte, sem crédito retroativo.

O módulo não conhece o conceito de workspace. O serviço de workspaces deve atuar como um adaptador de domínio: validar regras de ocupação, converter o workspace em um `resourceType/resourceId` e aplicar a capacidade somente quando a operação de billing permitir.

## Confirmação da DOM

A implementação usa somente recursos documentados pela DOM:

1. `GET /recurrence/subscriptions/{id}` fornece o valor recorrente, a frequência, o estado da assinatura e o token da carteira do cartão.
2. `POST /transactions` aceita o token da carteira com `credit_card.upsell = true` para uma cobrança avulsa e aceita `X-Idempotency-Key`.
3. `POST /recurrence/subscriptions/{id}/change-plan` migra a assinatura. A DOM inativa o ID anterior e devolve um novo ID de assinatura.

Essa composição evita forçar a próxima fatura recorrente para cobrar o proporcional. O proporcional é uma transação independente; depois da aprovação, o valor recorrente é alterado pela criação de um plano e migração da assinatura.

Fontes oficiais:

- <https://dom-pagamentos.readme.io/reference/consultar-assinatura>
- <https://dom-pagamentos.readme.io/reference/criar-uma-transacao>
- <https://dom-pagamentos.readme.io/reference/alterar-plano-da-assinatura>
- <https://dom-pagamentos.readme.io/reference/criar-plano>

Antes de produção, execute o roteiro de sandbox ao final deste documento com credenciais reais da conta DOM. A confirmação feita durante a implementação foi documental; o repositório não continha credenciais de sandbox utilizáveis para um teste transacional completo.

## Modelo comercial

O valor recorrente é:

```text
recurringAmount = baseAmount + unitAmount * quantity
```

Para um aumento durante o ciclo:

```text
remainingRatio = tempo restante no ciclo / duração total do ciclo
prorationAmount = unitAmount * (targetQuantity - currentQuantity) * remainingRatio
```

O cálculo usa o intervalo real entre `currentPeriodStart` e `currentPeriodEnd`, portanto funciona com meses de tamanhos diferentes, anos bissextos e frequências não mensais. O resultado monetário final é arredondado para duas casas, usando `ROUND_HALF_UP`.

Exemplo: base de R$ 100, unidade de R$ 20, quantidade atual 10, quantidade desejada 13 e 50% do ciclo restante:

```text
valor atual = 100 + 20 * 10 = R$ 300
novo valor recorrente = 100 + 20 * 13 = R$ 360
proporcional = 20 * 3 * 0,5 = R$ 30
```

## Segurança e configuração

Todas as rotas têm prefixo `internal/billing` e exigem:

```http
x-internal-token: <INTERNAL_SERVICE_TOKEN>
```

Configure no backend de pagamentos:

```dotenv
INTERNAL_SERVICE_TOKEN=segredo-forte-compartilhado-entre-servicos
DOM_TOKEN=token-dom-quando-aplicavel
URL_APP=https://url-publica-deste-backend
```

O token interno e os preços nunca devem ser enviados pelo navegador. O serviço de workspaces chama esta API no servidor. O backend resolve o token DOM pelo proprietário do contrato e não recebe dados brutos de cartão nas novas rotas.

## Ordem de implantação

1. Publicar o backend com a migration `20260815000000_add_generic_billing`.
2. Configurar `INTERNAL_SERVICE_TOKEN` nos dois serviços.
3. Criar e validar uma assinatura DOM de teste.
4. Registrar o contrato faturável pela API interna.
5. Integrar o aumento/redução no serviço de workspaces.
6. Executar o roteiro de sandbox.
7. Habilitar o fluxo para clientes de produção.

## 1. Registrar um contrato faturável

Primeiro crie a assinatura inicial na DOM pelo fluxo já existente. O valor dessa assinatura precisa ser exatamente `baseAmount + unitAmount * quantity`. Depois registre a relação genérica:

```http
POST /internal/billing/contracts
Content-Type: application/json
x-internal-token: <token>

{
  "userId": "user-id-dono-da-assinatura",
  "resourceType": "WORKSPACE",
  "resourceId": "workspace-id",
  "externalSubscriptionId": "subscription-id-da-dom",
  "baseAmount": "100.00",
  "unitAmount": "20.00",
  "quantity": 10,
  "minimumQuantity": 1,
  "currentPeriodStart": "2026-08-01T00:00:00.000Z",
  "currentPeriodEnd": "2026-09-01T00:00:00.000Z",
  "priceKey": "WORKSPACE_STANDARD",
  "pricingVersion": 1,
  "description": "Plano Standard",
  "metadata": {
    "workspaceId": "workspace-id"
  }
}
```

Regras importantes:

- `resourceType` é normalizado para maiúsculas e o par `resourceType/resourceId` é único.
- Valores monetários são strings decimais em BRL, nunca números em centavos.
- `currentPeriodStart` e `currentPeriodEnd` devem estar em UTC e representar o ciclo já pago. Obtenha-os do evento da primeira cobrança e de `next_date_invoice` da DOM; não derive o ciclo no navegador.
- A API consulta a assinatura e rejeita cadastro se ela não estiver ativa, não possuir token reutilizável ou tiver valor recorrente diferente do preço informado.
- Repetir o mesmo cadastro para o mesmo recurso, usuário e assinatura retorna o contrato existente.

Resposta relevante:

```json
{
  "id": "billing-contract-id",
  "resourceType": "WORKSPACE",
  "resourceId": "workspace-id",
  "quantity": 10,
  "pendingQuantity": null,
  "recurringAmount": "300.00",
  "version": 1,
  "externalSubscriptionId": "subscription-id-da-dom",
  "currentPeriodStart": "2026-08-01T00:00:00.000Z",
  "currentPeriodEnd": "2026-09-01T00:00:00.000Z"
}
```

## 2. Consultar o estado atual

Por recurso:

```http
GET /internal/billing/contracts/by-resource/WORKSPACE/{workspaceId}
x-internal-token: <token>
```

Por contrato:

```http
GET /internal/billing/contracts/{contractId}
x-internal-token: <token>
```

O serviço de workspaces deve consultar o contrato imediatamente antes de pedir uma alteração e usar o `version` retornado. Não mantenha a versão indefinidamente em cache.

## 3. Alterar a quantidade

A API recebe a quantidade absoluta desejada, não um delta:

```http
POST /internal/billing/contracts/{contractId}/quantity-changes
Content-Type: application/json
x-internal-token: <token>
Idempotency-Key: workspace:{workspaceId}:quantity:{operationId}

{
  "targetQuantity": 13,
  "expectedVersion": 1
}
```

`operationId` deve ser um UUID persistido pelo serviço chamador. Em uma repetição por timeout, envie a mesma chave e o mesmo payload. Reutilizar a chave com outro payload retorna conflito.

O campo opcional `effectiveAt` existe para replay controlado no servidor, mas o fluxo normal deve omiti-lo. Ele não aceita datas mais de cinco minutos no futuro.

### Aumento

O backend:

1. reserva a versão do contrato;
2. calcula o proporcional;
3. cobra o cartão já tokenizado em uma transação DOM idempotente;
4. cria um plano com o novo valor recorrente;
5. migra a assinatura para o plano;
6. persiste o novo ID da assinatura e aplica a quantidade.

O workspace só pode aumentar sua capacidade quando a resposta tiver `status = APPLIED`.

### Redução

A redução não gera crédito. Ela retorna `SCHEDULED` e é executada no fim do ciclo corrente. Até ficar `APPLIED`, o workspace mantém a capacidade anterior.

Antes de pedir a redução, o serviço de workspaces deve impedir `targetQuantity` menor que o uso real do recurso, por exemplo, o total de membros atualmente ocupando assentos. Essa é uma regra de domínio e propositalmente não pertence ao módulo genérico de billing.

### Operação sem mudança

Quando `targetQuantity` é igual à quantidade atual, a operação retorna `APPLIED`, sem cobrança e sem migração.

## 4. Interpretar a resposta

Exemplo resumido:

```json
{
  "id": "billing-change-id",
  "contractId": "billing-contract-id",
  "status": "APPLIED",
  "contractVersion": 3,
  "previousQuantity": 10,
  "targetQuantity": 13,
  "effectiveQuantity": 13,
  "scheduledFor": null,
  "remainingRatio": "0.5322580645",
  "previousRecurringAmount": "300.00",
  "nextRecurringAmount": "360.00",
  "prorationAmount": "31.94",
  "externalPaymentId": "dom-transaction-id",
  "externalSubscriptionId": "novo-dom-subscription-id",
  "failureCode": null,
  "failureMessage": null,
  "transaction": {
    "id": "local-transaction-id",
    "status": "COMPLETED"
  }
}
```

Estados e ação do integrador:

| Estado                      | Ação no workspace                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `APPLIED`                   | Aplicar `effectiveQuantity` de forma idempotente e persistir `changeId` como processado.                   |
| `SCHEDULED`                 | Manter a quantidade atual e consultar a operação depois de `scheduledFor`.                                 |
| `PENDING_PAYMENT`           | Não liberar capacidade; consultar novamente.                                                               |
| `PENDING_RECURRENCE_UPDATE` | Não liberar capacidade; consultar novamente. O pagamento pode já ter sido aprovado.                        |
| `FAILED`                    | Não alterar capacidade; mostrar falha de cobrança e permitir uma nova operação com nova chave.             |
| `COMPENSATION_REQUIRED`     | Não automatizar nova cobrança; abrir alerta operacional para reconciliação manual entre DOM e banco local. |

Há no máximo uma alteração mutável por contrato. Uma segunda operação enquanto existir `SCHEDULED`, `PENDING_PAYMENT` ou `PENDING_RECURRENCE_UPDATE` retorna `BILLING_CHANGE_IN_PROGRESS`.

## 5. Consulta e reconciliação

Consultar uma operação:

```http
GET /internal/billing/contracts/{contractId}/quantity-changes/{changeId}
x-internal-token: <token>
```

Solicitar reconciliação imediata:

```http
POST /internal/billing/contracts/{contractId}/quantity-changes/{changeId}/reconcile
x-internal-token: <token>
```

O backend também executa uma reconciliação agendada a cada 30 segundos. Mesmo assim, o serviço de workspaces deve manter uma pequena outbox/inbox local e consultar mudanças não terminais, porque esta versão não envia callback específico de billing para o serviço consumidor.

Sugestão de política de polling:

- após uma resposta pendente: 2 s, 5 s, 15 s, 30 s;
- depois disso: uma vez por minuto por até 15 minutos;
- para `SCHEDULED`: em `scheduledFor` e novamente a cada minuto enquanto não terminal;
- sempre interromper em `APPLIED`, `FAILED` ou `COMPENSATION_REQUIRED`.

Aplicar a capacidade pelo `changeId`, com uma restrição única local, torna o consumidor idempotente mesmo que a mesma resposta seja processada várias vezes.

## 6. Concorrência e erros esperados

- `409 BILLING_VERSION_CONFLICT`: buscar o contrato novamente e decidir se a intenção do usuário ainda é válida. Não repetir cegamente com a nova versão.
- `409 BILLING_CHANGE_IN_PROGRESS`: recuperar/acompanhar a operação em curso antes de aceitar outra.
- `409` por `Idempotency-Key` com payload diferente: erro de programação no chamador.
- `409 BILLING_EXTERNAL_DRIFT`: o valor na DOM divergiu do preço local; bloquear alterações e reconciliar comercialmente.
- `400`: quantidade abaixo do mínimo, intervalo inválido, token DOM ausente ou entrada inválida.
- `401`: `x-internal-token` ausente/incorreto ou `INTERNAL_SERVICE_TOKEN` não configurado.
- `404`: contrato, recurso ou alteração inexistente.

## 7. Novo ID de assinatura

A migração de plano da DOM sempre inativa o ID antigo e cria outro. O backend atualiza:

- `BillingContract.externalSubscriptionId`;
- `Subscription.domSubscriptionId`, quando houver vínculo local;
- `SubscriptionLinkOrder.domSubscriptionId`, quando houver vínculo local.

O serviço de workspaces não deve guardar o ID DOM como fonte da verdade. Guarde somente o `billingContractId` e, quando precisar do ID externo, leia o contrato atualizado.

## 8. Arquivos principais para o agente integrador

- `src/presentation/controllers/billing.controller.ts`: contrato HTTP.
- `src/application/dtos/billing/`: validação das entradas.
- `src/application/use-cases/billing/billing.service.ts`: máquina de estados e regras.
- `src/core/billing/proration-calculator.ts`: cálculo temporal e monetário.
- `src/core/services/payment-gateway.interface.ts`: capacidades genéricas do gateway.
- `src/infrastructure/http/api-dom.client.ts`: composição das rotas DOM.
- `prisma/schema.prisma`: `BillingContract` e `BillingQuantityChange`.
- `docs/superpowers/specs/2026-08-15-generic-quantity-proration-billing-design.md`: relatório completo de decisões.

## 9. Roteiro mínimo de sandbox

1. Criar uma assinatura ativa de cartão com valor igual ao contrato inicial.
2. Registrar o contrato e confirmar valor, frequência e período.
3. Aumentar a quantidade e confirmar uma única transação proporcional.
4. Reenviar a mesma requisição com a mesma chave e confirmar que não há segunda cobrança.
5. Confirmar que a assinatura antiga ficou inativa e que o contrato passou a guardar o novo ID.
6. Confirmar que a próxima recorrência possui o novo valor integral.
7. Pedir redução e confirmar ausência de crédito/cobrança imediata.
8. Avançar até o fechamento do ciclo e confirmar aplicação da redução.
9. Simular cartão não autorizado e confirmar `FAILED`, sem aumento de capacidade.
10. Simular timeout após cobrança e confirmar que a reconciliação não duplica a transação.
11. Disparar duas alterações concorrentes e confirmar que apenas uma é reservada.
12. Validar o fluxo operacional de `COMPENSATION_REQUIRED` antes de liberar produção.

## 10. Pseudocódigo do adaptador de workspace

```ts
async function changeWorkspaceCapacity(
  workspaceId: string,
  target: number,
  operationId: string,
) {
  const occupied = await countOccupiedSeats(workspaceId);
  if (target < occupied)
    throw new Error('Remova membros antes de reduzir a capacidade');

  const contract = await billing.getByResource('WORKSPACE', workspaceId);
  const change = await billing.changeQuantity(contract.id, {
    targetQuantity: target,
    expectedVersion: contract.version,
    idempotencyKey: `workspace:${workspaceId}:quantity:${operationId}`,
  });

  await saveBillingOperation(workspaceId, change.id, change.status);

  if (change.status === 'APPLIED') {
    await applyCapacityOnce(workspaceId, change.effectiveQuantity, change.id);
  } else if (!['FAILED', 'COMPENSATION_REQUIRED'].includes(change.status)) {
    await enqueueBillingPoll(contract.id, change.id, change.scheduledFor);
  }

  return change;
}
```

O ponto crítico é tratar cobrança e capacidade como duas máquinas de estado coordenadas, não como uma única transação distribuída. A capacidade só segue o billing depois de um estado confirmado e seu processamento local deve ser idempotente.
