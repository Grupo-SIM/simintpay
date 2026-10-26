import { afterEach, describe, expect, mock, test } from 'bun:test';

let connected = true;
const setups: Array<(channel: unknown) => Promise<void>> = [];
const send = mock(async (..._args: unknown[]) => undefined);
const close = mock(async () => undefined);
mock.module('amqp-connection-manager', () => ({
  connect: () => ({
    on: () => undefined,
    isConnected: () => connected,
    createChannel: (options: { setup?: (channel: unknown) => Promise<void> }) => {
      if (options.setup) setups.push(options.setup);
      return { addSetup: async () => undefined, sendToQueue: send, close };
    },
    close,
  }),
}));
const { RabbitMqService } = await import('./rabbitmq.service');

afterEach(() => { connected = true; setups.length = 0; send.mockClear(); });

async function consumer(handler: (payload: unknown) => Promise<void>) {
  const service = new RabbitMqService();
  service.register('test-webhooks', handler);
  let receive!: (message: unknown) => Promise<void>;
  const channel = {
    assertQueue: mock(async () => undefined),
    prefetch: mock(async () => undefined),
    consume: mock(async (_queue: string, callback: typeof receive) => { receive = callback; }),
    ack: mock(() => undefined),
    nack: mock(() => undefined),
  };
  await setups[0](channel);
  return { service, channel, receive };
}
const message = (attempts = 0) => ({ content: Buffer.from('{"paymentId":"payment-1"}'), properties: { headers: { 'x-attempts': attempts } } });

describe('durable webhook queues', () => {
  test('publishes persistent messages and waits for broker confirmation', async () => {
    const service = new RabbitMqService();
    await service.publish('test-webhooks', { paymentId: 'payment-1' });
    expect(send.mock.calls[0]).toEqual(['test-webhooks', Buffer.from('{"paymentId":"payment-1"}'), { persistent: true, timeout: 10_000 }]);
    await service.onModuleDestroy();
  });

  test('acknowledges only after successful handling and restores consumer setup', async () => {
    const handler = mock(async () => undefined);
    const { service, channel, receive } = await consumer(handler);
    const msg = message();
    await receive(msg);
    expect(handler).toHaveBeenCalledWith({ paymentId: 'payment-1' });
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.prefetch).toHaveBeenCalledWith(1);
    await setups[0](channel);
    expect(channel.consume).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
  });

  test('retries failures and retains exhausted messages in failure queue', async () => {
    const { service, channel, receive } = await consumer(async () => { throw new Error('temporary failure'); });
    await receive(message());
    expect(send.mock.calls[0][0]).toBe('test-webhooks');
    await receive(message(2));
    expect(send.mock.calls[1][0]).toBe('test-webhooks.failed');
    expect(channel.ack).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
  });

  test('keeps original message when retry publication fails', async () => {
    const { service, channel, receive } = await consumer(async () => { throw new Error('handler failed'); });
    send.mockImplementationOnce(async () => { throw new Error('broker unavailable'); });
    const msg = message();
    await receive(msg);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
    await service.onModuleDestroy();
  });
});

 test('processes opted-in DOM webhook locally while disconnected', async () => {
   const service = new RabbitMqService();
   const handler = mock(async () => undefined);
   service.register('dom', handler, true);
   connected = false;
   await service.publish('dom', { id: 'paid' });
   expect(handler).toHaveBeenCalledWith({ id: 'paid' });
   expect(send).not.toHaveBeenCalled();
   await service.onModuleDestroy();
 });
 test('falls back after publish timeout and propagates local processing failure', async () => {
   const service = new RabbitMqService();
   const handler = mock(async () => { throw new Error('database unavailable'); });
   service.register('dom', handler, true);
   send.mockImplementationOnce(async () => { throw new Error('timeout'); });
   await expect(service.publish('dom', { id: 'paid' })).rejects.toThrow('database unavailable');
   expect(handler).toHaveBeenCalledTimes(1);
   await service.onModuleDestroy();
 });

test('completes webhook locally after broker timeout', async () => {
  const service = new RabbitMqService();
  const handler = mock(async () => undefined);
  service.register('dom', handler, true);
  send.mockImplementationOnce(async () => { throw new Error('timeout'); });
  await service.publish('dom', { id: 'paid' });
  expect(handler).toHaveBeenCalledWith({ id: 'paid' });
  await service.onModuleDestroy();
});
