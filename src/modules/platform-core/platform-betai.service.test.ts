import { PlatformBetaiController } from './platform-betai.controller';
import { encryptPlatformSecret } from '../platform-integrations/platform-secrets';
import { describe, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformBetaiService } from './platform-betai.service';
import type { PlatformContext } from './platform-context.service';
import { InternalBetaiController } from '../../presentation/controllers/internal-betai.controller';

function fixture() {
  const context: PlatformContext = { id: 'platform', tag: 'BETAI', ownerUserId: 'owner', acquirer: 'DOM' };
  const createLink = mock(async (_input: unknown) => ({ data: { id: 'bill-link' } }));
  const createBill = mock(async (_input: unknown) => ({}));
  const resolve = mock(async () => ({ ...context }));
  const paymentLink = mock(async (_input: unknown) => null);
  const subscription = mock(async (_input: unknown) => null);
  const createPlan = mock(async (_context: unknown, _input: unknown) => ({ code: 'plan' }));
  const paymentStatus = mock(async (_context: unknown, _code: string) => ({ paid: false, paidAt: null }));
  const prisma = { cobranca: { create: createBill }, paymentLink: { findFirst: paymentLink }, subscriptionLink: { findFirst: subscription }, transaction: { findFirst: mock(async () => null) } };
  const service = new PlatformBetaiService(prisma as never, { resolve } as never, { get: () => ({ execute: createLink }) } as never,
    { createPlan, paymentStatus } as never, {} as never);
  return { context, service, createLink, createBill, resolve, paymentLink, subscription, createPlan };
}

describe('Shared BetAI operations', () => {
  test('bill uses registered current owner and shared checkout, stores PAYABLE in reais', async () => {
    const f = fixture();
    const result = await f.service.createBill(f.context, { amountCents: 1234, title: 'Mensalidade', email: 'a@example.com' });
    expect(result.linkCode).toBe('bill-link');
    expect(f.createLink.mock.calls[0][0]).toMatchObject({ userId: 'owner', dto: { valor: 12.34, plataformas: ['BETAI'] } });
    const data = (f.createBill.mock.calls[0][0] as any).data;
    expect(new Prisma.Decimal(data.amount).toNumber()).toBe(12.34);
    expect(data).toMatchObject({ userId: 'owner', createdByUserId: 'owner', mode: 'PAYABLE', paymentRef: 'bill-link' });
  });
  test('missing support and stale ownership cannot create checkout', async () => {
    const f = fixture();
    await expect(f.service.createBill({ ...f.context, tag: 'OTHER' }, { amountCents: 100 })).rejects.toMatchObject({ status: 422 });
    f.resolve.mockResolvedValueOnce({ ...f.context, ownerUserId: 'new-owner' });
    await expect(f.service.createBill(f.context, { amountCents: 100 })).rejects.toThrow('Contexto');
    f.context.acquirer = 'FRENDZ';
    await expect(f.service.createBill(f.context, { amountCents: 100 })).rejects.toMatchObject({ status: 422 });
    expect(f.createLink).not.toHaveBeenCalled();
  });
  test('canonical contract rejects fractional cents and invalid due date before shared usecase', async () => {
    const f = fixture();
    await expect(f.service.createBill(f.context, { amountCents: 10.5 })).rejects.toThrow('amountCents');
    await expect(f.service.createBill(f.context, { amountCents: 100, dueDate: 'invalid' })).rejects.toThrow('dueDate');
    expect(f.createLink).not.toHaveBeenCalled();
  });
  test('cancellation cannot access another platform or owner subscription', async () => {
    const f = fixture();
    expect(await f.service.cancelPlan(f.context, 'foreign')).toEqual({ encontrada: false, canceladas: 0 });
    expect(f.subscription.mock.calls[0][0]).toMatchObject({ where: { code: 'foreign', userId: 'owner', OR: [{ platformTag: 'BETAI' }, { plataformas: { has: 'BETAI' } }] } });
  });
  test('legacy reais alias translates once and preserves shared result', async () => {
    const f = fixture();
    const controller = new InternalBetaiController(f.service);
    const previous = process.env.API_MACHINE_INTERNAL_TOKEN;
    process.env.API_MACHINE_INTERNAL_TOKEN = 'local-test';
    try {
      const alias = await controller.criarCobranca({ valor: 12.34, titulo: 'Mensalidade' }, 'local-test');
      const canonical = await f.service.createBill(f.context, { amountCents: 1234, title: 'Mensalidade' });
      expect(alias).toEqual(canonical);
      expect(f.createLink.mock.calls[0][0]).toEqual(f.createLink.mock.calls[1][0]);
      expect(() => controller.criarCobranca({ valor: 12.34 }, 'wrong')).toThrow('Token interno');
    } finally { if (previous === undefined) delete process.env.API_MACHINE_INTERNAL_TOKEN; else process.env.API_MACHINE_INTERNAL_TOKEN = previous; }
  });
  test('legacy plan delegates monthly subscription to same core', async () => {
    const f = fixture();
    const result = await f.service.createPlan({ valor: 12.34, label: 'Mensalidade' });
    expect(f.createPlan).toHaveBeenCalledWith(f.context, { amountCents: 1234, frequency: 'MENSAL', name: 'Mensalidade' });
    expect(result.code).toBe('plan');
  });
});

test('BetAI status alias and canonical use actual checkout status and preserve envelopes', async () => {
  const f = fixture();
  const at = new Date('2026-09-01T12:00:00Z');
  f.paymentLink.mockImplementation(async () => ({ id: 'link' }) as any);
  (f.service as any).prisma.transaction.findFirst.mockImplementation(async () => ({ updatedAt: at }));
  const oldToken = process.env.API_MACHINE_INTERNAL_TOKEN;
  process.env.API_MACHINE_INTERNAL_TOKEN = 'test-only';
  try {
    expect(await new InternalBetaiController(f.service).statusCobranca('link', 'test-only')).toEqual({ pago: true, pagoEm: at });
    expect(await new PlatformBetaiController(f.service).status({ platformContext: f.context }, 'link')).toEqual({ paid: true, paidAt: at });
  } finally { if (oldToken === undefined) delete process.env.API_MACHINE_INTERNAL_TOKEN; else process.env.API_MACHINE_INTERNAL_TOKEN = oldToken; }
});
test('BetAI cancellation aliases execute same scoped cancellation and count successful gateway calls', async () => {
  const f = fixture();
  const oldToken = process.env.API_MACHINE_INTERNAL_TOKEN;
  const previousKey = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
  process.env.API_MACHINE_INTERNAL_TOKEN = 'test-only';
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = '1'.repeat(64);
  try {
    const p = (f.service as any).prisma;
    f.subscription.mockImplementation(async () => ({ id: 'subscription' }) as any);
    p.platformIntegration = { findUnique: async () => ({ encryptedValue: encryptPlatformSecret('provider-test-token') }) };
    p.subscriptionLinkOrder = { findMany: async () => [{ domSubscriptionId: 'ok' }, { domSubscriptionId: 'failed' }] };
    p.subscriptionLink.update = mock(async () => ({}));
    const cancel = mock(async (_token: string, id: string) => { if (id === 'failed') throw new Error('mock provider failure'); });
    (f.service as any).gateways = { byAcquirer: () => ({ cancelSubscription: cancel }) };
    expect(await new InternalBetaiController(f.service).cancelarPlano({ code: 'subscription' }, 'test-only')).toEqual({ encontrada: true, canceladas: 1 });
    expect(await new PlatformBetaiController(f.service).cancel({ platformContext: f.context }, { code: 'subscription' })).toEqual({ found: true, cancelled: 1 });
    expect(cancel).toHaveBeenCalledTimes(4);
    expect(p.subscriptionLink.update.mock.calls[0]).toEqual(p.subscriptionLink.update.mock.calls[1]);
  } finally {
    if (oldToken === undefined) delete process.env.API_MACHINE_INTERNAL_TOKEN; else process.env.API_MACHINE_INTERNAL_TOKEN = oldToken;
    if (previousKey === undefined) delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY; else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = previousKey;
  }
});
