import { afterEach, expect, mock, test } from 'bun:test';
import { VoucherService } from './voucher.service';

afterEach(() => {
  delete process.env.OFFER_PLATFORM_READS;
});

function service(over: Record<string, unknown> = {}) {
  const prisma = {
    offer: {
      findFirst: mock<(arg: unknown) => Promise<any>>(
        async () => null as unknown,
      ),
    },
    pixCreditPlan: {
      findFirst: mock<(arg: unknown) => Promise<any>>(
        async () => null as unknown,
      ),
    },
    subscriptionLink: {
      findFirst: mock<(arg: unknown) => Promise<any>>(
        async () => null as unknown,
      ),
    },
    ...over,
  };
  return { prisma, service: new VoucherService(prisma as never) };
}

test('default: the owner comes from the legacy plan, then the subscription link', async () => {
  const { prisma, service: s } = service();
  prisma.pixCreditPlan.findFirst.mockImplementation(async () => ({
    userId: 'plan-owner',
    description: 'd',
  }));
  expect(await s.findResourceOwner({ planId: 'p' })).toEqual({
    kind: 'plan',
    userId: 'plan-owner',
    description: 'd',
  });
  prisma.pixCreditPlan.findFirst.mockImplementation(async () => null);
  prisma.subscriptionLink.findFirst.mockImplementation(async () => ({
    userId: 'link-owner',
  }));
  expect(await s.findResourceOwner({ linkCode: 'c' })).toEqual({
    kind: 'link',
    userId: 'link-owner',
  });
  expect(prisma.offer.findFirst).not.toHaveBeenCalled();
});

test('flag on: id, code or PX alias resolve the owner through Offer, plans by legacyType', async () => {
  process.env.OFFER_PLATFORM_READS = '1';
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
  expect(prisma.pixCreditPlan.findFirst).not.toHaveBeenCalled();
  expect(prisma.subscriptionLink.findFirst).not.toHaveBeenCalled();
});
