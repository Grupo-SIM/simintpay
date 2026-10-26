import { afterEach } from 'bun:test';
import { initializePlatformTaxasCache } from '../src/modules/platform-taxas/platform-taxas.store';
import { initializePlatformRegistryCache } from '../src/modules/module.registry';
import { initializePlatformIntegrationsCache } from '../src/modules/platform-integrations/platform-integrations.store';

// Standalone tests must not refresh application caches against configured external services.
await initializePlatformTaxasCache({ platformTaxaOverride: { findMany: async () => [] } } as any);
await initializePlatformRegistryCache({ platform: { findMany: async () => [] } } as any);
await initializePlatformIntegrationsCache({ platformIntegration: { findMany: async () => [] } } as any);
let unexpectedHttpRequests = 0;
globalThis.fetch = (() => {
  unexpectedHttpRequests++;
  return Promise.reject(new Error('HTTP requires an explicit test mock'));
}) as typeof fetch;
afterEach(() => {
  const count = unexpectedHttpRequests;
  unexpectedHttpRequests = 0;
  if (count) throw new Error(`${count} HTTP request(s) attempted without a test mock`);
});
