import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { initializePlatformTaxasCache, readOverridesRaw, getPlatformTaxaEffective, getPlatformTaxaSource } from './platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from './platform-taxas.keys';
const client = { platformTaxaOverride: { findMany: async () => [] }, platform: { findMany: async () => [] } };
describe('database-only fee inheritance', () => {
  beforeEach(async () => { await initializePlatformTaxasCache(client as never); });
  afterEach(async () => { delete process.env.ATLAS_LIQUIDEZ; delete process.env.GLOBAL_LIQUIDEZ; await initializePlatformTaxasCache(client as never); });
  test('ignores env and unifies caller-specific defaults', () => {
    process.env.ATLAS_LIQUIDEZ = '0.1';
    process.env.GLOBAL_LIQUIDEZ = '0.2';
    expect(getPlatformTaxaEffective('ATLAS', 'LIQUIDEZ', 0.91)).toBe(PLATFORM_TAXA_DEFAULTS.LIQUIDEZ);
    expect(getPlatformTaxaSource('ATLAS', 'LIQUIDEZ')).toBe('default');
  });
  test('honors zero override then restores inheritance', () => {
    const cache = readOverridesRaw();
    cache.GLOBAL = { TAXA_SAQUE_FIXA: 5 };
    cache.ATLAS = { TAXA_SAQUE_FIXA: 0 };
    expect(getPlatformTaxaEffective('ATLAS', 'TAXA_SAQUE_FIXA', 2)).toBe(0);
    delete cache.ATLAS.TAXA_SAQUE_FIXA;
    expect(getPlatformTaxaEffective('ATLAS', 'TAXA_SAQUE_FIXA', 2)).toBe(5);
    expect(getPlatformTaxaSource('ATLAS', 'TAXA_SAQUE_FIXA')).toBe('global');
  });
});
