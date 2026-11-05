import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { initializePlatformTaxasCache } from '../../../modules/platform-taxas/platform-taxas.store';
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
  financial = false,
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
      createSubscriptionFromCheckout: async (_t: string, i: any) => {
        gatewayCalls.push(i);
        return { id: 'dom-sub', status: 'active' };
      },
    } as never,
    { findBoundCommunityForSubscriptionLink: async () => null } as never,
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

  test('voucher: platform fee is computed on the discounted amount', async () => {
    await initializePlatformTaxasCache({
      platformTaxaOverride: {
        findMany: async () => [
          { tag: 'USER:OWNER', key: 'MDR_CC_1X', value: 0.1 },
        ],
      },
    } as never);
    const full = setup();
    await full.service.execute({ code: 'c', dto: full.dto });

    const f = setup({}, 80);
    f.dto.voucherCode = 'OFF20';
    await f.service.execute({ code: 'c', dto: f.dto });

    const fullOrder = full.orders[0];
    expect(f.orders[0].amountCharged).toBe(80);
    // not activated lane: buyer pays base + fee; discounted total 80 carries fee 80 - 80/1.1
    expect(fullOrder.platformFeeAmount).toBe(10);
    expect(f.orders[0].platformFeeAmount).toBe(7.27);
  });
});
