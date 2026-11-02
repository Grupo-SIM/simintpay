import { expect, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { PlatformFinanceService } from '../../unified-platform/finance/platform-finance.service';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';

const ctx = (tag: string) => ({
  id: 'p',
  tag,
  ownerUserId: 'owner',
  acquirer: 'DOM' as const,
});
const row = (over: object = {}) => ({
  id: 'w1',
  amount: 10,
  grossAmount: 12,
  fee: 2,
  status: 'COMPLETED',
  pixKey: 'k',
  rejectionReason: null,
  createdAt: new Date(),
  receiptImage: 'https://x/r.png',
  comprovanteVisivel: true,
  user: { name: 'Owner', email: 'o@x.com' },
  ...over,
});
const make = (rows: any[]) => {
  const find = (a: any) =>
    rows.find(
      (r) =>
        r.id === a.where.id &&
        a.where.userId === 'owner' &&
        a.where.platform === 'bosque',
    ) ?? null;
  return new PlatformFinanceService({
    withdrawRequest: {
      findFirst: async (a: any) => find(a),
      count: async () => rows.length,
      findMany: async () => rows,
    },
  } as any);
};

for (const tag of ['BOSQUE', 'RENOVADA']) {
  test(`${tag} config exposes the resolved withdrawal policy in cents`, async () => {
    await initializePlatformTaxasCache({
      platformTaxaOverride: {
        findMany: async () => [
          { tag, key: 'TAXA_SAQUE_EXTRA', value: 3.5 },
          { tag, key: 'TAXA_SAQUE_PERCENT', value: 0.01 },
          { tag, key: 'SAQUE_MIN', value: 50 },
        ],
      },
    } as any);
    expect(make([]).config(ctx(tag))).toEqual({
      unit: 'cents',
      withdrawal: { minimumCents: 5000, fixedFeeCents: 350, percentFee: 0.01 },
    });
  });
}

test('withdrawal detail/list expose receipt flag and owner identity; receipt is owner-scoped', async () => {
  const svc = make([row(), row({ id: 'w2', receiptImage: null })]);
  expect(await svc.withdrawal(ctx('BOSQUE'), 'w1')).toMatchObject({
    receiptAvailable: true,
    customer: { name: 'Owner', email: 'o@x.com' },
  });
  const list = await svc.withdrawals(ctx('BOSQUE'));
  expect(list.data.map((d: any) => d.receiptAvailable)).toEqual([true, false]);
  expect(await svc.withdrawalReceiptRef(ctx('BOSQUE'), 'w1')).toBe(
    'https://x/r.png',
  );
  await expect(
    svc.withdrawalReceiptRef(ctx('BOSQUE'), 'w2'),
  ).rejects.toBeInstanceOf(NotFoundException);
  await expect(
    svc.withdrawalReceiptRef({ ...ctx('BOSQUE'), ownerUserId: 'other' }, 'w1'),
  ).rejects.toBeInstanceOf(NotFoundException);
});
