import { expect, mock, test } from 'bun:test';
import { PlatformContextService } from './platform-context.service';
function fixture() {
 const platform = { id: 'platform', tag: 'SHOP', ownerUserId: 'owner', acquirer: 'DOM', isActive: true, owner: { isActive: true, isPurged: false } };
 const delegated = { id: 'credential', source: 'delivery', platformId: 'platform', merchantId: 'merchant', externalCompanyId: 'company', profileId: 'profile', isActive: true, operations: ['payments:read', 'payments:allocate'], profile: { isActive: true, acquirer: 'DOM' } };
 const p = { platform: { findUnique: async () => platform }, platformApiCredential: { findUnique: async () => delegated }, integrationMerchant: { findUnique: async () => ({ id: 'merchant', externalMerchantId: 'company', user: { isActive: true, isPurged: false } }) }, platformIntegration: { findUnique: mock(async () => null) } };
 return { delegated, p, service: new PlatformContextService(p as never) };
}
test('delegated token cannot cross company or access platform-wide operations', async () => {
 const { service, p } = fixture();
 expect((await service.authorize('SHOP', 'payments:read', undefined, 'token', 'company')).delivery).toMatchObject({ merchantId: 'merchant', externalCompanyId: 'company', allocate: true });
 await expect(service.authorize('SHOP', 'payments:read', undefined, 'token', 'other')).rejects.toMatchObject({ status: 401 });
 await expect(service.authorize('SHOP', 'payments:read', undefined, 'token')).rejects.toMatchObject({ status: 401 });
 await expect(service.authorize('SHOP', 'finance:withdraw', undefined, 'token', 'company')).rejects.toMatchObject({ status: 403 });
 expect(p.platformIntegration.findUnique).not.toHaveBeenCalled();
});
test('inactive profile or foreign platform invalidates delegated access', async () => {
 const { delegated, service } = fixture();
 delegated.profile.isActive = false;
 await expect(service.authorize('SHOP', 'payments:read', undefined, 'token', 'company')).rejects.toMatchObject({ status: 401 });
 delegated.profile.isActive = true; delegated.platformId = 'foreign';
 await expect(service.authorize('SHOP', 'payments:read', undefined, 'token', 'company')).rejects.toMatchObject({ status: 401 });
});
