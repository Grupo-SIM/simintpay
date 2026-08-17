import { SubscriptionController } from './subscription.controller';

describe('SubscriptionController', () => {
  it('aceita SIGNATURE-CREATED usando data.id como identificador da assinatura', async () => {
    const billing = {
      getDomWebhookToken: jest.fn().mockResolvedValue('dom-token'),
      applyWorkspacePaymentEvent: jest.fn(),
    };
    const subscriptionWebhook = { handleWebhook: jest.fn().mockResolvedValue(undefined) };
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ id: 'subscription-1' }) };
    const controller = new SubscriptionController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      subscriptionWebhook as any,
      {} as any,
      billing as any,
      jwt as any,
    );

    await expect(controller.handleSubscriptionWebhook({
      event: 'SIGNATURE-CREATED',
      signature: 'signed-by-dom',
      data: { id: 'subscription-1' },
    })).resolves.toEqual({ status: 'ok' });

    expect(billing.getDomWebhookToken).toHaveBeenCalledWith('subscription-1');
    expect(jwt.verifyAsync).toHaveBeenCalledWith('signed-by-dom', {
      secret: 'dom-token',
      algorithms: ['HS256'],
    });
    expect(subscriptionWebhook.handleWebhook).toHaveBeenCalledTimes(1);
  });
});
