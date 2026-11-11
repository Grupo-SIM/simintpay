import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { CheckoutSubscriptionLinkCardUseCase } from './checkout-subscription-link-card.use-case';
import {
  makeFakePrisma,
  useEmptyCaches,
} from '../payment-link/charge-characterization.fixture';

const oldToken = process.env.DOM_TOKEN;
beforeAll(useEmptyCaches);
beforeEach(() => {
  process.env.DOM_TOKEN = 'test-token';
});
afterAll(useEmptyCaches);
afterEach(() => {
  if (oldToken === undefined) delete process.env.DOM_TOKEN;
  else process.env.DOM_TOKEN = oldToken;
});

function setup(
  over: Record<string, unknown> = {},
  voucherFinal?: number,
  financial = true,
) {
  const link: any = {
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
    ...over,
  };
  const db = makeFakePrisma({ financial });
  if (financial)
    db.prisma.financialPolicyRevision.findMany = async () =>
      [
        {
          tag: 'GLOBAL',
          version: 1,
          document: {
            schemaVersion: 1,
            lanes: {
              'DOM/CREDIT_CARD/ONLINE/1': {
                active: true,
                contract: {
                  reference: 'Signed',
                  fixedCents: 0,
                  ratePpm: 0,
                  cashbackCents: 0,
                  interestPpm: 0,
                  base: 'ORIGINAL',
                },
                sim: { fixedCents: 0, ratePpm: 100000, interestPpm: 0 },
              },
            },
            owner: {},
            interestFree: false,
          },
        },
      ] as never;
  const orders: any[] = [];
  const gatewayCalls: any[] = [];
  const service = new CheckoutSubscriptionLinkCardUseCase(
    {
      findByCode: async () => link,
      update: async () => undefined,
      createOrder: async (d: any) => {
        orders.push(d);
        return { id: 'order-1', status: 'pending' };
      },
    } as never,
    {} as never,
    {
      createPlan: async () => ({ id: 'quoted-plan' }),
      createSubscriptionFromCheckout: async (_t: string, i: any) => {
        gatewayCalls.push(i);
        return { id: 'dom-sub', status: 'active' };
      },
    } as never,
    {
      sendSubscriptionAccess: async () => undefined,
      sendEbookAccessEmail: async () => undefined,
    } as never,
    {
      validateVoucher: async () =>
        voucherFinal === undefined
          ? null
          : { valid: true, finalAmount: voucherFinal },
    } as never,
    db.prisma,
  );
  const dto: any = {
    customerName: 'Buyer',
    customerEmail: 'buyer@example.test',
    customerDocument: '12345678901',
    card: {},
  };
  return { service, dto, orders, gatewayCalls };
}

describe('card checkout (subscription link)', () => {
  test('PIX-only link rejects card checkout', async () => {
    const f = setup({ paymentMethods: 'PIX' });
    await expect(f.service.execute({ code: 'c', dto: f.dto })).rejects.toThrow(
      'Este link não aceita pagamento via cartão de crédito',
    );
    expect(f.orders).toHaveLength(0);
    expect(f.gatewayCalls).toHaveLength(0);
  });

  test('missing financial policy rejects before the gateway', async () => {
    const f = setup({}, undefined, false);
    await expect(f.service.execute({ code: 'c', dto: f.dto })).rejects.toThrow(
      'Política financeira não configurada',
    );
    expect(f.orders).toHaveLength(0);
    expect(f.gatewayCalls).toHaveLength(0);
  });

  test('voucher: platform fee is computed on the discounted amount', async () => {
    const full = setup();
    await full.service.execute({ code: 'c', dto: full.dto });

    const f = setup({}, 80);
    f.dto.voucherCode = 'OFF20';
    await f.service.execute({ code: 'c', dto: f.dto });

    const fullOrder = full.orders[0];
    expect(f.orders[0].amountCharged).toBe(80);
    // Current policy applies the same configured rate to the discounted base.
    expect(fullOrder.platformFeeAmount).toBe(20);
    expect(f.orders[0].platformFeeAmount).toBe(16);
  });
});
