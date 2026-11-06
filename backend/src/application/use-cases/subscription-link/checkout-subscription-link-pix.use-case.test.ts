import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { CheckoutSubscriptionLinkPixUseCase } from './checkout-subscription-link-pix.use-case';
import {
  makeFakePrisma,
  useEmptyCaches,
  withAreaflixPlatform,
  type FixtureOptions,
} from '../payment-link/charge-characterization.fixture';

/**
 * CHARACTERIZATION of CheckoutSubscriptionLinkPixUseCase.
 * This flow never writes a Transaction: money lands on SubscriptionLinkOrder (amountCharged,
 * platformFeeAmount, financialSnapshot). Vendor net is not stored, only the platform fee.
 */
const oldToken = process.env.DOM_TOKEN;
beforeAll(useEmptyCaches);
beforeEach(() => {
  process.env.DOM_TOKEN = 'test-token';
});
afterEach(() => {
  if (oldToken === undefined) delete process.env.DOM_TOKEN;
  else process.env.DOM_TOKEN = oldToken;
});

function makeSub(over: Record<string, unknown> = {}): any {
  return {
    id: 'sub',
    userId: 'owner',
    isActive: true,
    name: 'Sub plan',
    amount: 100,
    domPlanId: 'dom-plan',
    frequencyType: 'MENSAL',
    isStandalone: false,
    platformTag: null,
    plataformas: ['GLOBAL'],
    maxUses: null,
    currentUses: 0,
    webhookUrl: null,
    redirectUrl: null,
    ...over,
  };
}

function setup(
  link: any = makeSub(),
  opts: FixtureOptions & {
    voucher?: { valid: boolean; finalAmount: number } | null;
    community?: any;
    gatewayFails?: boolean;
  } = {},
) {
  const db = makeFakePrisma(opts);
  const calls: { token: string; input: any }[] = [];
  const orders: any[] = [];
  const repoUpdates: any[] = [];
  const pending: any[] = [];
  const plans: any[] = [];
  const gateway: any = {
    createPlan: async (_t: string, data: any) => {
      plans.push(data);
      return { id: 'new-plan' };
    },
    chargePixForLink: async (token: string, input: any) => {
      calls.push({ token, input });
      if (opts.gatewayFails) throw new Error('gateway down');
      return {
        id: 'dom-pix-1',
        pixContent: 'copy',
        qrCode: 'qr',
        pixExpire: '2030-01-01T00:00:00.000Z',
      };
    },
  };
  const service = new CheckoutSubscriptionLinkPixUseCase(
    {
      findByCode: async () => link,
      update: async (id: string, data: any) => {
        repoUpdates.push({ id, data });
      },
      createOrder: async (data: any) => {
        orders.push(data);
        return { id: 'order-1', status: 'pending' };
      },
    } as never,
    { findById: async () => ({ id: 'owner' }) } as never,
    gateway,
    {
      findBoundCommunityForSubscriptionLink: async () => opts.community ?? null,
      registerPendingPix: async (a: any) => pending.push(a),
    } as never,
    {
      validateVoucher: async () =>
        opts.voucher === undefined ? null : opts.voucher,
    } as never,
    db.prisma,
  );
  const dto: any = {
    customerName: 'Buyer',
    customerEmail: 'buyer@example.test',
    customerDocument: '123.456.789-01',
    customerPhone: '(81) 99999-9999',
  };
  return { service, dto, db, calls, orders, repoUpdates, pending, plans };
}

describe('legacy fees (financialQuote absent)', () => {
  test('non-standalone: buyer pays base, platform fee = MDR_PIX 0.98% rounded to cents', async () => {
    const f = setup();
    const out = await f.service.execute({ code: 'c', dto: f.dto });
    expect(out.amount).toBe(100);
    expect(f.calls[0].input.amount).toBe(100);
    expect(f.orders).toHaveLength(1);
    expect(f.orders[0]).toMatchObject({
      subscriptionLinkId: 'sub',
      userId: 'owner',
      paymentMethod: 'PIX',
      status: 'pending',
      amountCharged: 100,
      platformFeeAmount: 0.98,
      customerDocument: '12345678901',
      customerPhone: '81999999999',
    });
    expect(f.orders[0]).not.toHaveProperty('financialSnapshot');
  });

  test('standalone link: no platform fee at all', async () => {
    const f = setup(makeSub({ isStandalone: true }));
    await f.service.execute({ code: 'c', dto: f.dto });
    expect(f.orders[0].platformFeeAmount).toBe(0);
    expect(f.orders[0].amountCharged).toBe(100);
  });

  test('no Transaction, wallet or balance log is written', async () => {
    const f = setup();
    await f.service.execute({ code: 'c', dto: f.dto });
    expect(f.db.rows()).toHaveLength(0);
    expect(f.db.walletUpserts).toHaveLength(0);
    expect(f.db.logs()).toHaveLength(0);
  });

  test('gateway receives the plan id, codExternal and no draft reference', async () => {
    const f = setup();
    await f.service.execute({ code: 'c', dto: f.dto });
    const { token, input } = f.calls[0];
    expect(token).toBe('test-token');
    expect(input.domLinkId).toBe('dom-plan');
    expect(input.description).toBe('Sub plan');
    expect(input.documentType).toBe('CPF');
    expect(input.codExternal).toMatch(/^sub-link-pix-sub-\d+$/);
  });

  test('order gets the PIX reference and the link usage counter is incremented', async () => {
    const f = setup(makeSub({ currentUses: 2 }));
    const out = await f.service.execute({ code: 'c', dto: f.dto });
    expect(f.db.subscriptionOrderUpdates[0].data).toEqual({
      domPixPaymentId: 'dom-pix-1',
      pixContent: 'copy',
      pixExpire: new Date('2030-01-01T00:00:00.000Z'),
    });
    expect(f.repoUpdates).toEqual([{ id: 'sub', data: { currentUses: 3 } }]);
    expect(out).toMatchObject({
      id: 'order-1',
      domPaymentId: 'dom-pix-1',
      status: 'pending',
      amount: 100,
      qrCode: 'qr',
    });
  });

  test('missing domPlanId creates the plan first and persists it', async () => {
    const f = setup(makeSub({ domPlanId: null, frequencyType: 'ANUAL' }));
    await f.service.execute({ code: 'c', dto: f.dto });
    expect(f.plans[0]).toMatchObject({
      price: 100,
      frequency_type: 'YEAR',
      frequency: 1,
      repetitions: 0,
      retry_days: 3,
    });
    expect(f.repoUpdates[0]).toEqual({
      id: 'sub',
      data: { domPlanId: 'new-plan' },
    });
    expect(f.calls[0].input.domLinkId).toBe('new-plan');
  });

  test('voucher lowers the charged amount and the platform fee is computed on the DISCOUNTED amount', async () => {
    const f = setup(makeSub(), { voucher: { valid: true, finalAmount: 80 } });
    f.dto.voucherCode = 'OFF20';
    await f.service.execute({ code: 'c', dto: f.dto });
    expect(f.orders[0].amountCharged).toBe(80);
    expect(f.orders[0].platformFeeAmount).toBe(0.78); // 80 * 0.98%, was 0.98 on the original 100
  });

  test('voucher with financial quote: quote is derived from the discounted base', async () => {
    const f = setup(makeSub({ isStandalone: true }), {
      financial: true,
      voucher: { valid: true, finalAmount: 80 },
    });
    f.dto.voucherCode = 'OFF20';
    await f.service.execute({ code: 'c', dto: f.dto });
    expect(f.orders[0].financialSnapshot.originalCents).toBe(8000);
    expect(f.orders[0].amountCharged).toBeLessThan(105.48);
  });

  test('invalid voucher is rejected before any order exists', async () => {
    const f = setup(makeSub(), { voucher: { valid: false, finalAmount: 0 } });
    f.dto.voucherCode = 'BAD';
    await expect(f.service.execute({ code: 'c', dto: f.dto })).rejects.toThrow(
      'Cupom inválido ou expirado',
    );
    expect(f.orders).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
  });

  test('Areaflix tag: uses the global token and the platform MDR; no Areaflix seller-net rule here', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeSub({ platformTag: 'AREAFLIX' }));
      await f.service.execute({ code: 'c', dto: f.dto });
      expect(f.calls[0].token).toBe('test-token');
      expect(f.orders[0].amountCharged).toBe(100);
      expect(f.orders[0].platformFeeAmount).toBe(0.98);
    });
  });
});

describe('financialQuote present', () => {
  test('buyer is grossed up and the whole quoted fee becomes platformFeeAmount, snapshot saved', async () => {
    const f = setup(makeSub({ isStandalone: true }), { financial: true });
    const out = await f.service.execute({ code: 'c', dto: f.dto });
    expect(out.amount).toBe(105.48);
    expect(f.calls[0].input.amount).toBe(105.48);
    expect(f.orders[0].amountCharged).toBe(105.48);
    expect(f.orders[0].platformFeeAmount).toBe(5.48); // SUSPECT: contracted acquirer cost + sim fee lumped together
    expect(f.orders[0].financialSnapshot.originalCents).toBe(10000);
  });
});

describe('coproduction snapshot', () => {
  const agreement = {
    version: 2,
    participants: [{ userId: 'co-1', percentageBps: 1000 }],
  };

  test('legacy path: stored with a coproductionLegacy block carrying the computed split', async () => {
    const f = setup(makeSub(), { agreement });
    await f.service.execute({ code: 'c', dto: f.dto });
    const snap = f.orders[0].financialSnapshot;
    expect(snap.coproduction).toMatchObject({
      basis: 'NET',
      version: 2,
      product: 'links-assinatura',
      productId: 'sub',
      ownerUserId: 'owner',
      participants: [{ userId: 'co-1', percentageBps: 1000 }],
    });
    expect(snap.coproductionLegacy).toEqual({
      totalAmount: 100,
      netAmount: 99.02,
      totalFeeAmount: 0.98,
      domFeeAmount: 0,
      platformProfit: 0.98,
      policyTag: 'GLOBAL',
    });
  });

  test('quote path: no coproductionLegacy, quote snapshot is kept', async () => {
    const f = setup(makeSub(), { agreement, financial: true });
    await f.service.execute({ code: 'c', dto: f.dto });
    const snap = f.orders[0].financialSnapshot;
    expect(snap.coproduction.version).toBe(2);
    expect(snap.coproductionLegacy).toBeUndefined();
    expect(snap.originalCents).toBe(10000);
  });
});

describe('community, failures and guards', () => {
  test('bound community registers a pending PIX with the charged amount', async () => {
    const f = setup(makeSub(), { community: { id: 'comm' } });
    await f.service.execute({ code: 'c', dto: f.dto });
    expect(f.pending).toEqual([
      {
        communityId: 'comm',
        userId: 'owner',
        frequencyType: 'MENSAL',
        paymentMethod: 'PIX',
        amountCharged: 100,
        subscriptionLinkOrderId: 'order-1',
      },
    ]);
  });

  test('gateway failure marks the order failed, rethrows and does not consume a use', async () => {
    const f = setup(makeSub(), { gatewayFails: true });
    await expect(f.service.execute({ code: 'c', dto: f.dto })).rejects.toThrow(
      'gateway down',
    );
    expect(f.db.subscriptionOrderUpdates).toEqual([
      { where: { id: 'order-1' }, data: { status: 'failed' } },
    ]);
    expect(f.repoUpdates).toHaveLength(0);
  });

  test('maxUses reached', async () => {
    const f = setup(makeSub({ maxUses: 2, currentUses: 2 }));
    await expect(f.service.execute({ code: 'c', dto: f.dto })).rejects.toThrow(
      'Limite de assinaturas atingido',
    );
    expect(f.orders).toHaveLength(0);
  });

  test('inactive link', async () => {
    const f = setup(makeSub({ isActive: false }));
    await expect(f.service.execute({ code: 'c', dto: f.dto })).rejects.toThrow(
      'Link de assinatura não encontrado ou inativo',
    );
  });

  test('link that only accepts credit card rejects PIX before any order or gateway call', async () => {
    const f = setup(makeSub({ paymentMethods: 'CREDIT_CARD' }));
    await expect(f.service.execute({ code: 'c', dto: f.dto })).rejects.toThrow(
      'Este link não aceita pagamento via PIX',
    );
    expect(f.orders).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
  });

  test.each(['PIX', 'BOTH', undefined])(
    'paymentMethods %p accepts PIX',
    async (paymentMethods) => {
      const f = setup(makeSub({ paymentMethods }));
      await f.service.execute({ code: 'c', dto: f.dto });
      expect(f.orders).toHaveLength(1);
    },
  );

  // SubscriptionLink has no expiresAt field: expiry is only expressible via isActive/maxUses (covered above).
});
