# Programa de Afiliados (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Master-curated affiliate program — master ativa `isAffiliate` + `%` por conta, contas indicadas geram comissão automática (sobre `Transaction.platformFee`) creditada na wallet do afiliado, com painel de gestão (master) e painel próprio (afiliado).

**Architecture:** Campos novos em `User` (`isAffiliate`, `affiliateCommissionPercent`, `affiliateCode`, `referredByUserId`) + novo model `AffiliateCommission` (log/histórico, fonte de verdade pra reversão). Um `AffiliateCommissionService` stateless (opera dentro da `$transaction` do chamador) é invocado nos dois pontos existentes onde `Transaction` transiciona pra `COMPLETED`/`REFUNDED`/`CHARGEBACK` (`process-dom-webhook.use-case.ts` e `process-webhook.use-case.ts`). Vínculo automático via `?ref=CODE` no cadastro (`Lead.referredByCode` → `User.referredByUserId` na aprovação) ou manual pelo master. Dois controllers novos seguindo o padrão de `admin-clientes.controller.ts` (PrismaService direto, sem repositório/use-case por endpoint).

**Tech Stack:** NestJS 11, Prisma 7 (Postgres), Jest, class-validator.

**Spec:** `docs/superpowers/specs/2026-07-23-programa-afiliados-design.md`

---

## Task 1: Schema — campos de afiliado + model de comissão

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Editar o model `User`**

Em `prisma/schema.prisma`, no model `User`, logo após o campo `cnpj` (linha 22: `cnpj                 String?              @unique`), adicionar:

```prisma
  isAffiliate          Boolean              @default(false)
  affiliateCommissionPercent Decimal?       @db.Decimal(5, 2)
  affiliateCode        String?              @unique
  referredByUserId     String?
```

Depois do bloco de relations existentes do `User` (logo após a linha `cobrancas              Cobranca[]`), adicionar:

```prisma
  referredBy             User?                @relation("AffiliateReferrals", fields: [referredByUserId], references: [id])
  referrals              User[]               @relation("AffiliateReferrals")
  affiliateCommissionsEarned AffiliateCommission[] @relation("AffiliateCommissionsEarned")
  affiliateCommissionsGenerated AffiliateCommission[] @relation("AffiliateCommissionsGenerated")
```

No bloco de `@@index` do `User` (depois de `@@index([clientStatus])`), adicionar:

```prisma
  @@index([referredByUserId])
  @@index([affiliateCode])
```

- [ ] **Step 2: Adicionar o model `AffiliateCommission` e o enum de status**

Adicionar no final do arquivo (antes do último enum ou depois de `enum DiscountType`):

```prisma
// ── Programa de Afiliados ───────────────────────────────────────────────────

model AffiliateCommission {
  id               String                    @id @default(uuid())
  affiliateUserId  String
  referredUserId   String
  transactionId    String                    @unique
  percentApplied   Decimal                   @db.Decimal(5, 2)
  grossPlatformFee Decimal                   @db.Decimal(12, 2)
  commissionAmount Decimal                   @db.Decimal(12, 2)
  status           AffiliateCommissionStatus @default(CREDITED)
  createdAt        DateTime                  @default(now())
  reversedAt       DateTime?
  affiliate        User                      @relation("AffiliateCommissionsEarned", fields: [affiliateUserId], references: [id])
  referredUser     User                      @relation("AffiliateCommissionsGenerated", fields: [referredUserId], references: [id])

  @@index([affiliateUserId])
  @@index([referredUserId])
  @@index([status])
}

enum AffiliateCommissionStatus {
  CREDITED
  REVERSED
}
```

- [ ] **Step 3: Adicionar `referredByCode` no model `Lead`**

No model `Lead`, logo após `comoConheceu String?` (linha 570), adicionar:

```prisma
  referredByCode  String?
```

- [ ] **Step 4: Gerar e rodar a migration**

Run: `npx prisma migrate dev --name add_affiliate_program`
Expected: cria `prisma/migrations/<timestamp>_add_affiliate_program/migration.sql`, aplica no banco local, regenera o Prisma Client sem erros.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
feat(db): add affiliate program schema

User gets isAffiliate/commission%/code/referredBy fields; new
AffiliateCommission log table; Lead gets referredByCode for
automatic link capture.
EOF
)"
```

---

## Task 2: `AffiliateCommissionService` — cálculo, crédito e reversão

**Files:**
- Create: `src/application/services/affiliate-commission.service.ts`
- Test: `src/application/services/affiliate-commission.service.spec.ts`

Serviço stateless: recebe o `Prisma.TransactionClient` (`p`) já aberto pelo chamador (webhook use-cases) e opera dentro da mesma transação — nunca abre a sua própria. Sem constructor deps (só `Logger`).

- [ ] **Step 1: Escrever os testes**

```typescript
// src/application/services/affiliate-commission.service.spec.ts
import { Prisma } from '@prisma/client';
import { AffiliateCommissionService } from './affiliate-commission.service';

function buildPrismaMock(overrides: any = {}) {
  return {
    user: {
      findUnique: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    balanceLog: {
      create: jest.fn(),
    },
    affiliateCommission: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ...overrides,
  } as any;
}

describe('AffiliateCommissionService.applyForTransaction', () => {
  const svc = new AffiliateCommissionService();

  it('não faz nada se a conta não tem afiliado vinculado', async () => {
    const p = buildPrismaMock({
      user: { findUnique: jest.fn().mockResolvedValue({ referredByUserId: null }) },
    });

    await svc.applyForTransaction(p, {
      transactionId: 'tx1',
      referredUserId: 'referred1',
      platformFee: new Prisma.Decimal(10),
    });

    expect(p.wallet.findUnique).not.toHaveBeenCalled();
  });

  it('não faz nada se o afiliado vinculado está com isAffiliate=false', async () => {
    const p = buildPrismaMock({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ referredByUserId: 'aff1' })
          .mockResolvedValueOnce({ isAffiliate: false, affiliateCommissionPercent: new Prisma.Decimal(10) }),
      },
    });

    await svc.applyForTransaction(p, {
      transactionId: 'tx1',
      referredUserId: 'referred1',
      platformFee: new Prisma.Decimal(10),
    });

    expect(p.wallet.findUnique).not.toHaveBeenCalled();
  });

  it('credita commissionAmount = platformFee * percent/100 na wallet do afiliado', async () => {
    const p = buildPrismaMock({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ referredByUserId: 'aff1' })
          .mockResolvedValueOnce({ isAffiliate: true, affiliateCommissionPercent: new Prisma.Decimal(20) }),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'wallet-aff1',
          userId: 'aff1',
          balance: new Prisma.Decimal(100),
          lockedBalance: new Prisma.Decimal(0),
          version: 3,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      affiliateCommission: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    });

    await svc.applyForTransaction(p, {
      transactionId: 'tx1',
      referredUserId: 'referred1',
      platformFee: new Prisma.Decimal(10),
    });

    expect(p.wallet.updateMany).toHaveBeenCalledWith({
      where: { id: 'wallet-aff1', version: 3 },
      data: { balance: new Prisma.Decimal(102), version: { increment: 1 } },
    });
    expect(p.balanceLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'aff1',
        transactionId: 'tx1',
        amount: new Prisma.Decimal(2),
        source: 'AFFILIATE_COMMISSION',
      }),
    });
    expect(p.affiliateCommission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        affiliateUserId: 'aff1',
        referredUserId: 'referred1',
        transactionId: 'tx1',
        percentApplied: new Prisma.Decimal(20),
        grossPlatformFee: new Prisma.Decimal(10),
        commissionAmount: new Prisma.Decimal(2),
        status: 'CREDITED',
      }),
    });
  });

  it('não credita de novo se já existe AffiliateCommission pra essa transação', async () => {
    const p = buildPrismaMock({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ referredByUserId: 'aff1' })
          .mockResolvedValueOnce({ isAffiliate: true, affiliateCommissionPercent: new Prisma.Decimal(20) }),
      },
      affiliateCommission: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
      },
    });

    await svc.applyForTransaction(p, {
      transactionId: 'tx1',
      referredUserId: 'referred1',
      platformFee: new Prisma.Decimal(10),
    });

    expect(p.wallet.findUnique).not.toHaveBeenCalled();
  });
});

describe('AffiliateCommissionService.reverseForTransaction', () => {
  const svc = new AffiliateCommissionService();

  it('não faz nada se não existe comissão CREDITED pra essa transação', async () => {
    const p = buildPrismaMock({
      affiliateCommission: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    await svc.reverseForTransaction(p, 'tx1');

    expect(p.wallet.findUnique).not.toHaveBeenCalled();
  });

  it('debita o commissionAmount exato e marca REVERSED', async () => {
    const p = buildPrismaMock({
      affiliateCommission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'comm1',
          affiliateUserId: 'aff1',
          commissionAmount: new Prisma.Decimal(2),
          status: 'CREDITED',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'wallet-aff1',
          userId: 'aff1',
          balance: new Prisma.Decimal(102),
          lockedBalance: new Prisma.Decimal(0),
          version: 4,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await svc.reverseForTransaction(p, 'tx1');

    expect(p.wallet.updateMany).toHaveBeenCalledWith({
      where: { id: 'wallet-aff1', version: 4 },
      data: { balance: new Prisma.Decimal(100), version: { increment: 1 } },
    });
    expect(p.affiliateCommission.update).toHaveBeenCalledWith({
      where: { id: 'comm1' },
      data: { status: 'REVERSED', reversedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham (arquivo não existe ainda)**

Run: `npx jest src/application/services/affiliate-commission.service.spec.ts`
Expected: FAIL — `Cannot find module './affiliate-commission.service'`

- [ ] **Step 3: Implementar o serviço**

```typescript
// src/application/services/affiliate-commission.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class AffiliateCommissionService {
  private readonly logger = new Logger(AffiliateCommissionService.name);

  /**
   * Credita comissão ao afiliado da conta `referredUserId`, se ela tiver
   * `referredByUserId` apontando pra um afiliado ativo (`isAffiliate=true`).
   * Idempotente por `transactionId` (unique em AffiliateCommission).
   */
  async applyForTransaction(
    p: PrismaTx,
    params: { transactionId: string; referredUserId: string; platformFee: Prisma.Decimal | number },
  ): Promise<void> {
    const referred = await p.user.findUnique({
      where: { id: params.referredUserId },
      select: { referredByUserId: true },
    });
    const affiliateUserId = referred?.referredByUserId;
    if (!affiliateUserId) return;

    const affiliate = await p.user.findUnique({
      where: { id: affiliateUserId },
      select: { isAffiliate: true, affiliateCommissionPercent: true },
    });
    if (!affiliate?.isAffiliate || affiliate.affiliateCommissionPercent == null) return;

    const already = await p.affiliateCommission.findUnique({
      where: { transactionId: params.transactionId },
    });
    if (already) return;

    const platformFeeDec = new Prisma.Decimal(params.platformFee.toString());
    const percent = new Prisma.Decimal(affiliate.affiliateCommissionPercent.toString());
    const commissionAmount = platformFeeDec.mul(percent).div(100);
    if (commissionAmount.lte(0)) return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const wallet = await p.wallet.findUnique({ where: { userId: affiliateUserId } });
      if (!wallet) {
        this.logger.warn(`[AffiliateCommission] Afiliado ${affiliateUserId} sem wallet — pulando crédito`);
        return;
      }

      const newBalance = wallet.balance.add(commissionAmount);

      const result = await p.wallet.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: { balance: newBalance, version: { increment: 1 } },
      });

      if (result.count > 0) {
        await p.balanceLog.create({
          data: {
            userId: affiliateUserId,
            action: 'AFFILIATE_COMMISSION_CREDIT',
            transactionId: params.transactionId,
            amount: commissionAmount,
            balanceBefore: wallet.balance,
            balanceAfter: newBalance,
            lockedBefore: wallet.lockedBalance,
            lockedAfter: wallet.lockedBalance,
            source: 'AFFILIATE_COMMISSION',
          },
        });
        await p.affiliateCommission.create({
          data: {
            affiliateUserId,
            referredUserId: params.referredUserId,
            transactionId: params.transactionId,
            percentApplied: percent,
            grossPlatformFee: platformFeeDec,
            commissionAmount,
            status: 'CREDITED',
          },
        });
        return;
      }

      if (attempt === 2) {
        throw new Error('Wallet version conflict after 3 retries (affiliate commission)');
      }
    }
  }

  /** Reverte (debita) a comissão CREDITED gerada por `transactionId`, se existir. */
  async reverseForTransaction(p: PrismaTx, transactionId: string): Promise<void> {
    const commission = await p.affiliateCommission.findUnique({ where: { transactionId } });
    if (!commission || commission.status !== 'CREDITED') return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const wallet = await p.wallet.findUnique({ where: { userId: commission.affiliateUserId } });
      if (!wallet) {
        this.logger.warn(`[AffiliateCommission] Afiliado ${commission.affiliateUserId} sem wallet — pulando reversão`);
        return;
      }

      const newBalance = wallet.balance.sub(commission.commissionAmount);

      const result = await p.wallet.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: { balance: newBalance, version: { increment: 1 } },
      });

      if (result.count > 0) {
        await p.balanceLog.create({
          data: {
            userId: commission.affiliateUserId,
            action: 'AFFILIATE_COMMISSION_REVERSE',
            transactionId,
            amount: commission.commissionAmount,
            balanceBefore: wallet.balance,
            balanceAfter: newBalance,
            lockedBefore: wallet.lockedBalance,
            lockedAfter: wallet.lockedBalance,
            source: 'AFFILIATE_COMMISSION',
          },
        });
        await p.affiliateCommission.update({
          where: { id: commission.id },
          data: { status: 'REVERSED', reversedAt: new Date() },
        });
        return;
      }

      if (attempt === 2) {
        throw new Error('Wallet version conflict after 3 retries (affiliate commission reverse)');
      }
    }
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx jest src/application/services/affiliate-commission.service.spec.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add src/application/services/affiliate-commission.service.ts src/application/services/affiliate-commission.service.spec.ts
git commit -m "$(cat <<'EOF'
feat: add AffiliateCommissionService

Stateless service that credits/reverses affiliate commission inside
the caller's existing Prisma $transaction. Idempotent per transactionId.
EOF
)"
```

---

## Task 3: Hook no `process-dom-webhook.use-case.ts`

**Files:**
- Modify: `src/application/use-cases/webhook/process-dom-webhook.use-case.ts`
- Modify: `src/presentation/webhook.module.ts`
- Test: `src/application/use-cases/webhook/process-dom-webhook.affiliate.spec.ts`

O branch `handleTransaction` (dentro do `$transaction(async (p) => {...})`, por volta da linha 316-388) já calcula `balanceDelta` com base em `nextStatus`/`existing.status`. Vamos chamar o serviço logo depois do loop de retry da wallet do dono, usando a mesma condição.

- [ ] **Step 1: Escrever o teste (isolado, sem subir o módulo Nest — mesmo padrão de `admin.controller.list-external-users.spec.ts`)**

```typescript
// src/application/use-cases/webhook/process-dom-webhook.affiliate.spec.ts
jest.mock('uuid', () => ({ v4: () => 'test-uuid', v5: () => 'test-uuid', MAX: '', NIL: '' }));

import { ProcessDomWebhookUseCase } from './process-dom-webhook.use-case';
import { TransactionStatus } from '@prisma/client';

/**
 * `handleTransaction` é privado; testamos via `execute()` com um payload de
 * transação regular (evento 'charge'), que é o que dispara o branch.
 * O foco aqui é só confirmar que o hook de comissão é chamado com os
 * argumentos certos — o resto do fluxo já tem cobertura própria no arquivo.
 */
describe('ProcessDomWebhookUseCase — hook de comissão de afiliado', () => {
  function buildUseCase(existingTx: any) {
    const applyForTransaction = jest.fn().mockResolvedValue(undefined);
    const reverseForTransaction = jest.fn().mockResolvedValue(undefined);

    const wallet = {
      id: 'wallet1',
      balance: { add: (d: any) => wallet.balance, sub: (d: any) => wallet.balance },
      lockedBalance: { add: (d: any) => wallet.lockedBalance },
      version: 1,
    };

    const prismaTxClient = {
      transaction: { update: jest.fn().mockResolvedValue({}) },
      transactionStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      wallet: {
        findUnique: jest.fn().mockResolvedValue(wallet),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      balanceLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      webhookEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'wh1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      // `execute()` primeiro tenta achar uma SubscriptionLinkOrder pelo domPaymentId;
      // null faz cair no fluxo normal de handleTransaction.
      subscriptionLinkOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      transaction: { findFirst: jest.fn().mockResolvedValue(existingTx) },
      voucher: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(prismaTxClient)),
    } as any;

    const voucherService = { recordUsage: jest.fn() } as any;

    // Terceiro arg (affiliateCommission) é sobrescrito logo abaixo — passamos
    // `undefined as any` só pra bater a contagem de parâmetros do construtor.
    const uc = new ProcessDomWebhookUseCase(prisma, voucherService, undefined as any);
    (uc as any).affiliateCommission = { applyForTransaction, reverseForTransaction };

    return { uc, applyForTransaction, reverseForTransaction, prisma };
  }

  it('chama applyForTransaction quando a transação vira COMPLETED', async () => {
    const existingTx = {
      id: 'tx1',
      userId: 'user1',
      status: TransactionStatus.PENDING,
      netAmount: '50.00',
      platformFee: '5.00',
      description: null,
      domPaymentId: 'dom-1',
    };
    const { uc, applyForTransaction } = buildUseCase(existingTx);

    await uc.execute({
      event: 'charge',
      signature: 'sig-1',
      data: { id: 'dom-1', amount: 5000, status: 'paid' },
    });

    expect(applyForTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ transactionId: 'tx1', referredUserId: 'user1', platformFee: '5.00' }),
    );
  });

  it('chama reverseForTransaction quando a transação vai de COMPLETED pra REFUNDED', async () => {
    const existingTx = {
      id: 'tx2',
      userId: 'user1',
      status: TransactionStatus.COMPLETED,
      netAmount: '50.00',
      platformFee: '5.00',
      description: null,
      domPaymentId: 'dom-2',
    };
    const { uc, reverseForTransaction } = buildUseCase(existingTx);

    await uc.execute({
      event: 'charge',
      signature: 'sig-2',
      data: { id: 'dom-2', amount: 5000, status: 'refunded' },
    });

    expect(reverseForTransaction).toHaveBeenCalledWith(expect.anything(), 'tx2');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest src/application/use-cases/webhook/process-dom-webhook.affiliate.spec.ts`
Expected: FAIL — `(uc as any).affiliateCommission` nunca é chamado (propriedade não existe / não é usada ainda no fluxo real).

- [ ] **Step 3: Injetar o serviço e chamar nos dois pontos**

Em `src/application/use-cases/webhook/process-dom-webhook.use-case.ts`, adicionar o import:

```typescript
import { AffiliateCommissionService } from '../../services/affiliate-commission.service';
```

No constructor (linha 87-98), adicionar o parâmetro (não-opcional, é sempre fornecido pelo módulo):

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly voucherService: VoucherService,
    private readonly affiliateCommission: AffiliateCommissionService,
    @Optional() private readonly renovadaEvents?: RenovadaEventsService,
    @Optional() private readonly communities?: CommunityManagementService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() @Inject(PAYMENT_GATEWAY) private readonly paymentGateway?: IPaymentGateway,
    @Optional() private readonly pixPlanService?: PixPlanService,
    @Optional() private readonly pixPlanEvents?: PixPlanEventsService,
    @Optional() private readonly checkoutEvents?: CheckoutEventsService,
    @Optional() private readonly storage?: StorageService,
  ) { }
```

Dentro de `handleTransaction`, logo depois do `for` loop de retry da wallet (fecha na linha 387 com `}`), ainda dentro do callback do `$transaction` (antes do `});` da linha 388), adicionar:

```typescript
        if (
          nextStatus === TransactionStatus.COMPLETED &&
          existing.status !== TransactionStatus.COMPLETED
        ) {
          await this.affiliateCommission.applyForTransaction(p, {
            transactionId: existing.id,
            referredUserId: existing.userId,
            platformFee: existing.platformFee,
          });
        } else if (
          (nextStatus === TransactionStatus.REFUNDED || nextStatus === TransactionStatus.CHARGEBACK) &&
          existing.status === TransactionStatus.COMPLETED
        ) {
          await this.affiliateCommission.reverseForTransaction(p, existing.id);
        }
```

- [ ] **Step 4: Registrar o provider em `webhook.module.ts`**

Em `src/presentation/webhook.module.ts`, adicionar o import:

```typescript
import { AffiliateCommissionService } from '../application/services/affiliate-commission.service';
```

E adicionar `AffiliateCommissionService` no array `providers` (junto de `CommunityManagementService`).

- [ ] **Step 5: Rodar o teste da Task 3 e confirmar que passa**

Run: `npx jest src/application/use-cases/webhook/process-dom-webhook.affiliate.spec.ts`
Expected: PASS (2 testes)

- [ ] **Step 6: Rodar a suíte completa do arquivo pra garantir que nada quebrou**

Run: `npx jest process-dom-webhook`
Expected: PASS (todos os specs existentes desse use-case continuam passando)

- [ ] **Step 7: Commit**

```bash
git add src/application/use-cases/webhook/process-dom-webhook.use-case.ts src/application/use-cases/webhook/process-dom-webhook.affiliate.spec.ts src/presentation/webhook.module.ts
git commit -m "$(cat <<'EOF'
feat: credit/reverse affiliate commission on DOM webhook completion

Hooks AffiliateCommissionService into the existing COMPLETED/REFUNDED/
CHARGEBACK wallet-crediting transaction in handleTransaction.
EOF
)"
```

---

## Task 4: Hook no `process-webhook.use-case.ts`

**Files:**
- Modify: `src/application/use-cases/webhook/process-webhook.use-case.ts`
- Test: `src/application/use-cases/webhook/process-webhook.affiliate.spec.ts`

Mesmo hook, no outro caminho (fila `WEBHOOK_EVENTS`, usado pelo endpoint genérico `/webhook/eventos` e pelo postback traduzido da Frendz). `webhook.module.ts` já importa esse use-case no mesmo módulo — o provider `AffiliateCommissionService` registrado na Task 3 cobre os dois.

- [ ] **Step 1: Escrever o teste**

```typescript
// src/application/use-cases/webhook/process-webhook.affiliate.spec.ts
import { ProcessWebhookUseCase } from './process-webhook.use-case';
import { TransactionStatus } from '@prisma/client';

describe('ProcessWebhookUseCase — hook de comissão de afiliado', () => {
  function buildUseCase(existingTx: any) {
    const applyForTransaction = jest.fn().mockResolvedValue(undefined);
    const reverseForTransaction = jest.fn().mockResolvedValue(undefined);

    const wallet = {
      id: 'wallet1',
      balance: { add: () => wallet.balance, sub: () => wallet.balance },
      lockedBalance: { add: () => wallet.lockedBalance, sub: () => wallet.lockedBalance },
      version: 1,
    };

    const prismaTxClient = {
      transaction: { update: jest.fn().mockResolvedValue({}) },
      transactionStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      wallet: {
        findUnique: jest.fn().mockResolvedValue(wallet),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      balanceLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const events = {
      findByEventId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'evt1' }),
      markProcessed: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    } as any;

    const transactions = {
      findByDomPaymentId: jest.fn().mockResolvedValue(existingTx),
    } as any;

    const balanceLogs = {} as any;

    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ tenantModule: null }) },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(prismaTxClient)),
    } as any;

    const renovadaEvents = { emitTransaction: jest.fn() } as any;

    // Sexto arg (affiliateCommission) é sobrescrito logo abaixo — `undefined as any`
    // só pra bater a contagem de parâmetros do construtor.
    const uc = new ProcessWebhookUseCase(events, transactions, balanceLogs, prisma, renovadaEvents, undefined as any);
    (uc as any).affiliateCommission = { applyForTransaction, reverseForTransaction };

    return { uc, applyForTransaction, reverseForTransaction };
  }

  it('chama applyForTransaction quando o status vira paid/COMPLETED', async () => {
    const existingTx = {
      id: 'tx1',
      userId: 'user1',
      status: TransactionStatus.PENDING,
      platformFee: '5.00',
      description: null,
    };
    const { uc, applyForTransaction } = buildUseCase(existingTx);

    await uc.execute({
      payload: {
        event: 'charge',
        signature: 'sig-1',
        data: { paymentId: 'pay-1', status: 'paid', amountWithoutAllFee: 50 },
      },
    });

    expect(applyForTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ transactionId: 'tx1', referredUserId: 'user1', platformFee: '5.00' }),
    );
  });

  it('chama reverseForTransaction quando o status vira refunded', async () => {
    const existingTx = {
      id: 'tx2',
      userId: 'user1',
      status: TransactionStatus.COMPLETED,
      platformFee: '5.00',
      description: null,
    };
    const { uc, reverseForTransaction } = buildUseCase(existingTx);

    await uc.execute({
      payload: {
        event: 'charge',
        signature: 'sig-2',
        data: { paymentId: 'pay-2', status: 'refunded', amountWithoutAllFee: 50 },
      },
    });

    expect(reverseForTransaction).toHaveBeenCalledWith(expect.anything(), 'tx2');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest src/application/use-cases/webhook/process-webhook.affiliate.spec.ts`
Expected: FAIL — hook não chamado ainda.

- [ ] **Step 3: Injetar o serviço e chamar no ponto certo**

Em `src/application/use-cases/webhook/process-webhook.use-case.ts`, adicionar o import:

```typescript
import { AffiliateCommissionService } from '../../services/affiliate-commission.service';
```

No constructor (linha 52-65), adicionar o parâmetro:

```typescript
  constructor(
    @Inject(WEBHOOK_EVENT_REPOSITORY)
    private readonly events: IWebhookEventRepository,
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactions: ITransactionRepository,
    @Inject(BALANCE_LOG_REPOSITORY)
    private readonly balanceLogs: IBalanceLogRepository,
    private readonly prisma: PrismaService,
    private readonly renovadaEvents: RenovadaEventsService,
    private readonly affiliateCommission: AffiliateCommissionService,
    @Optional() private readonly pixPlanService?: PixPlanService,
    @Optional() private readonly pixPlanEvents?: PixPlanEventsService,
    @Optional() private readonly communities?: CommunityManagementService,
    @Optional() private readonly emailService?: EmailService,
  ) { }
```

Dentro de `execute`, logo depois do bloco `if (shouldMutateWallet && ...) { await p.balanceLog.create(...) }` (fecha na linha 353), ainda dentro do `$transaction`, adicionar:

```typescript
        if (nextStatus === TransactionStatus.COMPLETED) {
          await this.affiliateCommission.applyForTransaction(p, {
            transactionId: t.id,
            referredUserId: t.userId,
            platformFee: t.platformFee,
          });
        } else if (nextStatus === TransactionStatus.REFUNDED || nextStatus === TransactionStatus.CHARGEBACK) {
          await this.affiliateCommission.reverseForTransaction(p, t.id);
        }
```

(`isValidTransition`, já checado antes desse bloco, garante que `COMPLETED` só é alcançado a partir de `PENDING`/`IN_MEDIATION`, e `REFUNDED`/`CHARGEBACK` só a partir de `COMPLETED` — não precisa checar `t.status` de novo aqui.)

- [ ] **Step 4: Rodar o teste da Task 4 e confirmar que passa**

Run: `npx jest src/application/use-cases/webhook/process-webhook.affiliate.spec.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Rodar a suíte completa do arquivo**

Run: `npx jest process-webhook.use-case`
Expected: PASS (todos os specs existentes continuam passando)

- [ ] **Step 6: Commit**

```bash
git add src/application/use-cases/webhook/process-webhook.use-case.ts src/application/use-cases/webhook/process-webhook.affiliate.spec.ts
git commit -m "$(cat <<'EOF'
feat: credit/reverse affiliate commission on generic/Frendz webhook path

Same hook as the DOM-direct path, wired into ProcessWebhookUseCase
(WEBHOOK_EVENTS queue consumer).
EOF
)"
```

---

## Task 5: Captura de `referredByCode` no cadastro (Lead)

**Files:**
- Modify: `src/application/dtos/lead/create-lead.dto.ts`
- Modify: `src/core/repositories/lead.repository.interface.ts`
- Modify: `src/application/use-cases/lead/create-lead.use-case.ts`
- Test: `src/application/use-cases/lead/create-lead.use-case.spec.ts`

- [ ] **Step 1: Escrever o teste**

```typescript
// src/application/use-cases/lead/create-lead.use-case.spec.ts
import { CreateLeadUseCase } from './create-lead.use-case';

const baseDto: any = {
  name: 'João',
  phone: '11999999999',
  email: 'joao@empresa.com',
  razaoSocial: 'Empresa LTDA',
  cnpj: '12.345.678/0001-90',
  cpf: '123.456.789-09',
  faturamento: 'DE_50K_A_100K',
  tempoOperacao: 'DE_1_A_3_ANOS',
  cargo: 'SOCIO',
};

function build() {
  const leads = {
    findByEmailOrCnpj: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'lead1' }),
  } as any;
  return { uc: new CreateLeadUseCase(leads), leads };
}

describe('CreateLeadUseCase — referredByCode', () => {
  it('repassa referredByCode pro repositório quando informado', async () => {
    const { uc, leads } = build();
    await uc.execute({ ...baseDto, referredByCode: 'ABC123' });
    expect(leads.create).toHaveBeenCalledWith(expect.objectContaining({ referredByCode: 'ABC123' }));
  });

  it('não quebra quando referredByCode não é informado', async () => {
    const { uc, leads } = build();
    await uc.execute({ ...baseDto });
    expect(leads.create).toHaveBeenCalledWith(expect.objectContaining({ referredByCode: undefined }));
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest src/application/use-cases/lead/create-lead.use-case.spec.ts`
Expected: FAIL — `referredByCode` não é repassado (dto não tem o campo).

- [ ] **Step 3: Adicionar o campo no DTO**

Em `src/application/dtos/lead/create-lead.dto.ts`, depois do campo `comoConheceu` (linha 89), adicionar:

```typescript
  @ApiPropertyOptional({ example: 'ABC123', description: 'Código de indicação do afiliado (query ?ref= do link público)' })
  @IsOptional()
  @IsString()
  referredByCode?: string;
```

- [ ] **Step 4: Adicionar o campo no tipo do repositório**

Em `src/core/repositories/lead.repository.interface.ts`, em `CreateLeadData`, depois de `comoConheceu?: string;`, adicionar:

```typescript
  referredByCode?: string;
```

- [ ] **Step 5: Repassar no use-case**

Em `src/application/use-cases/lead/create-lead.use-case.ts`, no objeto passado pra `this.leads.create(...)`, depois de `comoConheceu: dto.comoConheceu,`, adicionar:

```typescript
      referredByCode: dto.referredByCode,
```

(`PrismaLeadRepository.create` já é genérico — `this.prisma.lead.create({ data })` — não precisa mudar.)

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx jest src/application/use-cases/lead/create-lead.use-case.spec.ts`
Expected: PASS (2 testes)

- [ ] **Step 7: Commit**

```bash
git add src/application/dtos/lead/create-lead.dto.ts src/core/repositories/lead.repository.interface.ts src/application/use-cases/lead/create-lead.use-case.ts src/application/use-cases/lead/create-lead.use-case.spec.ts
git commit -m "$(cat <<'EOF'
feat: capture referredByCode on public lead signup

Optional field, passed through untouched to Lead.referredByCode —
consumed at approval time to auto-link the new account to an affiliate.
EOF
)"
```

---

## Task 6: Vínculo automático na aprovação do Lead

**Files:**
- Modify: `src/application/use-cases/admin/approve-lead.use-case.ts`
- Test: `src/application/use-cases/admin/approve-lead.use-case.spec.ts`

Não existe spec pra esse use-case ainda — criar um focado neste comportamento (o use-case já tem efeitos colaterais pesados — DOM gateway, e-mail — que vamos mockar).

- [ ] **Step 1: Escrever o teste**

```typescript
// src/application/use-cases/admin/approve-lead.use-case.spec.ts
import { ApproveLeadUseCase } from './approve-lead.use-case';

function build(lead: any) {
  const leads = {
    findById: jest.fn().mockResolvedValue(lead),
    approve: jest.fn().mockResolvedValue({}),
  } as any;
  const users = {
    findByEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'newUser1' }),
    updateDomData: jest.fn().mockResolvedValue({}),
    findByAffiliateCode: jest.fn().mockResolvedValue(null),
    setReferredBy: jest.fn().mockResolvedValue({}),
  } as any;
  const wallets = { createForUser: jest.fn().mockResolvedValue({}) } as any;
  const hash = { hash: jest.fn().mockResolvedValue('hashed') } as any;
  const gateway = {
    register: jest.fn().mockRejectedValue(new Error('dom indisponível em teste')),
    generateToken: jest.fn(),
  } as any;
  const email = { sendWelcome: jest.fn().mockResolvedValue(undefined) } as any;
  const linkExternal = { linkByCpf: jest.fn(), linkByCnpj: jest.fn() } as any;

  const uc = new ApproveLeadUseCase(leads, users, wallets, hash, gateway, email, linkExternal);
  return { uc, users };
}

describe('ApproveLeadUseCase — vínculo automático de afiliado', () => {
  it('vincula referredByUserId quando o lead tem referredByCode válido', async () => {
    const lead = {
      id: 'lead1', email: 'novo@x.com', name: 'Novo', status: 'PENDING',
      cpf: '12345678901', cnpj: null, referredByCode: 'ABC123',
    };
    const { uc, users } = build(lead);
    users.findByAffiliateCode.mockResolvedValue({ id: 'affiliate1' });

    await uc.execute({ leadId: 'lead1', adminUserId: 'admin1' });

    expect(users.findByAffiliateCode).toHaveBeenCalledWith('ABC123');
    expect(users.setReferredBy).toHaveBeenCalledWith('newUser1', 'affiliate1');
  });

  it('não vincula nada quando o lead não tem referredByCode', async () => {
    const lead = {
      id: 'lead1', email: 'novo@x.com', name: 'Novo', status: 'PENDING',
      cpf: '12345678901', cnpj: null, referredByCode: null,
    };
    const { uc, users } = build(lead);

    await uc.execute({ leadId: 'lead1', adminUserId: 'admin1' });

    expect(users.findByAffiliateCode).not.toHaveBeenCalled();
    expect(users.setReferredBy).not.toHaveBeenCalled();
  });

  it('não vincula nada quando o código não bate com nenhum afiliado', async () => {
    const lead = {
      id: 'lead1', email: 'novo@x.com', name: 'Novo', status: 'PENDING',
      cpf: '12345678901', cnpj: null, referredByCode: 'CODIGO_INEXISTENTE',
    };
    const { uc, users } = build(lead);
    users.findByAffiliateCode.mockResolvedValue(null);

    await uc.execute({ leadId: 'lead1', adminUserId: 'admin1' });

    expect(users.setReferredBy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest src/application/use-cases/admin/approve-lead.use-case.spec.ts`
Expected: FAIL — `users.findByAffiliateCode is not a function` (método não existe na interface/mocks ainda são chamados mas o use-case real não invoca nada).

- [ ] **Step 3: Adicionar os métodos na interface e no repositório Prisma**

Em `src/core/repositories/user.repository.interface.ts`, no `IUserRepository`, depois de `updatePassword(...)`, adicionar:

```typescript
  findByAffiliateCode(code: string): Promise<User | null>;
  setReferredBy(userId: string, referredByUserId: string | null): Promise<void>;
```

Em `src/infrastructure/database/repositories/prisma-user.repository.ts`, depois de `updatePassword`, adicionar:

```typescript
  async findByAffiliateCode(code: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { affiliateCode: code } });
  }

  async setReferredBy(userId: string, referredByUserId: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { referredByUserId },
    });
  }
```

- [ ] **Step 4: Usar no `ApproveLeadUseCase`**

Em `src/application/use-cases/admin/approve-lead.use-case.ts`, logo depois de `await this.leads.approve(input.leadId, user.id);` (linha 92), adicionar:

```typescript
    // Vínculo automático de afiliado via link de indicação (?ref=CODE no cadastro)
    if ((lead as any).referredByCode) {
      const affiliate = await this.users.findByAffiliateCode((lead as any).referredByCode);
      if (affiliate) {
        await this.users.setReferredBy(user.id, affiliate.id);
      } else {
        this.logger.warn(
          `[ApproveLead] referredByCode "${(lead as any).referredByCode}" do lead ${lead.id} não bate com nenhum afiliado — ignorando`,
        );
      }
    }
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx jest src/application/use-cases/admin/approve-lead.use-case.spec.ts`
Expected: PASS (3 testes)

- [ ] **Step 6: Commit**

```bash
git add src/core/repositories/user.repository.interface.ts src/infrastructure/database/repositories/prisma-user.repository.ts src/application/use-cases/admin/approve-lead.use-case.ts src/application/use-cases/admin/approve-lead.use-case.spec.ts
git commit -m "$(cat <<'EOF'
feat: auto-link new account to affiliate on lead approval

When the approved Lead carries a referredByCode that matches an
existing User.affiliateCode, the new account's referredByUserId is
set automatically. Master can still override manually later.
EOF
)"
```

---

## Task 7: Endpoints de gestão (master) — `admin/afiliados`

**Files:**
- Create: `src/presentation/controllers/admin-afiliados.controller.ts`
- Modify: `src/presentation/admin.module.ts`
- Test: `src/presentation/controllers/admin-afiliados.controller.spec.ts`

Segue exatamente o padrão de `admin-clientes.controller.ts`: PrismaService direto, `JwtAuthGuard` + `RolesGuard` + `@Roles(Role.ADMIN)` no controller, e `assertMaster()` extra em cada handler (só o master de verdade, não qualquer ADMIN de plataforma, pode gerenciar afiliados).

Endpoints:
- `GET /admin/afiliados` — lista contas com `isAffiliate=true` (nome, email, %, código, total indicados, total comissão líquida).
- `GET /admin/afiliados/buscar?q=` — busca qualquer `User` por nome/email (candidatos a virar afiliado).
- `PATCH /admin/afiliados/:userId` — body `{ isAffiliate?: boolean; commissionPercent?: number }`. Ativa/desativa e/ou seta %. Gera `affiliateCode` na primeira ativação, se ainda não tiver.
- `GET /admin/afiliados/:userId` — detalhe: código, link, lista de indicados, total comissão.
- `PATCH /admin/afiliados/indicacao/:userId` — body `{ referredByUserId: string | null }`. Override manual do vínculo de QUALQUER conta (não precisa ser afiliado).

- [ ] **Step 1: Escrever os testes**

```typescript
// src/presentation/controllers/admin-afiliados.controller.spec.ts
import { AdminAfiliadosController } from './admin-afiliados.controller';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';

const masterUser = { id: 'admin1', role: 'ADMIN', email: 'master@simintpay.com', tenantModule: { slug: 'master', name: 'Master' } };
const nonMasterAdmin = { id: 'admin2', role: 'ADMIN', email: 'sub@areaflix.com', tenantModule: { slug: 'areaflix', name: 'Areaflix' } };

function buildPrisma(overrides: any = {}) {
  return {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    affiliateCommission: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { commissionAmount: null } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as any;
}

function invoke(method: string, prisma: any, ...args: any[]) {
  const ctx = { prisma } as any;
  return (AdminAfiliadosController.prototype as any)[method].apply(ctx, args);
}

describe('AdminAfiliadosController', () => {
  it('bloqueia quem não é master de verdade', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(nonMasterAdmin);

    await expect(invoke('list', prisma, nonMasterAdmin)).rejects.toThrow(ForbiddenException);
  });

  it('lista contas com isAffiliate=true', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue(masterUser),
        findMany: jest.fn().mockResolvedValue([
          { id: 'aff1', name: 'Fulano', email: 'fulano@x.com', affiliateCommissionPercent: '10.00', affiliateCode: 'ABC123', _count: { referrals: 3 } },
        ]),
      },
    });

    const res = await invoke('list', prisma, masterUser);

    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ id: 'aff1', totalReferrals: 3 });
  });

  it('ativa afiliado e gera affiliateCode quando ainda não tem', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(masterUser) // assertMaster
          .mockResolvedValueOnce({ id: 'u1', affiliateCode: null }), // target user
        update: jest.fn().mockResolvedValue({ id: 'u1', affiliateCode: 'GENCODE1' }),
      },
    });

    const res = await invoke('setAffiliate', prisma, 'u1', { isAffiliate: true, commissionPercent: 15 }, masterUser);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: expect.objectContaining({
        isAffiliate: true,
        affiliateCommissionPercent: 15,
        affiliateCode: expect.any(String),
      }),
    });
    expect(res.success).toBe(true);
  });

  it('mantém affiliateCode existente ao só atualizar a %', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce({ id: 'u1', affiliateCode: 'JAEXISTE' }),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    await invoke('setAffiliate', prisma, 'u1', { commissionPercent: 20 }, masterUser);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: expect.not.objectContaining({ affiliateCode: expect.anything() }),
    });
  });

  it('404 se o usuário-alvo não existe', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce(null),
      },
    });

    await expect(invoke('setAffiliate', prisma, 'ghost', { isAffiliate: true }, masterUser)).rejects.toThrow(NotFoundException);
  });

  it('override manual de indicado-por', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce({ id: 'u2' }),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    const res = await invoke('setReferredBy', prisma, 'u2', { referredByUserId: 'aff1' }, masterUser);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u2' }, data: { referredByUserId: 'aff1' } });
    expect(res.success).toBe(true);
  });

  it('bloqueia se referredByUserId apontar pro próprio usuário', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce({ id: 'u2' }),
      },
    });

    await expect(
      invoke('setReferredBy', prisma, 'u2', { referredByUserId: 'u2' }, masterUser),
    ).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest src/presentation/controllers/admin-afiliados.controller.spec.ts`
Expected: FAIL — `Cannot find module './admin-afiliados.controller'`

- [ ] **Step 3: Implementar o controller**

```typescript
// src/presentation/controllers/admin-afiliados.controller.ts
import {
  Body,
  Controller,
  ConflictException,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { randomBytes } from 'crypto';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { RolesGuard } from '../../infrastructure/security/guards/roles.guard';
import { Roles } from '../../infrastructure/security/decorators/roles.decorator';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { isMasterAdminUser } from '../../shared/utils/is-master-admin.util';

type SetAffiliateBody = { isAffiliate?: boolean; commissionPercent?: number };
type SetReferredByBody = { referredByUserId: string | null };

function generateAffiliateCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

/** Módulo master: curadoria e configuração do programa de afiliados. */
@Controller('admin/afiliados')
@ApiTags('Afiliados (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminAfiliadosController {
  constructor(private readonly prisma: PrismaService) {}

  private async assertMaster(authUser?: JwtPayload): Promise<void> {
    const requester = authUser?.sub
      ? await this.prisma.user.findUnique({
          where: { id: authUser.sub },
          include: { tenantModule: true },
        })
      : null;
    if (!requester || !isMasterAdminUser(requester)) {
      throw new ForbiddenException('Somente o módulo master pode gerenciar afiliados');
    }
  }

  @Get()
  @ApiOperation({ summary: 'Listar contas afiliadas' })
  async list(@CurrentUser() authUser?: JwtPayload) {
    await this.assertMaster(authUser);

    const affiliates = await this.prisma.user.findMany({
      where: { isAffiliate: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        affiliateCommissionPercent: true,
        affiliateCode: true,
        createdAt: true,
        _count: { select: { referrals: true } },
      },
    });

    const data = await Promise.all(
      affiliates.map(async (a) => {
        const totals = await this.prisma.affiliateCommission.aggregate({
          where: { affiliateUserId: a.id, status: 'CREDITED' },
          _sum: { commissionAmount: true },
        });
        return {
          id: a.id,
          name: a.name,
          email: a.email,
          commissionPercent: a.affiliateCommissionPercent,
          affiliateCode: a.affiliateCode,
          totalReferrals: a._count.referrals,
          totalCommission: Number(totals._sum.commissionAmount ?? 0),
          createdAt: a.createdAt,
        };
      }),
    );

    return { data };
  }

  @Get('buscar')
  @ApiOperation({ summary: 'Buscar usuários candidatos a afiliado (por nome/email)' })
  @ApiQuery({ name: 'q', required: true })
  async search(@Query('q') q: string, @CurrentUser() authUser?: JwtPayload) {
    await this.assertMaster(authUser);
    if (!q?.trim()) return { data: [] };

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: q.trim(), mode: 'insensitive' } },
          { email: { contains: q.trim(), mode: 'insensitive' } },
        ],
      },
      take: 20,
      select: { id: true, name: true, email: true, isAffiliate: true },
    });

    return { data: users };
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Detalhe de um afiliado: código, indicados, total de comissão' })
  async detail(@Param('userId') userId: string, @CurrentUser() authUser?: JwtPayload) {
    await this.assertMaster(authUser);

    const affiliate = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, isAffiliate: true,
        affiliateCommissionPercent: true, affiliateCode: true,
        referrals: { select: { id: true, name: true, email: true, createdAt: true } },
      },
    });
    if (!affiliate) throw new NotFoundException('Usuário não encontrado');

    const totals = await this.prisma.affiliateCommission.aggregate({
      where: { affiliateUserId: userId, status: 'CREDITED' },
      _sum: { commissionAmount: true },
    });

    return {
      data: {
        ...affiliate,
        totalCommission: Number(totals._sum.commissionAmount ?? 0),
      },
    };
  }

  @Patch(':userId')
  @ApiOperation({ summary: 'Ativar/desativar afiliado e/ou definir a % de comissão' })
  async setAffiliate(
    @Param('userId') userId: string,
    @Body() body: SetAffiliateBody,
    @CurrentUser() authUser?: JwtPayload,
  ) {
    await this.assertMaster(authUser);

    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, affiliateCode: true } });
    if (!target) throw new NotFoundException('Usuário não encontrado');

    const data: Record<string, unknown> = {};
    if (body.isAffiliate !== undefined) data.isAffiliate = body.isAffiliate;
    if (body.commissionPercent !== undefined) data.affiliateCommissionPercent = body.commissionPercent;
    if (body.isAffiliate === true && !target.affiliateCode) {
      data.affiliateCode = generateAffiliateCode();
    }

    await this.prisma.user.update({ where: { id: userId }, data });
    return { success: true };
  }

  @Patch('indicacao/:userId')
  @ApiOperation({ summary: 'Definir/trocar manualmente quem indicou esta conta' })
  async setReferredBy(
    @Param('userId') userId: string,
    @Body() body: SetReferredByBody,
    @CurrentUser() authUser?: JwtPayload,
  ) {
    await this.assertMaster(authUser);

    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) throw new NotFoundException('Usuário não encontrado');

    if (body.referredByUserId === userId) {
      throw new ConflictException('Uma conta não pode ser indicada por ela mesma');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { referredByUserId: body.referredByUserId },
    });
    return { success: true };
  }
}
```

- [ ] **Step 4: Registrar o controller no módulo**

Em `src/presentation/admin.module.ts`, adicionar o import:

```typescript
import { AdminAfiliadosController } from './controllers/admin-afiliados.controller';
```

E adicionar no array `controllers`: `[AdminController, AdminClientesController, AdminAfiliadosController]`.

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx jest src/presentation/controllers/admin-afiliados.controller.spec.ts`
Expected: PASS (7 testes)

- [ ] **Step 6: Commit**

```bash
git add src/presentation/controllers/admin-afiliados.controller.ts src/presentation/controllers/admin-afiliados.controller.spec.ts src/presentation/admin.module.ts
git commit -m "$(cat <<'EOF'
feat: admin endpoints to manage the affiliate program

GET/PATCH admin/afiliados — activate affiliates, set commission %,
search candidates, override referral link. Master-only (assertMaster).
EOF
)"
```

---

## Task 8: Painel do afiliado (self-service) + `GET /auth/me`

**Files:**
- Create: `src/presentation/controllers/afiliados.controller.ts`
- Modify: `src/presentation/settings.module.ts`
- Modify: `src/application/use-cases/auth/get-me.use-case.ts`
- Test: `src/presentation/controllers/afiliados.controller.spec.ts`
- Test: `src/application/use-cases/auth/get-me.use-case.affiliate.spec.ts`

- [ ] **Step 1: Escrever o teste do controller self-service**

```typescript
// src/presentation/controllers/afiliados.controller.spec.ts
import { AfiliadosController } from './afiliados.controller';

function buildPrisma(user: any, commissions: any[] = []) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    affiliateCommission: {
      findMany: jest.fn().mockResolvedValue(commissions),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { commissionAmount: commissions.filter((c) => c.status === 'CREDITED').reduce((s, c) => s + Number(c.commissionAmount), 0) || null },
      }),
    },
  } as any;
}

function invoke(prisma: any, authUser: any) {
  const ctx = { prisma } as any;
  return (AfiliadosController.prototype as any).me.call(ctx, authUser);
}

describe('AfiliadosController.me', () => {
  it('retorna vazio/zerado quando a conta não é afiliado', async () => {
    const prisma = buildPrisma({ id: 'u1', isAffiliate: false, affiliateCode: null, referrals: [] });
    const res = await invoke(prisma, { sub: 'u1' });
    expect(res.data.isAffiliate).toBe(false);
    expect(res.data.referrals).toEqual([]);
    expect(res.data.totalEarned).toBe(0);
  });

  it('retorna código, indicados e total ganho quando é afiliado', async () => {
    const prisma = buildPrisma(
      {
        id: 'u1', isAffiliate: true, affiliateCode: 'ABC123',
        referrals: [{ id: 'r1', name: 'Cliente 1', email: 'c1@x.com', createdAt: new Date('2026-07-01') }],
      },
      [{ id: 'c1', commissionAmount: '15.50', status: 'CREDITED', createdAt: new Date(), transactionId: 'tx1' }],
    );

    const res = await invoke(prisma, { sub: 'u1' });

    expect(res.data.isAffiliate).toBe(true);
    expect(res.data.affiliateCode).toBe('ABC123');
    expect(res.data.referrals).toHaveLength(1);
    expect(res.data.totalEarned).toBe(15.5);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest src/presentation/controllers/afiliados.controller.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o controller**

```typescript
// src/presentation/controllers/afiliados.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

/** Painel do próprio afiliado — somente leitura, só enxerga os dados dele. */
@Controller('afiliados')
@ApiTags('Afiliados')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class AfiliadosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @ApiOperation({ summary: 'Meus dados de afiliado: código, indicados e extrato de comissão' })
  async me(@CurrentUser() authUser?: JwtPayload) {
    const userId = authUser?.sub ?? '';

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isAffiliate: true,
        affiliateCode: true,
        referrals: { select: { id: true, name: true, email: true, createdAt: true } },
      },
    });

    if (!user || !user.isAffiliate) {
      return {
        data: {
          isAffiliate: false,
          affiliateCode: null,
          referrals: [],
          commissions: [],
          totalEarned: 0,
        },
      };
    }

    const [commissions, totals] = await Promise.all([
      this.prisma.affiliateCommission.findMany({
        where: { affiliateUserId: userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, transactionId: true, commissionAmount: true, status: true, createdAt: true },
      }),
      this.prisma.affiliateCommission.aggregate({
        where: { affiliateUserId: userId, status: 'CREDITED' },
        _sum: { commissionAmount: true },
      }),
    ]);

    return {
      data: {
        isAffiliate: true,
        affiliateCode: user.affiliateCode,
        referrals: user.referrals,
        commissions: commissions.map((c) => ({ ...c, commissionAmount: Number(c.commissionAmount) })),
        totalEarned: Number(totals._sum.commissionAmount ?? 0),
      },
    };
  }
}
```

- [ ] **Step 4: Registrar o controller**

Em `src/presentation/settings.module.ts` (mesmo módulo de `SettingsController`, outro self-service simples), adicionar o import:

```typescript
import { AfiliadosController } from './controllers/afiliados.controller';
```

E adicionar no array `controllers`: `[SettingsController, AfiliadosController]`. `PrismaService` é global no projeto (injetado direto em `AdminClientesController` sem aparecer em nenhum `providers`) — não precisa registrar nada a mais.

- [ ] **Step 5: Rodar o teste do controller e confirmar que passa**

Run: `npx jest src/presentation/controllers/afiliados.controller.spec.ts`
Expected: PASS (2 testes)

- [ ] **Step 6: Escrever o teste de `GetMeUseCase` com os campos novos**

```typescript
// src/application/use-cases/auth/get-me.use-case.affiliate.spec.ts
import { GetMeUseCase } from './get-me.use-case';

function build(user: any) {
  const users = { findById: jest.fn().mockResolvedValue(user) } as any;
  const wallets = {} as any;
  const gateway = { me: jest.fn() } as any;
  const prisma = {
    wallet: { findUnique: jest.fn().mockResolvedValue({ balance: '0', lockedBalance: '0' }) },
    transaction: { findMany: jest.fn().mockResolvedValue([]) },
    withdrawRequest: { aggregate: jest.fn().mockResolvedValue({ _sum: { grossAmount: null } }) },
  } as any;
  return new GetMeUseCase(users, wallets, gateway, prisma);
}

describe('GetMeUseCase — campos de afiliado', () => {
  it('inclui isAffiliate e affiliateCode na resposta', async () => {
    const uc = build({
      id: 'u1', name: 'A', email: 'a@x.com', cpf: null, cnpj: null, role: 'USER',
      clientStatus: null, tenantModule: null, domToken: null, createdAt: new Date(),
      isAffiliate: true, affiliateCode: 'ABC123',
    });

    const res = await uc.execute({ userId: 'u1' });

    expect(res.isAffiliate).toBe(true);
    expect(res.affiliateCode).toBe('ABC123');
  });

  it('isAffiliate=false e affiliateCode=null quando a conta não é afiliada', async () => {
    const uc = build({
      id: 'u1', name: 'A', email: 'a@x.com', cpf: null, cnpj: null, role: 'USER',
      clientStatus: null, tenantModule: null, domToken: null, createdAt: new Date(),
      isAffiliate: false, affiliateCode: null,
    });

    const res = await uc.execute({ userId: 'u1' });

    expect(res.isAffiliate).toBe(false);
    expect(res.affiliateCode).toBeNull();
  });
});
```

- [ ] **Step 7: Rodar e confirmar que falha**

Run: `npx jest src/application/use-cases/auth/get-me.use-case.affiliate.spec.ts`
Expected: FAIL — `res.isAffiliate` é `undefined`.

- [ ] **Step 8: Adicionar os campos em `GetMeUseCase`**

Em `src/application/use-cases/auth/get-me.use-case.ts`, no tipo de retorno de `execute` (depois de `clientStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;`), adicionar:

```typescript
    isAffiliate: boolean;
    affiliateCode: string | null;
```

E nos dois pontos de `return` (branch com `domMe` e branch final), adicionar as mesmas duas linhas:

```typescript
      isAffiliate: user.isAffiliate ?? false,
      affiliateCode: user.affiliateCode ?? null,
```

- [ ] **Step 9: Rodar o teste e confirmar que passa**

Run: `npx jest src/application/use-cases/auth/get-me.use-case.affiliate.spec.ts`
Expected: PASS (2 testes)

- [ ] **Step 10: Rodar a suíte completa pra garantir que nada quebrou**

Run: `npx jest`
Expected: PASS em todos os specs do projeto.

- [ ] **Step 11: Commit**

```bash
git add src/presentation/controllers/afiliados.controller.ts src/presentation/controllers/afiliados.controller.spec.ts src/application/use-cases/auth/get-me.use-case.ts src/application/use-cases/auth/get-me.use-case.affiliate.spec.ts
git commit -m "$(cat <<'EOF'
feat: self-service affiliate dashboard endpoint + expose isAffiliate on /auth/me

GET /afiliados/me returns code, referred accounts and commission
statement for the logged-in affiliate. GET /auth/me now flags
isAffiliate/affiliateCode so the frontend can show the nav item.
EOF
)"
```

---

## Notas finais

- Migração e todos os testes rodam contra o banco local configurado em `.env` — confirmar `DATABASE_URL` antes da Task 1.
- A Task 8 depende de identificar corretamente onde `SettingsController` está registrado (Step 4) — se não houver um módulo óbvio, criar `src/presentation/afiliados.module.ts` mínimo (`controllers: [AfiliadosController]`) e importá-lo em `app.module.ts`, seguindo o padrão dos outros módulos de presentation.
- Fora de escopo (confirmado no spec): comissão multinível, comissão sobre taxa de saque/outras fontes, retenção em `lockedBalance`.

---

## Task 9: Comissão em transações criadas via `SubscriptionLinkOrder` (gap achado na revisão final)

**Contexto do gap:** as Tasks 3/4 hookaram `AffiliateCommissionService` só no branch `handleTransaction`/fluxo regular de cada webhook. Só que `execute()` dos dois arquivos tenta `handleSubscriptionLinkPix` **antes** desse branch — se o `domPaymentId` bate com um `SubscriptionLinkOrder` (assinaturas Areaflix, vínculo de comunidade, CONTROLE-MOTORISTA, CONTROLE-PATRIMONIAL, BETAI), a função cria a `Transaction` **já `COMPLETED`, com `platformFee` não-zero**, direto ali dentro — e o fluxo regular (com o hook) nunca roda pra essa transação. Resultado: nenhuma comissão é gerada pra essa categoria inteira de transação, mesmo o design doc citando "Areaflix subcontas" nominalmente como caso coberto.

**Abordagem:** não reestruturar essas funções (são grandes, com múltiplos efeitos colaterais — fetch externo, e-mail, provisionamento). Só adicionar a chamada de comissão logo depois de cada `transaction.create(...)` que grava `status: COMPLETED`, dentro do já-existente `if (!exists) { ... }` que evita duplicata — seguindo o mesmo padrão não-atômico-mas-logado (try/catch próprio) que o crédito de wallet Areaflix já usa nessa mesma função.

**Files:**
- Modify: `src/application/use-cases/webhook/process-dom-webhook.use-case.ts` (2 pontos, dentro de `handleSubscriptionLinkPix`)
- Modify: `src/application/use-cases/webhook/process-webhook.use-case.ts` (2 pontos, dentro de `handleSubscriptionLinkPix`)
- Test: `src/application/use-cases/webhook/process-dom-webhook.subscription-affiliate.spec.ts`
- Test: `src/application/use-cases/webhook/process-webhook.subscription-affiliate.spec.ts`

### `process-dom-webhook.use-case.ts`

**Ponto 1** — bloco `subPlatformTag` (dentro de `if (subPlatformTag && subPlatformTag !== 'GLOBAL' && order.domPixPaymentId) { if (!exists) { ... } }`), a `Transaction` criada já é capturada em `const newTx = await this.prisma.transaction.create({...})`. Logo depois do bloco `if (afSubNet != null) { try { ... } catch (err) { ... } }` que credita a wallet Areaflix (fecha por volta da linha 1485, antes do comentário `// CONTROLE-MOTORISTA:`), adicionar:

```typescript
        // Comissão de afiliado (baseada no platformFee, independente da plataforma/tenant)
        try {
          await this.prisma.$transaction((p) =>
            this.affiliateCommission.applyForTransaction(p, {
              transactionId: newTx.id,
              referredUserId: order.userId,
              platformFee: newTx.platformFee,
            }),
          );
        } catch (err: unknown) {
          this.logger.error(
            `[DomWebhook] Falha ao creditar comissão de afiliado (subOrder ${order.id}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
```

**Ponto 2** — bloco fallback de comunidade (`else if (order.domPixPaymentId) { if (hasCommunity) { if (!exists) { await this.prisma.transaction.create({...}); } } }`, por volta da linha 1625-1642). Esse `create` hoje **não** captura o retorno — trocar:

```typescript
          await this.prisma.transaction.create({
            data: {
              userId: order.userId,
              amount: gross,
              netAmount: gross - pf,
              status: TransactionStatus.COMPLETED,
              paymentMethod: PaymentMethod.PIX,
              totalFee: 0,
              domFee: 0,
              platformFee: pf,
              description: `${order.subscriptionLink.name} [TENANT:${communityTag}] subOrder=${order.id}`,
              domPaymentId: order.domPixPaymentId,
              customerName: order.customerName,
              customerEmail: order.customerEmail,
              customerDocument: order.customerDocument,
              customerPhone: order.customerPhone ?? undefined,
            },
          });
```

por:

```typescript
          const communityTx = await this.prisma.transaction.create({
            data: {
              userId: order.userId,
              amount: gross,
              netAmount: gross - pf,
              status: TransactionStatus.COMPLETED,
              paymentMethod: PaymentMethod.PIX,
              totalFee: 0,
              domFee: 0,
              platformFee: pf,
              description: `${order.subscriptionLink.name} [TENANT:${communityTag}] subOrder=${order.id}`,
              domPaymentId: order.domPixPaymentId,
              customerName: order.customerName,
              customerEmail: order.customerEmail,
              customerDocument: order.customerDocument,
              customerPhone: order.customerPhone ?? undefined,
            },
          });

          try {
            await this.prisma.$transaction((p) =>
              this.affiliateCommission.applyForTransaction(p, {
                transactionId: communityTx.id,
                referredUserId: order.userId,
                platformFee: communityTx.platformFee,
              }),
            );
          } catch (err: unknown) {
            this.logger.error(
              `[DomWebhook] Falha ao creditar comissão de afiliado (subOrder ${order.id}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
```

### `process-webhook.use-case.ts`

Mesmo padrão, dois blocos dentro de `handleSubscriptionLinkPix`, nenhum dos dois hoje captura o retorno de `create`.

**Ponto 1** — branch `whAf.includes('areaflix')` (por volta da linha 500-526). Trocar:

```typescript
      if (!exists) {
        const gross = Number(order.amountCharged);
        const pf = Number(order.platformFeeAmount);
        await this.prisma.transaction.create({
          data: {
            userId: order.userId,
            amount: gross,
            netAmount: gross - pf,
            status: TransactionStatus.COMPLETED,
            paymentMethod: PaymentMethod.PIX,
            totalFee: 0,
            domFee: 0,
            platformFee: pf,
            description: `${order.subscriptionLink.name} ${TENANT_AREAFLIX_TAG} subOrder=${order.id}`,
            domPaymentId: order.domPixPaymentId,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerDocument: order.customerDocument,
            customerPhone: order.customerPhone ?? undefined,
          },
        });
      }
```

por:

```typescript
      if (!exists) {
        const gross = Number(order.amountCharged);
        const pf = Number(order.platformFeeAmount);
        const areaflixTx = await this.prisma.transaction.create({
          data: {
            userId: order.userId,
            amount: gross,
            netAmount: gross - pf,
            status: TransactionStatus.COMPLETED,
            paymentMethod: PaymentMethod.PIX,
            totalFee: 0,
            domFee: 0,
            platformFee: pf,
            description: `${order.subscriptionLink.name} ${TENANT_AREAFLIX_TAG} subOrder=${order.id}`,
            domPaymentId: order.domPixPaymentId,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerDocument: order.customerDocument,
            customerPhone: order.customerPhone ?? undefined,
          },
        });

        try {
          await this.prisma.$transaction((p) =>
            this.affiliateCommission.applyForTransaction(p, {
              transactionId: areaflixTx.id,
              referredUserId: order.userId,
              platformFee: areaflixTx.platformFee,
            }),
          );
        } catch (err: unknown) {
          this.logger.error(
            `[WEBHOOK] Falha ao creditar comissão de afiliado (subOrder ${order.id}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
```

**Ponto 2** — branch `hasCommunity` (por volta da linha 538-559). Mesmo tratamento: capturar o retorno em `const communityTx = await this.prisma.transaction.create({...})` e logo depois adicionar o mesmo bloco `try { await this.prisma.$transaction((p) => this.affiliateCommission.applyForTransaction(p, { transactionId: communityTx.id, referredUserId: order.userId, platformFee: communityTx.platformFee })); } catch (err: unknown) { this.logger.error(...) }`.

### Testes

Cada spec novo deve cobrir, pro respectivo arquivo: (a) `handleSubscriptionLinkPix` com uma `SubscriptionLinkOrder` cujo link é Areaflix (ou tem `platformTag`) → `applyForTransaction` é chamado com o `transactionId` da transação recém-criada, `referredUserId: order.userId` e o `platformFee` correto; (b) idem pro branch de fallback/comunidade. Siga o mesmo estilo de mock usado em `process-dom-webhook.affiliate.spec.ts`/`process-webhook.affiliate.spec.ts` (Tasks 3/4): monkey-patch `(uc as any).affiliateCommission = { applyForTransaction: jest.fn()... }` depois de construir a instância, mocke `this.prisma.subscriptionLinkOrder.findFirst` pra retornar uma order de teste, `this.prisma.transaction.findFirst` retornando `null` (não existe ainda), `this.prisma.transaction.create` retornando um objeto com `id`/`platformFee`, e `this.prisma.$transaction` executando o callback recebido (`jest.fn().mockImplementation((cb) => cb(mockTxClient))`). Não precisa testar o resto dos efeitos colaterais dessas funções (e-mail, comunidade, fetch externo) — já não são escopo desta task.

- [ ] **Step 1:** Escrever os testes (2 arquivos, ~2-3 casos cada) seguindo a descrição acima.
- [ ] **Step 2:** Rodar e confirmar que falham (o hook ainda não existe nesses pontos).
- [ ] **Step 3:** Implementar as 4 mudanças descritas acima (2 por arquivo).
- [ ] **Step 4:** Rodar os specs novos e confirmar que passam.
- [ ] **Step 5:** Rodar `npx jest process-dom-webhook` e `npx jest process-webhook.use-case` completos — confirmar que nada quebrou (specs das Tasks 3/4 continuam passando).
- [ ] **Step 6:** Rodar `npx jest` (suíte completa) — confirmar só as 2 falhas pré-existentes já conhecidas (não relacionadas a afiliados).
- [ ] **Step 7:** Commit:

```bash
git add src/application/use-cases/webhook/process-dom-webhook.use-case.ts src/application/use-cases/webhook/process-webhook.use-case.ts src/application/use-cases/webhook/process-dom-webhook.subscription-affiliate.spec.ts src/application/use-cases/webhook/process-webhook.subscription-affiliate.spec.ts
git commit -m "$(cat <<'EOF'
fix: credit affiliate commission on SubscriptionLinkOrder-based transactions

handleSubscriptionLinkPix creates Transaction rows already COMPLETED,
bypassing the regular handleTransaction/execute hook from Tasks 3/4.
Covers Areaflix subaccounts and community-bound subscription links in
both webhook paths, closing a gap found in final branch review.
EOF
)"
```
