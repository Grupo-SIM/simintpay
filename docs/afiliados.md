# Afiliados por plataforma e oferta — contrato de integração

Afiliado é uma conta cliente aprovada que indica vendas de uma plataforma (ou de uma oferta dela) e
recebe uma comissão na carteira. É independente do programa de indicação de contas (`?ref=` no
cadastro, `AffiliateCommission`) e da co-produção. Código e implementação: `backend/src/modules/affiliate/`.

## Modelo

- `AffiliateAgreement` por `(product, productId)`, `product` = `plataformas` | `ofertas`: `version`,
  `defaultPercentageBps` (global, opcional), `commissionOnRenewals`, `linkBaseUrl` (só plataforma) e
  `affiliates` (JSON `{ userId, percentageBps | null }`). `AffiliateAgreementRevision` é a auditoria
  imutável de cada versão aceita.
- `AffiliateCode` `(platformId, userId, code)`: código estável por pessoa e plataforma, único na
  plataforma, `[A-Za-z0-9_-]{3,40}`, gerado pelo servidor (8 caracteres aleatórios) na primeira vez em
  que a pessoa entra em qualquer lista da plataforma ou de uma oferta dela. Nunca é o e-mail e não muda
  ao sair e voltar para uma lista.
- `AffiliateAllocation` `(transactionId, userId)`: valor original da comissão, `state`
  (`AVAILABLE`, `LOCKED`, `REVERSED`) e `isRenewal`. Tabela própria, e não `CoproductionAllocation`
  com `kind`: a chave `(transactionId, userId)` da co-produção não permite a mesma pessoa como
  coprodutora e afiliada na mesma venda, e os recebimentos da co-produção não podem misturar comissão.
- O snapshot da venda (`financialSnapshot.coproduction.affiliate`) guarda afiliado, código, nome,
  percentual efetivo, nível de origem (`offer` | `platform`), versões dos acordos e
  `commissionOnRenewals` efetivo. Venda só com afiliado grava um snapshot sem participantes.

## Regras

- Plataforma e oferta **somam** (diferente da co-produção, que substitui): vale a união das duas
  listas. Afiliado da plataforma vale em toda compra dela (oferta, assinatura, renovação e API);
  afiliado da oferta vale só nela.
- Percentual, do mais forte ao mais fraco: pessoa na oferta, global da oferta, pessoa na plataforma,
  global da plataforma. Mesma pessoa nas duas listas: vale o percentual da oferta. Sem percentual em
  nenhum nível, não há comissão.
- Base: líquido após taxas, em centavos, parte inteira inferior (`floor`), mesma base da co-produção
  (no Delivery, os itens). Sai da parte do dono; coprodutores não mudam.
- Soma: afiliado efetivo + coprodutores <= 10000 bps, sobre a lista **já deduplicada** (ver abaixo).
  Um código identifica uma pessoa, então o pior caso é o maior total, entre as pessoas listadas, de
  esse afiliado mais os coprodutores da venda, contando a pessoa uma só vez. A validação é
  **simétrica**: o PUT de afiliados e o PUT de co-produção (plataforma e oferta) calculam o mesmo pior
  caso conjunto, com a mesma função (`worstCaseBps`, via `assertJointLimit` em
  `affiliate-limit.ts`), inclusive contra as ofertas da plataforma (PUT da plataforma). Quem estoura é
  rejeitado com 400 e mensagem que informa o total e o excedente (ex.: "A soma de coprodutores e
  afiliados chegaria a 100,01% do líquido, 0,01% acima do limite de 100%..."), sem e-mail de
  terceiros; a gravação inteira é desfeita. Os dois PUTs tomam o mesmo lock da plataforma
  (`affiliate:<platformId>`), então salvamentos concorrentes não passam cada um sobre o estado antigo
  do outro. A captura revalida sobre a lista deduplicada: se uma configuração legada ainda estourar a
  soma, a nova venda é recusada (409) e a renovação segue sem comissão.
- Sem comissão, sem erro: código desconhecido, inválido ou de pessoa removida da lista; dono da
  plataforma/oferta igual ao afiliado; e-mail do comprador igual ao do afiliado.
- Renovação: usa o snapshot da primeira venda, gravado em `BillingContract.metadata.affiliate`. Com
  `commissionOnRenewals` efetivo `false`, só o primeiro ciclo pago comissiona (inclusive o primeiro
  ciclo depois de um período de teste); renovações não geram alocação nem bloco `affiliate` no evento.
  Mudar a opção depois vale só para novas assinaturas. Renovações marcam `isRenewal`.
- Oferta fora de qualquer plataforma ativa não aceita afiliados (PUT 400).
- Ebook (`EBOOK_V1`): o acerto é por manifesto, com afiliados do próprio manifesto; os afiliados
  deste contrato **não** se aplicam a ele.

## Deduplicação e exceções por oferta

Afiliado é um coprodutor que só ganha nas vendas que trouxe: todos calculam sobre o **mesmo**
líquido (coprodutor 5% + afiliado 5% de pessoas diferentes: cada um 5%, dono 90%).

- **A mesma pessoa nunca recebe duas partes na mesma venda.** Se ela é coprodutora e afiliada da
  venda, vale uma entrada: a mais específica vence (oferta sobre plataforma). Nível do coprodutor: da
  oferta quando o acordo próprio (`OWN`) da oferta vale; da plataforma quando a oferta herda ou a
  venda é da plataforma. Nível do afiliado: `level` do snapshot.
- **Empate no mesmo nível: vale o coprodutor.** A entrada de afiliado é descartada: sem
  `AffiliateAllocation`, sem `affiliate` no snapshot e sem `affiliate` no evento da API de vendas.
- **Afiliado vence** (coprodutor herdado da plataforma, afiliado na oferta): o participante sai do
  snapshot daquela venda e vale a comissão de afiliado.
- **Auditoria:** o snapshot ganha `deduplication` (`discarded`: `coproducer` | `affiliate`,
  `coproducerLevel`, `affiliateLevel`, `discardedPercentageBps`), sem e-mail. Quando o afiliado
  vence, o mesmo bloco fica em `affiliate.deduplication` (e, portanto, em
  `BillingContract.metadata.affiliate`).
- Dono como afiliado continua sem comissão.
- **Soma:** a regra de 100% vale sobre a lista deduplicada, nos dois PUTs (afiliados e co-produção).
  Usa-se o **pior caso**: para cada
  pessoa listada, a venda em que ela é a afiliada, com a pessoa contada uma vez (vence a entrada que
  valeria, de coprodutor ou de afiliado), comparada com a co-produção sozinha. Vale o maior total. A
  captura aplica a mesma conta à venda real.
- **Renovações** usam o snapshot original: quando o afiliado venceu, o participante coprodutor dessa
  pessoa continua fora das renovações; quando perdeu, não há afiliado gravado no contrato e a
  renovação paga só o coprodutor. `commissionOnRenewals` não muda.

Exceção por oferta (inalterada, e diferente entre os dois módulos):

- Co-produção: o acordo `OWN` da oferta **substitui** a lista da plataforma (inclusive vazia);
  `INHERIT` herda. Não existe modo de união.
- Afiliados: plataforma e oferta **somam**, e a mesma pessoa vale pelo percentual da oferta. O
  percentual mínimo é 1 bps; 0 não exclui ninguém.

## Interface

O botão “Participações” (plataforma e oferta) abre um único diálogo com as abas “Co-produção” e
“Afiliados”; os dois acordos são carregados ao abrir. A validação do cliente é conjunta e usa o
rascunho das duas abas: total = maior percentual efetivo de uma pessoa afiliada (contada uma vez,
mesma regra de `worstCaseBps` e `dedupOverlap`) mais os coprodutores, exibido em um indicador fixo
com “Dono recebe X%”. Acima de 100% o salvar de qualquer aba fica bloqueado com o total e quem
excede. O cliente não conhece as ofertas de uma plataforma ao editar a plataforma: esse caso só o
servidor recusa (400), e o rascunho é preservado. Afiliados herdados na oferta chegam sem e-mail e
casam com coprodutores pelo nome.

## Identificação na venda

Chave `aff` (alias `ref`, normalizado para `aff`) no `tracking` do checkout (query ou corpo) e no
`tracking` de `POST /platforms/:tag/payments`. Formato `^[A-Za-z0-9_-]{3,40}$`; fora dele é descartado
em silêncio. O código fica em `Transaction.tracking.aff` apenas como chave de busca, nunca como valor
financeiro. A resolução ocorre antes do gateway em todos os chamadores (`captureAffiliate` ao lado de
`captureCoproduction`; renovações usam `renewalAffiliate`).

## Endpoints (sessão de usuário; token de integração não configura)

Dono aprovado ou admin ativo; versão otimista (409); e-mails normalizados e únicos; sem o próprio dono.

Prefixo HTTP: `/comissoes` (neutro de propósito: bloqueadores de anúncio, como EasyList, bloqueiam
caminhos com "afiliado"/"affiliate" e devolvem `net::ERR_BLOCKED_BY_CLIENT`). O frontend chama só
`/comissoes/*`.

- **Obsoleto:** `/afiliados/*` continua respondendo como alias (mesmo controller, mesmos guards) só para
  clientes antigos durante o deploy. Remover quando nenhum cliente o usar.
- **Ordem de deploy:** backend primeiro (serve os dois prefixos), frontend depois.

- `GET|PUT /comissoes/plataformas/:platformId` e `GET|PUT /comissoes/ofertas/:id`.
- `GET /comissoes/contas?search=&page=`: mesma busca de contas da co-produção.
- `GET /comissoes/recebimentos?page=&startDate=&endDate=&platform=&paymentMethod=`: comissões do
  afiliado (`amountCents`, `state`, `isRenewal`, `originName`) e `summary` (`creditedCents`,
  `lockedCents`, `reversedCents`). Os filtros são os mesmos, com a mesma validação e semântica de
  fuso, de `GET /coproducao/recebimentos` (`startDate`/`endDate` `YYYY-MM-DD` inclusivos em
  America/Sao_Paulo, `platform` pela tag canônica, `paymentMethod` do enum; 400 para data, intervalo,
  método ou filtro inválidos). `summary` e `total` respeitam os filtros; a paginação não os altera.
  `hasAffiliation` ignora os filtros e indica que o usuário já tem alguma comissão, para o relatório
  não esconder a seção quando o filtro não encontra nada.

Corpo do PUT (ambos escopos):

```json
{
  "version": 0,
  "defaultPercentageBps": 1000,
  "commissionOnRenewals": true,
  "linkBaseUrl": "https://rastrewin.com/",
  "affiliates": [{ "email": "pessoa@exemplo.com", "percentageBps": null }]
}
```

`percentageBps` 1..10000 (`null` usa o global); `commissionOnRenewals`: boolean na plataforma, e na
oferta `null` usa a da plataforma; `linkBaseUrl` só na plataforma (HTTPS, sem credenciais).

Resposta do GET/PUT: `{ data: { version, defaultPercentageBps, commissionOnRenewals, linkBaseUrl?,
affiliates: [{ email, name, code, percentageBps }], inherited? } }`. `inherited` só nas ofertas,
somente leitura e sem e-mails: `{ defaultPercentageBps, commissionOnRenewals, affiliates: [{ name,
code, percentageBps }] }` da plataforma.

## Liquidação

Mesmo liquidador da co-produção (`settleFinalNet`): `COMPLETED` credita a carteira do afiliado
(`nature: AFFILIATE`, ação `AFFILIATE_<status>`), `IN_MEDIATION` bloqueia, `REFUNDED`/`CHARGEBACK`
revertem o valor original sem recalcular. Idempotente por `(transactionId, userId)`. O dono recebe
o líquido menos a comissão (e menos os coprodutores): relatórios usam `coproductionOwnerNet`.

## API de vendas

`purchase_approved`, `purchase_refunded`, `chargeback` e `refund_requested` levam
`affiliate: { code, commissionCents, name? }` somente quando a venda tem comissão. Sem e-mail, id nem
valores de terceiros. Ver [central-sales-api.md](central-sales-api.md).

## Visibilidade para afiliados

Somente leitura e sem dados de terceiros; espelha a visibilidade da co-produção
([coproduction.md](coproduction.md)), com blocos próprios e nunca fundidos aos dela.

- `GET /relatorios/dashboard`, `GET /relatorios/financeiro` e o dashboard do cliente retornam
  `afiliacao: { count, creditedCents, lockedCents, reversedCents }`: só as comissões do próprio
  usuário como afiliado em vendas de outros donos. Informativo: o valor já integra a carteira e não
  é somado como receita integral da venda.
- Para o dono, `afiliados: { count, commissionCents }` é o que foi pago a afiliados nas vendas do
  período (comissões creditadas). O líquido das vendas próprias já desconta a comissão (relatórios
  usam a mesma base de `coproductionOwnerNet`), então a comissão aparece separada das taxas e dos
  coprodutores, para conciliar líquido x bruto.
- Os blocos respeitam os filtros de período, plataforma e meio de pagamento. Selecionar uma
  plataforma em que o usuário é só afiliado exibe apenas a participação dele (`participationOnly`).
- `GET /transacoes` e `GET /transacoes/:id` incluem vendas com `AffiliateAllocation` do usuário e
  retornam `afiliacao: { role: 'OWNER' | 'AFFILIATE', readOnly, myAmountCents, state, isRenewal }`.
  Afiliado: valor exato da própria alocação; sem comprador, sem taxas nem líquido do dono (campos
  nulos). Dono: `affiliateCommissionCents` e `affiliateCode`, nunca o e-mail do afiliado.
- Quem tem co-produção e afiliação na mesma venda recebe `coproducao` e `afiliacao` separados. Venda
  só com afiliado (ou em que a deduplicação tirou o coprodutor) não traz `coproducao`, nem para o
  dono. O coprodutor nunca vê `afiliacao`, código nem comissão do afiliado; o afiliado nunca vê
  comprador, líquido nem coprodutores.
  Estorno e chargeback aparecem como `REVERSED`.
- O catálogo de plataformas (`/platforms`) inclui as plataformas em que o usuário é afiliado
  (acordo da plataforma ou de oferta dela) com identificação básica e
  `afiliacao: { role: 'AFFILIATE', readOnly: true }`, sem configurações privadas.
- Os recebimentos de afiliado (`/afiliados/recebimentos`) recebem do relatório os mesmos filtros de
  período, plataforma e meio de pagamento que os recebimentos de coprodução.

## Publicação

Aplicar a migration `20261122090000_affiliates` (aditiva) antes do backend; depois frontend/checkout.
Nada é retroativo: vendas e assinaturas existentes não ganham afiliado.

## Afiliado SimIntPay (margem)

Mesmo mecanismo de afiliado (código `aff`, lista por plataforma e oferta, soma plataforma + oferta,
percentual por pessoa ou global, `commissionOnRenewals`), mas a comissão sai da **margem da
SimIntPay**, nunca do líquido do dono nem dos coprodutores. Só administrador ativo configura.

- Tabelas próprias: `MarginAffiliateAgreement`, `MarginAffiliateRevision`,
  `MarginAffiliateAllocation` (migration `20261123090000_margin_affiliates`, aditiva). O código
  (`AffiliateCode`) é o mesmo da pessoa na plataforma; o snapshot da venda ganha
  `financialSnapshot.coproduction.marginAffiliate`, independente de `affiliate`.
- Margem da venda em centavos: `buyerTotalCents − líquido do vendedor − acquirerCost.realizedCents`
  (mesma conta do lucro Simpay). Custo realizado desconhecido ou margem negativa: margem zero, sem
  alocação. Comissão = `floor(margem × bps / 10000)`, congelada no primeiro crédito (`COMPLETED`);
  mediação bloqueia e estorno/chargeback revertem o valor original.
- Sem deduplicação nem limite conjunto com coprodutores/afiliados comuns: a mesma pessoa pode estar
  nas duas listas e recebe de duas bases distintas. Limite próprio: cada percentual efetivo <= 100%
  da margem.
- Carteira: `nature: AFFILIATE`, ação `AFFILIATE_MARGIN_<status>`, metadado `basis: SIMINTPAY_MARGIN`.
- Renovação usa `BillingContract.metadata.marginAffiliate` da primeira venda.
- Endpoints (sessão admin): `GET|PUT /comissoes/margem/plataformas/:platformId` e
  `/comissoes/margem/ofertas/:id`; corpo e resposta como o afiliado comum, sem `linkBaseUrl`.
- Interface: aba "Afiliado SimIntPay" no diálogo Participações, visível só para admin.
- Pendente: relatórios de lucro Simpay ainda não abatem essa comissão; o afiliado ainda não a vê em
  `/comissoes/recebimentos` (aparece na carteira/extrato).
