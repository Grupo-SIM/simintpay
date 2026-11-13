# Estorno parcial (Dom)

Plano proposto em 2026-11-13. **Nada foi executado.** Nenhuma migração foi aplicada em banco real; o dono executa as migrações.

## 1. Objetivo

Hoje todo estorno é tratado como total. A Dom permite estornar parte do valor, e o SimIntPay não percebe: a venda segue `COMPLETED`, a carteira não é debitada e o aviso `purchase_refunded` não sai. O objetivo é:

- registrar cada estorno parcial (valor e data) e o total estornado por transação;
- debitar da carteira (dono, coprodutores, afiliado) só a parte proporcional ao valor estornado;
- informar o valor estornado nos avisos ao webhook externo, sem quebrar quem só entende estorno total;
- manter relatórios, dashboards e exportações coerentes com estorno parcial.

## 2. O que a Dom documenta (verificado em 2026-11-13)

Fonte: [dom-pagamentos.readme.io](https://dom-pagamentos.readme.io) (Estornar transação, Consultar transação, Eventos, Payload).

- `POST /transactions/{id}/refund` aceita `amount` (int32, centavos, não confirmado) e `msg` opcionais. Sem `amount`, estorna o valor da transação ou o saldo restante.
- Em estorno parcial a transação **continua `paid`**. O estorno aparece em `refunds.total_refunds` (centavos) e em `refunds.details[]` (`date`, `total`, `msg`).
- Só existe o evento `CHARGE-REFUND` ("um reembolso/estorno"), sem distinção entre parcial e total.
- O `data` do webhook tem o formato da consulta de transação, então carrega `refunds`.

**Lacunas que a documentação não fecha** (resolver na fase 0):

1. `CHARGE-REFUND` chega também em estorno parcial?
2. Formato real de `refunds.details` (a doc diz objeto na requisição e array na resposta) e unidade de `details[].total`.
3. `amount` e `liquid_amount` mudam após estorno parcial?
4. O estorno parcial de cartão parcelado devolve proporcionalmente por parcela? Há taxa retida pela Dom (MDR não devolvido)?
5. Chargeback parcial existe?

## 3. Estado atual do código

- `RawDomData` (`process-dom-webhook.use-case.ts:96`) não declara `refunds`; nada em `backend/src` lê `total_refunds`, `refunds` ou `CHARGE-REFUND`.
- `mapStatus` mapeia `refunded`/`pending_refund` para `REFUNDED`; `paid` num webhook seguinte a um `COMPLETED` não faz nada (transição inválida).
- Dois caminhos de liquidação de estorno, ambos total e com `netAmount` integral:
  - `settleFinalNet` (`modules/platform-core/link-settlement.ts`), para `settlementBasis=FINAL_NET`, que reverte o crédito registrado em `BalanceLog` (`LINK_SETTLEMENT_COMPLETED`);
  - ramo legado de `process-dom-webhook.use-case.ts` (~linha 484-560), com `creditedSettlementAmount`.
- Coprodução (`settleCoproduction`) marca cada `CoproductionAllocation` como `REVERSED` por inteiro (estado por alocação, sem valor parcial).
- Afiliado (`AffiliateCommissionService.reverseForTransaction`) reverte a comissão inteira (`CREDITED` → `REVERSED`).
- Avisos ao webhook externo:
  - caminho não assinado: `notifyPaymentLinkExternalWebhook` (`process-dom-webhook.use-case.ts:1760`), com `amountCharged` e `netAmount` originais;
  - caminho assinado (worker durável): `platform-sales-events.service.ts:~174`, que deriva o evento do histórico de status e usa `eventId = sha256(plataforma:tx:evento)`. **Um segundo estorno parcial colidiria nesse `eventId` e seria descartado como repetição.**
- `process-webhook.use-case.ts` (outra adquirente) tem o mesmo desenho com `PENDING_REFUND`; **fora do escopo** até a adquirente ser usada com estorno parcial. Registrar a decisão na fase 6.

## 4. Decisões de modelagem (propostas, a aprovar)

1. **Tabela `TransactionRefund`** (histórico imutável): `id`, `transactionId`, `amount` (bruto estornado), `netAmount` (parte do líquido revertida), `source` (`DOM_WEBHOOK`, `DOM_POLL`, ...), `externalRef` (chave de idempotência derivada de `date`+`total` da Dom), `occurredAt`, `createdAt`. Índice único `(transactionId, externalRef)`.
2. **Campos denormalizados em `Transaction`**: `refundedAmount` e `refundedNetAmount` (`Decimal(12,2)`, default 0), mantidos na mesma `$transaction` que grava `TransactionRefund`. Nenhum backfill: linhas antigas ficam em 0 e, quando `REFUNDED`/`CHARGEBACK`, o relatório continua usando o estorno total histórico.
3. **Status**: estorno parcial **não muda `status`** (continua `COMPLETED`), em linha com a Dom. Estorno que zera o saldo restante (`refundedAmount == amount`) transita para `REFUNDED` pelo mecanismo existente, de forma idempotente.
4. **Proporção do líquido**: `refundedNet = netAmount × (valorEstornado / amount)`, com arredondamento por resíduo (o último estorno que fecha o total absorve a diferença, para a soma bater exatamente com o `netAmount` creditado). Decisão a confirmar na fase 0 se a Dom retém MDR no estorno.
5. **Coprodução**: cada alocação é revertida proporcionalmente (`amount × fração`), com resíduo no último estorno. `CoproductionAllocation` precisa guardar o valor já revertido (coluna `reversedAmount`) além do `state`; `REVERSED` só quando `reversedAmount == amount`.
6. **Afiliado**: reverter proporcionalmente à fração estornada, com resíduo no último; `AffiliateCommission` ganha `reversedAmount`, e `REVERSED` só quando totalmente revertida.
7. **Regra de segurança**: estorno acima do saldo estornável (`refundedAmount + novo > amount`) é recusado, registrado em log de erro e **não debita nada**.

## 5. Fases

Cada fase vira commits atômicos (`feat(backend)`, `fix(backend)`, `docs`), sem push, em worktree (`task-worktree`).

### Fase 0: captura e decisão (bloqueia as demais)

- [ ] Em sandbox da Dom, fazer estorno parcial de PIX e de cartão (à vista e parcelado) e um estorno total depois; capturar os webhooks e a consulta da transação.
- [ ] Responder as 5 lacunas da seção 2 e registrar o payload real (com dados anonimizados) em `docs/` e como fixture de teste.
- [ ] Confirmar com o dono: política de MDR no estorno, e se o lojista é debitado do líquido proporcional ou do valor bruto.
- Saída: seção 2 atualizada, decisões da seção 4 confirmadas ou ajustadas.

### Fase 1: modelo de dados

- [ ] Migration Prisma: `TransactionRefund`, `Transaction.refundedAmount/refundedNetAmount`, `CoproductionAllocation.reversedAmount`, `AffiliateCommission.reversedAmount`.
- [ ] Sem backfill. Migração aplicada pelo dono.
- [ ] Documentar as colunas em `docs/business-rules.md`.

### Fase 2: núcleo de liquidação do estorno parcial

- [ ] Função única `applyPartialRefund(p, tx, refund)` em `modules/platform-core/`, chamada dentro da `$transaction` do chamador: valida saldo estornável, grava `TransactionRefund` (idempotente pelo índice único), calcula a fração, debita a carteira com `applyWalletEntry` (`action: LINK_SETTLEMENT_PARTIAL_REFUND` / `DOM_WEBHOOK_PARTIAL_REFUND`), reverte coprodução e afiliado proporcionalmente, e escreve `TransactionStatusHistory` com metadata do valor.
- [ ] Fechar em `REFUNDED` quando o saldo estornável chegar a zero, reaproveitando `settleFinalNet`/ramo legado sem debitar duas vezes (o débito do status final considera `refundedNetAmount` já revertido).
- [ ] Respeitar o princípio já adotado: reversão segue o crédito efetivamente registrado em `BalanceLog`, não a configuração atual.

### Fase 3: entrada pelo webhook da Dom

- [ ] Declarar `refunds?: { total_refunds?: number; details?: ... }` em `RawDomData`.
- [ ] No handler, para `status=paid` com `refunds.total_refunds` maior que `Transaction.refundedAmount`, chamar `applyPartialRefund` com a diferença. Usar `details[]` quando houver, e `total_refunds` como fonte de verdade para o total (mais robusto a ordem e perda de eventos).
- [ ] Tratar `CHARGE-REFUND` e `refunded` com `total_refunds < amount` como parcial, não total (a Dom pode enviar `refunded` só no total; confirmar na fase 0).
- [ ] Reconciliação: o polling/sincronização da Dom (`DOM_SYNC_SETUP.md`) também lê `refunds` e aplica a mesma função, para cobrir webhook perdido.

### Fase 4: avisos ao webhook externo (contrato)

- [ ] `purchase_refunded` passa a incluir `refundedAmount`, `refundedNetAmount` (reais, nos dois caminhos) e `totalRefundedAmount`, `fullyRefunded` (booleano), além de `amountCharged`/`netAmount` originais. Campos novos são aditivos: consumidores atuais continuam funcionando, mas passam a receber `purchase_refunded` também em estornos parciais.
- [ ] Caminho assinado: incluir o sequencial/`externalRef` do estorno no `eventId`, para estornos parciais distintos não colidirem; manter o `eventId` atual para o estorno total histórico (compatibilidade, sem reenvio de eventos antigos).
- [ ] **Semântica de revogação de acesso**: quem integra (ex.: Areaflix) hoje revoga o acesso em `purchase_refunded`. Estorno parcial normalmente não deve revogar. Por isso `fullyRefunded` é obrigatório no contrato, e `docs/central-sales-api.md` deve dizer explicitamente: "revogue acesso apenas quando `fullyRefunded=true`". Avisar os integradores antes de ligar o evento para estornos parciais; considerar um evento separado `purchase_partially_refunded` se algum integrador não puder ler o campo.
- [ ] Atualizar `docs/central-sales-api.md` e o OpenAPI/SDK conforme a skill `backend-endpoint-sdk`, se algum DTO ou resposta mudar.

### Fase 5: relatórios, dashboard e frontend

- [ ] Relatórios que somam `netAmount` com `status IN ('REFUNDED','CHARGEBACK')` (`owned-platform-reports.service.ts:345-358`, `platform-dashboard-reports.ts`, `platform-customer-reports.ts`, `platform-overview-reports.ts`, `dashboard-summary.use-case.ts`) passam a usar `refundedNetAmount` (mais o histórico antigo sem a coluna) para valores de estorno, e a receita líquida desconta só a parte estornada.
- [ ] Contagem de "estornos" inclui transações com estorno parcial; receita e "vendas" não perdem a venda inteira.
- [ ] Frontend: mostrar valor estornado e saldo restante na transação (i18n em todos os locales no mesmo commit; status/enum via `t()` com `defaultValue`). Validar com a skill `ui-screenshot-validation`.
- [ ] Seguir a regra existente: respostas do dono nunca incluem custo da adquirente nem margens.

### Fase 6: escopo excluído e documentação

- [ ] `process-webhook.use-case.ts` (adquirente com `PENDING_REFUND`) permanece só com estorno total; registrar em `docs/business-rules.md` que estorno parcial é suportado apenas para a Dom.
- [ ] Atualizar `docs/business-rules.md` com a regra de estorno parcial (proporção, resíduo, coprodução, afiliado, status, avisos).
- [ ] Mover este plano para `plans/done/` quando todo o código estiver implementado, registrando validações pendentes.

## 6. Testes (integração, banco descartável via `scripts/test-runner.ts`)

Sem testes unitários novos (regra do repositório). Cenários de integração:

1. PIX: estorno parcial → carteira debitada proporcionalmente, venda `COMPLETED`, `TransactionRefund` gravado, aviso com `fullyRefunded=false`.
2. Dois estornos parciais em sequência fecham o total → `REFUNDED`, soma debitada igual ao líquido creditado (resíduo correto), sem débito duplo.
3. Webhook repetido / fora de ordem / `total_refunds` menor que o já registrado → sem novo débito.
4. Estorno acima do saldo estornável → recusado, sem débito.
5. Coprodução com 2+ beneficiários: reversão proporcional, estado final `REVERSED`, sem resíduo.
6. Afiliado: comissão revertida proporcionalmente; total fecha em `REVERSED`.
7. Chargeback após estorno parcial: reverte só o restante.
8. Linha legada sem `refundedAmount` (estorno total histórico) continua igual nos relatórios.
9. Caminho assinado: dois estornos parciais geram dois `eventId` distintos; reentrega do mesmo não duplica.
10. Concorrência: dois webhooks simultâneos do mesmo estorno → um débito.

Falha com dinheiro real não é testada: gateways reais e bancos compartilhados ficam fora (limite local do repositório).

## 7. Riscos

- **Maior risco:** integradores que revogam acesso em qualquer `purchase_refunded`. Mitigação: `fullyRefunded` obrigatório, documentação, aviso prévio e opção de evento separado.
- Arredondamento acumulado em centavos: coberto pelo resíduo no último estorno e pelo teste 2.
- Taxa/MDR retido pela Dom no estorno pode tornar o débito proporcional maior que o devolvido: depende da fase 0.
- Webhook parcial não chegar: coberto pela reconciliação por polling (fase 3).
- Carteira sem saldo para o débito: segue o comportamento atual (estorno obriga o débito mesmo que o saque anterior tenha esvaziado o saldo; ver `docs/coproduction.md`).

## 8. Fora do escopo

- Iniciar estorno parcial pelo SimIntPay (chamar `POST /transactions/{id}/refund`). Hoje o estorno é feito fora do sistema, e este plano apenas reage a ele. "Estorno automático permanece indisponível" (`docs/guides/delivery-canonical-integration.md`).
- Backfill financeiro de transações antigas.

## 9. Pendências de validação

- Fase 0 inteira (sandbox da Dom) e aprovação do dono das decisões da seção 4.
- Aviso aos integradores sobre o novo contrato de `purchase_refunded`.
