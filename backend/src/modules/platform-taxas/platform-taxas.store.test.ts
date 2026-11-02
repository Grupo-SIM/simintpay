import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  initializePlatformTaxasCache,
  readOverridesRaw,
  getPlatformTaxaEffective,
  getPlatformTaxaSource,
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
    delete process.env.ATLAS_LIQUIDEZ;
    delete process.env.GLOBAL_LIQUIDEZ;
    await initializePlatformTaxasCache(client as never);
  });
  test('ignores env and unifies caller-specific defaults', () => {
    process.env.ATLAS_LIQUIDEZ = '0.1';
    process.env.GLOBAL_LIQUIDEZ = '0.2';
    expect(getPlatformTaxaEffective('ATLAS', 'LIQUIDEZ', 0.91)).toBe(
      PLATFORM_TAXA_DEFAULTS.LIQUIDEZ,
    );
    expect(getPlatformTaxaSource('ATLAS', 'LIQUIDEZ')).toBe('default');
  });
  test('durable merchant override wins and legacy fallback preserves zero', async () => {
    await initializePlatformTaxasCache({
      user: {
        findMany: async () => [{ id: 'owner', email: 'merchant@example.test' }],
      },
      platformTaxaOverride: {
        findMany: async () => [
          { tag: 'CLIENT:MERCHANT@EXAMPLE.TEST', key: 'MDR_PIX', value: 0 },
          { tag: 'GLOBAL', key: 'MDR_PIX', value: 0.9 },
        ],
      },
    } as never);
    expect(getPlatformTaxaEffective('USER:OWNER', 'MDR_PIX', 1)).toBe(0);
    expect(getPlatformTaxaSource('USER:OWNER', 'MDR_PIX')).toBe('override');
    readOverridesRaw()['USER:OWNER'] = { MDR_PIX: 0.03 };
    expect(getPlatformTaxaEffective('USER:OWNER', 'MDR_PIX', 1)).toBe(0.03);
    expect(getPlatformTaxaEffective('USER:BUYER', 'MDR_PIX', 1)).toBe(0.9);
  });
  test('platform override then registered owner override then global', async () => {
    await initializePlatformRegistryCache({
      platform: {
        findMany: async () => [{ tag: 'SHOP', ownerUserId: 'owner' }],
      },
    } as never);
    const cache = readOverridesRaw();
    cache.GLOBAL = { MDR_PIX: 0.9 };
    cache['USER:OWNER'] = { MDR_PIX: 0 };
    expect(getPlatformTaxaEffective('SHOP', 'MDR_PIX', 1)).toBe(0);
    expect(getPlatformTaxaSource('SHOP', 'MDR_PIX')).toBe('override');
    cache.SHOP = { MDR_PIX: 0.03 };
    expect(getPlatformTaxaEffective('SHOP', 'MDR_PIX', 1)).toBe(0.03);
    delete cache.SHOP.MDR_PIX;
    delete cache['USER:OWNER'].MDR_PIX;
    expect(getPlatformTaxaEffective('SHOP', 'MDR_PIX', 1)).toBe(0.9);
    expect(getPlatformTaxaSource('SHOP', 'MDR_PIX')).toBe('global');
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
});
