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
  const db = makeFakePrisma({ financial: true, ...opts });
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

describe('editable financial policy', () => {
  test('missing policy rejects before draft, gateway or use reservation', async () => {
    const f = setup(makeBoleto(), { financial: false });

    await expect(f.service.execute(f.input)).rejects.toThrow(
      'Taxas da plataforma não configuradas',
    );
    expect(f.gatewayCalls).toHaveLength(0);
    expect(f.db.rows()).toHaveLength(0);
    expect(f.updates).toHaveLength(0);
  });

  test('configured PIX freezes amount, fees and seller net before gateway', async () => {
    const f = setup(makeBoleto(), { financial: true });

    const out = await f.service.execute(f.input);
    expect(f.gatewayCalls[0].draft.status).toBe('DRAFT');
    expect(f.gatewayCalls[0].draft.settlementBasis).toBe('FINAL_NET');
    expect(f.gatewayCalls[0].input.description).toContain('[LINK_CHARGE:');
    expect(out.amount).toBe(100);
    expect(money(f.db.row())).toEqual({
      amount: 100,
      netAmount: 94.52,
      totalFee: 5.48,
      domFee: 1.48,
      platformFee: 4,
    });
    expect(f.db.row().financialSnapshot.originalCents).toBe(10000);
    expect(f.db.row().status).toBe('PENDING');
    expect(f.db.wallet().balance.toNumber()).toBe(0);
  });

  test('Areaflix uses the configured policy without a special seller-net formula', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeBoleto({ plataformas: ['AREAFLIX'] }), {
        financial: true,
      });

      await f.service.execute(f.input);
      expect(money(f.db.row()).netAmount).toBe(94.52);
      expect(f.db.row().financialSnapshot.originalCents).toBe(10000);
    });
  });

  test('expired product rejects without charging even with policy configured', async () => {
    const f = setup(makeBoleto({ expiresAt: new Date(Date.now() - 1000) }), {
      financial: true,
    });

    await expect(f.service.execute(f.input)).rejects.toThrow();
    expect(f.gatewayCalls).toHaveLength(0);
    expect(f.db.rows()).toHaveLength(0);
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
