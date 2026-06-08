# Netflix (Areaflix) — capturar CPF/CNPJ + telefone do checkout

**Data:** 2026-06-06
**Repos afetados:** `api-machine`, `saas-netflix-back`

## Problema

Quando um cliente paga um link de assinatura do Areaflix (saas-netflix), a `api-machine`
notifica o `saas-netflix-back` via `POST /area-of-member/webhook/simpay`. O payload atual
manda só `customerEmail`, `customerName`, `planName`, etc. — **sem o documento**. O handler
cria a conta (quando o usuário não existe) sem `cpf`/`cnpj`/`phone`, e o `model User` do
netflix nem tem essas colunas. Resultado: contas do netflix nascem sem documento, ao contrário
de patrimonial e consumo (que já recebem `cpf`/`cnpj` via `/internal/users/provision`).

## Objetivo

Fazer o netflix gravar o CPF/CNPJ (e telefone) que o cliente preencheu no checkout, **na
criação da conta nova**, seguindo o mesmo padrão dos outros SaaS (api-machine separa cpf de cnpj
e envia já separado).

## Não-objetivos

- Backfill de contas já existentes (só preenche na criação).
- O gap do cartão nos outros SaaS (patrimonial/consumo).
- Fluxos Hotmart/Kiwify/Frendz do netflix (são integrações separadas).
- Exibir o documento em telas/admin.

## Abordagem (Opção B — igual aos outros SaaS)

A `api-machine` separa `cpf`/`cnpj` (por nº de dígitos: 11 → cpf, 14 → cnpj) e envia já
separado no payload do webhook simpay, junto com `phone`. O netflix apenas grava.

## Mudanças

### api-machine

1. **Extrair helper compartilhado.** Hoje `provisionDocPayload(raw): {cpf?}|{cnpj?}` e
   `documentType` são funções locais em `process-dom-webhook.use-case.ts`. Mover para
   `src/application/utils/document.util.ts` (export `splitDocument`, `cleanDocument`) e fazer
   `process-dom-webhook.use-case.ts` importar de lá (remove a cópia local).

2. **Adicionar `cpf`/`cnpj` + `phone` aos 3 payloads do webhook simpay:**
   - `checkout-subscription-link-card.use-case.ts:178` (`subscription_activated`, cartão) —
     usar `cleanDoc` / `cleanPhone` já calculados no arquivo.
   - `process-dom-webhook.use-case.ts:1326` (`subscription_activated`, PIX) —
     `order.customerDocument` / `order.customerPhone`.
   - `subscription-webhook.service.ts:292` (`subscription_renewed`, renovação) —
     `linkOrder.customerDocument` / `linkOrder.customerPhone`.

   Em cada um: `...splitDocument(<documento>), phone: <telefone> || undefined`.

### saas-netflix-back

3. **Schema** (`prisma/schema.prisma`, `model User`): adicionar
   `cpf String?`, `cnpj String?`, `phone String?`. Gerar migration (`add_cpf_cnpj_phone_to_user`).

4. **Handler** (`area.service.ts` → `handleSimpayWebhook`): aceitar `cpf`, `cnpj`, `phone` no
   body; no ramo de **criação** de usuário (`prisma.user.create`), incluir
   `cpf: body.cpf ?? null, cnpj: body.cnpj ?? null, phone: body.phone ?? null`. Não altera o
   ramo de atualização (sem backfill).

5. **Controller** (`area.controller.ts` → `handleSimpayWebhook`): adicionar `cpf?`, `cnpj?`,
   `phone?` no tipo do `@Body()` e nas `properties` do `@ApiBody` (Swagger).

## Fluxo de dados

```
Checkout (cliente digita CPF/CNPJ + celular)
  → api-machine: splitDocument(documento) → {cpf} ou {cnpj}, phone
  → POST /area-of-member/webhook/simpay { event, customerEmail, customerName, planName,
                                          cpf?, cnpj?, phone?, ... }
  → netflix: se usuário não existe → cria com cpf/cnpj/phone
```

## Casos de borda

- Documento vazio/ausente → `splitDocument` retorna `{}` → grava `null`.
- Documento com máscara → `cleanDocument` remove não-dígitos antes de classificar.
- < 11 ou outros tamanhos → trata como cpf (mesma regra do `provisionDocPayload` atual).
- Usuário já existe → não preenche (sem backfill, conforme decidido).

## Verificação (manual, sem testes automatizados)

1. Build dos dois repos.
2. Deploy: rebuild/redeploy `api-machine` e `saas-netflix-back`; rodar
   `npx prisma migrate deploy` no container do netflix (criar as colunas em prod).
3. Checkout de teste (e-mail novo) num link do Areaflix, preenchendo CPF (ou CNPJ) + celular.
4. Conferir: conta criada no netflix com `cpf`/`cnpj`/`phone` preenchidos; log do webhook simpay
   recebendo os campos.

## Notas de deploy

- `api-machine`: rebuild + redeploy.
- `saas-netflix-back`: rebuild + redeploy **e** aplicar a migration no banco de produção
  (o deploy não roda migration sozinho — mesmo ponto dos outros SaaS).
