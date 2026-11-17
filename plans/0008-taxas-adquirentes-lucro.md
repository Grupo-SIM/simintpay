# Taxa única, adquirentes arbitrárias, sincronização e lucro — backend

Plano em execução, reconciliado em 2026-11-17: o backend entregou o núcleo com nomes e desenho diferentes dos propostos abaixo. Parte frontend: [0017](0017-taxas-adquirentes-lucro.md).

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
- Contrato de simulação/cotação passa a devolver campos sem ambiguidade: `chargedRate`, `referenceAcquirerCost{acquirer,fixed,rate,interest}`, `platformCharges`, `sellerPayout`, `estimatedAdminProfit`, `fallback`; transação liquidada registra `processedBy`, `actualAcquirerCost`, `actualAdminProfit`. Preservar snapshots para auditoria e evitar tratar estimativa como lucro realizado.

## Sincronização com adquirentes

- Interface `AcquirerFeeSyncAdapter { code; fetchSchedule(): Promise<Schedule> }`; adapter DOM primeiro, via `GET /get-negotiation` (`fee_details` das transações serve só para validar unidades).
- Cron periódico (diário, config por env, desligável como `DISABLED_DOM_SYNC`): busca, compara, grava nova versão `SYNC`; aplica automaticamente; queda de custo aumenta o excedente SimIntPay, alta de custo gera alerta; tudo auditado.
- Trilha de auditoria e endpoint `POST /platforms/acquirers/:code/sync`.

## Etapas

- [x] Migração Prisma: `AcquirerFeeSchedule` (append-only; `source` MANUAL|SYNC|MIGRATION, `changeDirection`, `actorId`, `base`) e `active`/`syncAdapter` em `AcquirerCatalogue`; custos `contract` migrados da política GLOBAL (`20261030120000_acquirer_fee_schedule`). Divergência: sem `syncedAt` nem `active` por linha (vale `createdAt` e `AcquirerCatalogue.active`).
- [x] Motor: preço pelo maior custo ativo, roteamento pela adquirente mais barata e fallback 2× do excedente interno (`fallbackPricing`), em `calculateFinancials`/`quoteFinancialCharge` com `scheduled` (`af5333b4`). Divergência: não houve `schemaVersion: 2`; segue `schemaVersion: 1`, e snapshots antigos restauram pelo caminho legado.
- [x] Endpoints de adquirentes em `platforms/acquirers/fees`: `GET /`, `POST /`, `PATCH /:code/active`, `GET /:code/history`, `POST /:code` (custo manual).
- [x] Sincronização DOM (`get-negotiation`) em `AcquirerFeesService.syncDom`, cron diário às 3h (`DISABLED_DOM_SYNC`), e-mail de alta de custo (`d66854c8`) e `POST /platforms/acquirers/fees/DOM/sync`. Divergência: sem interface `AcquirerFeeSyncAdapter` e rota fixa para DOM, não `/:code/sync`.
- [~] Lucro dos relatórios vem só do snapshot financeiro, com o custo da adquirente que processou (`27841e7a`, `ed74114c`, `473af1f1`). Falta expor `T − C_sim` (repasse) e `C_sim − C_adq` (lucro admin) em campos próprios; hoje a base é `simMarginCents`.
- [ ] Contrato de simulação/liquidação sem ambiguidade: os campos `chargedRate`, `referenceAcquirerCost`, `platformCharges`, `sellerPayout`, `estimatedAdminProfit`, `processedBy`, `actualAcquirerCost` e `actualAdminProfit` não existem. Os campos reais são `pricingAcquirer`, `realizedAcquirer`, `fallbackPricing`, `simMarginCents`, `effectiveFees`. Decidir entre implementar o contrato proposto ou redefinir este plano e o 0017 para os campos reais.
- [~] Regras de negócio em `docs/business-rules.md` (custos só da tabela sincronizada, maior custo, sincronização DOM) e testes Bun existem. Falta documentar o fallback 2×.

## Decisões do usuário

1. Sem custo de adquirente na lane: cobrar o **dobro do excedente SimIntPay** (fixo, % e juros).
2. Juros e taxas da adquirente são custo; lucro = só o excedente (inclui excedente de juros); repasse = total − (juros/taxas efetivos). Vale para admin e cliente de plataformas (mesma fórmula, `profit` único do backend). O bug atual é a margem somar valores "adicionais" independentes do custo real da adquirente.
3. Maior custo entre todas as adquirentes ativas habilitadas para a plataforma (hoje todas; sem desativação por plataforma no frontend ainda). Tentativa de processamento da mais barata para a mais cara; grava só a que processou.
4. Sincronização aplica automaticamente; queda de custo da adquirente aumenta o excedente SimIntPay na mesma medida (taxa ao comprador inalterada); alta de custo eleva a taxa cobrada e gera alerta.
5. API DOM: `GET {apiUrl}/get-negotiation` (Authorization: Bearer). Resposta real da conta SimIntPay recebida em 2026-10-29; unidades inferidas (percentuais, não ppm). O adapter lê **apenas** `negotiation` e descarta `user` (contém e-mail, IP, MFA e permissões); nunca persistir nem logar o payload bruto.

## Mapeamento verificado da resposta DOM (crédito online)

- `mdr` = 3,99 (%): constante em todas as parcelas, incide sobre o **total cobrado** (`contract.base = BUYER_TOTAL`). A tela da DOM confirma 3,99% + R$ 1,00 em 1x na modalidade "absorver juros".
- `fees` = 4,51 … 20,48 (%): coluna **taxa link de pagamento** da DOM. Não equivale automaticamente ao custo efetivo quando absorvemos juros; nesse caso a coluna da DOM é `effective_rate` (8,30% em 2x, 20,99% em 12x). A tabela `DOM_FEE_RATES` hardcoded repete `fees`: distinguir as modalidades ao integrar.
- `interest_rate_our` = `effective_rate − mdr` na resposta (conferido: 8,30 − 3,99 = 4,31; 20,99 − 3,99 = 17,00). A proximidade com `fees / (1 + fees)` não comprova que seja essa a fórmula contratual; usar os campos da API diretamente e validar arredondamentos em testes.
- `effective_rate` = `mdr + interest_rate_our` (8,30 em 2x; 20,99 em 12x): custo percentual total sobre o total cobrado.
- `credit.fee_transaction` = R$ 1,00 fixo também em 1x: confirmado pelo usuário e pela tela da DOM (3,99% + R$ 1,00 ao absorver juros). Hoje o código aplica R$ 0 em 1x e R$ 1 em 2x+: corrigir os caminhos afetados e testar. Conferir `fee_details` na conciliação para validar valores efetivamente debitados.
- Mapeamento: `contract.ratePpm = mdr`, `contract.interestPpm = interest_rate_our`, `contract.fixedCents = fee_transaction`, base `BUYER_TOTAL`.
- Fora do crédito: `pix_online` 0,98% + R$ 1; boleto **R$ 3,49 + R$ 1 por transação**, confirmado pela tela da DOM (`mdr_type: FIXED`); débito/crédito físico por bandeira (3,99). Sincronizar crédito online, PIX e boleto com parsing específico para `FIXED`; POS permanece manual até validar modalidade e roteamento por bandeira.
- **Atualização (2026-11):** o débito online passou a ser sincronizado a partir de `debit_physical` (a DOM não expõe contrato online). Foram removidos os custos fixos no código: `TAXA_BOLETO_DOM*`, `POS_MDR_*`, `POS_TAXA_DOM_FIXA`, `MDR_PIX`, `MDR_CC_*`, `MDR_CC_MASTER_*`, `MDR_LINK_*` e `LINK_COST_*`. Estimativas e relatórios leem só `syncedAcquirerCostReais`/`syncedAcquirerRate`. Pendente de validação do desenvolvedor: relatórios de parcelamento passam a reportar `taxaParcelamentoSimIntPay = 0` e `taxaCartao`/`taxaPix` saíram das respostas de admin.

## Pontos a validar na implementação

- Se o gateway só aceita uma adquirente por plataforma hoje (`platformGatewayToken`), o roteamento com fallback exige um adaptador de pagamento por adquirente; com apenas a DOM cadastrada o fallback fica pronto, porém inativo.
- Migração dos snapshots/transações existentes: `processedBy` assume `DOM` para o histórico.
