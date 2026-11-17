import { expect, mock, test } from 'bun:test';
import { VoucherService } from './voucher.service';

function service(over: Record<string, unknown> = {}) {
  const prisma = {
    offer: {
      findFirst: mock<(arg: unknown) => Promise<any>>(
        async () => null as unknown,
      ),
    },
    ...over,
  };
  return { prisma, service: new VoucherService(prisma as never) };
}

test('id, code or PX alias resolve the owner through Offer, plans by legacyType', async () => {
  const { prisma, service: s } = service();
  prisma.offer.findFirst.mockImplementation(async () => ({
    ownerUserId: 'o',
    description: 'd',
    legacyType: 'PixCreditPlan',
  }));
  expect(await s.findResourceOwner({ planId: 'p', linkCode: 'PX-1' })).toEqual({
    kind: 'plan',
    userId: 'o',
    description: 'd',
  });
  const where = (prisma.offer.findFirst.mock.calls[0][0] as any).where.OR;
  expect(where).toHaveLength(3);
  expect(where[0]).toEqual({ id: 'p' });
  expect(JSON.stringify(where[2])).toContain('codeAliases');
  prisma.offer.findFirst.mockImplementation(async () => ({
    ownerUserId: 'o2',
    description: null,
    legacyType: 'SubscriptionLink',
  }));
  expect(await s.findResourceOwner({ linkCode: 'c' })).toEqual({
    kind: 'link',
    userId: 'o2',
  });
  prisma.offer.findFirst.mockImplementation(async () => null);
  expect(await s.findResourceOwner({ linkCode: 'x' })).toEqual({
    kind: 'none',
  });
});
