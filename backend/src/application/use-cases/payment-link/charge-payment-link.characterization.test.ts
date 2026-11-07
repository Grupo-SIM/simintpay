import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { ChargePaymentLinkUseCase } from './charge-payment-link.use-case';
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
  gatewayStatus = 'pending',
) {
  const db = makeFakePrisma({ financial: true, ...opts });
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

describe('editable financial policy', () => {
  test('missing policy rejects before draft, gateway or use reservation', async () => {
    const f = setup(makeLink(), { financial: false });
    f.input.paymentMethod = 'pix';
    f.input.card = undefined;
    await expect(f.service.execute(f.input)).rejects.toThrow(
      'Taxas da plataforma não configuradas',
    );
    expect(f.gatewayCalls).toHaveLength(0);
    expect(f.db.rows()).toHaveLength(0);
    expect(f.linkUpdates).toHaveLength(0);
  });

  test('configured PIX freezes amount, fees and seller net before gateway', async () => {
    const f = setup(makeLink(), { financial: true });
    f.input.paymentMethod = 'pix';
    f.input.card = undefined;
    const out = await f.service.execute(f.input);
    expect(out.status).toBe('pending');
    expect(f.gatewayCalls[0].input.amount).toBe(100);
    expect(f.gatewayCalls[0].draft.status).toBe('DRAFT');
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
      const f = setup(makeLink({ plataformas: ['AREAFLIX'] }), {
        financial: true,
      });
      f.input.paymentMethod = 'pix';
      f.input.card = undefined;
      await f.service.execute(f.input);
      expect(money(f.db.row()).netAmount).toBe(94.52);
      expect(f.db.row().financialSnapshot.originalCents).toBe(10000);
    });
  });

  test('expired product rejects without charging even with policy configured', async () => {
    const f = setup(makeLink({ expiresAt: new Date(Date.now() - 1000) }), {
      financial: true,
    });
    f.input.paymentMethod = 'pix';
    f.input.card = undefined;
    await expect(f.service.execute(f.input)).rejects.toThrow();
    expect(f.gatewayCalls).toHaveLength(0);
    expect(f.db.rows()).toHaveLength(0);
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
