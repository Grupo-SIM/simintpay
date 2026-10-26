import { SalePushService, validateSubscription } from './sale-push.service';
const sendNotification = jest.fn();
jest.mock('web-push', () => ({ sendNotification: (...args: unknown[]) => sendNotification(...args) }));

describe('SalePushService', () => {
  const execute = jest.fn().mockResolvedValue(1);
  const query = jest.fn().mockResolvedValue([{ id: "delivery" }]);
  const prisma = { $executeRaw: execute, $queryRaw: query };
  const service = new SalePushService(prisma as never);
  const delivery = { id: 'delivery', subscriptionId: 'device', transactionId: 'sale', amount: '14.99', endpoint: 'https://fcm.googleapis.com/fcm/send/device', p256dh: 'a'.repeat(87), auth: 'a'.repeat(22), attempts: 2 };
  beforeEach(() => { jest.clearAllMocks(); query.mockResolvedValue([{ id: "delivery" }]); });
  it('accepts browser subscription and blocks private/untrusted providers', () => {
    const subscription = { endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } };
    expect(() => validateSubscription(subscription)).not.toThrow();
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://fcm.googleapis.com.evil.com/x', 'https://fcm.googleapis.com:8080/x']) {
      expect(() => validateSubscription({ ...subscription, endpoint })).toThrow();
    }
    expect(() => validateSubscription({ ...subscription, keys: { ...subscription.keys, auth: '' } })).toThrow();
  });
  it('skips devices removed or reassigned while a batch waits', async () => {
    query.mockResolvedValue([]);
    await service.deliver(delivery);
    expect(sendNotification).not.toHaveBeenCalled();
  });
  it('sends only sale ID and amount, marks delivery sent', async () => {
    sendNotification.mockResolvedValue({});
    await service.deliver(delivery);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toEqual({ saleId: 'sale', amount: 14.99 });
    expect(execute.mock.calls[0][0].join('')).toContain("status = 'SENT'");
  });
  it.each([404, 410])('removes expired subscription HTTP %s', async statusCode => {
    sendNotification.mockRejectedValue({ statusCode });
    await expect(service.deliver(delivery)).resolves.toBeUndefined();
    expect(execute.mock.calls[0][0].join('')).toContain('DELETE FROM "PushSubscription"');
  });
  it('retries temporary failures with backoff without exposing provider errors', async () => {
    sendNotification.mockRejectedValue(new Error('private provider response'));
    await expect(service.deliver(delivery)).resolves.toBeUndefined();
    expect(execute.mock.calls[0][1].getTime()).toBeGreaterThan(Date.now() + 110000);
    expect(execute.mock.calls[0][2]).toBe('Falha temporária no provedor');
  });
});
