import { describe, expect, it, mock } from 'bun:test';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { ApiDomClient } from './api-dom.client';

describe('DOM payment link charge', () => {
  const input = {
    domLinkId: 'link-1', amount: 125.50, description: 'Compra teste',
    customerName: 'Cliente Teste', customerEmail: 'cliente@example.com',
    customerDocument: '123.456.789-00', customerPhone: '(11) 99999-9999',
    paymentMethod: 'credit_card' as const, installments: 3,
    card: { token: 'test-token', exp_month: '05', exp_year: '29', cvv: '000',
      holder_name: 'Cliente Teste', holder_document: '12345678900' },
  };

  it('uses transactions with calculated amount and token only', async () => {
    const post = mock(() => of({ data: { data: { id: 'tx-1', status: 'paid' } } }));
    const client = new ApiDomClient({ post } as unknown as HttpService);
    expect(await client.chargePaymentLink('merchant-token', input)).toEqual({
      id: 'tx-1', status: 'paid', pixContent: null,
    });
    const [url, body, options] = post.mock.calls[0] as unknown as [string, any, any];
    expect(url.endsWith('/transactions')).toBe(true);
    expect(body.payment).toEqual({ payment_method: 'credit_card', total: 125.50,
      credit_card: { token: 'test-token', installments: 3 } });
    expect(body.items).toEqual([{ description: 'Compra teste', price: 125.50, quantity: 1 }]);
    expect(body.customer.document).toBe('12345678900');
    expect(body.customer.mobile_phone).toBe('11999999999');
    expect(options.headers.Authorization).toBe('Bearer merchant-token');
    expect(JSON.stringify(body)).not.toContain('cvv');
  });

  it('forces debit to one installment', async () => {
    const post = mock(() => of({ data: { id: 'tx-2' } }));
    const client = new ApiDomClient({ post } as unknown as HttpService);
    await client.chargePaymentLink('token', { ...input, paymentMethod: 'debit_card' });
    const body = (post.mock.calls[0] as unknown as [string, any])[1];
    expect(body.payment.debit_card).toEqual({ token: 'test-token', installments: 1 });
  });

  it('does not retry failed charges', async () => {
    const error = new Error('Gateway unavailable');
    const post = mock(() => throwError(() => error));
    const client = new ApiDomClient({ post } as unknown as HttpService);
    await expect(client.chargePaymentLink('token', input)).rejects.toThrow('Gateway unavailable');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects missing token before contacting gateway', async () => {
    const post = mock();
    const client = new ApiDomClient({ post } as unknown as HttpService);
    await expect(client.chargePaymentLink('token', { ...input, card: undefined })).rejects.toThrow('Token do cartão obrigatório');
    expect(post).not.toHaveBeenCalled();
  });
});
