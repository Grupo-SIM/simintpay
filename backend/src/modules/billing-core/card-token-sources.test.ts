import { describe, expect, test } from 'bun:test';
import {
  cardTokenSourceKindFromEnv,
  firstChargeOutcome,
  parseExpiry,
} from './card-token-source';
import {
  CardTokenEndpointSource,
  CustomerTokenSource,
  SubscriptionCardTokenSource,
  extractSubscriptionCardToken,
} from './card-token-sources';

const card = {
  token: 'single-use',
  number: '4111111111111111',
  cvv: '123',
  exp_month: '12',
  exp_year: '2030',
  holder_name: 'Ana',
  holder_document: '12345678909',
};
const customer = {
  name: 'Ana',
  email: 'ana@test.dev',
  document: '12345678909',
  phone: '',
  documentType: 'CPF' as const,
};

function fakeRefs() {
  const rows: any[] = [];
  return {
    rows,
    externalIdFor: async (t: any, acquirerCode: string, kind: string) =>
      rows.find(
        (r) =>
          r.entityType === t.entityType &&
          r.entityId === t.entityId &&
          r.acquirerCode === acquirerCode &&
          r.kind === kind,
      )?.externalId ?? null,
    link: async (
      acquirerCode: string,
      kind: string,
      externalId: string,
      t: any,
    ) => {
      rows.push({ acquirerCode, kind, externalId, ...t });
    },
  } as any;
}

const base = {
  domToken: 'tok',
  acquirerCode: 'DOM',
  offer: {
    id: 'o1',
    name: 'Plano',
    intervalType: 'MONTH' as const,
    intervalCount: 1,
  },
  contractId: 'c1',
  amount: 49.9,
  description: 'd',
  domLinkId: 'link-1',
  customer,
  card,
};

describe('card token helpers', () => {
  test('first charge outcome and expiry parsing', () => {
    expect(firstChargeOutcome('active')).toBe('PAID');
    expect(firstChargeOutcome('Refused')).toBe('FAILED');
    expect(firstChargeOutcome('processing')).toBe('PENDING');
    expect(firstChargeOutcome(undefined)).toBe('PENDING');
    expect(parseExpiry('3', '30')).toEqual({ expMonth: 3, expYear: 2030 });
    expect(parseExpiry('13', '2030')).toBeNull();
  });

  test('source flag defaults to subscription', () => {
    expect(cardTokenSourceKindFromEnv(undefined)).toBe('customer-token');
    expect(cardTokenSourceKindFromEnv('nonsense')).toBe('customer-token');
    expect(cardTokenSourceKindFromEnv('subscription')).toBe('subscription');
    expect(cardTokenSourceKindFromEnv('card-token')).toBe('card-token');
  });

  test('reads card.token from the supported subscription shapes', () => {
    expect(extractSubscriptionCardToken({ card: { token: 'a' } })).toBe('a');
    expect(
      extractSubscriptionCardToken({
        payment_method: { card: { token: 'b' } },
      }),
    ).toBe('b');
    expect(extractSubscriptionCardToken({ card: {} })).toBeNull();
    expect(extractSubscriptionCardToken(null)).toBeNull();
  });
});

describe('SubscriptionCardTokenSource', () => {
  test('creates one single-repetition plan per offer and reads the token once paid', async () => {
    const refs = fakeRefs();
    const calls: any = { plan: [], sub: [], get: [] };
    const gateway: any = {
      createPlan: async (_t: string, input: any) => {
        calls.plan.push(input);
        return { id: 'plan-1' };
      },
      createSubscriptionFromCheckout: async (_t: string, input: any) => {
        calls.sub.push(input);
        return {
          id: 'sub-1',
          status: 'active',
          transaction: { id: 'dom-tx-1' },
        };
      },
      getSubscription: async (_t: string, id: string) => {
        calls.get.push(id);
        return { card: { token: 'reusable' } };
      },
    };
    const source = new SubscriptionCardTokenSource(refs);
    const out = await source.chargeFirstCycle({ ...base, gateway });
    expect(out).toEqual({
      paymentId: 'dom-tx-1',
      status: 'active',
      token: 'reusable',
    });
    expect(calls.plan[0]).toMatchObject({
      repetitions: 1,
      price: 49.9,
      frequency_type: 'MONTH',
    });
    expect(calls.sub[0].planId).toBe('plan-1');

    await source.chargeFirstCycle({ ...base, contractId: 'c2', gateway });
    expect(calls.plan).toHaveLength(1);
  });

  test('pending subscription returns no token; fetchToken reads it later', async () => {
    const refs = fakeRefs();
    let status = 'pending';
    const gateway: any = {
      createPlan: async () => ({ id: 'plan-1' }),
      createSubscriptionFromCheckout: async () => ({ id: 'sub-1', status }),
      getSubscription: async () => ({ card: { token: 'reusable' } }),
    };
    const source = new SubscriptionCardTokenSource(refs);
    const out = await source.chargeFirstCycle({ ...base, gateway });
    expect(out.token).toBeNull();
    expect(out.paymentId).toBe('sub:sub-1');
    status = 'active';
    expect(
      await source.fetchToken({
        gateway,
        domToken: 't',
        acquirerCode: 'DOM',
        contractId: 'c1',
      }),
    ).toBe('reusable');
  });
});

describe('CardTokenEndpointSource', () => {
  test('tokenizes the full card then charges the standalone token', async () => {
    const seen: any = {};
    const gateway: any = {
      createReusableCardToken: async (_t: string, input: any) => {
        seen.token = input;
        return 'reusable';
      },
      chargePaymentLink: async (_t: string, input: any) => {
        seen.charge = input;
        return { id: 'dom-pay-1', status: 'approved' };
      },
    };
    const out = await new CardTokenEndpointSource().chargeFirstCycle({
      ...base,
      gateway,
    });
    expect(out).toEqual({
      paymentId: 'dom-pay-1',
      status: 'approved',
      token: 'reusable',
    });
    expect(seen.token.card.number).toBe(card.number);
    expect(seen.charge.card.token).toBe('reusable');
    expect(seen.charge.installments).toBe(1);
  });

  test('requires gateway support', async () => {
    await expect(
      new CardTokenEndpointSource().chargeFirstCycle({
        ...base,
        gateway: {} as any,
      }),
    ).rejects.toThrow();
  });
});

describe('CustomerTokenSource', () => {
  test('charges the browser token with upsell and returns it as the reusable token', async () => {
    const calls: any[] = [];
    const gateway: any = {
      chargePaymentLink: async (_t: string, input: any) => {
        calls.push(input);
        return { id: 'dom-tx-9', status: 'pending' };
      },
    };
    const source = new CustomerTokenSource();
    const out = await source.chargeFirstCycle({
      ...base,
      gateway,
      customerId: 'cus-1',
      card: { ...card, token: 'wallet-tok', number: '', cvv: '' },
    });
    expect(out).toEqual({
      paymentId: 'dom-tx-9',
      status: 'pending',
      token: 'wallet-tok',
    });
    expect(calls[0]).toMatchObject({
      upsell: true,
      installments: 1,
      paymentMethod: 'credit_card',
      card: { token: 'wallet-tok' },
    });
    expect(JSON.stringify(calls[0])).not.toContain('4111');
  });

  test('refuses without a token or customer before any charge', async () => {
    const gateway: any = {
      chargePaymentLink: async () => {
        throw new Error('must not charge');
      },
    };
    const source = new CustomerTokenSource();
    await expect(
      source.chargeFirstCycle({
        ...base,
        gateway,
        card: { ...card, token: '' },
      }),
    ).rejects.toThrow('obrigat');
  });
});
