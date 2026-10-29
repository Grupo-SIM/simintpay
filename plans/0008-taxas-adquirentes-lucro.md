# Taxa única, adquirentes arbitrárias, sincronização e lucro — backend

Plano (aguardando aprovação). Parte frontend: [../../simintpay-front/plans/0007-taxas-adquirentes-lucro.md](../../simintpay-front/plans/0007-taxas-adquirentes-lucro.md).

## Contexto verificado

- `calculateFinancials` (`modules/financial-policy/financial-policy.ts`) hoje soma `contract` (adquirente) + `sim` (SimIntPay) como custos separados; sem custo de adquirente configurado a lane fica só com `sim`, e o fluxo antigo divergia (incidente de juros duplicados).
- `margem = contractedCost − acquirerCost` inclui `simInterestCents` → juros entram no lucro.
- `AcquirerCatalogue` só tem `code`/`name`; custos vivem dentro das lanes do documento de política (`DOM/CREDIT_CARD/ONLINE/n`), misturados com os do SimIntPay.
- Não existe sincronização de taxas; `api-dom.client.ts` usa tabela fixa `CARD_RATES`. Já há padrão de cron em `infrastructure/cron/*`.

## Modelo proposto

- **Custos de adquirente separados da política da plataforma**: nova tabela `AcquirerFeeSchedule` (acquirer, method, channel, installments, fixedCents, ratePpm, interestPpm, source `MANUAL|SYNC`, active, versão imutável/append-only, `syncedAt`). Adquirentes arbitrárias via `AcquirerCatalogue` (+ `active`, `syncAdapter?`).
- **Taxa cobrada por lane** = excedente SimIntPay (`sim`: fixo, %, juros) + **maior** custo entre adquirentes ativas da lane. Sem nenhum custo configurado: **2× o excedente interno** (fallback explícito, sinalizado na resposta como `fallback: true`).
- **Três valores por cobrança, sem ambiguidade** (`T` = total pago pelo comprador; `C_sim` = taxas+juros cobrados pela SimIntPay = excedente + custo da adquirente; `C_adq` = taxas+juros efetivos pagos à adquirente que processou):
  - **Repasse / lucro do usuário (dono da plataforma)** = `T − C_sim`.
  - **Lucro do admin (SimIntPay)** = `T − repasse − C_adq` = `C_sim − C_adq`.
  - Juros entram nos dois lados: no custo/excedente de juros, nunca como "lucro" isolado. A tela do usuário mostra só `T`, `C_sim` e repasse (nunca `C_adq`); o admin vê os três mais `C_adq`.
- **Roteamento**: tentar primeiro a adquirente mais barata da lane (entre ativas e habilitadas para a plataforma) e, em falha, a seguinte por custo crescente. Gravar na transação **apenas a adquirente que efetivamente processou** e o custo efetivo dela (`processedBy`, custo fixo/%/juros em centavos); relatórios calculam lucro real a partir disso, nunca de estimativa.
- Compatibilidade: snapshots existentes (`restoreFinancialCharge`) continuam recalculando pelo documento antigo; novo cálculo versionado (`schemaVersion: 2`), cobranças novas apenas.
- Contrato de simulação/cotação passa a devolver: `chargedRate`, `effectiveAcquirerCost{acquirer,fixed,rate,interest}`, `profit`, `interestPassThrough`, `fallback`.

## Sincronização com adquirentes

- Interface `AcquirerFeeSyncAdapter { code; fetchSchedule(): Promise<Schedule> }`; adapter DOM primeiro, via `GET /get-negotiation` (`fee_details` das transações serve só para validar unidades).
- Cron periódico (diário, config por env, desligável como `DISABLED_DOM_SYNC`): busca, compara, grava nova versão `SYNC`; aplica automaticamente; queda de custo aumenta o excedente SimIntPay, alta de custo gera alerta; tudo auditado.
- Trilha de auditoria e endpoint `POST /platforms/acquirers/:code/sync`.

## Etapas

- [ ] Migração Prisma: `AcquirerFeeSchedule`, campos de `AcquirerCatalogue`; migrar custos `contract` atuais das lanes (revisão auditável).
- [ ] Motor v2 em `financial-policy.ts` + `quoteFinancialCharge` com maior-custo/fallback 2× e `profit` correto; testes de arredondamento e regressão com snapshots v1.
- [ ] Endpoints CRUD de adquirentes/custos e simulação com o novo contrato.
- [ ] Adapter DOM + cron + alertas + aprovação.
- [ ] Corrigir lucro em relatórios/`platformProfit`/liquidação para excluir repasse de juros.
- [ ] Regras de negócio (`docs/business-rules.md`), testes Bun, build.

## Decisões do usuário

1. Sem custo de adquirente na lane: cobrar o **dobro do excedente SimIntPay** (fixo, % e juros).
2. Juros e taxas da adquirente são custo; lucro = só o excedente (inclui excedente de juros); repasse = total − (juros/taxas efetivos). Vale para admin e cliente de plataformas (mesma fórmula, `profit` único do backend). O bug atual é a margem somar valores "adicionais" independentes do custo real da adquirente.
3. Maior custo entre todas as adquirentes ativas habilitadas para a plataforma (hoje todas; sem desativação por plataforma no frontend ainda). Tentativa de processamento da mais barata para a mais cara; grava só a que processou.
4. Sincronização aplica automaticamente; queda de custo da adquirente aumenta o excedente SimIntPay na mesma medida (taxa ao comprador inalterada); alta de custo eleva a taxa cobrada e gera alerta.
5. API DOM: `GET {apiUrl}/get-negotiation` (Authorization: Bearer). Resposta real da conta SimIntPay recebida em 2026-10-29; unidades inferidas (percentuais, não ppm). O adapter lê **apenas** `negotiation` e descarta `user` (contém e-mail, IP, MFA e permissões); nunca persistir nem logar o payload bruto.

## Mapeamento verificado da resposta DOM (crédito online)

- `mdr` = 3,99 (%): constante em todas as parcelas, incide sobre o **total cobrado** (`contract.base = BUYER_TOTAL`).
- `fees` = 4,51 … 20,48 (%): acréscimo da parcela sobre o valor base (igual à tabela `DOM_FEE_RATES` que está hardcoded em `payment-link-fees.helper.ts`).
- `interest_rate_our` = `fees / (1 + fees)` (conferido: 4,51→4,31; 12x 20,48→17,00): é o juros como % do total cobrado.
- `effective_rate` = `mdr + interest_rate_our` (8,30 em 2x; 20,99 em 12x): custo percentual total sobre o total cobrado.
- `credit.fee_transaction` = R$ 1,00 fixo. Hoje o código aplica R$ 0 em 1x e R$ 1 em 2x+: confirmar com uma transação real de 1x (`fee_details`) antes de espelhar.
- Mapeamento: `contract.ratePpm = mdr`, `contract.interestPpm = interest_rate_our`, `contract.fixedCents = fee_transaction`, base `BUYER_TOTAL`.
- Fora do crédito: `pix_online` 0,98% + R$ 1; `boleto` mdr 3,49 com `mdr_type: FIXED` (valor fixo em R$ ou %? ambíguo); débito/crédito físico por bandeira (3,99). Sincronizar só crédito online e PIX no início; boleto e POS ficam manuais até a unidade do `FIXED` ser confirmada.

## Pontos a validar na implementação

- Se o gateway só aceita uma adquirente por plataforma hoje (`platformGatewayToken`), o roteamento com fallback exige um adaptador de pagamento por adquirente; com apenas a DOM cadastrada o fallback fica pronto, porém inativo.
- Migração dos snapshots/transações existentes: `processedBy` assume `DOM` para o histórico.
