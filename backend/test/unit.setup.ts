import { initializePlatformTaxasCache } from '../src/modules/platform-taxas/platform-taxas.store';
import { initializePlatformRegistryCache } from '../src/modules/module.registry';
import { initializePlatformIntegrationsCache } from '../src/modules/platform-integrations/platform-integrations.store';

// Match the Bun preload: unit tests never refresh caches from a real database.
beforeAll(async () => {
  await initializePlatformTaxasCache({
    user: { findMany: async () => [] },
    platformTaxaOverride: { findMany: async () => [] },
  } as any);
  await initializePlatformRegistryCache({
    platform: { findMany: async () => [] },
  } as any);
  await initializePlatformIntegrationsCache({
    platformIntegration: { findMany: async () => [] },
  } as any);
});
