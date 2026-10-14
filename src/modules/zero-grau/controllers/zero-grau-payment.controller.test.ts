import { initializePlatformRegistryCache } from '../../module.registry';
import { initializePlatformIntegrationsCache } from '../../platform-integrations/platform-integrations.store';
import { afterEach, expect, mock, test } from 'bun:test';
import { ZeroGrauPaymentController } from './zero-grau-payment.controller';

const previousUserId = process.env.ZERO_GRAU_USER_ID;
afterEach(() => {
  if (previousUserId === undefined) delete process.env.ZERO_GRAU_USER_ID;
  else process.env.ZERO_GRAU_USER_ID = previousUserId;
});

test('legacy card status checks reconcile DOM under the Zero Grau owner', async () => {
  await initializePlatformRegistryCache({ platform: { findMany: async () => [{ tag: 'ZERO-GRAU', ownerUserId: 'legacy-seller' }] } } as never);
  await initializePlatformIntegrationsCache({ platformIntegration: { findMany: async () => [] } } as never);
  const reconcilePayment = mock(async (..._args: unknown[]) => ({ paymentId: 'dom-card', status: 'COMPLETED' }));
  const controller = new ZeroGrauPaymentController({ checkStatus: (id: string) => reconcilePayment(id, 'legacy-seller') } as never, {} as never);
  expect(await controller.checkStatus('dom-card')).toEqual({ paymentId: 'dom-card', status: 'COMPLETED' });
  expect(reconcilePayment.mock.calls[0]?.slice(0, 2)).toEqual(['dom-card', 'legacy-seller']);
});
