# Portal do Cliente (SimintPay) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que clientes (contas auto-cadastradas no SimintPay) criem planos, planos-pix, links de pagamento e links de assinatura na plataforma SimintPay (conta DOM mestre, invisível para o cliente), com taxa por cliente definida pelo master, valor mínimo R$ 14,99, aprovação do master, e visão de auditoria completa para o master.

**Architecture:** Backend NestJS (`api-machine`) + frontend Next.js/shadcn (`admin-card-machine`). Reaproveita: posse por `userId` (já existe), sistema de taxa `CLIENT:<email>` (já existe), `ClienteDashboardService` (já existe, exposição nova). Adiciona: `clientStatus` em `User` (+ aprovação), resolução de taxa pelo **dono** (não comprador) em itens de cliente, endpoints master `/admin/clientes/*`, rotas de cliente no front com `mode="cliente"`.

**Tech Stack:** NestJS 11, Prisma 7 (postgres), Jest, class-validator; Next.js (app router), React Query, shadcn/ui, TypeScript.

**Spec:** [docs/superpowers/specs/2026-06-27-portal-cliente-simintpay-design.md](../specs/2026-06-27-portal-cliente-simintpay-design.md)

---

## Convenções

- Backend root: `d:/all simint/api-machine`. Frontend root: `d:/all simint/admin-card-machine`.
- Testes backend: Jest, arquivos `*.spec.ts` em `src/` (config `jest` no `package.json`, `rootDir: src`). Rodar: `cd "d:/all simint/api-machine" && npx jest <caminho>`.
- Verificação de build backend: `cd "d:/all simint/api-machine" && npx tsc --noEmit` (ou `npm run build`).
- Verificação de build frontend: `cd "d:/all simint/admin-card-machine" && npx tsc --noEmit`.
- Commits frequentes ao fim de cada Task.
- **NÃO** rodar `prisma migrate deploy` automático em prod (ver [memory SaaS prod DB migration drift]). Migrations criadas com `prisma migrate dev --create-only` e revisadas.

---

# FASE 1 — Backend: fundação (status de cliente)

### Task 1.1: Adicionar enum `ClientStatus` e campo `clientStatus` em `User`

**Files:**
- Modify: `d:/all simint/api-machine/prisma/schema.prisma` (model `User` ~linhas 9-46; enum `Role` existente — adicionar enum novo perto dele)

- [ ] **Step 1: Adicionar o enum e o campo no schema**

No `prisma/schema.prisma`, dentro do `model User`, adicionar após a linha `role Role @default(USER)`:

```prisma
  clientStatus         ClientStatus?
  clientApprovedAt     DateTime?
```

E adicionar o enum (perto do enum `Role`):

```prisma
enum ClientStatus {
  PENDING
  APPROVED
  REJECTED
}
```

Adicionar índice no fim do `model User` (junto aos `@@index` existentes):

```prisma
  @@index([clientStatus])
```

- [ ] **Step 2: Gerar a migration (create-only, sem aplicar em prod)**

Run: `cd "d:/all simint/api-machine" && npx prisma migrate dev --name add_client_status --create-only`
Expected: cria pasta em `prisma/migrations/<timestamp>_add_client_status/` com `ALTER TABLE "User" ADD COLUMN "clientStatus" ...` e `CREATE TYPE "ClientStatus"`.

- [ ] **Step 3: Aplicar localmente e regenerar o client**

Run: `cd "d:/all simint/api-machine" && npx prisma migrate dev && npx prisma generate`
Expected: migration aplicada no DB local; `@prisma/client` regenerado com `ClientStatus`.

- [ ] **Step 4: Verificar tipos**

Run: `cd "d:/all simint/api-machine" && npx tsc --noEmit`
Expected: PASS (o tipo `User` agora tem `clientStatus`).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add ClientStatus enum and User.clientStatus"
```

---

### Task 1.2: Repositório de usuário — suportar `clientStatus`

**Files:**
- Read first: `d:/all simint/api-machine/src/core/repositories/user.repository.interface.ts`
- Read first: a implementação Prisma do repositório (procurar `class PrismaUserRepository` / `implements IUserRepository`)
- Modify: a interface e a impl Prisma do repositório de usuário

- [ ] **Step 1: Ler a interface e a implementação**

Run: `cd "d:/all simint/api-machine" && grep -rl "IUserRepository" src/infrastructure` para achar a impl. Ler interface + impl (`create`, `update`, o tipo de retorno do `User`).

- [ ] **Step 2: Garantir que o tipo `User` retornado inclui `clientStatus` e `clientApprovedAt`**

Se o repositório mapeia campos manualmente (DTO/entidade), adicionar `clientStatus` e `clientApprovedAt` ao mapeamento de leitura. Se retorna o objeto Prisma direto, nada a fazer além de regenerar (já feito na Task 1.1).

- [ ] **Step 3: Adicionar método de atualização de status (se o `update` genérico não cobrir)**

Se já existe um `update(id, Partial<User>)`, garantir que aceita `clientStatus` e `clientApprovedAt`. Caso contrário, adicionar:

```ts
// interface
updateClientStatus(id: string, status: 'PENDING' | 'APPROVED' | 'REJECTED'): Promise<void>;
```

```ts
// impl Prisma
async updateClientStatus(id: string, status: 'PENDING' | 'APPROVED' | 'REJECTED'): Promise<void> {
  await this.prisma.user.update({
    where: { id },
    data: { clientStatus: status, clientApprovedAt: status === 'APPROVED' ? new Date() : null },
  });
}
```

- [ ] **Step 4: Verificar tipos**

Run: `cd "d:/all simint/api-machine" && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(users): support clientStatus in user repository"
```

---

### Task 1.3: Auto-cadastro marca `clientStatus = PENDING`

**Files:**
- Modify: `d:/all simint/api-machine/src/application/use-cases/auth/register.use-case.ts` (chamada `this.users.create({...})` ~linha 53)

- [ ] **Step 1: Escrever teste do register marcando PENDING**

Create: `d:/all simint/api-machine/src/application/use-cases/auth/register.use-case.spec.ts`

```ts
import { RegisterUseCase } from './register.use-case';

describe('RegisterUseCase', () => {
  it('marca novas contas auto-cadastradas como clientStatus PENDING', async () => {
    const created: any[] = [];
    const users = {
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: any) => { created.push(data); return Promise.resolve({ ...data, id: 'u1', role: 'USER' }); }),
    } as any;
    const sessions = { create: jest.fn().mockResolvedValue(undefined) } as any;
    const wallets = { createForUser: jest.fn().mockResolvedValue(undefined) } as any;
    const hash = { hash: jest.fn().mockResolvedValue('hashed') } as any;
    const gateway = {
      register: jest.fn().mockResolvedValue({ domUserId: 'dom1' }),
      generateToken: jest.fn().mockResolvedValue({ domToken: 'tok' }),
    } as any;
    const tokens = { signAccessToken: jest.fn().mockResolvedValue({ token: 'jwt', expiresIn: 3600 }) } as any;
    const linkExternal = { linkByCpf: jest.fn(), linkByCnpj: jest.fn() } as any;

    const uc = new RegisterUseCase(users, sessions, wallets, hash, gateway, tokens, linkExternal);
    await uc.execute({ dto: { name: 'A', email: 'a@a.com', password: '123' } as any });

    expect(created[0].clientStatus).toBe('PENDING');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd "d:/all simint/api-machine" && npx jest src/application/use-cases/auth/register.use-case.spec.ts`
Expected: FAIL (`created[0].clientStatus` é `undefined`).

- [ ] **Step 3: Implementar — adicionar `clientStatus: 'PENDING'` no create**

Em `register.use-case.ts`, na chamada `this.users.create({...})`, adicionar o campo:

```ts
    const user = await this.users.create({
      name,
      email,
      password: hashed,
      domUserId: domReg.domUserId,
      domToken: domTok.domToken,
      cpf: isCpf ? docDigits : undefined,
      cnpj: isCnpj ? docDigits : undefined,
      clientStatus: 'PENDING',
    });
```

> Se o tipo do `create` do repositório não aceitar `clientStatus`, ajustar o tipo do parâmetro `create` na interface do repositório (Task 1.2) para incluir `clientStatus?: 'PENDING' | 'APPROVED' | 'REJECTED'`.

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd "d:/all simint/api-machine" && npx jest src/application/use-cases/auth/register.use-case.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/auth/register.use-case.ts src/application/use-cases/auth/register.use-case.spec.ts src/core/repositories/user.repository.interface.ts
git commit -m "feat(auth): self-registered accounts start as PENDING client"
```

---

### Task 1.4: `GET /auth/me` expõe `isClient` e `clientStatus`

**Files:**
- Modify: `d:/all simint/api-machine/src/application/use-cases/auth/get-me.use-case.ts` (tipo de retorno + dois `return` ~linhas 159-190)

- [ ] **Step 1: Adicionar campos ao tipo de retorno**

No tipo de retorno do `execute` (~linha 28-46), adicionar:

```ts
    isClient: boolean;
    clientStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
```

- [ ] **Step 2: Preencher nos dois `return`**

Em ambos os blocos `return {...}` (o de enriquecimento DOM ~159 e o final ~178), adicionar:

```ts
      isClient: user.clientStatus != null,
      clientStatus: (user.clientStatus ?? null) as 'PENDING' | 'APPROVED' | 'REJECTED' | null,
```

- [ ] **Step 3: Verificar tipos**

Run: `cd "d:/all simint/api-machine" && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/application/use-cases/auth/get-me.use-case.ts
git commit -m "feat(auth): expose isClient and clientStatus in /auth/me"
```

---

# FASE 2 — Backend: regras de criação para cliente

> Objetivo: nos 4 use-cases de **criação**, quando o dono é cliente (`clientStatus != null`): (1) bloquear se não-APPROVED, (2) forçar `DOM_TOKEN`, (3) mínimo 14,99, (4) ignorar plataforma enviada e usar `CLIENT:<owner.email>` como tag de taxa.

### Task 2.1: Helper compartilhado de regras de cliente

**Files:**
- Create: `d:/all simint/api-machine/src/application/helpers/client-rules.helper.ts`
- Test: `d:/all simint/api-machine/src/application/helpers/client-rules.helper.spec.ts`

- [ ] **Step 1: Escrever o teste**

```ts
import { CLIENT_MIN_AMOUNT, assertClientCanCreate, clientTaxaTagFor } from './client-rules.helper';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('client-rules.helper', () => {
  const approved = { email: 'v@v.com', clientStatus: 'APPROVED' } as any;
  const pending = { email: 'v@v.com', clientStatus: 'PENDING' } as any;
  const notClient = { email: 'v@v.com', clientStatus: null } as any;

  it('CLIENT_MIN_AMOUNT é 14.99', () => {
    expect(CLIENT_MIN_AMOUNT).toBe(14.99);
  });

  it('bloqueia cliente não aprovado', () => {
    expect(() => assertClientCanCreate(pending, 20)).toThrow(ForbiddenException);
  });

  it('bloqueia valor abaixo do mínimo para cliente aprovado', () => {
    expect(() => assertClientCanCreate(approved, 14.98)).toThrow(BadRequestException);
  });

  it('permite cliente aprovado com valor >= 14.99', () => {
    expect(() => assertClientCanCreate(approved, 14.99)).not.toThrow();
  });

  it('não aplica regras a quem não é cliente', () => {
    expect(() => assertClientCanCreate(notClient, 1)).not.toThrow();
  });

  it('clientTaxaTagFor retorna CLIENT:<email> para cliente e null para não-cliente', () => {
    expect(clientTaxaTagFor(approved)).toBe('CLIENT:V@V.COM');
    expect(clientTaxaTagFor(notClient)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "d:/all simint/api-machine" && npx jest src/application/helpers/client-rules.helper.spec.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o helper**

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { buildClientTaxaTag } from '../../modules/platform-taxas/platform-taxas.store';

export const CLIENT_MIN_AMOUNT = 14.99;

type ClientUserLike = { email: string; clientStatus?: string | null };

/** True se a conta é um cliente SimintPay (auto-cadastrado). */
export function isClientUser(user: ClientUserLike | null | undefined): boolean {
  return !!user && user.clientStatus != null;
}

/** Tag de taxa do dono quando ele é cliente; null caso contrário. */
export function clientTaxaTagFor(user: ClientUserLike | null | undefined): string | null {
  return isClientUser(user) ? buildClientTaxaTag(user!.email) : null;
}

/**
 * Aplica as regras de criação para clientes. No-op se não for cliente.
 * - cliente não-APPROVED → 403
 * - valor < 14,99 → 400
 */
export function assertClientCanCreate(user: ClientUserLike | null | undefined, amount: number): void {
  if (!isClientUser(user)) return;
  if (user!.clientStatus !== 'APPROVED') {
    throw new ForbiddenException('Sua conta está em análise. Aguarde a aprovação para criar.');
  }
  if (!(amount >= CLIENT_MIN_AMOUNT)) {
    throw new BadRequestException('O valor mínimo é R$ 14,99');
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "d:/all simint/api-machine" && npx jest src/application/helpers/client-rules.helper.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/application/helpers/client-rules.helper.ts src/application/helpers/client-rules.helper.spec.ts
git commit -m "feat(client): shared client creation rules helper"
```

---

### Task 2.2: Plano — aplicar regras de cliente no `CreatePlanUseCase`

**Files:**
- Modify: `d:/all simint/api-machine/src/application/use-cases/plan/create-plan.use-case.ts`
- Read first: para injetar `USER_REPOSITORY` (já usado em outros use-cases, ex.: subscription-link).

- [ ] **Step 1: Injetar repositório de usuário**

No construtor, adicionar:

```ts
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { assertClientCanCreate, clientTaxaTagFor } from '../../helpers/client-rules.helper';
```

```ts
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}
```

- [ ] **Step 2: Buscar o dono e aplicar regras + tag**

Substituir o início do `execute` (o cálculo de `platformTag` ~linha 51) por:

```ts
    const owner = await this.users.findById(input.userId);
    assertClientCanCreate(owner, input.dto.preco);

    const clientTag = clientTaxaTagFor(owner);
    // Cliente: ignora plataforma enviada e usa CLIENT:<email>. Senão, comportamento atual.
    const platformTag = clientTag ?? (input.dto.plataformas?.[0] ?? 'GLOBAL').toUpperCase();
```

> O `domToken` já é `process.env.DOM_TOKEN` neste use-case (SimintPay) — nada a mudar no token. O markup já usa `getPlatformTaxaEffective(platformTag, ...)`, que agora recebe `CLIENT:<email>` para clientes.

- [ ] **Step 3: Não persistir plataforma para cliente**

Na chamada `this.plans.create({...})`, ajustar `plataformas`:

```ts
      plataformas: clientTag ? [] : (input.dto.plataformas ?? []),
```

- [ ] **Step 4: Atualizar o módulo (providers)**

Garantir que `USER_REPOSITORY` está disponível no módulo do plano: ler `d:/all simint/api-machine/src/presentation/plan.module.ts` e confirmar que o provider de `USER_REPOSITORY` está importado (a maioria dos módulos importa um `RepositoriesModule`/`PrismaModule`). Se não, adicionar o provider conforme os outros módulos fazem.

- [ ] **Step 5: Escrever teste do ramo cliente**

Create: `d:/all simint/api-machine/src/application/use-cases/plan/create-plan.use-case.spec.ts`

```ts
import { CreatePlanUseCase } from './create-plan.use-case';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

const baseDto = { nome: 'P', preco: 20, tipo: 'MENSAL' } as any;

function build(owner: any) {
  const plans = { create: jest.fn().mockResolvedValue({ id: 'p1', name: 'P', price: 20, isActive: true, createdAt: new Date() }) } as any;
  const gateway = { createPlan: jest.fn().mockResolvedValue({ id: 'dom1' }) } as any;
  const users = { findById: jest.fn().mockResolvedValue(owner) } as any;
  process.env.DOM_TOKEN = 'tok';
  return { uc: new CreatePlanUseCase(plans, gateway, users), plans, gateway };
}

describe('CreatePlanUseCase (cliente)', () => {
  it('bloqueia cliente PENDING', async () => {
    const { uc } = build({ id: 'u1', email: 'v@v.com', clientStatus: 'PENDING' });
    await expect(uc.execute({ userId: 'u1', dto: baseDto })).rejects.toThrow(ForbiddenException);
  });

  it('bloqueia valor < 14,99 para cliente APPROVED', async () => {
    const { uc } = build({ id: 'u1', email: 'v@v.com', clientStatus: 'APPROVED' });
    await expect(uc.execute({ userId: 'u1', dto: { ...baseDto, preco: 10 } })).rejects.toThrow(BadRequestException);
  });

  it('cria para cliente APPROVED ignorando plataforma enviada', async () => {
    const { uc, plans } = build({ id: 'u1', email: 'v@v.com', clientStatus: 'APPROVED' });
    await uc.execute({ userId: 'u1', dto: { ...baseDto, plataformas: ['RENOVADA'] } });
    expect(plans.create).toHaveBeenCalledWith(expect.objectContaining({ plataformas: [] }));
  });
});
```

- [ ] **Step 6: Rodar testes (helper + plano) e ver passar**

Run: `cd "d:/all simint/api-machine" && npx jest src/application/use-cases/plan/create-plan.use-case.spec.ts`
Expected: PASS

- [ ] **Step 7: Verificar tipos + commit**

Run: `cd "d:/all simint/api-machine" && npx tsc --noEmit`

```bash
git add src/application/use-cases/plan src/presentation/plan.module.ts
git commit -m "feat(plan): apply client rules (approval, min, owner taxa tag) on create"
```

---

### Task 2.3: Link de pagamento — regras de cliente no create

**Files:**
- Read first: `d:/all simint/api-machine/src/application/use-cases/payment-link/create-payment-link.use-case.ts` e seu DTO (`amount`/`valor`) e módulo `payment-link.module.ts`.
- Modify: o create use-case.

- [ ] **Step 1: Ler o use-case** para identificar: campo de valor, como resolve token, onde grava `platformFee*`/`plataformas`.

- [ ] **Step 2: Injetar `USER_REPOSITORY` + helper** (igual Task 2.2 Step 1).

- [ ] **Step 3: Buscar dono e aplicar regras**

No início do `execute`, antes de qualquer cálculo de fee/criação na DOM:

```ts
    const owner = await this.users.findById(input.userId);
    const amount = Number(input.dto.amount /* ou o campo de valor real */);
    assertClientCanCreate(owner, amount);
    const clientTag = clientTaxaTagFor(owner);
```

- [ ] **Step 4: Forçar token SimintPay e tag de cliente**

- Onde o token é resolvido: se `clientTag` (cliente), forçar `domToken = process.env.DOM_TOKEN`.
- Onde a fee por parcela é calculada (`MDR_LINK_*` / `platformFee*`): usar `clientTag ?? <tag atual>` como tag em `getPlatformTaxaEffective`.
- `plataformas`: gravar `[]` quando `clientTag`.

- [ ] **Step 5: Teste do ramo cliente** (espelhar Task 2.2 Step 5, adaptado ao DTO real). Mínimo: bloqueia PENDING; bloqueia < 14,99; cria APPROVED com token forçado.

- [ ] **Step 6: Rodar testes + tsc + commit**

Run: `cd "d:/all simint/api-machine" && npx jest src/application/use-cases/payment-link && npx tsc --noEmit`

```bash
git add src/application/use-cases/payment-link src/presentation/payment-link.module.ts
git commit -m "feat(payment-link): apply client rules on create"
```

---

### Task 2.4: Link de assinatura — regras de cliente no create

**Files:**
- Read first: `d:/all simint/api-machine/src/application/use-cases/subscription-link/create-subscription-link.use-case.ts` + DTO + `subscription-link.module.ts`.
- Modify: o create use-case.

- [ ] **Step 1: Ler o use-case** (campo de valor `amount`, token, `platformTag`/`plataformas`).

- [ ] **Step 2: Injetar `USER_REPOSITORY` + helper.**

- [ ] **Step 3: Buscar dono e aplicar regras** (igual padrão): `assertClientCanCreate(owner, Number(input.dto.amount))`; `const clientTag = clientTaxaTagFor(owner)`.

- [ ] **Step 4: Para cliente:** `platformTag = clientTag` (gravar no campo `platformTag` do link, para o checkout resolver corretamente — ver Task 3.1); `plataformas = []`.

- [ ] **Step 5: Teste do ramo cliente** (PENDING bloqueado; < 14,99 bloqueado; APPROVED grava `platformTag = CLIENT:<email>`).

- [ ] **Step 6: Rodar testes + tsc + commit**

```bash
git add src/application/use-cases/subscription-link src/presentation/subscription-link.module.ts
git commit -m "feat(subscription-link): apply client rules on create"
```

---

### Task 2.5: Plano por PIX — regras de cliente no create

**Files:**
- Read first: `d:/all simint/api-machine/src/application/use-cases/pix-plan/pix-plan.service.ts` (método de criação) + DTO + módulo.
- Modify: o método `create` do `PixPlanService`.

- [ ] **Step 1: Ler o método de criação** (campo `price`, `tenantTag`, token).

- [ ] **Step 2: Injetar `USER_REPOSITORY` (se ainda não) + helper.**

- [ ] **Step 3: Buscar dono e aplicar regras**: `assertClientCanCreate(owner, Number(dto.price))`; `const clientTag = clientTaxaTagFor(owner)`.

- [ ] **Step 4: Para cliente:** gravar `tenantTag = clientTag`; forçar `DOM_TOKEN`.

- [ ] **Step 5: Teste do ramo cliente** (PENDING/min/APPROVED com `tenantTag = CLIENT:<email>`).

- [ ] **Step 6: Rodar testes + tsc + commit**

```bash
git add src/application/use-cases/pix-plan src/presentation/pix-plan.module.ts
git commit -m "feat(pix-plan): apply client rules on create"
```

---

# FASE 3 — Backend: taxa pelo dono no checkout + líquido do cliente

### Task 3.1: Checkout resolve a taxa pelo DONO quando o dono é cliente

> Hoje os checkouts GLOBAL constroem `CLIENT:<customerEmail>` (comprador). Para itens de cliente, a taxa deve ser a do DONO (`CLIENT:<owner.email>`).

**Files:**
- Modify: `d:/all simint/api-machine/src/application/use-cases/subscription-link/checkout-subscription-link-card.use-case.ts` (lógica de `platformTag`/`taxaTag` ~linhas 80-92)
- Modify: `d:/all simint/api-machine/src/application/use-cases/subscription-link/checkout-subscription-link-pix.use-case.ts` (lógica equivalente)
- Modify: `d:/all simint/api-machine/src/application/use-cases/payment-link/charge-payment-link.use-case.ts` (~linhas 138-141)
- Modify: `d:/all simint/api-machine/src/application/use-cases/payment-link/charge-pix-payment-link.use-case.ts` (equivalente)
- Modify: `d:/all simint/api-machine/src/application/use-cases/pix-plan/pix-plan.service.ts` (checkout PIX do plano)

- [ ] **Step 1: Em cada checkout, priorizar a tag do dono cliente.** O `owner` já é buscado (ex.: subscription-link card linha 48). Adicionar, antes de calcular `taxaTag`:

```ts
import { clientTaxaTagFor } from '../../helpers/client-rules.helper';
// ...
const ownerClientTag = clientTaxaTagFor(owner); // CLIENT:<owner.email> se o dono é cliente
```

E na resolução da tag, dar prioridade ao dono cliente. Ex.: em `checkout-subscription-link-card`:

```ts
      const platformTag = ownerClientTag
        ?? (link as any).platformTag?.toUpperCase()
        ?? slugTag
        ?? (isAreaflix ? 'AREAFLIX' : 'GLOBAL');
      const taxaTag = ownerClientTag
        ?? (platformTag === 'GLOBAL' && input.dto.customerEmail?.trim()
              ? buildClientTaxaTag(input.dto.customerEmail)
              : platformTag);
```

> Onde o link já grava `platformTag = CLIENT:<email>` (Task 2.4), `(link as any).platformTag` já basta; ainda assim, derivar de `owner` é mais robusto contra dados antigos. Aplicar o mesmo padrão (prioridade `ownerClientTag`) nos demais arquivos do Step.

- [ ] **Step 2: Para payment-link (`charge-payment-link` / `charge-pix-payment-link`)**, buscar o dono se ainda não busca: `const owner = await this.users.findById(link.userId);` (injetar `USER_REPOSITORY` se necessário) e usar `clientTaxaTagFor(owner)` como tag prioritária no cálculo das fees.

- [ ] **Step 3: Teste unitário de resolução de tag (pelo menos para subscription-link card)** — owner cliente força `CLIENT:<owner.email>` mesmo com `customerEmail` diferente.

Create: `...checkout-subscription-link-card.use-case.spec.ts` (mockar repos/gateway; asserir que `getPlatformTaxaEffective` recebeu `CLIENT:<OWNER>` — pode-se espionar via `jest.spyOn` do módulo `platform-taxas.store`).

- [ ] **Step 4: Rodar testes + tsc**

Run: `cd "d:/all simint/api-machine" && npx jest src/application/use-cases/subscription-link && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases
git commit -m "feat(checkout): resolve fee by owner client tag for client-owned items"
```

---

### Task 3.2: Expor o líquido do cliente (dashboard/listagem)

> O cliente vê o valor líquido recebido. Reusar `ClienteDashboardService` (já existe, não exposto) e/ou `Transaction.netAmount`.

**Files:**
- Read first: `d:/all simint/api-machine/src/modules/cliente/services/cliente-dashboard.service.ts` (assinatura de `getDashboardData`)
- Read first: o módulo que declara esse service (`src/modules/cliente/*.module.ts`) e como controllers são registrados.
- Create: `d:/all simint/api-machine/src/modules/cliente/controllers/cliente-dashboard.controller.ts` (ou adicionar rota a um controller de cliente existente)

- [ ] **Step 1: Ler o service** e confirmar entrada/saída de `getDashboardData(period, jwtUser)`.

- [ ] **Step 2: Criar o controller expondo a rota já referenciada no front**

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../../infrastructure/security/strategies/jwt.strategy';
import { ClienteDashboardService } from '../services/cliente-dashboard.service';

@Controller('admin/plataformas/cliente')
export class ClienteDashboardController {
  constructor(private readonly dashboard: ClienteDashboardService) {}

  @Get('dashboard')
  @UseGuards(JwtAuthGuard)
  async getDashboard(@CurrentUser() user: JwtPayload, @Query('period') period = '30d') {
    return this.dashboard.getDashboardData(period, user);
  }
}
```

- [ ] **Step 3: Registrar o controller no módulo** (adicionar a `controllers: [...]` do módulo cliente, garantindo `ClienteDashboardService` em `providers`).

- [ ] **Step 4: Verificar tipos/build**

Run: `cd "d:/all simint/api-machine" && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/cliente
git commit -m "feat(cliente): expose cliente dashboard endpoint (net values)"
```

> Nota: a exibição do líquido por item/transação na listagem do cliente é consumida no front (Fase 5). A fonte é este dashboard + `Transaction.netAmount` já existente. Validar o exemplo 20→15 ao testar manualmente.

---

# FASE 4 — Backend: módulo master (Clientes)

### Task 4.1: Endpoints de listagem/aprovação de clientes (vendedores)

**Files:**
- Create: `d:/all simint/api-machine/src/presentation/controllers/admin-clientes.controller.ts`
- Create: use-cases simples em `d:/all simint/api-machine/src/application/use-cases/admin-clientes/` OU usar `PrismaService` direto no controller (seguir o padrão do `admin.controller.ts`, que usa `this.prisma` direto).
- Read first: `admin.controller.ts` (~linhas 1949-2134) para copiar o padrão de guard master (`@UseGuards(JwtAuthGuard, RolesGuard)`, `@Roles(Role.ADMIN)`, `isMasterAdminUser`).
- Register: adicionar o controller ao módulo onde `admin.controller.ts` está registrado.

- [ ] **Step 1: Criar o controller com guard master e listar clientes**

```ts
import { Body, Controller, ForbiddenException, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { RolesGuard } from '../../infrastructure/security/guards/roles.guard';
import { Roles } from '../../infrastructure/security/decorators/roles.decorator';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { isMasterAdminUser } from '../../shared/utils/is-master-admin.util';
import { buildClientTaxaTag, applyPatchToOverrides, writeOverrides, getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

@Controller('admin/clientes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminClientesController {
  constructor(private readonly prisma: PrismaService) {}

  private async assertMaster(authUser?: JwtPayload) {
    const requester = authUser?.sub
      ? await this.prisma.user.findUnique({ where: { id: authUser.sub }, include: { tenantModule: true } })
      : null;
    if (!requester || !isMasterAdminUser(requester)) {
      throw new ForbiddenException('Somente o módulo master pode gerenciar clientes');
    }
  }

  @Get()
  async list(@CurrentUser() authUser?: JwtPayload, @Query('status') status = 'all') {
    await this.assertMaster(authUser);
    const where: any = { clientStatus: { not: null } };
    if (status === 'pending') where.clientStatus = 'PENDING';
    else if (status === 'approved') where.clientStatus = 'APPROVED';
    const clientes = await this.prisma.user.findMany({
      where,
      orderBy: [{ clientStatus: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true, email: true, clientStatus: true, clientApprovedAt: true, isActive: true, createdAt: true },
    });
    // taxa cartão atual (MDR_CC_MASTER_1X) por cliente, para exibir
    const data = clientes.map((c) => ({
      ...c,
      taxaCartao: getPlatformTaxaEffective(buildClientTaxaTag(c.email), 'MDR_CC_MASTER_1X', PLATFORM_TAXA_DEFAULTS.MDR_CC_MASTER_1X),
    }));
    return { data };
  }
}
```

- [ ] **Step 2: Adicionar aprovar/rejeitar/taxa**

```ts
  @Patch(':id/aprovar')
  async aprovar(@Param('id') id: string, @Body() body: { taxaCartao?: number; taxaPix?: number; taxaAssinatura?: number }, @CurrentUser() authUser?: JwtPayload) {
    await this.assertMaster(authUser);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new ForbiddenException('Cliente não encontrado');
    await this.prisma.user.update({ where: { id }, data: { clientStatus: 'APPROVED', clientApprovedAt: new Date() } });
    await this.applyTaxa(user.email, body);
    return { success: true };
  }

  @Patch(':id/rejeitar')
  async rejeitar(@Param('id') id: string, @CurrentUser() authUser?: JwtPayload) {
    await this.assertMaster(authUser);
    await this.prisma.user.update({ where: { id }, data: { clientStatus: 'REJECTED' } });
    return { success: true };
  }

  @Patch(':id/taxa')
  async taxa(@Param('id') id: string, @Body() body: { taxaCartao?: number; taxaPix?: number; taxaAssinatura?: number }, @CurrentUser() authUser?: JwtPayload) {
    await this.assertMaster(authUser);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new ForbiddenException('Cliente não encontrado');
    await this.applyTaxa(user.email, body);
    return { success: true };
  }

  private async applyTaxa(email: string, body: { taxaCartao?: number; taxaPix?: number; taxaAssinatura?: number }) {
    const tag = buildClientTaxaTag(email);
    const patch: Record<string, number | null> = {};
    if (body.taxaCartao != null) {
      // soma a % do cliente sobre o escalonamento padrão (decisão do usuário): grava no MDR_CC_MASTER_1X base
      patch['MDR_CC_MASTER_1X'] = Number(body.taxaCartao);
    }
    if (body.taxaPix != null) patch['MDR_PIX'] = Number(body.taxaPix);
    if (body.taxaAssinatura != null) patch['TAXA_ASSINATURA'] = Number(body.taxaAssinatura);
    if (Object.keys(patch).length === 0) return;
    const next = applyPatchToOverrides(tag, patch);
    await writeOverrides(next);
  }
```

> **Nota de escalonamento (decisão do usuário):** "somar a % do cliente sobre o padrão". A implementação acima grava a base 1x; o escalonamento por parcela já vem dos defaults `MDR_CC_MASTER_2X..12X`/`MDR_LINK_*` herdados do GLOBAL. Se for preciso somar o delta também nas parcelas, replicar `taxaCartao` nas chaves `MDR_CC_MASTER_2X..12X` somando ao default — refinar ao validar números reais (anotado no spec §11).

- [ ] **Step 3: Registrar o controller** no módulo que registra `admin.controller.ts` (procurar `AdminController` em `*.module.ts` e adicionar `AdminClientesController` a `controllers`).

- [ ] **Step 4: Verificar build + commit**

Run: `cd "d:/all simint/api-machine" && npx tsc --noEmit`

```bash
git add src/presentation/controllers/admin-clientes.controller.ts src/presentation
git commit -m "feat(admin): master clientes endpoints (list/approve/reject/taxa)"
```

---

### Task 4.2: Endpoints de auditoria — itens criados por clientes

**Files:**
- Modify: `d:/all simint/api-machine/src/presentation/controllers/admin-clientes.controller.ts`

- [ ] **Step 1: Adicionar 4 listagens agregadas com atribuição**

Para cada produto, listar itens cujo dono tem `clientStatus != null`, incluindo `clientId`/`clientEmail`, com filtro opcional `?clientId=`:

```ts
  @Get('planos')
  async planos(@CurrentUser() authUser?: JwtPayload, @Query('clientId') clientId?: string) {
    await this.assertMaster(authUser);
    const rows = await this.prisma.plan.findMany({
      where: { user: { clientStatus: { not: null } }, ...(clientId ? { userId: clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return { data: rows.map((r) => ({ ...r, clientId: r.user.id, clientEmail: r.user.email, clientName: r.user.name })) };
  }
```

Repetir o padrão para `paymentLink` → `GET planos`/rota `links-pagamento`, `subscriptionLink` → `links-assinatura`, `pixCreditPlan` → `planos-pix` (usar os nomes de model corretos do Prisma: `plan`, `paymentLink`, `subscriptionLink`, `pixCreditPlan`).

- [ ] **Step 2: Build + commit**

Run: `cd "d:/all simint/api-machine" && npx tsc --noEmit`

```bash
git add src/presentation/controllers/admin-clientes.controller.ts
git commit -m "feat(admin): master audit listings of client-created items"
```

---

### Task 4.3: Verificar posse em update/delete dos 4 produtos

> Segurança: cliente não pode editar/excluir item de terceiro.

**Files:**
- Read: os use-cases `update-*`/`delete-*` dos 4 produtos.

- [ ] **Step 1: Para cada `update`/`delete`**, confirmar que filtra por `userId` do solicitante (ex.: `findFirst({ where: { id, userId } })` e 404 se nulo). O plano já passa `userId` + `role` (ver `plan.controller.ts`). Onde a checagem não existir, adicionar.

- [ ] **Step 2: Teste unitário mínimo** para um deles (ex.: `update-plan`): solicitante diferente do dono → `NotFoundException`/`ForbiddenException`.

- [ ] **Step 3: Rodar testes + commit**

```bash
git add src/application/use-cases
git commit -m "fix(security): enforce ownership on update/delete for client items"
```

---

# FASE 5 — Frontend: portal do cliente

### Task 5.1: Tipos e endpoints do front

**Files:**
- Modify: `d:/all simint/admin-card-machine/src/hooks/use-current-user.ts` (tipo `CurrentUser`)
- Modify: `d:/all simint/admin-card-machine/src/services/api/endpoints.ts` (bloco `admin`)

- [ ] **Step 1: Adicionar campos ao tipo `CurrentUser`**

```ts
  isClient?: boolean;
  clientStatus?: "PENDING" | "APPROVED" | "REJECTED" | null;
```

- [ ] **Step 2: Adicionar endpoints master de clientes**

No objeto `endpoints.admin`, adicionar:

```ts
    clientes: {
      list: "/admin/clientes",
      approve: (id: string) => `/admin/clientes/${id}/aprovar`,
      reject: (id: string) => `/admin/clientes/${id}/rejeitar`,
      taxa: (id: string) => `/admin/clientes/${id}/taxa`,
      planos: "/admin/clientes/planos",
      planosPix: "/admin/clientes/planos-pix",
      linksPagamento: "/admin/clientes/links-pagamento",
      linksAssinatura: "/admin/clientes/links-assinatura",
    },
```

- [ ] **Step 3: Build + commit**

Run: `cd "d:/all simint/admin-card-machine" && npx tsc --noEmit`

```bash
git add src/hooks/use-current-user.ts src/services/api/endpoints.ts
git commit -m "feat(fe): client/master types and endpoints"
```

---

### Task 5.2: Sidebar — abas do cliente e seção master

**Files:**
- Read first + Modify: `d:/all simint/admin-card-machine/src/components/layout/sidebar.tsx` (bloco de NavLinks ~217-254, hoje gated em `user?.isAdmin`)

- [ ] **Step 1: Ler o bloco de navegação** e identificar como `user.isAdmin` gateia os 4 itens.

- [ ] **Step 2: Adicionar grupo do cliente** — quando `user?.isClient`, mostrar as 4 abas apontando para `/cliente/*`:

```tsx
{user?.isClient && (
  <>
    <NavLink href="/cliente/planos" icon={...} label="Planos" open={open} />
    <NavLink href="/cliente/planos-pix" icon={...} label="Planos PIX" open={open} />
    <NavLink href="/cliente/links-pagamento" icon={...} label="Links de Pagamento" open={open} />
    <NavLink href="/cliente/links-assinatura" icon={...} label="Links de Assinatura" open={open} />
  </>
)}
```

- [ ] **Step 3: Adicionar item master "Clientes"** — quando `user?.isMasterAdmin`:

```tsx
{user?.isMasterAdmin && (
  <NavLink href="/admin/clientes" icon={...} label="Clientes" open={open} />
)}
```

- [ ] **Step 4: Build + commit**

Run: `cd "d:/all simint/admin-card-machine" && npx tsc --noEmit`

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat(fe): sidebar entries for client portal and master clientes"
```

---

### Task 5.3: Componentizar os formulários com `mode`

> Reaproveitar os formulários de criação existentes adicionando uma prop `mode?: "admin" | "cliente"` que: esconde seletor de plataforma + campos de taxa; valida mínimo 14,99; não envia plataforma.

**Files:**
- Read first: os 4 `criar/page.tsx` em `src/app/(dashboard)/{planos,planos-pix,links-pagamento,links-assinatura}/criar/page.tsx`.
- Refactor: extrair o corpo do formulário de cada um para um componente reutilizável, ex.: `src/app/(dashboard)/planos/criar/PlanoForm.tsx` (e equivalentes), aceitando `mode` e `apiBasePath`/endpoints.

- [ ] **Step 1: Para cada produto, extrair o form** para um componente `…Form.tsx` que recebe:

```tsx
type FormProps = { mode?: "admin" | "cliente" };
```

- [ ] **Step 2: Comportamento `mode === "cliente"`** em cada form:
  - Ocultar: seletor de plataforma; todos os campos de taxa/`platformFee*`/parcela-fee.
  - Validação de valor: `if (preco < 14.99) → erro "O valor mínimo é R$ 14,99"`.
  - No payload de criação: não enviar `plataformas`/`platformTag`.
  - O endpoint de criação é o **mesmo** (`endpoints.planos.create`, etc.) — o backend aplica as regras.

- [ ] **Step 3: As páginas admin atuais** passam a renderizar `<PlanoForm mode="admin" />` (comportamento idêntico ao de hoje).

- [ ] **Step 4: Build + commit**

Run: `cd "d:/all simint/admin-card-machine" && npx tsc --noEmit`

```bash
git add src/app/(dashboard)
git commit -m "refactor(fe): extract product forms with mode prop"
```

---

### Task 5.4: Rotas do cliente `(dashboard)/cliente/*`

**Files:**
- Create: `src/app/(dashboard)/cliente/planos/page.tsx` (lista) + `criar/page.tsx`
- Create: idem para `planos-pix`, `links-pagamento`, `links-assinatura`
- Create (opcional): `src/app/(dashboard)/cliente/layout.tsx` para o gate de papel/estado

- [ ] **Step 1: Gate de cliente** — em `cliente/layout.tsx`, usar `useCurrentUser()`:
  - Se `!isClient` → redirect para a home.
  - Se `clientStatus !== "APPROVED"` → renderizar aviso "Conta em análise" e **não** renderizar os filhos de criação (ou desabilitar criação).

```tsx
"use client";
import { useCurrentUser } from "@/hooks/use-current-user";
export default function ClienteLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useCurrentUser();
  if (loading) return null;
  if (!user?.isClient) return <div className="p-6">Acesso restrito.</div>;
  if (user.clientStatus !== "APPROVED") {
    return <div className="p-6">Sua conta está em análise. Você poderá criar links assim que for aprovada.</div>;
  }
  return <>{children}</>;
}
```

- [ ] **Step 2: Páginas de lista** — reutilizar os componentes de tabela existentes, chamando os mesmos endpoints (`endpoints.planos.list`, etc.). O backend já filtra pelo dono. **Adicionar coluna/preview de valor líquido** (consumir `endpoints.relatorios.dashboardCliente` ou `Transaction.netAmount` da listagem de transações).

- [ ] **Step 3: Páginas de criar** — renderizar `<PlanoForm mode="cliente" />` etc.

- [ ] **Step 4: Build + commit**

Run: `cd "d:/all simint/admin-card-machine" && npx tsc --noEmit`

```bash
git add src/app/(dashboard)/cliente
git commit -m "feat(fe): client portal routes (list/create) with net values"
```

---

# FASE 6 — Frontend: seção master "Clientes"

### Task 6.1: Página master `/admin/clientes`

**Files:**
- Create: `src/app/(dashboard)/admin/clientes/page.tsx`
- Read first (padrão): `src/app/(dashboard)/admin/taxas/page.tsx` (modal de cliente + edição de taxa) para reusar o padrão de edição de taxa.

- [ ] **Step 1: Lista de clientes com status** — consumir `endpoints.admin.clientes.list`. Colunas: nome, email, status (badge), taxa cartão, data. Destaque para pendentes.

- [ ] **Step 2: Ações de aprovação** — para cliente PENDING: botão "Aprovar" abre modal para definir taxa (cartão/pix/assinatura) → `PATCH endpoints.admin.clientes.approve(id)`; botão "Rejeitar" → `PATCH .reject(id)`.

- [ ] **Step 3: Ajuste de taxa** — para cliente APPROVED: editar taxa → `PATCH endpoints.admin.clientes.taxa(id)` (reusar UI da página `admin/taxas`).

- [ ] **Step 4: Build + commit**

Run: `cd "d:/all simint/admin-card-machine" && npx tsc --noEmit`

```bash
git add src/app/(dashboard)/admin/clientes
git commit -m "feat(fe): master clientes page (approval + fee)"
```

---

### Task 6.2: Auditoria — itens por cliente (master)

**Files:**
- Modify/Create: `src/app/(dashboard)/admin/clientes/page.tsx` (abas ou seção) ou subpáginas `…/clientes/[produto]/page.tsx`

- [ ] **Step 1: Abas/seções** para os 4 produtos consumindo `endpoints.admin.clientes.{planos,planosPix,linksPagamento,linksAssinatura}`. Coluna **"Criado por"** (`clientName`/`clientEmail`) + filtro por cliente (`?clientId=`).

- [ ] **Step 2: Build + commit**

```bash
git add src/app/(dashboard)/admin/clientes
git commit -m "feat(fe): master audit views of client-created items"
```

---

# FASE 7 — Verificação fim-a-fim

### Task 7.1: Verificação manual do fluxo completo

- [ ] **Step 1: Build de ambos os repos**

Run: `cd "d:/all simint/api-machine" && npm run build` e `cd "d:/all simint/admin-card-machine" && npx tsc --noEmit`
Expected: ambos PASS.

- [ ] **Step 2: Rodar a suíte de testes backend**

Run: `cd "d:/all simint/api-machine" && npx jest`
Expected: PASS (pelo menos os specs novos desta entrega).

- [ ] **Step 3: Roteiro manual** (subir backend + front locais):
  1. Auto-cadastrar uma conta → confirmar `clientStatus = PENDING` no DB; logar → portal mostra "Conta em análise"; criar plano via API → 403.
  2. Como master, abrir `/admin/clientes` → cliente aparece como PENDENTE; aprovar definindo taxa.
  3. Como cliente, criar um link de pagamento de R$ 20,00 → sucesso; criar de R$ 10,00 → erro "valor mínimo R$ 14,99"; confirmar que o form não mostra plataforma/taxa.
  4. Conferir no DB/DOM que o item foi criado com o `DOM_TOKEN` mestre (SimintPay) e `plataformas: []`.
  5. Simular um pagamento → conferir que a listagem do cliente mostra o **líquido** (ex.: ~R$ 15,00) e que a taxa `CLIENT:<email>` foi aplicada.
  6. Como master, ver o item na auditoria com a atribuição "Criado por" correta; filtrar por cliente.
  7. Como cliente, tentar abrir/editar item de outro cliente → 403/404.

- [ ] **Step 4: Commit final (se houver ajustes)**

```bash
git add -A && git commit -m "test: end-to-end verification fixes for client portal"
```

---

## Notas de implementação / riscos

- **Token mestre:** itens de cliente sempre usam `process.env.DOM_TOKEN`. Confirmar que está setado em todos os ambientes.
- **Migration em prod:** não auto-aplica no deploy (ver memória). Aplicar manualmente no container após o deploy.
- **Escalonamento de taxa por parcela:** a gravação base 1x cobre o caso comum; validar números reais com o exemplo 20→15 e ajustar `applyTaxa` se for preciso replicar o delta nas parcelas.
- **`simintpay-clientes` existente** lista compradores (de transações) — é outro recurso; não confundir com `/admin/clientes` (vendedores). Não alterar o existente.
- **Contas USER antigas** ficam com `clientStatus = null` → não viram clientes (intocadas).
