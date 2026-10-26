import { notifyZeroGrauPaymentStatus } from './zero-grau-webhook-notifier';

describe('notifyZeroGrauPaymentStatus', () => {
  it('skips notification when callback configuration is absent', async () => {
    const fetcher = jest.fn();

    await expect(
      notifyZeroGrauPaymentStatus({ paymentId: 'dom-1', status: 'COMPLETED' }, {}, fetcher),
    ).resolves.toBe('skipped');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends payment id and status with the shared secret', async () => {
    const fetcher = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      notifyZeroGrauPaymentStatus(
        { paymentId: 'dom-1', status: 'COMPLETED' },
        { secret: 'shared-secret', url: 'https://delivery.example/payments/webhooks/simintpay' },
        fetcher,
      ),
    ).resolves.toBe('sent');
    expect(fetcher).toHaveBeenCalledWith('https://delivery.example/payments/webhooks/simintpay', {
      body: JSON.stringify({ paymentId: 'dom-1', status: 'COMPLETED' }),
      headers: {
        'content-type': 'application/json',
        'x-simpay-webhook-secret': 'shared-secret',
      },
      method: 'POST',
      signal: expect.any(AbortSignal),
    });
  });

  it('reports delivery failures without breaking DOM webhook processing', async () => {
    const fetcher = jest.fn().mockResolvedValue(new Response(null, { status: 500 }));

    await expect(
      notifyZeroGrauPaymentStatus(
        { paymentId: 'dom-1', status: 'COMPLETED' },
        { secret: 'shared-secret', url: 'https://delivery.example/payments/webhooks/simintpay' },
        fetcher,
      ),
    ).resolves.toBe('failed');
  });
});
