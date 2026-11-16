import { afterEach, expect, mock, test } from 'bun:test';
import { PlatformSellerReports } from './platform-seller-reports';

const ctx = {
  id: 'p',
  tag: 'AREAFLIX',
  ownerUserId: 'o',
  acquirer: 'DOM' as const,
};
function prisma() {
  const orders = [{ customerEmail: 'a@x.com' }, { customerEmail: 'b@x.com' }];
  return {
    platform: {
      findUnique: async () => ({
        ...ctx,
        isActive: true,
        owner: { isActive: true },
      }),
    },
    subscriptionLink: { findMany: mock(async () => [{ id: 'link-1' }]) },
    offer: { findMany: mock(async () => [{ id: 'link-1' }]) },
    subscriptionLinkOrder: { findMany: mock(async () => orders) },
  } as any;
}
afterEach(() => {
  delete process.env.OFFERS_READ_ENABLED;
});

test('areaflix totals are identical reading SubscriptionLink or Offer', async () => {
  const legacyDb = prisma();
  const legacy = await new PlatformSellerReports(legacyDb, ctx).getSellerStats(
    'AREAFLIX',
  );
  expect(legacyDb.offer.findMany).not.toHaveBeenCalled();

  process.env.OFFERS_READ_ENABLED = 'true';
  const offerDb = prisma();
  const viaOffer = await new PlatformSellerReports(offerDb, ctx).getSellerStats(
    'AREAFLIX',
  );
  expect(offerDb.subscriptionLink.findMany).not.toHaveBeenCalled();
  expect(viaOffer).toEqual(legacy);
  expect(viaOffer.totalContas).toBe(2);
});
