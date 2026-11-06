import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Prisma } from '@prisma/client';
import { ChargePixPaymentLinkUseCase } from './charge-pix-payment-link.use-case';
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
 * CHARACTERIZATION of ChargePixPaymentLinkUseCase: pins what it does today so a Charge-model refactor can be
 * compared. Values flagged "SUSPECT" look wrong but are intentionally pinned as-is.
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
  gatewayOverride?: (token: string, input: any) => Promise<any>,
) {
  const db = makeFakePrisma(opts);
  const gatewayCalls: { token: string; input: any; draft: any }[] = [];
  const linkUpdates: any[] = [];
  const gateway: any = {
    chargePixForLink: async (token: string, input: any) => {
      gatewayCalls.push({ token, input, draft: { ...db.row() } });
      if (gatewayOverride) return gatewayOverride(token, input);
      return {
        id: 'dom-pay-1',
        status: 'pending',
        pixContent: 'pix-copy-paste',
        qrCode: 'qr',
        pixExpire: '2030-01-01T00:00:00.000Z',
      };
    },
  };
  const service = new ChargePixPaymentLinkUseCase(
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
  };
  return { service, input, db, gatewayCalls, linkUpdates };
}

describe('plain PIX charge (legacy fees, no financial policy)', () => {
  test('numbers written to the Transaction', async () => {
    const f = setup();
    const out = await f.service.execute(f.input);
    // buyer pays exactly the base; seller fee = 9% + R$4 = 13; domFee = MDR_PIX 0.98% (real acquirer cost), platformFee = rest
    expect(money(f.db.row())).toEqual({
      amount: 100,
      netAmount: 87,
      totalFee: 13,
      domFee: 0.98,
      platformFee: 12.02,
    });
    expect(out.amount).toBe(100);
    expect(out.status).toBe('pending');
  });

  test('draft is written before the gateway, then bound and left PENDING with no wallet credit', async () => {
    const f = setup();
    const out = await f.service.execute(f.input);
    const call = f.gatewayCalls[0];
    expect(call.draft.status).toBe('DRAFT');
    expect(call.draft.settlementBasis).toBe('FINAL_NET');
    expect(call.draft.domPaymentId).toBeNull();
    expect(call.token).toBe('test-token');
    expect(call.input.amount).toBe(100);
    expect(call.input.domLinkId).toBe('dom-link');
    expect(call.input.documentType).toBe('CPF');
    expect(call.input.customerDocument).toBe('12345678901');
    expect(call.input.customerPhone).toBe('81999999999');
    expect(call.input.codExternal).toBe(call.draft.id);
    expect(linkChargeReference(call.input.description)).toBe(call.draft.id);

    const row = f.db.row();
    expect(f.db.rows()).toHaveLength(1);
    expect(row.id).toBe(call.draft.id);
    expect(row.status).toBe('PENDING');
    expect(row.settlementBasis).toBe('FINAL_NET');
    expect(row.domPaymentId).toBe('dom-pay-1');
    expect(row.pixContent).toBe('pix-copy-paste');
    expect(row.pixExpire).toEqual(new Date('2030-01-01T00:00:00.000Z'));
    expect(row.paymentMethod).toBe('PIX');
    expect(row.paymentLinkId).toBe('link');
    expect(row.customerPhone).toBe('81999999999');
    expect(out.transactionId).toBe(row.id);
    expect(f.db.wallet().balance.toNumber()).toBe(0);
    expect(f.db.logs()).toHaveLength(0);
    expect(f.db.walletUpserts).toHaveLength(1);
    expect(f.db.walletUpserts[0].where).toEqual({ userId: 'owner' });
    expect(f.db.walletUpserts[0].create.balance).toBe(0);
  });

  test('description has no TENANT marker for GLOBAL, uses description over title', async () => {
    const f = setup(makeLink({ description: 'Desc' }));
    await f.service.execute(f.input);
    expect(f.db.row().description).toBe('Desc');
    expect(f.db.row().financialSnapshot).toBeUndefined();
  });

  test('CNPJ document type is inferred from 14 digits', async () => {
    const f = setup();
    f.input.customerDocument = '12.345.678/0001-90';
    await f.service.execute(f.input);
    expect(f.gatewayCalls[0].input.documentType).toBe('CNPJ');
  });

  test('currentUses is incremented by one on the link', async () => {
    const f = setup(makeLink({ currentUses: 3, maxUses: 10 }));
    await f.service.execute(f.input);
    expect(f.linkUpdates).toEqual([{ id: 'link', data: { currentUses: 4 } }]);
  });

  test('non-GLOBAL platform adds a [TENANT:x] marker and uses the platform fee tag', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeLink({ plataformas: ['AREAFLIX'] }));
      await f.service.execute(f.input);
      expect(f.db.row().description).toBe('Plan [TENANT:AREAFLIX]');
      expect(f.gatewayCalls[0].token).toBe('test-token');
    });
  });
});

describe('PIX with order bump', () => {
  test('bump is added to the charged base and fees are recomputed on it', async () => {
    const f = setup(makeLink(), { offers: [makeOffer()] });
    f.input.orderBumpIds = ['bump-1'];
    const out = await f.service.execute(f.input);
    expect(out.amount).toBe(120);
    expect(f.gatewayCalls[0].input.amount).toBe(120);
    expect(money(f.db.row())).toEqual({
      amount: 120,
      netAmount: 105.2, // 120 - (120 * 9% + 4)
      totalFee: 14.8,
      domFee: 1.18,
      platformFee: 13.62,
    });
    expect(f.db.row().description).toBe('Plan + Bump');
    expect(f.db.offerSales).toHaveLength(1);
    expect(f.db.offerSales[0]).toMatchObject({
      offerId: 'bump-1',
      paymentLinkId: 'link',
      transactionId: f.db.row().id,
      parentTransactionId: null,
      type: 'ORDER_BUMP',
      title: 'Bump',
    });
    expect(f.linkUpdates).toHaveLength(1);
  });

  test('unknown / inactive bump is rejected before anything is written', async () => {
    const f = setup(makeLink(), { offers: [] });
    f.input.orderBumpIds = ['nope'];
    await expect(f.service.execute(f.input)).rejects.toThrow(
      'Order bump indisponível',
    );
    expect(f.db.rows()).toHaveLength(0);
    expect(f.gatewayCalls).toHaveLength(0);
  });
});

describe('upsell / downsell (funnel offer)', () => {
  const parent = {
    id: 'parent-tx',
    status: 'COMPLETED',
    customerEmail: 'Buyer@Example.test',
  };
  const upsell = makeOffer({
    id: 'up-1',
    type: 'UPSELL',
    title: 'Upsell X',
    price: new Prisma.Decimal(50),
  });

  test('charges only the offer price, links to the parent, and does not consume a use', async () => {
    const f = setup(makeLink({ maxUses: 1, currentUses: 1 }), {
      offers: [upsell],
      parent,
    });
    f.input.offerId = 'up-1';
    f.input.parentPaymentId = 'parent-tx';
    f.input.orderBumpIds = ['ignored'];
    const out = await f.service.execute(f.input);
    expect(out.amount).toBe(50);
    expect(money(f.db.row())).toEqual({
      amount: 50,
      netAmount: 41.5, // 50 - (50 * 9% + 4)
      totalFee: 8.5,
      domFee: 0.49, // 50 * 0.98% = 0.49
      platformFee: 8.01,
    });
    expect(f.db.row().description).toBe('Plan | Upsell: Upsell X');
    expect(f.db.offerSales[0]).toMatchObject({
      offerId: 'up-1',
      parentTransactionId: 'parent-tx',
      type: 'UPSELL',
    });
    // maxUses already reached, still allowed; counter untouched
    expect(f.linkUpdates).toHaveLength(0);
  });

  test('downsell is labelled Downsell', async () => {
    const f = setup(makeLink(), {
      offers: [{ ...upsell, type: 'DOWNSELL', title: 'Down' }],
      parent,
    });
    f.input.offerId = 'up-1';
    f.input.parentPaymentId = 'parent-tx';
    await f.service.execute(f.input);
    expect(f.db.row().description).toBe('Plan | Downsell: Down');
    expect(f.db.offerSales[0].type).toBe('DOWNSELL');
  });

  test('requires an approved parent of the same buyer', async () => {
    const pending = setup(makeLink(), {
      offers: [upsell],
      parent: { ...parent, status: 'PENDING' },
    });
    pending.input.offerId = 'up-1';
    pending.input.parentPaymentId = 'parent-tx';
    await expect(pending.service.execute(pending.input)).rejects.toThrow(
      'Pedido principal não aprovado',
    );
    const other = setup(makeLink(), {
      offers: [upsell],
      parent: { ...parent, customerEmail: 'other@x.test' },
    });
    other.input.offerId = 'up-1';
    other.input.parentPaymentId = 'parent-tx';
    await expect(other.service.execute(other.input)).rejects.toThrow(
      'Pedido principal pertence a outro comprador',
    );
    const missing = setup(makeLink(), { offers: [upsell], parent });
    missing.input.offerId = 'up-1';
    await expect(missing.service.execute(missing.input)).rejects.toThrow(
      'Pedido principal não informado',
    );
    expect(pending.db.rows()).toHaveLength(0);
  });

  test('an already paid funnel offer on the parent is rejected; unpaid earlier attempts are not', async () => {
    const paid = setup(makeLink(), {
      offers: [upsell],
      parent,
      funnelSales: [{ transactionId: 'earlier' }],
      paidFunnelCount: 1,
    });
    paid.input.offerId = 'up-1';
    paid.input.parentPaymentId = 'parent-tx';
    await expect(paid.service.execute(paid.input)).rejects.toThrow(
      'Oferta pós-compra já adquirida neste pedido',
    );
    expect(paid.db.rows()).toHaveLength(0);
    const unpaid = setup(makeLink(), {
      offers: [upsell],
      parent,
      funnelSales: [{ transactionId: 'earlier' }],
      paidFunnelCount: 0,
    });
    unpaid.input.offerId = 'up-1';
    unpaid.input.parentPaymentId = 'parent-tx';
    await unpaid.service.execute(unpaid.input);
    expect(unpaid.db.rows()).toHaveLength(1);
  });

  test('funnel still honours expiry', async () => {
    const f = setup(makeLink({ expiresAt: new Date(Date.now() - 1000) }), {
      offers: [upsell],
      parent,
    });
    f.input.offerId = 'up-1';
    f.input.parentPaymentId = 'parent-tx';
    await expect(f.service.execute(f.input)).rejects.toThrow(
      'Link de pagamento expirado',
    );
  });
});

describe('link guards (nothing is written, gateway untouched)', () => {
  async function rejects(link: any, message: string, ctor?: unknown) {
    const f = setup(link);
    const err: any = await f.service.execute(f.input).catch((e) => e);
    expect(err.message).toBe(message);
    if (ctor) expect(err).toBeInstanceOf(ctor as never);
    expect(f.db.rows()).toHaveLength(0);
    expect(f.gatewayCalls).toHaveLength(0);
    expect(f.linkUpdates).toHaveLength(0);
  }
  test('expired link (expiresAt <= now)', () =>
    rejects(
      makeLink({ expiresAt: new Date(Date.now() - 1) }),
      'Link de pagamento expirado',
    ));
  test('future expiry is accepted', async () => {
    const f = setup(makeLink({ expiresAt: new Date(Date.now() + 60_000) }));
    await f.service.execute(f.input);
    expect(f.db.rows()).toHaveLength(1);
  });
  test('maxUses reached', () =>
    rejects(
      makeLink({ maxUses: 2, currentUses: 2 }),
      'Limite de usos do link atingido',
    ));
  test('maxUses not yet reached is accepted', async () => {
    const f = setup(makeLink({ maxUses: 2, currentUses: 1 }));
    await f.service.execute(f.input);
    expect(f.linkUpdates[0].data.currentUses).toBe(2);
  });
  test('link not accepting PIX', () =>
    rejects(
      makeLink({ aceitaPix: false }),
      'Este link não aceita pagamento via PIX',
    ));
  test('inactive link', () =>
    rejects(
      makeLink({ isActive: false }),
      'Link de pagamento não encontrado ou inativo',
    ));
  test('link not synced to the gateway', () =>
    rejects(
      makeLink({ domPaymentLinkId: null }),
      'Link ainda não sincronizado com o gateway',
    ));
  test('missing gateway token', async () => {
    delete process.env.DOM_TOKEN;
    await rejects(makeLink(), 'Token do gateway não configurado');
  });
  test('guard order: expiry wins over maxUses, maxUses over PIX flag', async () => {
    await rejects(
      makeLink({
        expiresAt: new Date(Date.now() - 1),
        maxUses: 1,
        currentUses: 1,
        aceitaPix: false,
      }),
      'Link de pagamento expirado',
    );
    await rejects(
      makeLink({ maxUses: 1, currentUses: 1, aceitaPix: false }),
      'Limite de usos do link atingido',
    );
  });
});

describe('Areaflix seller net', () => {
  test('legacy path: net = gross * LIQUIDEZ(0.9301) - TAXA_SERVICO(4), rounded to cents', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeLink({ plataformas: ['AREAFLIX'] }));
      await f.service.execute(f.input);
      expect(money(f.db.row())).toEqual({
        amount: 100,
        netAmount: 89.01,
        totalFee: 10.99,
        domFee: 0.98,
        platformFee: 10.01,
      });
    });
  });

  test('detected by webhook-less plataformas only (lowercase tag still matches)', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeLink({ plataformas: ['areaflix'] }));
      await f.service.execute(f.input);
      expect(money(f.db.row()).netAmount).toBe(89.01);
    });
  });

  test('with order bump, Areaflix net is computed on the bumped total', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeLink({ plataformas: ['AREAFLIX'] }), {
        offers: [makeOffer()],
      });
      f.input.orderBumpIds = ['bump-1'];
      await f.service.execute(f.input);
      expect(money(f.db.row())).toEqual({
        amount: 120,
        netAmount: 107.61, // 120 * 0.9301 - 4
        totalFee: 12.39,
        domFee: 1.18,
        platformFee: 11.21,
      });
    });
  });

  test('a financial quote takes precedence over the Areaflix formula', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeLink({ plataformas: ['AREAFLIX'] }), {
        financial: true,
      });
      await f.service.execute(f.input);
      expect(money(f.db.row())).not.toEqual({
        amount: 100,
        netAmount: 89.01,
        totalFee: 10.99,
        domFee: 4.99,
        platformFee: 6,
      });
      expect(f.db.row().financialSnapshot).toBeDefined();
    });
  });
});

describe('financialQuote present vs absent', () => {
  test('absent: legacy numbers and no financialSnapshot', async () => {
    const f = setup();
    await f.service.execute(f.input);
    expect(f.db.row().financialSnapshot).toBeUndefined();
    expect(money(f.db.row()).netAmount).toBe(87);
  });

  test('present: quote drives amount/net/fees and the snapshot is stored', async () => {
    const f = setup(makeLink(), { financial: true });
    const out = await f.service.execute(f.input);
    const row = f.db.row();
    // Buyer is grossed up (PIX legacy path charged exactly the base): 100 + sim 2% + R$2 + contracted cost.
    expect(out.amount).toBe(105.48);
    expect(money(row)).toEqual({
      amount: 105.48,
      netAmount: 100,
      totalFee: 5.48,
      domFee: 1.48, // contracted acquirer cost: 0.98% * 100 + R$0.50
      platformFee: 4, // sim fee: 2% * 100 + R$2
    });
    // fees are rounded to 2 decimals on the financial-quote path too (no float noise)
    expect(row.totalFee.toNumber()).toBe(5.48);
    expect(row.platformFee.toNumber()).toBe(4);
    expect(row.financialSnapshot).toBeDefined();
    expect(row.settlementBasis).toBe('FINAL_NET');
    expect(row.status).toBe('PENDING');
    expect(f.gatewayCalls[0].input.amount).toBe(out.amount);
  });
});

describe('coproduction snapshot', () => {
  const agreement = {
    version: 3,
    participants: [{ userId: 'co-1', percentageBps: 3000 }],
  };

  test('legacy path: snapshot stored under financialSnapshot.coproduction only', async () => {
    const f = setup(makeLink(), { agreement });
    await f.service.execute(f.input);
    expect(f.db.row().financialSnapshot).toEqual({
      coproduction: {
        basis: 'NET',
        version: 3,
        product: 'links-pagamento',
        productId: 'link',
        ownerUserId: 'owner',
        participants: [{ userId: 'co-1', percentageBps: 3000 }],
      },
      // no quote: allocateNet is not run and no coproductionLegacy block is added on the link path
    });
  });

  test('quote path: coproduction is merged into the quote snapshot', async () => {
    const f = setup(makeLink(), { agreement, financial: true });
    await f.service.execute(f.input);
    const snap = f.db.row().financialSnapshot;
    expect(snap.coproduction).toMatchObject({
      basis: 'NET',
      version: 3,
      product: 'links-pagamento',
      productId: 'link',
      ownerUserId: 'owner',
      participants: [{ userId: 'co-1', percentageBps: 3000 }],
    });
    expect(snap.originalCents).toBe(10000);
  });

  test('owner listed as participant is dropped; empty remainder means no snapshot', async () => {
    const f = setup(makeLink(), {
      agreement: {
        version: 1,
        participants: [{ userId: 'owner', percentageBps: 5000 }],
      },
    });
    await f.service.execute(f.input);
    expect(f.db.row().financialSnapshot).toBeUndefined();
  });
});

describe('gateway failure', () => {
  test('ambiguous error leaves the DRAFT in place and does not consume a use', async () => {
    const f = setup(makeLink(), {}, async () => {
      throw new Error('timeout');
    });
    await expect(f.service.execute(f.input)).rejects.toThrow('timeout');
    expect(f.db.rows()).toHaveLength(1);
    expect(f.db.row().status).toBe('DRAFT');
    expect(f.db.row().domPaymentId).toBeNull();
    expect(f.linkUpdates).toHaveLength(0);
    expect(f.db.offerSales).toHaveLength(0);
  });
});
