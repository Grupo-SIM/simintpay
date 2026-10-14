import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { MasterWebhookController } from '../master/controllers/master-webhook.controller';
import { PagatgWebhookController } from '../pagatg/pagatg-webhook.controller';
import { RenovadaWebhookController } from '../renovada/controllers/renovada-webhook.controller';
import { RenovadaWebhookNewController } from '../renovada/controllers/renovada-webhook-new.controller';
import { WebhookController } from '../../presentation/controllers/webhook.controller';
import { PlatformCorporateController } from './platform-corporate.controller';
import { QueueNames } from '../../infrastructure/queue/queue-names';
const oldSecret = process.env.WEBHOOK_SECRET, oldInternal = process.env.API_MACHINE_INTERNAL_TOKEN;
beforeEach(() => { process.env.WEBHOOK_SECRET = 'mock-webhook'; process.env.API_MACHINE_INTERNAL_TOKEN = 'mock-internal'; });
afterEach(() => { if (oldSecret === undefined) delete process.env.WEBHOOK_SECRET; else process.env.WEBHOOK_SECRET = oldSecret; if (oldInternal === undefined) delete process.env.API_MACHINE_INTERNAL_TOKEN; else process.env.API_MACHINE_INTERNAL_TOKEN = oldInternal; });
for (const [Controller, method] of [[MasterWebhookController, 'handle'], [PagatgWebhookController, 'domWebhook'], [PagatgWebhookController, 'webhook'], [RenovadaWebhookController, 'handle'], [RenovadaWebhookNewController, 'domWebhook'], [RenovadaWebhookNewController, 'webhook']] as const) {
  test(`${Controller.name}.${method} preserves raw DOM queue contract and acknowledgments`, async () => {
    const queue = { publish: mock(async (_name: unknown, _body: unknown) => {}) };
    const body = { data: { id: 'payment', status: 'paid', amount: 1234, liquid_amount: 1129 }, event: 'transaction' };
    const controller = new Controller(queue as any);
    expect(await (controller as any)[method](body)).toEqual({ status: 'ok' });
    expect(queue.publish).toHaveBeenCalledWith(QueueNames.DOM_WEBHOOK_DIRECT, body);
    queue.publish.mockRejectedValue(new Error('broker unavailable'));
    await expect((controller as any)[method](body)).rejects.toThrow('broker unavailable');
  });
}
test('legacy shared webhook preserves secret and raw-body HMAC checks before shared event queue', async () => {
  const queue = { publish: mock(async () => {}) };
  const controller = new WebhookController(queue as any, {} as any);
  const body = { event: 'transaction', signature: 'event-id', data: { paymentId: 'payment', status: 'paid', amountWithoutAllFee: 11.29 } };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = createHmac('sha256', 'mock-webhook').update(rawBody).digest('hex');
  expect(await controller.handle(body, signature, 'mock-webhook', { rawBody } as any)).toEqual({ status: 'ok' });
  expect(queue.publish).toHaveBeenCalledWith(QueueNames.WEBHOOK_EVENTS, body);
  for (const args of [[signature, 'wrong', { rawBody }], ['wrong', 'mock-webhook', { rawBody }], [signature, 'mock-webhook', {}]]) {
    await expect((controller.handle as any)(body, ...args)).rejects.toMatchObject({ status: 401 });
  }
  expect(queue.publish).toHaveBeenCalledTimes(1);
});
function ebookFixture() {
  const context = { id: 'p', tag: 'EBOOK', ownerUserId: 'owner', acquirer: 'DOM' as const };
  const platform = { ...context, isActive: true, owner: { isActive: true }, integrations: [{ key: 'BACKEND_URL', url: 'https://mock-ebook.invalid/' }, { key: 'INTERNAL_TOKEN', url: 'mock-internal' }] };
  const p: any = { platform: { findUnique: async () => platform } };
  return { context, platform, legacy: new WebhookController({} as any, p), canonical: new PlatformCorporateController({} as any, p) };
}
test('Ebook confirmation alias and canonical capability share payload, default store and downstream response', async () => {
  const { legacy, canonical, context } = ebookFixture();
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
  try {
    const body = { orderNumber: 'order', status: 'paid', email: 'client@example.com' };
    expect(await legacy.handleEbookPaymentConfirmation(body, 'mock-webhook')).toEqual(await canonical.ebookConfirmation({ platformContext: context }, body));
    expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[1]);
    expect(fetcher.mock.calls[0]).toEqual(['https://mock-ebook.invalid/webhook/payment-confirmation', { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': 'mock-internal' }, body: JSON.stringify({ ...body, store: 'ebook' }) }]);
    await expect(legacy.handleEbookPaymentConfirmation(body, 'wrong')).rejects.toMatchObject({ status: 401 });
    expect(() => canonical.ebookConfirmation({ platformContext: context }, { ...body, userId: 'other' } as any)).toThrow('Contrato inválido');
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { fetcher.mockRestore(); }
});
test('Ebook confirmation preserves validation/upstream errors and canonical configuration never falls back to legacy token', async () => {
  const { legacy, canonical, context, platform } = ebookFixture();
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('upstream error', { status: 409 }));
  try {
    await expect(legacy.handleEbookPaymentConfirmation({}, 'mock-webhook')).rejects.toThrow('orderNumber e status');
    const body = { orderNumber: 'order', status: 'paid' };
    await expect(legacy.handleEbookPaymentConfirmation(body, 'mock-webhook')).rejects.toThrow('409 upstream error');
    platform.integrations.splice(1);
    await expect(canonical.ebookConfirmation({ platformContext: context }, body)).rejects.toMatchObject({ response: { code: 'PLATFORM_CAPABILITY_UNAVAILABLE' } });
    await expect(canonical.ebookConfirmation({ platformContext: { ...context, ownerUserId: 'old' } }, body)).rejects.toThrow('alterado');
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { fetcher.mockRestore(); }
});
