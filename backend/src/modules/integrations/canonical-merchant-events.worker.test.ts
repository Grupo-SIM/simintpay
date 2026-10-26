import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { CanonicalMerchantEventsWorker } from './canonical-merchant-events.worker';
import { encryptPlatformSecret } from '../platform-integrations/platform-secrets';
const original = { ...process.env };
afterEach(() => {
 mock.restore();
 for (const key of ['PLATFORM_CONFIG_ENCRYPTION_KEY','SIM_DELIVERY_CANONICAL_WEBHOOK_URL']) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
});
function fixture() {
 process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
 process.env.SIM_DELIVERY_CANONICAL_WEBHOOK_URL = 'https://delivery.example/integrations/simintpay';
 const platform = { id: 'platform', tag: 'SHOP', isActive: true, owner: { isActive: true, isPurged: false } };
 const credential = { id: 'credential', platformId: 'platform', merchantId: 'merchant', externalCompanyId: 'company', isActive: true, encryptedWebhookSecret: encryptPlatformSecret('company-secret'), profile: { isActive: true }, platform };
 const payload = { eventId: 'event', platformId: 'platform', externalMerchantId: 'company', kind: 'payment.updated', status: 'COMPLETED' };
 const events: any[] = [];
 const p = {
  platformApiCredential: { findMany: async () => [credential] },
  integrationMerchant: { findUnique: async () => ({ id: 'merchant', userId: 'seller', integrationKey: 'platform:platform', user: { isActive: true, isPurged: false } }) },
  transaction: { findMany: mock(async () => [{ id: 'transaction', status: 'COMPLETED', updatedAt: new Date(), externalPaymentId: 'gateway', tracking: { delivery: { idempotencyKey: 'attempt' } }, statusHistory: [] }]) },
  withdrawRequest: { findMany: async () => [] },
  canonicalMerchantEvent: {
   upsert: mock(async ({ create }: any) => { events.push(create); return create; }),
   findMany: async () => [{ id: 'outbox', attempts: 0, payload, credential }],
   updateMany: mock(async () => ({ count: 1 })),
   update: mock(async (_q: any) => ({})),
  },
 };
 return { p, credential, events, payload, worker: new CanonicalMerchantEventsWorker(p as never) };
}
test('capture uses merchant beneficiary instead of platform owner and immutable credential attribution', async () => {
 const f = fixture();
 await f.worker.capture();
 expect(f.p.transaction.findMany).toHaveBeenCalledWith({ where: { userId: 'seller', tracking: { path: ['delivery', 'credentialId'], equals: 'credential' } }, include: { statusHistory: { orderBy: { createdAt: 'asc' } } }, orderBy: { id: 'asc' }, take: 100 });
 expect(f.events[0].payload).toMatchObject({ requestId: 'attempt', externalMerchantId: 'company', platformId: 'platform', transactionId: 'transaction', paymentId: 'gateway' });
});
test('durable dispatch leases event and signs the exact bytes with company secret', async () => {
 const f = fixture(); const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
 await f.worker.deliver();
 const [url, options] = fetch.mock.calls[0];
 expect(String(url)).toBe('https://delivery.example/integrations/simintpay/company/events');
 expect(options?.headers).toHaveProperty('x-simintpay-signature', createHmac('sha256', 'company-secret').update(String(options?.body)).digest('hex'));
 expect(f.p.canonicalMerchantEvent.updateMany).toHaveBeenCalledTimes(1);
 expect(f.p.canonicalMerchantEvent.update.mock.calls[0][0]).toMatchObject({ where: { id: 'outbox' }, data: { attempts: { increment: 1 }, lastError: null } });
});
test('failed delivery remains queued; inactive credential never dispatches', async () => {
 const f = fixture(); const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
 await f.worker.deliver();
 expect(f.p.canonicalMerchantEvent.update.mock.calls[0][0]).toMatchObject({ data: { lastError: 'Webhook delivery failed', attempts: { increment: 1 } } });
 f.credential.isActive = false;
 fetch.mockClear();
 await f.worker.deliver(); expect(fetch).not.toHaveBeenCalled();
});
test('lost lease prevents concurrent duplicate dispatch', async () => {
 const f = fixture(); f.p.canonicalMerchantEvent.updateMany.mockResolvedValue({ count: 0 });
 const fetch = spyOn(globalThis, 'fetch');
 await f.worker.deliver(); expect(fetch).not.toHaveBeenCalled();
});
