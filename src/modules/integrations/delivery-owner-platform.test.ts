import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { ensureDeliveryOwnerPlatform } from './delivery-owner-platform';
import { decryptPlatformSecret, hashPlatformToken } from '../platform-integrations/platform-secrets';

const savedKey = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
afterEach(() => {
  if (savedKey === undefined) delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
  else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = savedKey;
});
const active = { id: 'platform', ownerUserId: 'user', isActive: true, owner: { isActive: true, isPurged: false } };
function fixture(bindings: any[] = [], platform: any = null, binding: any = null) {
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  const tx = {
    deliveryPlatformRegistration: { upsert: mock(async () => ({ id: 'reservation', integrationKey: 'sim-delivery_shop', platformId: null })), update: mock(async () => ({})) },
    platformIntegration: {
      findMany: mock(async () => bindings), findUnique: mock(async () => binding), upsert: mock(async () => ({})),
    },
    platform: { findUnique: mock(async () => platform), create: mock(async ({ data }: any) => ({ ...data })) },
  };
  return { tx, run: () => ensureDeliveryOwnerPlatform(tx as never, 'sim-delivery_shop', 'company', 'user', 'Shop') };
}

describe('Delivery owner platform', () => {
  test('creates an owned platform with bounded stable tag, binding and separate encrypted credentials', async () => {
    const { tx, run } = fixture();
    await run();
    const data = tx.platform.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ id: 'reservation', tag: `SIM-DELIVERY-${createHash('sha256').update('company').digest('hex').slice(0, 32).toUpperCase()}`, ownerUserId: 'user', name: 'Shop', isActive: true });
    const rows = data.integrations.create;
    expect(rows).toContainEqual({ key: 'LEGACY_MERCHANT_KEYS', url: 'sim-delivery_shop' });
    expect(tx.deliveryPlatformRegistration.update).toHaveBeenCalledWith({ where: { id: 'reservation' }, data: { platformId: 'reservation' } });
    const credential = rows.find((r: any) => r.key === 'INBOUND_TOKEN');
    const token = decryptPlatformSecret(credential.encryptedValue);
    expect(credential.tokenHash).toBe(hashPlatformToken(token));
    const webhook = decryptPlatformSecret(rows.find((r: any) => r.key === 'WEBHOOK_SECRET').encryptedValue);
    expect(webhook).not.toBe(token);
    expect(rows.find((r: any) => r.key === 'INBOUND_OPERATIONS').url.split(',')).toEqual(['payments:create', 'payments:read', 'finance:read', 'finance:withdraw', 'merchants:manage', 'sync:run']);
  });
  test('preserves an explicit active platform and all existing keys and credentials', async () => {
    const { tx, run } = fixture([{ url: 'other, sim-delivery_shop', platform: active }]);
    expect(await run()).toEqual(active);
    expect(tx.platform.create).not.toHaveBeenCalled();
    expect(tx.platformIntegration.upsert).not.toHaveBeenCalled();
  });
  test('rejects ambiguous or disabled associations instead of creating a replacement', async () => {
    for (const bindings of [
      [{ url: 'sim-delivery_shop', platform: active }, { url: 'sim-delivery_shop', platform: active }],
      ...[{ ...active, isActive: false }, { ...active, owner: { isActive: false, isPurged: false } }, { ...active, owner: { isActive: true, isPurged: true } }].map(platform => [{ url: 'sim-delivery_shop', platform }]),
    ]) {
      const { tx, run } = fixture(bindings);
      await expect(run()).rejects.toMatchObject({ status: 409 });
      expect(tx.platform.create).not.toHaveBeenCalled();
    }
  });
  test('repairs missing binding on same owned platform without changing credentials', async () => {
    const { tx, run } = fixture([], active);
    expect(await run()).toEqual(active);
    expect(tx.platform.create).not.toHaveBeenCalled();
    expect(tx.platformIntegration.upsert.mock.calls[0][0]).toEqual({
      where: { platformId_key: { platformId: 'platform', key: 'LEGACY_MERCHANT_KEYS' } },
      create: { platformId: 'platform', key: 'LEGACY_MERCHANT_KEYS', url: 'sim-delivery_shop' }, update: { url: 'sim-delivery_shop' },
    });
  });
  test('never claims a foreign, inactive or differently bound platform', async () => {
    for (const [platform, binding] of [[{ ...active, ownerUserId: 'another' }, null], [{ ...active, isActive: false }, null], [active, { url: 'other' }]]) {
      const { tx, run } = fixture([], platform, binding);
      await expect(run()).rejects.toMatchObject({ status: 409 });
      expect(tx.platformIntegration.upsert).not.toHaveBeenCalled();
    }
  });
  test('rejects replacing a reservation already completed under another platform', async () => {
    const { tx, run } = fixture([{ url: 'sim-delivery_shop', platform: active }]);
    tx.deliveryPlatformRegistration.upsert.mockResolvedValue({ id: 'reservation', integrationKey: 'sim-delivery_shop', platformId: 'foreign' } as never);
    await expect(run()).rejects.toMatchObject({ status: 409 });
    expect(tx.deliveryPlatformRegistration.update).not.toHaveBeenCalled();
  });
  test('fails closed without an encryption key', async () => {
    const { tx, run } = fixture();
    delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
    await expect(run()).rejects.toThrow('PLATFORM_CONFIG_ENCRYPTION_KEY');
    expect(tx.platform.create).not.toHaveBeenCalled();
  });
});
