# Migração de assinaturas para contratos próprios (`BillingContract`)

Este guia diz **como** levar cada assinatura existente para o modelo novo (`Offer` + `BillingContract` + `Charge`), em dois cenários: a assinatura **não** está ativa na DOM e a assinatura **está** ativa na DOM. Ele complementa o [runbook de migração de produtos](offer-migration-runbook.md), que cria as `Offer`s a partir dos produtos legados.

Regra de ouro dos dois cenários: **nunca existir cobrança automática nos dois lados ao mesmo tempo**. Uma janela sem cobrança (recuperável) é aceitável; uma cobrança em dobro não é.

Fontes da DOM usadas aqui (documentação oficial em `dom-pagamentos.readme.io`): consultar assinatura, listar faturas, cancelar assinatura, ativar assinatura, alterar modo de faturamento, consultar token de cartão e criar transação.

## 1. Situação real em 2026-11-05 (consulta agregada, somente leitura)

| Item                                                                                     | Valor                                                                   |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `SubscriptionLinkOrder`                                                                  | 5, todas `paid`                                                         |
| Meio de pagamento                                                                        | **PIX** nas 5                                                           |
| Frequência                                                                               | **ANUAL** nas 5                                                         |
| `domSubscriptionId`                                                                      | **nulo nas 5** (nenhuma assinatura na DOM)                              |
| Pagamentos                                                                               | 20/10/2026 (3) e 21/10/2026 (2), `Transaction` `COMPLETED`, `FINAL_NET` |
| `currentPeriodEndsAt` da ordem                                                           | **vazio nas 5**                                                         |
| `PlatformSubscriberAccess`, `SubscriptionPause`, `Plan`, `Subscription`, `PixCreditPlan` | 0 linhas                                                                |
| `SubscriptionLink`                                                                       | 13 ativos (6 mensais, 7 anuais); 12 têm plano criado na DOM             |

**Conclusão:** hoje **não há assinatura ativa na DOM** para migrar. As 5 ordens são compras anuais pagas por PIX, sem cartão e sem cobrança automática. O cenário que se aplica agora é o **A**. O cenário B fica documentado para quando houver assinaturas de cartão na DOM.

O fim do acesso **não está gravado** em lugar nenhum. A estimativa é `data do pagamento + 1 ano`: 20/10/2027 e 21/10/2027. Confirme com a data de liquidação da `Transaction` antes de gravar.

## 2. Cenário A: a assinatura não está ativa na DOM (é o caso das 5 ordens)

Não há token de cartão, nem cobrança agendada na DOM. O comprador pagou um período e precisa pagar de novo quando ele acabar. Isso é um contrato **pago pelo comprador a cada ciclo** (`MANUAL_PAY`).

Para cada ordem:

1. **Garanta que a `Offer` existe** (script `offer-migration-apply`, com o `SubscriptionLink` de origem).
2. **Crie o `BillingContract`** ligado à oferta, com:
   - dados do comprador copiados da ordem (nome, e-mail, documento);
   - `currentPeriodStart` = data do pagamento e `currentPeriodEnd` = início + 1 ano;
   - `nextChargeAt` = `currentPeriodEnd`;
   - `status` = `ACTIVE`;
   - `metadata.legacyOrderId` = id da `SubscriptionLinkOrder`, para rastrear e reverter.
3. **Crie a `Charge` do período já pago como `PAID` diretamente**, com `transactionId` apontando para a `Transaction` original e `cycleKey` do início do período.
   - **Não chame `BillingCycleService.settle` nessas cobranças.** Ele lançaria o ledger de novo e creditaria a carteira do vendedor uma segunda vez. O dinheiro já foi liquidado.
4. **Não toque na `SubscriptionLinkOrder`.** Ela continua sendo a origem do acesso até a verificação.
5. **Renovação:** em 20/10/2027 o ciclo vence, o job cria a cobrança e emite o evento `CHARGE_DUE`; o comprador paga por PIX. Enquanto o comprador não pagar, vale a carência da oferta (`graceDays`) e depois o contrato suspende.

**Script:** os passos 2 e 3 (contrato e cobrança já paga) são feitos por `backend/scripts/offer-contract-migration.ts`, com a lógica em `backend/scripts/sql/migrate-paid-subscription-orders.sql`. Ele só lê ordens `paid` + `PIX` + sem `domSubscriptionId`, ligadas à `Transaction` `COMPLETED`, e só grava `BillingContract` e `Charge`. Nunca cria `Offer` (ordem sem oferta é pulada e listada), nunca toca carteira, `BalanceLog`, `Transaction`, `CoproductionAllocation` nem a ordem, e aborta a transação se algum deles mudar. O início do período é a data em que a `Transaction` virou `COMPLETED` (histórico de status; na falta, `updatedAt`). É idempotente: rodar de novo não muda nada. Só use `--database-url` explícito (`.env` e `DATABASE_URL` nunca são lidos), a partir de `backend/`:

```bash
# 1. simulação (padrão): executa tudo, imprime as contagens e desfaz (ROLLBACK)
bun --no-env-file scripts/offer-contract-migration.ts --database-url=postgresql://...
# 2. gravar
bun --no-env-file scripts/offer-contract-migration.ts --database-url=... --apply --i-understand-this-writes
# 3. conferir (somente leitura); sai com código 1 se algo não bater
bun --no-env-file scripts/offer-contract-migration.ts --database-url=... --verify
```

Motivos de pulo mostrados na simulação: `OFFER_MISSING`, `NO_SETTLED_TRANSACTION`, `OFFER_WITHOUT_INTERVAL`, `AMOUNT_MISMATCH`, `AMOUNT_NOT_WHOLE_CENTS`, `ALREADY_MIGRATED`, `DUPLICATE_CONTRACT_KEY` (mesmo e-mail e oferta: vale o pagamento mais antigo) e `CONTRACT_KEY_TAKEN`. Período já vencido vira `SUSPENDED` com `accessEndsAt`; vigente vira `ACTIVE` com `nextChargeAt`. Teste: `backend/tests/offer-contract-migration.integration.test.ts` (variável `OFFER_CONTRACT_MIGRATION_TEST_DATABASE_URL`, só `127.0.0.1`).

**Pré-requisito de código (ainda não feito):** hoje a oferta de assinatura é `AUTO_CHARGE`. Um contrato **sem cartão salvo** nessa oferta é tratado pelo executor como cobrança falha e suspenderia o comprador. Antes de migrar, o ciclo precisa decidir o modo **por contrato**: com cartão salvo, cobra; sem cartão, emite `CHARGE_DUE` como `MANUAL_PAY`.

**Lembrete ao comprador:** o `ExpirationReminderCron` atual não olha `BillingContract`. Sem um aviso antes do vencimento, o comprador só descobre no dia do `CHARGE_DUE`. Inclua um lembrete (por exemplo 30 e 7 dias antes) antes de migrar contratos anuais.

**Verificação e reversão:**

- Conferir que há um contrato por ordem, que as somas de valor batem e que cada `Charge` `PAID` aponta para a `Transaction` original.
- Conferir que o saldo da carteira do vendedor **não mudou** depois da migração.
- Reverter apagando os contratos e cobranças com `metadata.legacyOrderId`. É seguro porque nenhum dinheiro se moveu.

## 3. Cenário B: a assinatura está ativa na DOM (cartão)

Siga a ordem **capturar, criar inerte, cancelar na DOM, verificar, ativar**. Assim a pior falha é uma cobrança que não acontece (recuperável), nunca uma cobrança em dobro.

Para cada assinatura, **antes de mexer**, leia na DOM:

- `GET /recurrence/subscriptions/{id}`: `status`, `card.token`, `customer_id`, `next_date_invoice`, `current_cycle`, `auto_recurring` (valor, frequência, repetições).
- `GET /recurrence/subscriptions/{id}/invoices`: confira se há fatura `pending`, `scheduled` ou `not_authorized` (esta última tem retentativa em curso).
- `GET /customers/{customer_id}/card-token/{token}`: o token deve estar `active` e o cartão dentro da validade.

Passos:

1. **Escolha a janela.** Não migre se a próxima fatura vence em menos de 48 horas, nem enquanto houver fatura `pending` ou retentativa em curso. Espere o ciclo processar.
2. **Crie o contrato inerte** (sem `nextChargeAt`, fora do agendamento) e copie o token para o cofre (`StoredCard` + `StoredCardToken`, cifrado). Guarde o `next_date_invoice` lido.
3. **Marque a assinatura local como "em migração"** para o tratamento de `SIGNATURE-CANCELLED` não revogar o acesso quando você cancelar na DOM no próximo passo. Verifique no código como esse evento é tratado hoje (`subscription-webhook.service.ts`); se ele desprovisiona acesso, adicione a proteção antes de rodar.
4. **Cancele na DOM:** `DELETE /recurrence/subscriptions/{id}`. Alterar o modo de faturamento (`change-mode`) **não serve** como parada: ele vale por fatura, então as faturas seguintes voltariam a cobrar sozinhas.
5. **Verifique o token** com `GET /customers/{customer_id}/card-token/{token}`. A doc não diz se cancelar invalida o token.
   - Token `active`: siga para o passo 6.
   - Token inválido: o contrato vira `MANUAL_PAY` (o comprador recebe link para informar o cartão de novo). Opcionalmente tente reativar a DOM com `PUT /recurrence/subscriptions/active/{id}`, sabendo que a doc admite a resposta "Essa assinatura não pode ser reativada".
6. **Ative o contrato próprio:** `status` = `ACTIVE`, `currentPeriodEnd` = `next_date_invoice` lido no passo 2, `nextChargeAt` igual.
7. **A primeira cobrança nossa é a prova real.** Não existe validação sem cobrar. Acompanhe a primeira cobrança de cada contrato migrado (conciliador e alerta de `CHARGE_UNRESOLVED`).

**Piloto obrigatório:** faça a primeira migração com **uma** assinatura de teste ou de comprador tolerante, em sandbox se possível. A cobrança do token fora da assinatura (`POST /transactions` com `credit_card.token` e `upsell: true`) está documentada, mas nunca foi exercida contra a DOM real.

## 4. Cenário C: assinaturas inativas, canceladas, expiradas ou pausadas na DOM

Não há cobrança a assumir. Crie o contrato **sem agendamento** e preserve o acesso que o comprador ainda tem:

- Pausada (`SubscriptionPause`): o acesso restante é `remainingDays`; grave o contrato como `SUSPENDED` com o fim de acesso correspondente.
- Cancelada ou expirada com acesso vigente: contrato `INACTIVE` até o fim do período pago.
- Para voltar a vender a esse comprador, hoje o endpoint de assinatura responde 409 quando existe contrato pago e suspenso para o mesmo e-mail e oferta. **Falta um fluxo de reativação**; sem ele, o comprador precisa de um contrato novo, criado manualmente.

## 5. Antes de executar qualquer cenário

- [x] Modo de renovação efetivo por contrato (com cartão salvo cobra; sem cartão emite `CHARGE_DUE`), em `billing-core/effective-renewal-mode.ts`.
- [x] Lembrete ao comprador antes do vencimento (30, 7 e 1 dias antes e no dia), em `renewal-reminder.cron.ts`. Exige `RENEWAL_LINK_SECRET` no ambiente.
- [x] Script de migração de contratos com dry-run, `--apply --i-understand-this-writes` e `--verify` (`scripts/offer-contract-migration.ts` + `scripts/sql/migrate-paid-subscription-orders.sql`). Testado contra um banco com **todas** as migrations aplicadas, inclusive a guarda de carteira.
- [x] Fluxo de renovação e reativação: `POST /ofertas/public/:code/renew` (link assinado, PIX).
- [ ] Tela de renovação no checkout (`?renovar=<contractId>&sig=<hmac>`): o backend existe, a página não.
- [ ] Proteção do tratamento de `SIGNATURE-CANCELLED` durante a migração do cenário B.
- [ ] Migrations aplicadas (nenhuma foi aplicada em banco real até agora) e as `Offer`s já criadas e verificadas.
- [ ] `RENEWAL_LINK_SECRET` e, para plataformas com token próprio, `DOM_PUBLIC_KEY` definidos no ambiente.
- [ ] Autorização do dono do produto para rodar contra o banco real.

Observação sobre contratos migrados: o endpoint de renovação responde 409 pedindo contato com o suporte quando o contrato não tem documento do comprador. Confira nas 5 ordens se `customerDocument` está preenchido antes de enviar os links.
