import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Prisma } from '@prisma/client';
import { ChargePaymentLinkUseCase } from './charge-payment-link.use-case';
import { linkChargeReference } from '../../../modules/platform-core/link-settlement';
import {
  makeFakePrisma,
  makeLink,
  makeOffer,
  money,
  useEmptyCaches,
  withAreaflixPlatform,
  type FixtureOptions,
} from './charge-characterization.fixture';

/**
 * CHARACTERIZATION of ChargePaymentLinkUseCase (card / debit / PIX through the generic endpoint).
 * Complements charge-payment-link.use-case.test.ts (which pins atomicity). Values flagged SUSPECT look wrong
 * but are intentionally pinned as-is.
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

function setup(
  link: any = makeLink(),
  opts: FixtureOptions = {},
  gatewayStatus = 'pending',
) {
  const db = makeFakePrisma(opts);
  const gatewayCalls: { token: string; input: any; draft: any }[] = [];
  const linkUpdates: any[] = [];
  const gateway: any = {
    chargePaymentLink: async (token: string, input: any) => {
      gatewayCalls.push({ token, input, draft: { ...db.row() } });
      return { id: 'dom-pay-1', status: gatewayStatus, pixContent: null };
    },
  };
  const service = new ChargePaymentLinkUseCase(
    {
      findById: async () => link,
      update: async (id: string, data: any) => {
        linkUpdates.push({ id, data });
        return link;
      },
    } as never,
    { findById: async () => ({ id: 'owner', platform: null }) } as never,
    gateway,
    db.prisma,
  );
  const input: any = {
    linkId: 'link',
    customerName: 'Buyer',
    customerEmail: 'buyer@example.test',
    customerDocument: '123.456.789-01',
    customerPhone: '(81) 99999-9999',
    paymentMethod: 'credit_card',
    installments: 1,
    card: { token: 'fake' },
  };
  return { service, input, db, gatewayCalls, linkUpdates };
}

describe('fees per payment method (legacy, no financial policy)', () => {
  test('credit 1x standalone: buyer pays base + DOM fee, seller net is the base minus 9% + R$4', async () => {
    const f = setup();
    const out = await f.service.execute(f.input);
    expect(f.gatewayCalls[0].input.amount).toBe(104.99);
    expect(f.gatewayCalls[0].input.installments).toBe(1);
    expect(f.gatewayCalls[0].input.paymentMethod).toBe('credit_card');
    expect(money(f.db.row())).toEqual({
      amount: 104.99,
      netAmount: 87,
      totalFee: 17.99,
      domFee: 4.99,
      platformFee: 13,
    });
    expect(f.db.row().paymentMethod).toBe('CREDIT_CARD');
    expect(f.db.row().installments).toBe(1);
    expect(out.status).toBe('pending');
    expect(f.db.row().status).toBe('PENDING');
  });

  test('debit: buyer pays base; DOM + platform + fixed + cashback all come out of the seller net', async () => {
    const f = setup();
    f.input.paymentMethod = 'debit_card';
    await f.service.execute(f.input);
    expect(f.gatewayCalls[0].input.amount).toBe(100);
    expect(money(f.db.row())).toEqual({
      amount: 100,
      netAmount: 87.51, // 100 - (3.49% + 1) - (2% + 2) - 1 (TAXA_FIXA_TRANSACAO) - 3 (TAXA_CASHBACK)
      totalFee: 12.49,
      domFee: 4.49, // DOM debit cost only: 3.49% + R$1
      platformFee: 8, // platform take: 2% + R$2 + fixed 1 + cashback 3
    });
    expect(f.db.row().paymentMethod).toBe('DEBIT_CARD');
  });

  test('pix through the generic endpoint: buyer pays base, net = base - 13', async () => {
    const f = setup();
    f.input.paymentMethod = 'pix';
    f.input.card = undefined;
    await f.service.execute(f.input);
    expect(money(f.db.row())).toEqual({
      amount: 100,
      netAmount: 87,
      totalFee: 13,
      domFee: 0.98, // real acquirer cost: MDR_PIX 0.98%, not the card rate
      platformFee: 12.02,
    });
    expect(f.db.row().paymentMethod).toBe('PIX');
  });

  test('missing paymentMethod defaults to credit_card on the row and the gateway', async () => {
    const f = setup();
    f.input.paymentMethod = undefined;
    await f.service.execute(f.input);
    expect(f.db.row().paymentMethod).toBe('CREDIT_CARD');
    expect(f.gatewayCalls[0].input.paymentMethod).toBe('credit_card');
  });

  test('credit 3x: interest passed to the buyer, DOM fee on the interest-bearing value', async () => {
    const f = setup();
    f.input.installments = 3;
    await f.service.execute(f.input);
    expect(f.db.row().installments).toBe(3);
    expect(money(f.db.row())).toEqual({
      amount: 113.12, // base + customer interest (platform-owned), then + DOM fee
      netAmount: 92.73,
      totalFee: 20.39,
      domFee: 7.39,
      platformFee: 13,
    });
  });
});

describe('draft / settlement ordering', () => {
  test('draft is DRAFT + FINAL_NET with the final snapshot before the gateway is called', async () => {
    const f = setup();
    await f.service.execute(f.input);
    const draft = f.gatewayCalls[0].draft;
    expect(draft.status).toBe('DRAFT');
    expect(draft.settlementBasis).toBe('FINAL_NET');
    expect(money(draft).netAmount).toBe(87);
    expect(linkChargeReference(f.gatewayCalls[0].input.description)).toBe(
      draft.id,
    );
  });

  test.each([
    ['approved', 'COMPLETED', 87],
    ['PAID', 'COMPLETED', 87],
    ['pending', 'PENDING', 0],
    ['something-else', 'PENDING', 0],
    ['rejected', 'FAILED', 0],
    ['EXPIRED', 'FAILED', 0],
  ])(
    'gateway status %s settles the row as %s and credits %d to the wallet',
    async (gatewayStatus, rowStatus, credit) => {
      const f = setup(makeLink(), {}, gatewayStatus);
      await f.service.execute(f.input);
      expect(f.db.row().status).toBe(rowStatus);
      expect(f.db.wallet().balance.toNumber()).toBe(credit);
      expect(f.db.logs()).toHaveLength(credit ? 1 : 0);
      if (credit) {
        expect(f.db.logs()[0]).toMatchObject({
          userId: 'owner',
          action: 'LINK_SETTLEMENT_COMPLETED',
        });
        expect(Number(f.db.logs()[0].balanceDelta)).toBe(87);
      }
    },
  );

  test('credit uses netAmount, not amount (net 87 of a 104.99 charge)', async () => {
    const f = setup(makeLink(), {}, 'approved');
    await f.service.execute(f.input);
    expect(f.db.wallet().balance.toNumber()).toBe(87);
  });
});

describe('order bump and funnel', () => {
  test('order bump raises the base: credit 1x on 120', async () => {
    const f = setup(makeLink(), { offers: [makeOffer()] });
    f.input.orderBumpIds = ['bump-1'];
    await f.service.execute(f.input);
    expect(money(f.db.row())).toEqual({
      amount: 125.79,
      netAmount: 105.2,
      totalFee: 20.59,
      domFee: 5.79,
      platformFee: 14.8,
    });
    expect(f.db.row().description).toBe('Plan + Bump');
    expect(f.db.offerSales[0]).toMatchObject({
      offerId: 'bump-1',
      type: 'ORDER_BUMP',
      parentTransactionId: null,
    });
    expect(f.linkUpdates).toEqual([{ id: 'link', data: { currentUses: 1 } }]);
  });

  test('upsell: only the offer is charged, maxUses is not consumed or checked', async () => {
    const upsell = makeOffer({
      id: 'up-1',
      type: 'UPSELL',
      title: 'Upsell X',
      price: new Prisma.Decimal(50),
    });
    const f = setup(makeLink({ maxUses: 1, currentUses: 1 }), {
      offers: [upsell],
      parent: {
        id: 'parent-tx',
        status: 'COMPLETED',
        customerEmail: 'buyer@example.test',
      },
    });
    f.input.offerId = 'up-1';
    f.input.parentPaymentId = 'parent-tx';
    await f.service.execute(f.input);
    expect(money(f.db.row())).toEqual({
      amount: 53, // 50 + 2.995 rounded to 3 DOM fee
      netAmount: 41.5,
      totalFee: 11.5,
      domFee: 3,
      platformFee: 8.5,
    });
    expect(f.db.row().description).toBe('Plan | Upsell: Upsell X');
    expect(f.db.offerSales[0]).toMatchObject({
      type: 'UPSELL',
      parentTransactionId: 'parent-tx',
    });
    expect(f.linkUpdates).toHaveLength(0);
  });
});

describe('link guards', () => {
  async function rejects(
    link: any,
    message: string,
    mutate?: (i: any) => void,
  ) {
    const f = setup(link);
    mutate?.(f.input);
    const err: any = await f.service.execute(f.input).catch((e) => e);
    expect(err.message).toBe(message);
    expect(f.db.rows()).toHaveLength(0);
    expect(f.gatewayCalls).toHaveLength(0);
  }
  test('expired', () =>
    rejects(
      makeLink({ expiresAt: new Date(Date.now() - 1) }),
      'Link de pagamento expirado',
    ));
  test('maxUses reached', () =>
    rejects(
      makeLink({ maxUses: 5, currentUses: 5 }),
      'Limite de usos do link atingido',
    ));
  test('inactive', () =>
    rejects(
      makeLink({ isActive: false }),
      'Link de pagamento não encontrado ou inativo',
    ));
  test('not synced', () =>
    rejects(
      makeLink({ domPaymentLinkId: null }),
      'Link ainda não sincronizado com o gateway',
    ));
  test.each([
    ['pix', { aceitaPix: false }, 'Este link não aceita pagamento via PIX'],
    [
      'credit_card',
      { aceitaCartao: false },
      'Este link não aceita pagamento via cartão de crédito',
    ],
    [
      'debit_card',
      { aceitaDebito: false },
      'Este link não aceita pagamento via cartão de débito',
    ],
  ])(
    'rejects %s when the link does not accept it and writes nothing',
    async (method, over, message) => {
      const f = setup(makeLink(over));
      f.input.paymentMethod = method;
      await expect(f.service.execute(f.input)).rejects.toThrow(message);
      expect(f.db.rows()).toHaveLength(0);
      expect(f.gatewayCalls).toHaveLength(0);
    },
  );

  test('a method the link accepts is not blocked by the others being off', async () => {
    const f = setup(
      makeLink({ aceitaPix: true, aceitaCartao: false, aceitaDebito: false }),
    );
    f.input.paymentMethod = 'pix';
    await f.service.execute(f.input);
    expect(f.db.rows()).toHaveLength(1);
  });
});

describe('Areaflix seller net', () => {
  test('pix: net = gross * 0.9301 - 4 (financial quote absent)', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeLink({ plataformas: ['AREAFLIX'] }));
      f.input.paymentMethod = 'pix';
      await f.service.execute(f.input);
      expect(money(f.db.row())).toEqual({
        amount: 100,
        netAmount: 89.01,
        totalFee: 10.99,
        domFee: 0.98,
        platformFee: 10.01,
      });
      expect(f.gatewayCalls[0].token).toBe('test-token');
    });
  });

  test('credit 1x: net is computed on the base (link amount), not on the buyer total (FIXED)', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeLink({ plataformas: ['AREAFLIX'] }));
      await f.service.execute(f.input);
      // before: net 91.54 (104.99 * 0.91 - 4), totalFee 13.45, platformFee 8.46
      expect(money(f.db.row())).toEqual({
        amount: 104.99,
        netAmount: 87, // 100 * (1 - 9%) - R$4
        totalFee: 17.99,
        domFee: 4.99,
        platformFee: 13,
      });
    });
  });

  test('credit 1x with order bump: net follows the bumped base, not the buyer total', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeLink({ plataformas: ['AREAFLIX'] }), {
        offers: [makeOffer()],
      });
      f.input.orderBumpIds = ['bump-1'];
      await f.service.execute(f.input);
      expect(money(f.db.row()).netAmount).toBe(105.2); // 120 * 0.91 - 4
    });
  });

  test('debit: net = gross * (1 - 2%) - R$2 on the base; platformFee floored at 0 with the subsidy in the snapshot (FIXED)', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeLink({ plataformas: ['AREAFLIX'] }));
      f.input.paymentMethod = 'debit_card';
      await f.service.execute(f.input);
      // before: platformFee -0.49 (net unchanged at 96)
      expect(money(f.db.row())).toEqual({
        amount: 100,
        netAmount: 96,
        totalFee: 4,
        domFee: 4.49,
        platformFee: 0,
      });
      expect(f.db.row().financialSnapshot).toEqual({ subsidy: 0.49 });
    });
  });

  test('non-negative platformFee leaves no subsidy marker', async () => {
    const f = setup(makeLink());
    f.input.paymentMethod = 'debit_card';
    await f.service.execute(f.input);
    expect(f.db.row().platformFee.toNumber()).toBeGreaterThanOrEqual(0);
    expect(f.db.row().financialSnapshot).toBeUndefined();
  });
});

describe('financialQuote present vs absent (PIX lane configured)', () => {
  test('present for PIX: quote wins and snapshot is stored', async () => {
    const f = setup(makeLink(), { financial: true });
    f.input.paymentMethod = 'pix';
    await f.service.execute(f.input);
    expect(money(f.db.row())).toEqual({
      amount: 105.48,
      netAmount: 100,
      totalFee: 5.48,
      domFee: 1.48,
      platformFee: 4,
    });
    expect(f.db.row().financialSnapshot.originalCents).toBe(10000);
    // no float noise: stored fees are rounded to 2 decimals on the quote path
    expect(f.db.row().totalFee.toNumber()).toBe(5.48);
    expect(f.db.row().platformFee.toNumber()).toBe(4);
  });

  test('absent for the same link on a lane without policy (credit 1x): legacy numbers', async () => {
    const f = setup(makeLink(), { financial: true });
    await f.service.execute(f.input);
    expect(money(f.db.row()).netAmount).toBe(87);
    expect(f.db.row().financialSnapshot).toBeUndefined();
  });
});

describe('coproduction snapshot', () => {
  test('stored on the transaction and not allocated until settlement', async () => {
    const f = setup(makeLink(), {
      agreement: {
        version: 2,
        participants: [{ userId: 'co-1', percentageBps: 2500 }],
      },
    });
    await f.service.execute(f.input);
    expect(f.db.row().financialSnapshot).toEqual({
      coproduction: {
        basis: 'NET',
        version: 2,
        product: 'links-pagamento',
        productId: 'link',
        ownerUserId: 'owner',
        participants: [{ userId: 'co-1', percentageBps: 2500 }],
      },
    });
  });
});
