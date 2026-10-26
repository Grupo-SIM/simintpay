import { describe, expect, it, mock } from 'bun:test';
import type { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { ApiDomClient } from './api-dom.client';

const input = {
  amount: 25, description: 'Mensalidade', customerName: 'Cliente Teste',
  customerEmail: 'cliente@example.com', customerDocument: '123.456.789-00',
  customerPhone: '(11) 99999-9999', documentType: 'CPF' as const,
  codExternal: 'boleto-test', expireDays: 3,
  address: { street: 'Rua das Flores', number: '123', neighborhood: 'Centro',
    zipCode: '01001-000', city: 'São Paulo', uf: 'sp' },
};

function setup(dueDate?: string) {
  const post = mock(() => of({ data: { data: {
    id: 'boleto-test', status: 'waiting', boleto_url: 'https://example.com/boleto',
    ...(dueDate ? { boleto_due_date: dueDate } : {}),
  } } }));
  return { post, client: new ApiDomClient({ post } as unknown as HttpService) };
}

function requestBody(post: ReturnType<typeof setup>['post']) {
  return (post.mock.calls[0] as unknown as [string, {
    items: unknown; customer: { address: { zip_code: string; uf: string } };
    payment: { boleto: Record<string, number> };
  }])[1];
}

describe('DOM boleto charge', () => {
  it('sends an item array and normalized address with configured due days', async () => {
    const { client, post } = setup();
    const result = await client.chargeBoletoForLink('test-token', input);
    const body = requestBody(post);
    expect(body.items).toEqual([{ description: 'Mensalidade', price: 25, quantity: 1 }]);
    expect(body.payment.boleto).toEqual({ boleto_due_days: 3 });
    expect(body.customer.address.zip_code).toBe('01001000');
    expect(body.customer.address.uf).toBe('SP');
    expect(result.boletoUrl).toBe('https://example.com/boleto');
    expect(result.dueDate).not.toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not silently replace no configured deadline with three days', async () => {
    const { client, post } = setup();
    const result = await client.chargeBoletoForLink('test-token', { ...input, expireDays: 0 });
    expect(requestBody(post).payment.boleto).toEqual({});
    expect(result.dueDate).toBeNull();
  });

  it('preserves a gateway due date even without a configured deadline', async () => {
    const { client } = setup('2026-12-01');
    const result = await client.chargeBoletoForLink('test-token', { ...input, expireDays: 0 });
    expect(result.dueDate).toBe('2026-12-01');
  });
});
