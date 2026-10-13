import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { RenovadaWebhookService } from './renovada-webhook.service';
import { initializePlatformRegistryCache } from '../../module.registry';
import { initializePlatformIntegrationsCache } from '../../platform-integrations/platform-integrations.store';

describe('registered terminal routing', () => {
  beforeEach(async () => {
    await initializePlatformRegistryCache({ platform: { findMany: async () => [] } } as never);
    await initializePlatformIntegrationsCache({ platformIntegration: { findMany: async () => [] } } as never);
  });
  test('rejects unknown serial before touching financial records', async () => {
    const findFirst = mock();
    const service = new RenovadaWebhookService({ transaction: { findFirst } } as never, {} as never);
    await expect((service as any).handleMachineSync({ data: { id: 'payment', status: 'paid' } }, 'UNKNOWN')).rejects.toThrow('Terminal sem plataforma/dono cadastrado');
    expect(findFirst).not.toHaveBeenCalled();
  });
  test('configured serial maps to explicit owner', async () => {
    await initializePlatformRegistryCache({ platform: { findMany: async () => [{ tag: 'BOSQUE', ownerUserId: 'shared-owner' }, { tag: 'RENOVADA', ownerUserId: 'shared-owner' }] } } as never);
    await initializePlatformIntegrationsCache({ platformIntegration: { findMany: async () => [{ platform: { tag: 'BOSQUE' }, key: 'MACHINE_SERIALS', url: ' SERIAL-1, SERIAL-2 ' }] } } as never);
    const service = new RenovadaWebhookService({} as never, {} as never);
    expect((service as any).MACHINE_CONFIG).toEqual({ 'SERIAL-1': 'shared-owner', 'SERIAL-2': 'shared-owner' });
  });
});
