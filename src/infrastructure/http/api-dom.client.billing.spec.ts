import { HttpService } from '@nestjs/axios';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { of } from 'rxjs';
import { ApiDomClient } from './api-dom.client';

describe('ApiDomClient billing', () => {
  const subscription = {
    id: 'sub-old',
    status: 'active',
    plan_id: 'plan-old',
    customer_id: 'customer-1',
    auto_recurring: {
      value: 300,
      frequency_type: 'MONTH',
      frequency: 1,
    },
    card: { token: 'wallet-token' },
    next_date_invoice: '2026-09-01',
  };

  function build() {
    const http = {
      get: jest.fn().mockReturnValue(of({ data: subscription })),
      post: jest.fn(),
    } as unknown as HttpService;
    return { http, client: new ApiDomClient(http) };
  }

  it('extrai valor, período e token da assinatura', async () => {
    const { client } = build();
    await expect(
      client.getSubscriptionBillingSnapshot('token', 'sub-old'),
    ).resolves.toEqual({
      id: 'sub-old',
      status: 'active',
      planId: 'plan-old',
      customerId: 'customer-1',
      cardToken: 'wallet-token',
      recurringAmount: 300,
      frequencyType: 'MONTH',
      frequency: 1,
      nextInvoiceAt: '2026-09-01',
    });
  });

  it('cobra o token salvo com idempotência', async () => {
    const { client, http } = build();
    (http.post as jest.Mock).mockReturnValue(
      of({
        data: { id: 'payment-1', status: 'paid', liquid_amount: 3100 },
      }),
    );

    const result = await client.chargeSubscriptionPaymentMethod('token', {
      subscriptionId: 'sub-old',
      amount: 31.94,
      description: 'Ajuste proporcional',
      codExternal: 'change-1',
      idempotencyKey: 'change-1',
      postbackUrl: 'https://example.com/webhook/master',
    });

    expect(result).toEqual({
      id: 'payment-1',
      status: 'paid',
      amount: 31.94,
      netAmount: 31,
    });
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining('/transactions'),
      expect.objectContaining({
        payment: expect.objectContaining({
          total: 31.94,
          credit_card: expect.objectContaining({
            token: 'wallet-token',
            upsell: true,
          }),
        }),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Idempotency-Key': 'change-1' }),
      }),
    );
  });

  it('migra para um plano e retorna o novo id da assinatura', async () => {
    const { client, http } = build();
    (http.post as jest.Mock).mockReturnValue(
      of({
        data: { id: 'sub-new', status: 'active' },
      }),
    );

    await expect(
      client.changeSubscriptionPlan('token', {
        subscriptionId: 'sub-old',
        planId: 'plan-new',
      }),
    ).resolves.toEqual({
      subscriptionId: 'sub-new',
      planId: 'plan-new',
      status: 'active',
    });
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining('/recurrence/subscriptions/sub-old/change-plan'),
      { plan_id: 'plan-new' },
      expect.any(Object),
    );
  });
});
