import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { CanonicalCardsService } from './canonical-cards.service';
import { encryptPlatformSecret } from '../platform-integrations/platform-secrets';
const oldKey = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
afterEach(() => { mock.restore(); if (oldKey === undefined) delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY; else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = oldKey; });
function fixture() {
 process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
 const credential = { id: 'credential', source: 'delivery', externalCompanyId: 'company', platformId: 'platform', merchantId: 'merchant', isActive: true, profile: { code: 'DELIVERY', isActive: true, acquirer: 'DOM', encryptedCredential: encryptPlatformSecret('account-token') } };
 const ctx = { id: 'platform', tag: 'SHOP', acquirer: 'DOM' as const, ownerUserId: 'owner', delivery: { credentialId: 'credential', merchantId: 'merchant', externalCompanyId: 'company', profileId: 'profile', allocate: true } };
 const p = { platformApiCredential: { findUnique: async () => credential }, canonicalCardCustomer: { findUnique: mock(async () => null), upsert: mock(async ({ create }: any) => ({ id: 'customer', ...create })), findFirst: mock(async () => ({ id: 'customer', providerCustomerId: 'dom-customer' })) } };
 return { ctx, p, service: new CanonicalCardsService(p as never) };
}
test('customer ownership mapping is persisted, raw card data is never written to persistence', async () => {
 const f = fixture();
 const fetch = spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ id: 'dom-customer' })).mockResolvedValueOnce(Response.json({ token: 'opaque-token' }));
 expect(await f.service.customer(f.ctx, { externalCustomerId: 'buyer', name: 'Maria Silva', email: 'maria@example.com', document: '52998224725' })).toEqual({ id: 'customer' });
 const result = await f.service.tokenize(f.ctx, 'customer', { number: '4242424242424242', cvv: '123', expMonth: 12, expYear: 2030, holderName: 'Maria Silva', holderDocument: '52998224725' });
 expect(result).toMatchObject({ token: 'opaque-token', bin: '424242', last4: '4242', brand: 'Visa', expiryYear: '2030' });
 expect(JSON.stringify(f.p.canonicalCardCustomer.upsert.mock.calls)).not.toContain('4242424242424242');
 expect(f.p.canonicalCardCustomer.findFirst).toHaveBeenCalledWith({ where: { id: 'customer', credentialId: 'credential' } });
 expect(fetch.mock.calls[1][1]?.headers).toHaveProperty('Authorization', 'Bearer account-token');
 expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ number: '4242424242424242', cvv: '123', exp_month: 12, exp_year: 2030, holder_name: 'Maria Silva', holder_document: '52998224725' });
});
test('tokenization rejects customer outside the company credential before contacting acquirer', async () => {
 const f = fixture(); f.p.canonicalCardCustomer.findFirst.mockResolvedValue(null as never);
 const fetch = spyOn(globalThis, 'fetch');
 await expect(f.service.tokenize(f.ctx, 'foreign', {} as never)).rejects.toMatchObject({ status: 404 });
 expect(fetch).not.toHaveBeenCalled();
});
