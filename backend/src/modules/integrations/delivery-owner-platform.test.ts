import { afterEach, describe, expect, mock, test } from 'bun:test';
import { ensureDeliveryOwnerPlatform } from './delivery-owner-platform';
import {
  decryptPlatformSecret,
  hashPlatformToken,
} from '../platform-integrations/platform-secrets';

const savedKey = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
afterEach(() => {
  if (savedKey === undefined) delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
  else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = savedKey;
});
const active = {
  id: 'platform',
  ownerUserId: 'user',
  isActive: true,
  owner: { isActive: true, isPurged: false },
};
function fixture(
  bindings: any[] = [],
  platform: any = null,
  binding: any = null,
  name = 'Shop',
) {
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  const tx = {
    deliveryPlatformRegistration: {
      upsert: mock(async () => ({
        id: 'reservation',
        integrationKey: 'sim-delivery_shop',
        platformId: null,
      })),
      update: mock(async () => ({})),
    },
    platformIntegration: {
      findMany: mock(async () => bindings),
      findUnique: mock(async () => binding),
      upsert: mock(async () => ({})),
    },
    platform: {
      findMany: mock(async () => [] as any[]),
      findUnique: mock(async () => platform),
      create: mock(async ({ data }: any) => ({ ...data })),
    },
  };
  return {
    tx,
    run: () =>
      ensureDeliveryOwnerPlatform(
        tx as never,
        'sim-delivery_shop',
        'company',
        'user',
        name,
      ),
  };
}

describe('Delivery owner platform', () => {
  test('creates an owned platform with name-based tag, binding and separate encrypted credentials', async () => {
    const { tx, run } = fixture();
    await run();
    const data = tx.platform.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      id: 'reservation',
      tag: 'SHOP',
      ownerUserId: 'user',
      name: 'Shop',
      isActive: true,
    });
    const rows = data.integrations.create;
    expect(rows).toContainEqual({
      key: 'LEGACY_MERCHANT_KEYS',
      url: 'sim-delivery_shop',
    });
    expect(tx.deliveryPlatformRegistration.update).toHaveBeenCalledWith({
      where: { id: 'reservation' },
      data: { platformId: 'reservation' },
    });
    const credential = rows.find((r: any) => r.key === 'INBOUND_TOKEN');
    const token = decryptPlatformSecret(credential.encryptedValue);
    expect(credential.tokenHash).toBe(hashPlatformToken(token));
    const webhook = decryptPlatformSecret(
      rows.find((r: any) => r.key === 'WEBHOOK_SECRET').encryptedValue,
    );
    expect(webhook).not.toBe(token);
    expect(
      rows.find((r: any) => r.key === 'INBOUND_OPERATIONS').url.split(','),
    ).toEqual([
      'payments:create',
      'payments:read',
      'finance:read',
      'finance:withdraw',
      'merchants:manage',
      'sync:run',
    ]);
  });
  test('preserves an explicit active platform and all existing keys and credentials', async () => {
    const { tx, run } = fixture([
      { url: 'other, sim-delivery_shop', platform: active },
    ]);
    expect(await run()).toEqual(active);
    expect(tx.platform.create).not.toHaveBeenCalled();
    expect(tx.platformIntegration.upsert).not.toHaveBeenCalled();
  });
  test('rejects ambiguous or disabled associations instead of creating a replacement', async () => {
    for (const bindings of [
      [
        { url: 'sim-delivery_shop', platform: active },
        { url: 'sim-delivery_shop', platform: active },
      ],
      ...[
        { ...active, isActive: false },
        { ...active, owner: { isActive: false, isPurged: false } },
        { ...active, owner: { isActive: true, isPurged: true } },
      ].map((platform) => [{ url: 'sim-delivery_shop', platform }]),
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
      where: {
        platformId_key: { platformId: 'platform', key: 'LEGACY_MERCHANT_KEYS' },
      },
      create: {
        platformId: 'platform',
        key: 'LEGACY_MERCHANT_KEYS',
        url: 'sim-delivery_shop',
      },
      update: { url: 'sim-delivery_shop' },
    });
  });
  test('never claims a foreign, inactive or differently bound platform', async () => {
    for (const [platform, binding] of [
      [{ ...active, ownerUserId: 'another' }, null],
      [{ ...active, isActive: false }, null],
      [active, { url: 'other' }],
    ]) {
      const { tx, run } = fixture([], platform, binding);
      await expect(run()).rejects.toMatchObject({ status: 409 });
      expect(tx.platformIntegration.upsert).not.toHaveBeenCalled();
    }
  });
  test('rejects replacing a reservation already completed under another platform', async () => {
    const { tx, run } = fixture([
      { url: 'sim-delivery_shop', platform: active },
    ]);
    tx.deliveryPlatformRegistration.upsert.mockResolvedValue({
      id: 'reservation',
      integrationKey: 'sim-delivery_shop',
      platformId: 'foreign',
    } as never);
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

test('legacy merchant retains its unique owned platform and original tenant history', async () => {
  const { tx, run } = fixture();
  tx.platform.findMany.mockResolvedValue([
    { ...active, id: 'historical', tag: 'ZERO-GRAU' },
  ]);
  expect(await run()).toMatchObject({ id: 'historical', tag: 'ZERO-GRAU' });
  expect(tx.platform.create).not.toHaveBeenCalled();
  expect(tx.platformIntegration.upsert.mock.calls[0][0]).toMatchObject({
    create: {
      platformId: 'historical',
      key: 'LEGACY_MERCHANT_KEYS',
      url: 'sim-delivery_shop',
    },
  });
  expect(tx.deliveryPlatformRegistration.update).toHaveBeenCalledWith({
    where: { id: 'reservation' },
    data: { platformId: 'historical' },
  });
});
test('historical platform ambiguity or inactive ownership never creates a duplicate', async () => {
  for (const owned of [
    [active, { ...active, id: 'second' }],
    [{ ...active, isActive: false }],
    [{ ...active, owner: { isActive: false, isPurged: false } }],
    [{ ...active, owner: { isActive: true, isPurged: true } }],
  ]) {
    const { tx, run } = fixture();
    tx.platform.findMany.mockResolvedValue(owned);
    await expect(run()).rejects.toMatchObject({ status: 409 });
    expect(tx.platform.create).not.toHaveBeenCalled();
    expect(tx.platformIntegration.upsert).not.toHaveBeenCalled();
  }
});
test('historical platform bound to another company is never claimed', async () => {
  const { tx, run } = fixture([], null, {
    url: 'sim-delivery_another-company',
  });
  tx.platform.findMany.mockResolvedValue([active]);
  await expect(run()).rejects.toMatchObject({ status: 409 });
  expect(tx.platform.create).not.toHaveBeenCalled();
  expect(tx.platformIntegration.upsert).not.toHaveBeenCalled();
});

test('normalizes platform names without accents, repeated separators or edge hyphens', async () => {
  for (const [name, tag] of [
    ['Zero Grau', 'ZERO-GRAU'],
    ['  Açúcar   & Café!  ', 'ACUCAR-CAFE'],
    ['Zero-Grau', 'ZERO-GRAU'],
  ]) {
    const { tx, run } = fixture([], null, null, name);
    await run();
    expect(tx.platform.findUnique).toHaveBeenCalledWith({ where: { tag } });
    expect(tx.platform.create.mock.calls[0][0].data).toMatchObject({
      name,
      tag,
    });
  }
});
test('rejects a name without letters or numbers before creating a platform', async () => {
  const { tx, run } = fixture([], null, null, ' --- ');
  await expect(run()).rejects.toMatchObject({ status: 400 });
  expect(tx.platform.create).not.toHaveBeenCalled();
});
test('rejects normalized name collision with another owner', async () => {
  const { tx, run } = fixture(
    [],
    { ...active, tag: 'ZERO-GRAU', ownerUserId: 'another' },
    null,
    'Zero Gráu',
  );
  await expect(run()).rejects.toMatchObject({ status: 409 });
  expect(tx.platform.create).not.toHaveBeenCalled();
  expect(tx.platformIntegration.upsert).not.toHaveBeenCalled();
});
