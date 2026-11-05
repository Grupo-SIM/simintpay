import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { ChargeBoletoPixUseCase } from './charge-boleto-pix.use-case';
import {
  makeFakePrisma,
  money,
  useEmptyCaches,
  withAreaflixPlatform,
  type FixtureOptions,
} from '../payment-link/charge-characterization.fixture';

/**
 * CHARACTERIZATION of ChargeBoletoPixUseCase (PIX charged against a boleto link).
 * Always settles FINAL_NET (DRAFT -> gateway -> persistLinkCharge). Without a financial quote the net
 * follows exactly what a PIX payment link of the same amount nets (Areaflix included).
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

function makeBoleto(over: Record<string, unknown> = {}): any {
  return {
    id: 'boleto',
    userId: 'owner',
    isActive: true,
    domPaymentLinkId: 'dom-link',
    amount: 100,
    title: 'Boleto',
    description: null,
    plataformas: ['GLOBAL'],
    maxUses: null,
    currentUses: 0,
    expiresAt: null,
    ...over,
  };
}

function setup(boleto: any = makeBoleto(), opts: FixtureOptions = {}) {
  const db = makeFakePrisma(opts);
  const gatewayCalls: { token: string; input: any; draft: any }[] = [];
  const updates: any[] = [];
  const gateway: any = {
    chargePixForLink: async (token: string, input: any) => {
      gatewayCalls.push({
        token,
        input,
        draft: db.row() ? { ...db.row() } : undefined,
      });
      return {
        id: 'dom-pay-1',
        status: 'pending',
        pixContent: 'pix-copy-paste',
        qrCode: 'qr',
        pixExpire: null,
      };
    },
  };
  const service = new ChargeBoletoPixUseCase(
    {
      findById: async () => boleto,
      update: async (id: string, data: any) => {
        updates.push({ id, data });
        return boleto;
      },
    } as never,
    { findById: async () => ({ id: 'owner' }) } as never,
    gateway,
    db.prisma,
  );
  const input: any = {
    boletoId: 'boleto',
    customerName: 'Buyer',
    customerEmail: 'buyer@example.test',
    customerDocument: '123.456.789-01',
    customerPhone: '(81) 99999-9999',
  };
  return { service, input, db, gatewayCalls, updates };
}

describe('without financial quote (same rule as a PIX payment link)', () => {
  test('numbers: net = base - (9% + R$4) = 87, domFee from MDR_PIX (FIXED)', async () => {
    const f = setup();
    const out = await f.service.execute(f.input);
    expect(out.amount).toBe(100);
    expect(f.gatewayCalls[0].input.amount).toBe(100);
    // before: net 83 (extra R$3 cashback + R$1 fixed), totalFee 17, domFee 0, platformFee 17
    expect(money(f.db.row())).toEqual({
      amount: 100,
      netAmount: 87,
      totalFee: 13,
      domFee: 0.98,
      platformFee: 12.02,
    });
  });

  test('always a DRAFT -> PENDING FINAL_NET charge with the link reference', async () => {
    const f = setup();
    await f.service.execute(f.input);
    expect(f.gatewayCalls[0].draft.status).toBe('DRAFT');
    expect(f.gatewayCalls[0].draft.settlementBasis).toBe('FINAL_NET');
    expect(f.gatewayCalls[0].input.description).toContain('[LINK_CHARGE:');
    expect(f.gatewayCalls[0].input.codExternal).toMatch(
      /^pix-boleto-boleto-\d+$/,
    );
    expect(f.gatewayCalls[0].input.documentType).toBe('CPF');
    const row = f.db.row();
    expect(f.db.rows()).toHaveLength(1);
    expect(row.status).toBe('PENDING');
    expect(row.settlementBasis).toBe('FINAL_NET');
    expect(row.domPaymentId).toBe('dom-pay-1');
    expect(row.pixContent).toBe('pix-copy-paste');
    expect(row.description).toBe('Boleto [TENANT:GLOBAL]');
    expect(f.db.wallet().balance.toNumber()).toBe(0);
  });

  test('currentUses +1 on the boleto', async () => {
    const f = setup(makeBoleto({ currentUses: 4 }));
    await f.service.execute(f.input);
    expect(f.updates).toEqual([{ id: 'boleto', data: { currentUses: 5 } }]);
  });

  test('non-GLOBAL platform: tenant marker and token from the platform', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeBoleto({ plataformas: ['AREAFLIX'] }));
      await f.service.execute(f.input);
      expect(f.gatewayCalls[0].token).toBe('areaflix-token');
      expect(f.db.row().description).toBe('Boleto [TENANT:AREAFLIX]');
    });
  });

  test('Areaflix boleto-PIX nets the Areaflix seller net, like an Areaflix PIX link (FIXED)', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeBoleto({ plataformas: ['AREAFLIX'] }));
      await f.service.execute(f.input);
      // before: net 83, totalFee 17, domFee 0, platformFee 17
      expect(money(f.db.row())).toEqual({
        amount: 100,
        netAmount: 89.01,
        totalFee: 10.99,
        domFee: 0.98,
        platformFee: 10.01,
      });
    });
  });
});

describe('financialQuote present', () => {
  test('uses the DRAFT -> FINAL_NET path with quote numbers and snapshot', async () => {
    const f = setup(makeBoleto(), { financial: true });
    const out = await f.service.execute(f.input);
    expect(f.gatewayCalls[0].draft.status).toBe('DRAFT');
    expect(f.gatewayCalls[0].draft.settlementBasis).toBe('FINAL_NET');
    expect(f.gatewayCalls[0].input.description).toContain('[LINK_CHARGE:');
    expect(out.amount).toBe(105.48);
    expect(money(f.db.row())).toEqual({
      amount: 105.48,
      netAmount: 100,
      totalFee: 5.48,
      domFee: 1.48,
      platformFee: 4,
    });
    expect(f.db.row().status).toBe('PENDING');
    expect(f.db.row().settlementBasis).toBe('FINAL_NET');
    expect(f.db.row().financialSnapshot.originalCents).toBe(10000);
    expect(f.db.row().description).toBe('Boleto [TENANT:GLOBAL]');
    expect(f.db.row().customerPhone).toBe('81999999999');
  });
});

describe('coproduction snapshot', () => {
  test('coproduction alone (no quote) keeps the FINAL_NET path with the link PIX numbers', async () => {
    const f = setup(makeBoleto(), {
      agreement: {
        version: 1,
        participants: [{ userId: 'co-1', percentageBps: 4000 }],
      },
    });
    await f.service.execute(f.input);
    expect(f.gatewayCalls[0].draft.status).toBe('DRAFT');
    expect(f.db.row().settlementBasis).toBe('FINAL_NET');
    expect(money(f.db.row())).toEqual({
      amount: 100,
      netAmount: 87,
      totalFee: 13,
      domFee: 0.98,
      platformFee: 12.02,
    });
    expect(f.db.row().financialSnapshot.coproduction).toMatchObject({
      basis: 'NET',
      version: 1,
      product: 'boletos',
      productId: 'boleto',
      ownerUserId: 'owner',
      participants: [{ userId: 'co-1', percentageBps: 4000 }],
    });
    expect(f.db.row().financialSnapshot.coproductionLegacy).toBeUndefined();
  });
});

describe('guards (nothing written, gateway untouched)', () => {
  async function rejects(boleto: any, message: string) {
    const f = setup(boleto);
    const err: any = await f.service.execute(f.input).catch((e) => e);
    expect(err.message).toBe(message);
    expect(f.db.rows()).toHaveLength(0);
    expect(f.gatewayCalls).toHaveLength(0);
    expect(f.updates).toHaveLength(0);
  }
  test('expired', () =>
    rejects(
      makeBoleto({ expiresAt: new Date(Date.now() - 1) }),
      'Boleto expirado',
    ));
  test('maxUses reached', () =>
    rejects(
      makeBoleto({ maxUses: 1, currentUses: 1 }),
      'Limite de usos do boleto atingido',
    ));
  test('inactive', () =>
    rejects(
      makeBoleto({ isActive: false }),
      'Boleto não encontrado ou inativo',
    ));
  test('not synced', () =>
    rejects(
      makeBoleto({ domPaymentLinkId: null }),
      'Boleto ainda não sincronizado com o gateway',
    ));
  test('no order bump / funnel support: those inputs are ignored', async () => {
    const f = setup();
    f.input.orderBumpIds = ['x'];
    f.input.offerId = 'y';
    await f.service.execute(f.input);
    expect(money(f.db.row()).amount).toBe(100);
    expect(f.db.offerSales).toHaveLength(0);
  });
});
