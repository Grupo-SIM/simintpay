import { describe, expect, mock, test } from 'bun:test';
import { reserveDeliveryPlatform } from './delivery-platform-registration';

function fixture(saved: any = null) {
  const registrations = new Map<string, any>();
  if (saved) registrations.set(saved.externalMerchantId, saved);
  const tx = { deliveryPlatformRegistration: { upsert: mock(async ({ where, create }: any) => {
    let row = registrations.get(where.externalMerchantId);
    if (!row) { row = { id: 'reservation', ...create, platformId: null }; registrations.set(where.externalMerchantId, row); }
    return row;
  }), update: mock(async ({ where, data }: any) => {
    const row = [...registrations.values()].find(row => row.id === where.id);
    Object.assign(row, data);
    return row;
  }) } };
  return { tx, registrations, reserve: (key = 'sim-delivery_shop', id = 'company', name = 'Shop') => reserveDeliveryPlatform(tx as never, key, id, name) };
}
describe('Delivery platform reservation', () => {
  test('reserves pending platform id before owner exists; retries return same reservation', async () => {
    const { reserve, registrations } = fixture();
    const first = await reserve();
    expect(first).toMatchObject({ id: 'reservation', integrationKey: 'sim-delivery_shop', externalMerchantId: 'company', name: 'Shop', platformId: null });
    expect(await reserve()).toEqual(first);
    expect(registrations.size).toBe(1);
  });
  test('preserves reservation id when company slug changes before its first owner', async () => {
    const { reserve, registrations } = fixture();
    const first = await reserve();
    expect(await reserve('sim-delivery_renamed')).toMatchObject({ id: first.id, integrationKey: 'sim-delivery_renamed', platformId: null });
    expect(registrations.size).toBe(1);
  });
  test('preserves completed registration and rejects changes to tenant identity', async () => {
    const saved = { id: 'reservation', externalMerchantId: 'company', integrationKey: 'sim-delivery_shop', platformId: 'platform' };
    const { reserve } = fixture(saved);
    expect(await reserve()).toEqual(saved);
    await expect(reserve('sim-delivery_other')).rejects.toMatchObject({ status: 409 });
  });
  test('rejects invalid namespace, empty company id and empty name before writing', async () => {
    const { reserve, tx } = fixture();
    for (const args of [['other', 'company', 'Shop'], ['sim-delivery_', 'company', 'Shop'], ['sim-delivery_shop', ' ', 'Shop'], ['sim-delivery_shop', 'company', ' ']]) {
      await expect(reserve(...args as [string, string, string])).rejects.toMatchObject({ status: 400 });
    }
    expect(tx.deliveryPlatformRegistration.upsert).not.toHaveBeenCalled();
  });
});
