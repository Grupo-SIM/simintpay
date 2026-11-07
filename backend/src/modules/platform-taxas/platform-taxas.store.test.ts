import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  initializePlatformTaxasCache,
  readOverridesRaw,
  getPlatformTaxaEffective,
  getPlatformTaxaSource,
  patchPlatformOverrides,
} from './platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from './platform-taxas.keys';
import { initializePlatformRegistryCache } from '../module.registry';
const client = {
  user: { findMany: async () => [] },
  platformTaxaOverride: { findMany: async () => [] },
  platform: { findMany: async () => [] },
};
describe('database-only fee inheritance', () => {
  beforeEach(async () => {
    await initializePlatformTaxasCache(client as never);
  });
  afterEach(async () => {
    delete process.env.ATLAS_SAQUE_MIN;
    delete process.env.GLOBAL_SAQUE_MIN;
    await initializePlatformTaxasCache(client as never);
  });
  test('ignores env and unifies caller-specific defaults', () => {
    process.env.ATLAS_SAQUE_MIN = '0.1';
    process.env.GLOBAL_SAQUE_MIN = '0.2';
    expect(getPlatformTaxaEffective('ATLAS', 'SAQUE_MIN', 0.91)).toBe(
      PLATFORM_TAXA_DEFAULTS.SAQUE_MIN,
    );
    expect(getPlatformTaxaSource('ATLAS', 'SAQUE_MIN')).toBe('default');
  });
  test('ignores client and owner scopes and inherits only platform/global', async () => {
    await initializePlatformRegistryCache({
      platform: {
        findMany: async () => [{ tag: 'SHOP', ownerUserId: 'owner' }],
      },
    } as never);
    await initializePlatformTaxasCache({
      ...client,
      platformTaxaOverride: {
        findMany: async () => [
          { tag: 'CLIENT:MERCHANT@EXAMPLE.TEST', key: 'SAQUE_MIN', value: 1 },
          { tag: 'USER:OWNER', key: 'SAQUE_MIN', value: 2 },
          { tag: 'GLOBAL', key: 'SAQUE_MIN', value: 90 },
          { tag: 'SHOP', key: 'SAQUE_MIN', value: 0 },
        ],
      },
    } as never);
    const cache = readOverridesRaw();
    expect(cache).toEqual({
      GLOBAL: { SAQUE_MIN: 90 },
      SHOP: { SAQUE_MIN: 0 },
    });
    expect(getPlatformTaxaEffective('SHOP', 'SAQUE_MIN', 1)).toBe(0);
    expect(getPlatformTaxaSource('SHOP', 'SAQUE_MIN')).toBe('override');
    delete cache.SHOP.SAQUE_MIN;
    cache['USER:OWNER'] = { SAQUE_MIN: 3 };
    expect(getPlatformTaxaEffective('SHOP', 'SAQUE_MIN', 1)).toBe(90);
    expect(getPlatformTaxaSource('SHOP', 'SAQUE_MIN')).toBe('global');
    expect(getPlatformTaxaEffective('USER:OWNER', 'SAQUE_MIN', 1)).toBe(90);
    for (const tag of ['USER:OWNER', 'CLIENT:MERCHANT@EXAMPLE.TEST']) {
      await expect(
        patchPlatformOverrides(tag, { SAQUE_MIN: 0 }),
      ).rejects.toThrow('por plataforma');
    }
  });
  test('honors zero override then restores inheritance', () => {
    const cache = readOverridesRaw();
    cache.GLOBAL = { TAXA_SAQUE_EXTRA: 5 };
    cache.ATLAS = { TAXA_SAQUE_EXTRA: 0 };
    expect(getPlatformTaxaEffective('ATLAS', 'TAXA_SAQUE_EXTRA', 2)).toBe(0);
    delete cache.ATLAS.TAXA_SAQUE_EXTRA;
    expect(getPlatformTaxaEffective('ATLAS', 'TAXA_SAQUE_EXTRA', 2)).toBe(5);
    expect(getPlatformTaxaSource('ATLAS', 'TAXA_SAQUE_EXTRA')).toBe('global');
  });
  test('ignores persisted legacy overrides and refuses new legacy writes', async () => {
    await initializePlatformTaxasCache({
      ...client,
      platformTaxaOverride: {
        findMany: async () => [
          { tag: 'GLOBAL', key: 'LIQUIDEZ', value: 0.1 },
          { tag: 'ATLAS', key: 'LINK_COST_2X', value: 0.99 },
          { tag: 'ATLAS', key: 'MDR_CC_1X', value: 0.99 },
          { tag: 'ATLAS', key: 'TAXA_SAQUE_EXTRA', value: 0 },
        ],
      },
    } as never);
    expect(readOverridesRaw()).toEqual({ ATLAS: { TAXA_SAQUE_EXTRA: 0 } });
    for (const key of ['LIQUIDEZ', 'LINK_COST_2X', 'MDR_CC_1X'] as const) {
      expect(getPlatformTaxaEffective('ATLAS', key, 0.42)).toBe(
        PLATFORM_TAXA_DEFAULTS[key],
      );
      expect(getPlatformTaxaSource('ATLAS', key)).toBe('default');
      await expect(
        patchPlatformOverrides('ATLAS', { [key]: 0.1 }),
      ).rejects.toThrow('Taxa legada');
    }
  });
});
