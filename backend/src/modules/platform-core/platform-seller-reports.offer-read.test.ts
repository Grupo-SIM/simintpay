import { expect, mock, test } from 'bun:test';
import { PlatformSellerReports } from './platform-seller-reports';

const ctx = {
  id: 'p',
  tag: 'AREAFLIX',
  ownerUserId: 'o',
  acquirer: 'DOM' as const,
};

test('areaflix totals are read through Offer', async () => {
  const db = {
    platform: {
      findUnique: async () => ({
        ...ctx,
        isActive: true,
        owner: { isActive: true },
      }),
    },
    offer: { findMany: mock(async () => [{ id: 'link-1' }]) },
    subscriptionLinkOrder: {
      findMany: mock(async () => [
        { customerEmail: 'a@x.com' },
        { customerEmail: 'b@x.com' },
      ]),
    },
  } as any;
  const stats = await new PlatformSellerReports(db, ctx).getSellerStats(
    'AREAFLIX',
  );
  expect(db.offer.findMany).toHaveBeenCalled();
  expect(stats.totalContas).toBe(2);
});
