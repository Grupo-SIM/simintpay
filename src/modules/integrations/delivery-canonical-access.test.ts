import { afterEach, describe, expect, mock, test } from 'bun:test';
import { assertDeliveryProvisioningToken, ensureDeliveryAccess, deliveryAccessResult } from './delivery-canonical-access';
import { decryptPlatformSecret, encryptPlatformSecret, hashPlatformToken } from '../platform-integrations/platform-secrets';
const previous = { ...process.env };
afterEach(() => { for (const key of ['PLATFORM_CONFIG_ENCRYPTION_KEY','SIM_DELIVERY_PROVISIONING_TOKEN','SIM_DELIVERY_INTERNAL_TOKEN']) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
function fixture(existing: any = null) {
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  const tx = { platformIntegration: { findUnique: mock(async () => null), upsert: mock(async () => ({})) }, platformApiCredential: { findUnique: mock(async () => existing), create: mock(async ({ data }: any) => ({ id: 'credential', isActive: true, ...data })) }, paymentIntegrationProfile: { findUnique: mock(async () => ({ id: 'profile', code: 'DELIVERY', isActive: true, acquirer: 'DOM', encryptedCredential: encryptPlatformSecret('same-account') })) } };
  return { tx, run: () => ensureDeliveryAccess(tx as never, 'platform', { id: 'merchant', externalMerchantId: 'company' }) };
}
describe('canonical Delivery bootstrap', () => {
  test('requires dedicated provisioning credential and rejects ordinary machine keys', () => {
    process.env.SIM_DELIVERY_PROVISIONING_TOKEN = 'provision';
    expect(() => assertDeliveryProvisioningToken('wrong')).toThrow();
    expect(() => assertDeliveryProvisioningToken(undefined)).toThrow();
    expect(() => assertDeliveryProvisioningToken('provision')).not.toThrow();
    delete process.env.SIM_DELIVERY_PROVISIONING_TOKEN;
    process.env.SIM_DELIVERY_INTERNAL_TOKEN = 'old';
    expect(() => assertDeliveryProvisioningToken('old')).not.toThrow();
  });
  test('creates independent scoped secrets and replays without rotation', async () => {
    const { tx, run } = fixture();
    const result = await run();
    const token = decryptPlatformSecret(result.encryptedToken);
    expect(result.tokenHash).toBe(hashPlatformToken(token));
    expect(result.operations).toContain('payments:allocate');
    expect(result).toMatchObject({ source: 'delivery', externalCompanyId: 'company', merchantId: 'merchant', platformId: 'platform' });
    tx.platformApiCredential.findUnique.mockResolvedValue(result);
    expect(await run()).toEqual(result);
    expect(tx.platformApiCredential.create).toHaveBeenCalledTimes(1);
    expect(deliveryAccessResult(result, { id: 'platform', tag: 'SHOP' }, { id: 'merchant' }).credentials.accessToken).toBe(token);
    expect(decryptPlatformSecret(result.encryptedWebhookSecret)).not.toBe(token);
  });
  test('rejects disabled, foreign and differently scoped existing credentials', async () => {
    for (const change of [{ isActive: false }, { source: 'other' }, { merchantId: 'other' }, { platformId: 'other' }]) {
      const { tx, run } = fixture({ isActive: true, source: 'delivery', platformId: 'platform', merchantId: 'merchant', ...change });
      await expect(run()).rejects.toMatchObject({ status: 409 });
      expect(tx.platformApiCredential.create).not.toHaveBeenCalled();
    }
  });
  test('no global acquiring fallback when explicit profile is unavailable', async () => {
    const { tx, run } = fixture();
    tx.paymentIntegrationProfile.findUnique.mockResolvedValue(null as never);
    await expect(run()).rejects.toMatchObject({ status: 422 });
    expect(tx.platformApiCredential.create).not.toHaveBeenCalled();
  });
});

test('bootstrap never switches an existing acquiring account to the central profile', async () => {
 const { tx, run } = fixture();
 tx.platformIntegration.findUnique.mockResolvedValue({ encryptedValue: encryptPlatformSecret('different-account') } as never);
 await expect(run()).rejects.toMatchObject({ status: 409 });
 expect(tx.platformApiCredential.create).not.toHaveBeenCalled();
 expect(tx.platformIntegration.upsert).not.toHaveBeenCalled();
});
