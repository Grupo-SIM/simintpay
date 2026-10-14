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
