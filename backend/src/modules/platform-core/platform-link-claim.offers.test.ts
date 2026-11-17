import { expect, mock, test } from 'bun:test';
import { claimSelectors, PlatformLinkClaim } from './platform-link-claim';

function fixture() {
  const offer = {
    findMany: mock(async (args: any) =>
      args.where.id.in.map((id: string) => ({ id })),
    ),
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
    $transaction: async (f: any) => f(p),
  };
  return { p, offer, service: new PlatformLinkClaim(p) };
}

test('same ids resolve and transfer through Offer, one-off and recurring separated', async () => {
  const { offer, service } = fixture();
  const result = await service.claim('AREAFLIX', 'owner', {
    paymentLinkIds: ['link'],
  });
  expect(result.transferred.paymentLinks).toBe(1);
  expect(result.transferred.subscriptionLinks).toBe(1);
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

test('a link that is not an offer of the platform blocks the claim before mutation', async () => {
  const { offer, service } = fixture();
  offer.findMany.mockImplementation(async () => []);
  await expect(
    service.claim('AREAFLIX', 'owner', { paymentLinkIds: ['foreign'] }),
  ).rejects.toThrow();
  expect(offer.updateMany).not.toHaveBeenCalled();
});
