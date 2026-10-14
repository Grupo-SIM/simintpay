import { describe, expect, mock, test } from 'bun:test';
import { CreatePaymentLinkUseCase } from './create-payment-link.use-case';

function fixture() {
  const create = mock(async (input: any) => ({ ...input, id: 'link', code: 'link', createdAt: new Date('2026-01-01') }));
  const register = mock(async () => { throw new Error('transport unavailable'); });
  const service = new CreatePaymentLinkUseCase({ create } as never, { createPaymentLink: register } as never,
    { findById: async () => ({ id: 'owner', email: 'owner@example.com' }) } as never);
  return { service, create, register };
}

describe('Shared payment link optional DOM registration', () => {
  test('BetAI local checkout contract survives registration failure without switching gateway', async () => {
    const previous = process.env.DOM_TOKEN;
    process.env.DOM_TOKEN = 'test-only';
    try {
      const f = fixture();
      const result = await f.service.execute({ userId: 'owner', dto: { titulo: 'Monthly', valor: 100 }, allowLocalCheckout: true });
      expect(result.data.id).toBe('link');
      expect(f.create.mock.calls[0][0]).toMatchObject({ userId: 'owner', amount: 100, domPaymentLinkId: null });
      expect(f.register).toHaveBeenCalledTimes(1);
    } finally { if (previous === undefined) delete process.env.DOM_TOKEN; else process.env.DOM_TOKEN = previous; }
  });
  test('other callers retain failure contract and cannot create an unregistered link implicitly', async () => {
    const previous = process.env.DOM_TOKEN;
    process.env.DOM_TOKEN = 'test-only';
    try {
      const f = fixture();
      await expect(f.service.execute({ userId: 'owner', dto: { titulo: 'Monthly', valor: 100 } })).rejects.toThrow('transport unavailable');
      expect(f.create).not.toHaveBeenCalled();
    } finally { if (previous === undefined) delete process.env.DOM_TOKEN; else process.env.DOM_TOKEN = previous; }
  });
});
