import { expect, test } from 'bun:test';
import { platformMerchant } from './platform-merchant-lookup';
const context = { id: 'p', tag: 'SHOP', ownerUserId: 'owner', acquirer: 'DOM' as const };
function fixture() {
  const merchant = { id: 'm', userId: 'seller', integrationKey: 'old-key', user: { isActive: true } };
  const p: any = {
    integrationMerchant: { findUnique: async () => null, findMany: async () => [merchant] },
    platformIntegration: { findUnique: async () => ({ url: 'old-key' }), findMany: async () => [{ url: 'old-key', platform: context }] },
  };
  return { merchant, p };
}
test('canonical merchant can reuse existing explicit legacy binding without creating a duplicate', async () => {
  const { merchant, p } = fixture();
  expect(await platformMerchant(p, context, 'external')).toBe(merchant);
});
test('missing and ambiguous legacy merchant bindings never choose an arbitrary association', async () => {
  const { merchant, p } = fixture();
  p.integrationMerchant.findMany = async () => [merchant, { ...merchant, id: 'other' }];
  await expect(platformMerchant(p, context, 'external')).rejects.toThrow('ambiguidade');
  p.platformIntegration.findUnique = async () => null;
  await expect(platformMerchant(p, context, 'external')).rejects.toThrow('não associado');
});
test('legacy namespace shared by two products is rejected', async () => {
  const { p } = fixture();
  p.platformIntegration.findMany = async () => [{ url: 'old-key', platform: context }, { url: 'old-key', platform: { ...context, id: 'other' } }];
  await expect(platformMerchant(p, context, 'external')).rejects.toMatchObject({ response: { code: 'PLATFORM_CAPABILITY_UNAVAILABLE' } });
});
