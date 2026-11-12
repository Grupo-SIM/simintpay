import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { ChargePixPaymentLinkUseCase } from './charge-pix-payment-link.use-case';
import {
  makeFakePrisma,
  makeLink,
  money,
  useEmptyCaches,
  withAreaflixPlatform,
  type FixtureOptions,
} from './charge-characterization.fixture';

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
  const db = makeFakePrisma({ financial: true, ...opts });
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

describe('editable financial policy', () => {
  test('missing policy rejects before draft, gateway or use reservation', async () => {
    const f = setup(makeLink(), { financial: false });

    await expect(f.service.execute(f.input)).rejects.toThrow(
      'Taxas da plataforma não configuradas',
    );
    expect(f.gatewayCalls).toHaveLength(0);
    expect(f.db.rows()).toHaveLength(0);
    expect(f.linkUpdates).toHaveLength(0);
  });

  test('configured PIX freezes amount, fees and seller net before gateway', async () => {
    const f = setup(makeLink(), { financial: true });

    const out = await f.service.execute(f.input);
    expect(out.amount).toBe(100);
    expect(f.gatewayCalls[0].input.amount).toBe(100);
    expect(f.gatewayCalls[0].draft.status).toBe('DRAFT');
    expect(money(f.db.row())).toEqual({
      amount: 100,
      netAmount: 94.52,
      totalFee: 5.48,
      acquirerFee: 1.48,
      platformFee: 4,
    });
    expect(f.db.row().financialSnapshot.originalCents).toBe(10000);
    expect(f.db.row().status).toBe('PENDING');
    expect(f.db.wallet().balance.toNumber()).toBe(0);
  });

  test('Areaflix uses the configured policy without a special seller-net formula', async () => {
    await withAreaflixPlatform(async () => {
      const f = setup(makeLink({ plataformas: ['AREAFLIX'] }), {
        financial: true,
      });

      await f.service.execute(f.input);
      expect(money(f.db.row()).netAmount).toBe(94.52);
      expect(f.db.row().financialSnapshot.originalCents).toBe(10000);
    });
  });

  test('expired product rejects without charging even with policy configured', async () => {
    const f = setup(makeLink({ expiresAt: new Date(Date.now() - 1000) }), {
      financial: true,
    });

    await expect(f.service.execute(f.input)).rejects.toThrow();
    expect(f.gatewayCalls).toHaveLength(0);
    expect(f.db.rows()).toHaveLength(0);
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
