# Portal do Cliente (SimintPay) — Design

**Data:** 2026-06-27
**Repos envolvidos:** `api-machine` (backend NestJS), `admin-card-machine` (frontend Next.js)
**Abordagem escolhida:** B — Seções dedicadas (cliente + master) reusando componentes; páginas atuais do admin ficam intocadas.

---

## 1. Objetivo

Criar uma versão das 4 abas existentes (**Plano**, **Plano por PIX**, **Links de Pagamento**, **Links de Assinatura**) para **clientes**.

**Quem é cliente (DECIDIDO):** toda conta que se **auto-cadastra** no SimintPay (fluxo `register` atual). Admins de tenant e o master **não** são clientes. Contas `USER` já existentes ficam intocadas.

**Onboarding (DECIDIDO):** cadastro + **aprovação do master**. O cliente se cadastra e fica **pendente**; só pode **criar** links/planos depois que o master **aprova e define a taxa** dele.

Regras:

1. Tudo que o cliente cria é criado **em cima da plataforma SimintPay** (conta DOM mestre / `DOM_TOKEN` global), **sempre** — o cliente nunca vê esse vínculo. É invisível, acontece por trás dos panos.
2. O **módulo master** define a **taxa por cliente** que incide sobre os links/planos daquele cliente (no momento da aprovação e ajustável depois).
3. Tudo que é criado **aparece para o master**, e o master sabe **qual cliente criou** (atribuição/auditoria).
4. O **cliente só vê / cria / edita o que é dele**. Só o master vê tudo.
5. O cliente só pode criar com **valor mínimo de R$ 14,99** no campo de valor.
6. Cliente **pendente** (não aprovado) **não cria** links/planos (bloqueio no backend).

### Não-objetivos (YAGNI)

- Não mexer no fluxo atual do admin/tenant (as 4 páginas atuais continuam como estão).
- Não criar um app frontend separado (decisão: mesmo app, por papel).
- Não criar um novo gateway de pagamento — SimintPay = conta DOM mestre já existente.
- Não expor a granularidade completa de taxas (52 chaves) ao master por cliente; o master configura uma **taxa simplificada por cliente** (ver §5).

---

## 2. Conceitos e estado atual (o que já existe)

| Peça | Estado atual | O que muda |
|------|--------------|------------|
| **Papéis** | `Role = USER \| ADMIN`. `isMasterAdmin` = ADMIN + (email em `MASTER_ADMIN_EMAILS` ou tenant "master"). | **Não** mexer no enum `Role`. Marcar cliente via novo campo `clientStatus` em `User` (`PENDING`/`APPROVED`/`REJECTED`; `null` = não-cliente). `isClient = clientStatus != null`. |
| **Cadastro** | `register` cria conta na DOM, gera `domToken` pessoal, faz auto-login, `role = USER`. | Auto-cadastro passa a marcar `clientStatus = PENDING`. Auto-login continua, mas criação fica bloqueada até `APPROVED`. |
| **Posse (ownership)** | Todos os 4 modelos têm `userId`. `GET /planos`, `/links-pagamento`, etc. já filtram pelo dono via token. | Reaproveitar — cliente já só enxerga o que é dele. Garantir que update/delete também checam posse. |
| **Token SimintPay** | `create-plan` já usa `process.env.DOM_TOKEN`. Subscription/payment link resolvem `owner.domToken → módulo → DOM_TOKEN`. | Para itens de **cliente**, **forçar sempre** `DOM_TOKEN` (ignorar token pessoal). |
| **Taxa por cliente** | `buildClientTaxaTag(email)` → `CLIENT:<email>`; `patchPlatform`, `getResolvedTaxaForTag` existem. Só o checkout de **link de assinatura** aplica `CLIENT:<email>` (e só quando tag = GLOBAL). | Generalizar: para **qualquer item cujo dono é CLIENTE**, resolver taxa com tag `CLIENT:<email>` (fallback GLOBAL/defaults), nos 4 produtos. |
| **Chaves de taxa** | Cartão: `MDR_CC_MASTER_*`; PIX: `MDR_PIX`; link pgto: `MDR_LINK_*`; assinatura: `TAXA_ASSINATURA`. | Master grava override por cliente nessas chaves via `CLIENT:<email>`. |

**Insight central:** a fundação de taxa-por-cliente e de vínculo-SimintPay já existe. O trabalho é (a) marcar/aprovar clientes (`clientStatus`), (b) generalizar a aplicação da taxa `CLIENT:<email>` aos 4 produtos, (c) forçar o token mestre nos itens de cliente, (d) impor o mínimo de R$ 14,99 e bloquear pendentes, e (e) dar ao master a visão de auditoria + aprovação + configuração de taxa por cliente.

---

## 3. Papéis e identidade

### Backend
- Adicionar campo `clientStatus` em `User` (enum `ClientStatus { PENDING, APPROVED, REJECTED }`, **nullable**; `null` = não é cliente) → **migration**. Não altera o enum `Role`.
- `register.use-case.ts`: novas contas auto-cadastradas recebem `clientStatus = PENDING`.
- `get-me.use-case.ts`: expor `isClient: user.clientStatus != null` e `clientStatus` (além de `isAdmin`, `isMasterAdmin`).
- Tag de taxa do cliente: `CLIENT:<email>` (via `buildClientTaxaTag`), derivada do **dono** do item (não do comprador).
- Atribuição/auditoria: o `userId` do item já identifica o cliente; o master resolve nome/email por join em `User` onde `clientStatus != null`. **Sem coluna nova** além de `clientStatus`.

### Frontend
- `use-current-user.ts`: adicionar `isClient` ao tipo `CurrentUser`.
- Sidebar:
  - `isClient` → mostra as 4 abas (apontando para as páginas de cliente, §6).
  - `isMasterAdmin` → mostra, além do painel atual, a nova seção **"Clientes"** (§7).
  - Admin/tenant comum → comportamento atual inalterado.

---

## 4. Vínculo SimintPay (invisível para o cliente)

Regra única para itens cujo **dono é CLIENTE**, nos 4 fluxos de criação/checkout:

```
domToken = process.env.DOM_TOKEN   // conta SimintPay mestre — SEMPRE, ignora owner.domToken
```

No frontend de cliente, **nenhum** seletor de plataforma/tenant é exibido. O backend nunca aceita `plataformas`/`platformTag` vindo do cliente — ele força GLOBAL/SimintPay internamente. Visualmente o cliente só vê: nome, descrição, valor, e opções funcionais (frequência, parcelas, métodos de pagamento, etc.).

---

## 5. Taxa por cliente (definida pelo master)

### Modelo
- **Uma taxa por cliente** (decisão do usuário), persistida como override `CLIENT:<email>` no store de platform-taxas (mecanismo existente — **sem schema novo**).
- O master configura uma **taxa simplificada** por cliente. Proposta de campos expostos na UI do master:
  - **Taxa cartão (%)** → grava em `MDR_CC_MASTER_1X` (e replica nas demais parcelas `MDR_CC_MASTER_2X…12X` / `MDR_LINK_*` conforme o produto, ou mantém o escalonamento padrão somando a % do cliente — decisão de implementação a detalhar no plano).
  - **Taxa PIX (%)** → grava em `MDR_PIX` para o tag `CLIENT:<email>`.
  - **Taxa assinatura (%)** → grava em `TAXA_ASSINATURA`.
  - (Defaults: se o master não definir, cai em GLOBAL/defaults — o cliente nunca fica "sem taxa".)
- Endpoints reaproveitados: `patchPlatform('CLIENT:<email>', {…})` para gravar, `getResolvedTaxaForTag('CLIENT:<email>')` para ler.

### Economia (como a taxa incide) — **DECIDIDO**
- O valor que o cliente digita (≥ 14,99) é o **valor cobrado do comprador** (o que o comprador paga).
- A taxa SimintPay/master é **descontada** desse valor. O cliente recebe o **líquido**.
- Exemplo do usuário: link de R$ 20,00 → o cliente vê na listagem ~R$ 15,00 (líquido após taxas).
- O cálculo de líquido **reaproveita a lógica de vendedor já existente** (`computeUserNetBalance`, `Transaction.netAmount`, `LIQUIDEZ`, `TAXA_SERVICO`) — resolvida com o tag `CLIENT:<email>` do dono. A fórmula exata deve ser validada contra o exemplo 20→15 no plano de implementação.
- **Parcelamento no cartão (DECIDIDO):** a % do cliente é **somada sobre o escalonamento padrão por parcela** (mantém os juros por parcela e adiciona o delta do cliente). Aplicação por produto (mesmo mecanismo de cada um, trocando o tag para `CLIENT:<email>`):
  - **Plano (cartão):** preço enviado à DOM = valor do cliente; taxa do cliente realizada no líquido/markup conforme `CLIENT:<email>`.
  - **Plano por PIX:** taxa via `MDR_PIX` (tag `CLIENT:<email>`).
  - **Link de pagamento:** `MDR_LINK_*` por parcela = padrão + % do cliente.
  - **Link de assinatura:** `MDR_CC_MASTER_1X` (+ `MDR_CC_1X`) no checkout — já implementado para `CLIENT:<email>`, generalizar.

### Visibilidade — **DECIDIDO**
- O cliente **não vê** a taxa (%) nem o vínculo SimintPay (atende "visualmente ele não vê").
- O cliente **vê o valor líquido** que vai receber por venda paga, na listagem (ex.: 20 cobrado → 15 líquido). Ver §6.1.

---

## 6. Cliente — páginas (frontend)

Novas rotas sob `(dashboard)/cliente/*` (páginas atuais do admin **não são tocadas**):

- `(dashboard)/cliente/planos` + `…/planos/criar`
- `(dashboard)/cliente/planos-pix` + `…/criar`
- `(dashboard)/cliente/links-pagamento` + `…/criar`
- `(dashboard)/cliente/links-assinatura` + `…/criar`

Reaproveitamento: extrair/usar os **componentes de formulário** atuais com uma prop `mode="cliente"` que:
- Esconde seletor de plataforma e **todos** os campos de taxa/parcelamento-taxa.
- Valida **valor mínimo R$ 14,99** (mensagem clara).
- Não envia `plataformas`/`platformTag`.

**Estado pendente:** se `clientStatus !== 'APPROVED'`, o portal mostra um aviso "Conta em análise" e **desabilita a criação** (o backend também bloqueia — §8). Cliente `REJECTED` vê mensagem equivalente.

Listagens do cliente: chamam os **mesmos endpoints** existentes (`GET /planos`, etc.), que já filtram pelo dono. Sem coluna "criado por" (é tudo dele).

### 6.1 Valor líquido na listagem (cliente) — **DECIDIDO**
- O cliente **não vê** a taxa, mas **vê o líquido** que recebe por cada venda paga.
- Onde aparece:
  - Numa **listagem de vendas/transações** do cliente: cada transação paga mostra o **valor líquido** recebido (`netAmount`/`computeUserNetBalance` com tag `CLIENT:<email>`).
  - (Opcional, a refinar no plano) Pré-visualização do líquido estimado na própria listagem do link/plano.
- Reaproveita a infra de carteira/líquido já existente; nada de novo no schema.

---

## 7. Master — seção "Clientes" (frontend + backend)

Visível só para `isMasterAdmin`.

### 7.1 Gestão e aprovação de clientes
- **Listar** clientes (`clientStatus != null`): nome, email, **status** (pendente/aprovado/rejeitado), taxa atual, contagem de itens. Destaque para **pendentes**.
- **Aprovar** um cliente pendente: define a taxa (`CLIENT:<email>`) e marca `clientStatus = APPROVED`. (Pode rejeitar → `REJECTED`.)
- **Editar** cliente: ajustar taxa, reativar/desativar.
- (Master **não cria** contas de cliente — elas nascem do auto-cadastro; o master aprova.)

Endpoints (master-only, `@Roles(Role.ADMIN)` + `isMasterAdminUser`):
- `GET /admin/clientes?status=pending|approved|all`
- `PATCH /admin/clientes/:id/aprovar` (body: taxa) → seta `APPROVED` + grava taxa
- `PATCH /admin/clientes/:id/rejeitar` → seta `REJECTED`
- `GET /admin/clientes/:id/taxa` / `PATCH /admin/clientes/:id/taxa` (wrap de `getResolvedTaxaForTag`/`patchPlatform` com `CLIENT:<email>`).

### 7.2 Visão de auditoria (tudo que clientes criaram)
- Listagens agregadas dos 4 produtos com coluna **"Criado por"** (cliente) + **filtro por cliente**.
- Endpoints master-only:
  - `GET /admin/clientes/planos`
  - `GET /admin/clientes/planos-pix`
  - `GET /admin/clientes/links-pagamento`
  - `GET /admin/clientes/links-assinatura`
  - (cada um: lista itens de **todos** os donos com `clientStatus != null`, com `clientId`/`clientEmail`, suporta `?clientId=`).

---

## 8. Backend — regras de criação para CLIENTE

Nos use-cases de criação dos 4 produtos, quando o usuário é cliente (`clientStatus != null`):

1. **Aprovação:** se `clientStatus !== 'APPROVED'` → `ForbiddenException('Sua conta está em análise')`. Bloqueia criação de pendente/rejeitado.
2. **Token:** forçar `process.env.DOM_TOKEN` (SimintPay).
3. **Mínimo:** rejeitar valor < `14.99` → `BadRequestException('O valor mínimo é R$ 14,99')`. Constante compartilhada `CLIENT_MIN_AMOUNT = 14.99`.
4. **Tag de taxa:** usar `buildClientTaxaTag(user.email)` em vez do tag de plataforma; fallback GLOBAL/defaults.
5. **Ignorar** qualquer `plataformas`/`platformTag` enviado pelo cliente.
6. **Posse:** `userId = user.id` (já é o padrão).

Validação de mínimo e do estado aprovado também no frontend (UX), mas o **backend é a fonte de verdade**.

---

## 9. Modelo de dados (mudanças)

- **Única mudança de schema:** novo enum `ClientStatus { PENDING, APPROVED, REJECTED }` + campo `clientStatus ClientStatus?` em `User` (migration Prisma). Opcionalmente `clientApprovedAt DateTime?` para auditoria.
- **Não** mexe no enum `Role`.
- **Sem** colunas novas para taxa (reusa platform-taxas overrides) nem para atribuição (reusa `userId` + `clientStatus`).

---

## 10. Tratamento de erros e segurança

- Cliente pendente/rejeitado criando item → 403 ("Sua conta está em análise").
- Valor < 14,99 → 400 com mensagem PT clara.
- Cliente acessando endpoints `/admin/clientes/*` → 403 (RolesGuard + `isMasterAdminUser`).
- Cliente tentando ler/editar item de outro → 404/403 via checagem de posse. **Verificar que update/delete dos 4 produtos checam `userId` do dono** (não só o list).
- Cliente nunca recebe na resposta: token DOM, `platformTag`, valores de taxa (%). Recebe apenas o **valor líquido** (§6.1).

---

## 11. Decisões confirmadas pelo usuário

1. **Cliente não vê a taxa**, mas **vê o valor líquido** que recebe por venda paga na listagem (ex.: 20 cobrado → 15 líquido). Ver §5/§6.1.
2. **Taxa de cartão por parcela:** soma a % do cliente **sobre o escalonamento padrão** por parcela. Ver §5.
3. **Quem é cliente:** toda conta **auto-cadastrada** no SimintPay (marcada com `clientStatus`). Contas `USER` já existentes ficam **intocadas** (`clientStatus = null`). Admins de tenant e master não são clientes.
4. **Onboarding:** cadastro + **aprovação do master** (cliente pendente não cria; master aprova e define a taxa).

### Ainda a detalhar no plano (não bloqueiam o design)
- Fórmula exata do líquido validada contra o exemplo 20→15 (combinação `LIQUIDEZ` + `TAXA_SERVICO` + taxa `CLIENT:<email>`).
- Forma exata de gravar a "taxa simplificada por cliente" nas chaves `MDR_*` (replicar nas parcelas vs delta).
- Onde exatamente exibir o líquido (listagem de transações e/ou preview no link).

---

## 12. Testes

- **Unit:** resolução de taxa com tag `CLIENT:<email>` (fallback GLOBAL); guard de mínimo 14,99; guard de aprovação; forçar `DOM_TOKEN` para cliente; cálculo do líquido (20→15).
- **Integração/e2e:**
  - Auto-cadastro marca `clientStatus = PENDING`; pendente recebe 403 ao tentar criar.
  - Master aprova → cliente passa a criar; cria nos 4 produtos → usa `DOM_TOKEN` + taxa `CLIENT:<email>`; valor < 14,99 é rejeitado.
  - Cliente só lista/edita o que é dele; 403/404 em itens de terceiros; vê valor líquido na listagem.
  - Master vê todos os itens de clientes com atribuição correta e filtra por cliente.
  - Master grava/lê taxa por cliente.

---

## 13. Fases de implementação (resumo p/ o plano)

1. **Backend base:** enum `ClientStatus` + campo `clientStatus` em `User` + migration; `register` marca `PENDING`; `isClient`/`clientStatus` no get-me; constante de mínimo; helper de tag de cliente já existe.
2. **Backend criação:** ramo cliente nos 4 use-cases (aprovação + token + mínimo + tag + ignorar plataforma).
3. **Backend master:** endpoints `/admin/clientes*` (listar/aprovar/rejeitar, taxa, auditoria dos 4 produtos).
4. **Frontend cliente:** rotas `(dashboard)/cliente/*` + `mode="cliente"` nos formulários + sidebar + estado "em análise" + **listagem com valor líquido por venda** (§6.1).
5. **Frontend master:** seção "Clientes" (fila de aprovação + taxa + auditoria).
6. **Testes + verificação.**
