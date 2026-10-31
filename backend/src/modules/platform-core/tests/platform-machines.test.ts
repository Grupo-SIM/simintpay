import { expect, test } from 'bun:test';
import { PlatformFinanceService } from '../../unified-platform/finance/platform-finance.service';

const ctx = {
  id: 'p1',
  tag: 'RENOVADA',
  ownerUserId: 'x',
  acquirer: 'DOM' as const,
};
const tx = (over: object = {}) => ({
  id: 't1',
  domPaymentId: 'pay1',
  domTransactionId: 'ext1',
  description: '[ORIGEM:MAQUINETA] Terminal: AB-12-CD [x]',
  amount: 10.5,
  netAmount: 9.99,
  status: 'COMPLETED',
  paymentMethod: 'CREDIT_CARD',
  installments: 1,
  createdAt: new Date('2026-01-02T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  ...over,
});
const make = (platform: any, calls: any = {}) =>
  new PlatformFinanceService({
    platform: {
      findUnique: async (a: any) => {
        calls.platform = a;
        return a.where.id === 'p1' ? platform : null;
      },
    },
    transaction: {
      findMany: async (a: any) => {
        calls.find = a;
        return [tx()];
      },
      count: async () => 1,
    },
  } as any);
const active = {
  ownerUserId: 'owner',
  isActive: true,
  owner: { isActive: true, isPurged: false },
};

test('machines are scoped to the authenticated platform owner and mapped to cents', async () => {
  const calls: any = {};
  const out = await make(active, calls).machines(ctx, { page: 1, limit: 20 });
  expect(calls.platform.where).toEqual({ id: 'p1' });
  expect(calls.find.where.userId).toBe('owner');
  expect(calls.find.where.OR).toHaveLength(3);
  expect(out.transactions[0]).toMatchObject({
    id: 'pay1',
    terminal: 'AB-12-CD',
    amountCents: 1050,
    netAmountCents: 999,
    status: 'completed',
  });
  expect(out.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
});

test('inactive or missing platform/owner yields an empty list without querying transactions', async () => {
  for (const p of [
    { ...active, isActive: false },
    { ...active, owner: { isActive: false, isPurged: false } },
    { ...active, owner: { isActive: true, isPurged: true } },
    null,
  ]) {
    const calls: any = {};
    const out = await make(p, calls).machines(ctx);
    expect(out.transactions).toEqual([]);
    expect(out.meta.total).toBe(0);
    expect(calls.find).toBeUndefined();
  }
});

test('rejects invalid pagination and dates', async () => {
  const svc = make(active);
  await expect(svc.machines(ctx, { limit: 101 })).rejects.toThrow();
  await expect(svc.machines(ctx, { startDate: 'nope' })).rejects.toThrow();
});
