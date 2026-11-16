import { afterEach, expect, mock, test } from 'bun:test';
import { claimSelectors, PlatformLinkClaim } from './platform-link-claim';

afterEach(() => {
  delete process.env.OFFER_PLATFORM_READS;
});

function fixture() {
  const offer = {
    findMany: mock(async (args: any) =>
      args.where.id.in.map((id: string) => ({ id })),
    ),
    updateMany: mock<(arg: unknown) => Promise<any>>(async () => ({
      count: 1,
    })),
  };
  const legacy = {
    findMany: mock<(arg: unknown) => Promise<any>>(async () => [
      { id: 'link' },
    ]),
    updateMany: mock<(arg: unknown) => Promise<any>>(async () => ({
      count: 1,
    })),
  };
  const p: any = {
    platform: {
      findUnique: async () => ({
        id: 'p',
        ownerUserId: 'owner',
        isActive: true,
        owner: { isActive: true },
      }),
    },
    offer,
    paymentLink: legacy,
    subscriptionLink: {
      findMany: async () => [],
      updateMany: mock(async () => ({ count: 0 })),
    },
    $transaction: async (f: any) => f(p),
  };
  return { p, offer, legacy, service: new PlatformLinkClaim(p) };
}

test('flag off: claim keeps using PaymentLink and never touches Offer', async () => {
  const { offer, legacy, service } = fixture();
  await service.claim('AREAFLIX', 'owner', { paymentLinkIds: ['link'] });
  expect(legacy.updateMany).toHaveBeenCalledTimes(1);
  expect(offer.findMany).not.toHaveBeenCalled();
  expect(offer.updateMany).not.toHaveBeenCalled();
});

test('flag on: same ids resolve and transfer through Offer, one-off and recurring separated', async () => {
  process.env.OFFER_PLATFORM_READS = '1';
  const { offer, legacy, service } = fixture();
  const result = await service.claim('AREAFLIX', 'owner', {
    paymentLinkIds: ['link'],
  });
  expect(result.transferred.paymentLinks).toBe(1);
  expect(result.transferred.subscriptionLinks).toBe(1);
  expect(legacy.findMany).not.toHaveBeenCalled();
  expect(legacy.updateMany).not.toHaveBeenCalled();
  const wheres = offer.updateMany.mock.calls.map((c) => (c[0] as any).where);
  expect(wheres[0]).toMatchObject({
    id: { in: ['link'] },
    platformTag: 'AREAFLIX',
    renewalMode: 'NONE',
    ownerUserId: { not: 'owner' },
  });
  expect(wheres[1].renewalMode).toEqual({ not: 'NONE' });
  expect((offer.updateMany.mock.calls[0][0] as any).data).toEqual({
    ownerUserId: 'owner',
  });
});

test('flag on: a link that is not an offer of the platform blocks the claim before mutation', async () => {
  process.env.OFFER_PLATFORM_READS = '1';
  const { offer, service } = fixture();
  offer.findMany.mockImplementation(async () => []);
  await expect(
    service.claim('AREAFLIX', 'owner', { paymentLinkIds: ['foreign'] }),
  ).rejects.toThrow();
  expect(offer.updateMany).not.toHaveBeenCalled();
});

test('selectors are the same ids and platform in both worlds', () => {
  const legacy = claimSelectors('T', ['a'], ['b'], false);
  const offers = claimSelectors('T', ['a'], ['b'], true);
  expect(legacy.payment.id).toEqual(offers.payment.id);
  expect(legacy.subscription.id).toEqual(offers.subscription.id);
});
