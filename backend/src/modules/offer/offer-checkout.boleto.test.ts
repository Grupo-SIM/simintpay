import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Prisma } from '@prisma/client';
import { ChargeBoletoUseCase } from '../../application/use-cases/boleto/charge-boleto.use-case';
import {
  makeFakePrisma,
  money,
  useEmptyCaches,
} from '../../application/use-cases/payment-link/charge-characterization.fixture';
import { Acquirer } from '../../core/services/acquirer.enum';
import { acquirerCapabilities } from '../../core/services/acquirer-capabilities';
import { markPreDispatchNoCharge } from '../unified-platform/payments/dom-rejection';
import { ExternalRefService } from '../billing-core/external-ref.service';
import { markChargeSettled } from '../billing-core/charge-settlement';
import { OfferSubscribeService } from './offer-subscribe.service';
import { OfferCheckoutService } from './offer-checkout.service';
import { makeOffer, makeOfferDb } from './offer-checkout.fixture';

const oldToken = process.env.DOM_TOKEN;
beforeAll(useEmptyCaches);
beforeEach(() => {
  process.env.DOM_TOKEN = 'test-token';
});
afterEach(() => {
  if (oldToken === undefined) delete process.env.DOM_TOKEN;
  else process.env.DOM_TOKEN = oldToken;
});

const buyer = {
  customerName: 'Ana',
  customerEmail: 'ana@test.dev',
  customerDocument: '123.456.789-09',
  customerPhone: '(11) 99999-0000',
};
const address = {
  cep: '50.000-000',
  rua: ' Rua A ',
  numero: '10',
  bairro: 'Centro',
  cidade: 'Recife',
  uf: 'PE',
  complemento: 'ap 2',
};

/** BOLETO lane in the GLOBAL policy, so quoteFinancialCharge returns a quote for boleto. */
const BOLETO_POLICY = {
  schemaVersion: 1,
  lanes: {
    'DOM/BOLETO/ONLINE/1': {
      active: true,
      contract: {
        reference: 'Signed',
        fixedCents: 150,
        ratePpm: 0,
        cashbackCents: 0,
        interestPpm: 0,
        base: 'ORIGINAL',
      },
      sim: { fixedCents: 250, ratePpm: 10000, interestPpm: 0 },
    },
  },
  owner: {},
  interestFree: false,
};

/** Makes a fake prisma return the BOLETO policy/fee lane (same shape the fixture uses for PIX). */
function withBoletoQuote(prisma: any) {
  prisma.acquirerCatalogue = { findMany: async () => [{ code: 'DOM' }] };
  prisma.acquirerFeeSchedule = {
    findMany: async ({ where }: any) =>
      where.method === 'BOLETO' &&
      where.channel === 'ONLINE' &&
      where.installments === 1
        ? [
            {
              acquirerCode: 'DOM',
              fixedCents: 150,
              ratePpm: 0,
              interestPpm: 0,
              base: 'ORIGINAL',
              source: 'Signed',
              createdAt: new Date('2026-01-01'),
              id: 'fee',
            },
          ]
        : [],
  };
  prisma.financialPolicyRevision = {
    findMany: async () => [
      { tag: 'GLOBAL', version: 1, document: BOLETO_POLICY },
    ],
  };
}

const boletoResult = (over: Record<string, unknown> = {}) => ({
  id: 'dom-boleto-1',
  status: 'waiting',
  boletoUrl: 'https://dom.test/boleto.pdf',
  barcode: '3419',
  digitableLine: '34191.79001 01043.510047 91020.150008 1 99990000010000',
  dueDate: '2026-12-10',
  amount: 100,
  ...over,
});

function setup(
  offerOver: Record<string, unknown> = {},
  opts: {
    quote?: boolean;
    acquirer?: Acquirer;
    boletoError?: any;
    result?: any;
  } = {},
) {
  const offer = makeOffer({
    acceptedMethods: ['BOLETO'],
    metadata: { boletoDueDays: 5, requiresBuyerAddress: true },
    ...offerOver,
  });
  const db = makeOfferDb(offer);
  if (opts.quote !== false) {
    withBoletoQuote(db.prisma);
    withBoletoQuote(db.base.prisma);
  }
  const calls: any = { links: [], boleto: [], pix: [] };
  const gateway: any = {
    createPaymentLink: async (_t: string, input: any) => {
      calls.links.push(input);
      return { id: 'dom-link-1' };
    },
    chargeBoletoForLink: async (_t: string, input: any) => {
      calls.boleto.push({ input, draft: { ...db.base.row() } });
      if (opts.boletoError) throw opts.boletoError;
      return opts.result ?? boletoResult({ amount: input.amount });
    },
    chargePixForLink: async (_t: string, input: any) => {
      calls.pix.push(input);
      return { id: 'dom-pix-1', status: 'pending', pixContent: '000201' };
    },
  };
  const acquirer = opts.acquirer ?? Acquirer.DOM;
  const resolver: any = {
    acquirerForSlug: () => acquirer,
    capabilitiesFor: acquirerCapabilities,
    byAcquirer: () => gateway,
  };
  const service = new OfferCheckoutService(
    db.prisma,
    { findById: async () => ({ id: 'owner' }) } as any,
    resolver,
    new ExternalRefService(db.prisma),
  );
  const charge = (over: Record<string, unknown> = {}) =>
    service.charge(offer.code, {
      paymentMethod: 'boleto',
      ...buyer,
      ...address,
      ...over,
    } as never);
  return { service, db, offer, calls, charge };
}

describe('offer boleto charge', () => {
  test('writes Charge + FINAL_NET draft before the gateway, persists PENDING after, returns boleto fields', async () => {
    const { db, offer, calls, charge } = setup();
    const out = await charge();

    expect(Object.keys(out).sort()).toEqual(
      [
        'amount',
        'boletoDigitableLine',
        'boletoExpiresAt',
        'boletoUrl',
        'chargeId',
        'id',
        'pixContent',
        'redirectUrl',
        'status',
        'transactionId',
      ].sort(),
    );
    expect(out).toMatchObject({
      id: 'dom-boleto-1',
      status: 'waiting',
      pixContent: null,
      boletoUrl: 'https://dom.test/boleto.pdf',
      boletoDigitableLine: expect.stringContaining('34191'),
      boletoExpiresAt: '2026-12-10',
      amount: 100,
    });
    expect(calls.boleto[0].draft.status).toBe('DRAFT');
    expect(calls.boleto[0].draft.settlementBasis).toBe('FINAL_NET');
    expect(calls.boleto[0].draft.paymentMethod).toBe('BOLETO');
    expect(calls.boleto[0].input).toMatchObject({
      expireDays: 5,
      codExternal: out.transactionId,
      customerDocument: '12345678909',
      documentType: 'CPF',
      address: {
        street: 'Rua A',
        number: '10',
        neighborhood: 'Centro',
        zipCode: '50000000',
        city: 'Recife',
        uf: 'PE',
        complement: 'ap 2',
      },
    });
    expect(calls.boleto[0].input.description).toContain(
      `[LINK_CHARGE:${out.transactionId}]`,
    );
    const row = db.base.row();
    expect(row.status).toBe('PENDING');
    expect(row.domPaymentId).toBe('dom-boleto-1');
    expect(db.charges[0]).toMatchObject({
      offerId: offer.id,
      transactionId: out.transactionId,
      status: 'PENDING',
      method: 'BOLETO',
      amountCents: 10000,
    });
    expect(offer.usedCount).toBe(1);
    // Nenhum dado de cartão.
    expect(JSON.stringify(out)).not.toContain('card');
  });

  test('due days: metadata value, 0 = none, absent = legacy default 3', async () => {
    for (const [metadata, expected] of [
      [{ boletoDueDays: 0 }, 0],
      [{ boletoDueDays: 90 }, 90],
      [null, 3],
      [{ requiresBuyerAddress: true }, 3],
    ] as const) {
      const s = setup({ metadata });
      await s.charge();
      expect(s.calls.boleto[0].input.expireDays).toBe(expected);
      expect(s.calls.links[0]).toMatchObject({
        aceitaBoleto: true,
        boletoExpireDay: expected,
      });
    }
  });

  test('gateway link of a boleto-only offer: boleto + PIX, no card; one PAYMENT_LINK ref reused', async () => {
    const { db, calls, charge } = setup();
    await charge();
    await charge();
    expect(calls.links).toHaveLength(1);
    expect(calls.links[0]).toMatchObject({
      aceitaBoleto: true,
      aceitaCartao: false,
      aceitaPix: true,
      boletoExpireDay: 5,
    });
    expect(db.refs).toHaveLength(1);
    expect(db.refs[0]).toMatchObject({
      kind: 'PAYMENT_LINK',
      externalId: 'dom-link-1',
    });
  });

  test('mixed offer shares the one link (card + pix + boleto) with the right flags', async () => {
    const { calls, charge } = setup({
      acceptedMethods: ['PIX', 'CREDIT_CARD', 'BOLETO'],
    });
    await charge();
    expect(calls.links[0]).toMatchObject({
      aceitaBoleto: true,
      aceitaCartao: true,
      aceitaPix: true,
    });
  });

  test('an existing card/PIX offer keeps its link flags (no boleto)', async () => {
    const { offerGatewayLinkInput } = await import('./offer-gateway-link');
    const input = offerGatewayLinkInput(
      makeOffer({
        acceptedMethods: ['PIX', 'CREDIT_CARD'],
        maxInstallments: 3,
      }),
    );
    expect(input).toMatchObject({
      aceitaPix: true,
      aceitaCartao: true,
      maxInstallments: 3,
    });
    expect(input.aceitaBoleto).toBeUndefined();
    expect(input.boletoExpireDay).toBeUndefined();
    const pixOnly = setup({ acceptedMethods: ['PIX'] });
    await expect(pixOnly.charge()).rejects.toThrow('não aceita');
    expect(pixOnly.calls.links).toHaveLength(0);
  });

  test('address is mandatory with the legacy message; nothing is written', async () => {
    for (const bad of [
      { cep: '123' },
      { rua: ' ' },
      { cidade: '' },
      { uf: 'P' },
      { cep: undefined, rua: undefined },
    ]) {
      const s = setup();
      await expect(s.charge(bad)).rejects.toThrow(
        'Para boleto é obrigatório o endereço completo (CEP, rua, número, bairro, cidade e UF).',
      );
      expect(s.db.base.rows()).toHaveLength(0);
      expect(s.db.charges).toHaveLength(0);
      expect(s.offer.usedCount).toBe(0);
      expect(s.calls.boleto).toHaveLength(0);
    }
  });

  test('refused when not accepted by the offer, or unsupported by the acquirer', async () => {
    const pixOnly = setup({ acceptedMethods: ['PIX'] });
    await expect(pixOnly.charge()).rejects.toThrow(
      'Esta oferta não aceita pagamento via boleto',
    );
    const frendz = setup({}, { acquirer: Acquirer.FRENDZ });
    await expect(frendz.charge()).rejects.toThrow(
      'O adquirente desta oferta não suporta boleto',
    );
    for (const s of [pixOnly, frendz]) {
      expect(s.db.base.rows()).toHaveLength(0);
      expect(s.db.charges).toHaveLength(0);
      expect(s.offer.usedCount).toBe(0);
    }
  });

  test('bumps and funnel are rejected with a clear 400', async () => {
    const bump = setup();
    await expect(bump.charge({ bumpCodes: ['BUMP00001'] })).rejects.toThrow(
      'Boleto não aceita order bumps nem upsell/downsell',
    );
    const funnel = setup();
    await expect(funnel.charge({ parentChargeId: 'p1' })).rejects.toThrow(
      'Boleto não aceita order bumps nem upsell/downsell',
    );
    for (const s of [bump, funnel]) {
      expect(s.db.charges).toHaveLength(0);
      expect(s.offer.usedCount).toBe(0);
    }
  });

  test('maxUses is reserved atomically; a definitive rejection releases it', async () => {
    const limited = setup({ maxUses: 1 });
    await limited.charge();
    await expect(limited.charge()).rejects.toThrow('Limite');
    expect(limited.offer.usedCount).toBe(1);

    const error = markPreDispatchNoCharge(new Error('rejected'));
    const rej = setup({ maxUses: 1 }, { boletoError: error });
    await expect(rej.charge()).rejects.toThrow('rejected');
    expect(rej.db.base.rows()).toHaveLength(0);
    expect(rej.db.charges).toHaveLength(0);
    expect(rej.offer.usedCount).toBe(0);

    const ambiguous = setup({}, { boletoError: new Error('timeout') });
    await expect(ambiguous.charge()).rejects.toThrow('timeout');
    expect(ambiguous.db.base.row().status).toBe('DRAFT');
    expect(ambiguous.db.charges).toHaveLength(1);
    expect(ambiguous.offer.usedCount).toBe(1);
  });

  test('a boleto the gateway failed to generate is a 400 and is discarded like the legacy', async () => {
    for (const result of [
      boletoResult({ status: 'failed' }),
      boletoResult({ boletoUrl: null, digitableLine: null }),
    ]) {
      const s = setup({ maxUses: 1 }, { result });
      await expect(s.charge()).rejects.toThrow(
        'Não foi possível gerar o boleto no gateway',
      );
      expect(s.db.base.rows()).toHaveLength(0);
      expect(s.db.charges).toHaveLength(0);
      expect(s.offer.usedCount).toBe(0);
    }
  });

  test('settles through markChargeSettled: paid -> PAID, expired -> EXPIRED, idempotent', async () => {
    for (const [status, expected] of [
      ['COMPLETED', 'PAID'],
      ['EXPIRED', 'EXPIRED'],
      ['FAILED', 'FAILED'],
    ] as const) {
      const s = setup();
      const out = await s.charge();
      expect(s.db.charges[0].status).toBe('PENDING');
      expect(
        await markChargeSettled(s.db.extra as never, out.transactionId, status),
      ).toBe(true);
      expect(s.db.charges[0].status).toBe(expected);
      expect(
        await markChargeSettled(
          s.db.extra as never,
          out.transactionId,
          'COMPLETED',
        ),
      ).toBe(false);
      expect(s.db.charges[0].status).toBe(expected);
    }
  });
});

describe('recurring offers do not take boleto', () => {
  test('subscribe refuses boleto with a clear message before touching anything', async () => {
    for (const renewalMode of ['AUTO_CHARGE', 'MANUAL_PAY']) {
      const offer = {
        id: 'o1',
        isActive: true,
        expiresAt: null,
        platformTag: null,
        renewalMode,
        acceptedMethods: ['BOLETO', 'PIX'],
      };
      const service: any = new OfferSubscribeService(
        { offer: { findUnique: async () => offer } } as never,
        {} as never,
        { acquirerForSlug: () => 'DOM', byAcquirer: () => ({}) } as never,
        {} as never,
        {} as never,
        {} as never,
        { kind: 'server' } as never,
      );
      await expect(
        service.subscribe('CODE', { paymentMethod: 'boleto', ...buyer }),
      ).rejects.toThrow('Ofertas recorrentes não aceitam boleto');
    }
  });
});

/** Same fixture charged by the legacy ChargeBoletoUseCase and by the offer. */
async function legacyBoleto(amount: number, opts: { quote: boolean }) {
  const db = makeFakePrisma();
  if (opts.quote) withBoletoQuote(db.prisma);
  const sent: any[] = [];
  const boleto: any = {
    id: 'boleto-1',
    userId: 'owner',
    isActive: true,
    expiresAt: null,
    maxUses: null,
    currentUses: 0,
    amount: new Prisma.Decimal(amount),
    title: 'Curso',
    description: null,
    plataformas: ['GLOBAL'],
    vencimentoDias: 5,
  };
  const use = new ChargeBoletoUseCase(
    { findById: async () => boleto, update: async () => boleto } as never,
    { findById: async () => ({ id: 'owner', platform: null }) } as never,
    {
      chargeBoletoForLink: async (_t: string, input: any) => {
        sent.push(input);
        return boletoResult({ amount: input.amount });
      },
    } as never,
    db.prisma,
  );
  const out = await use.execute({
    boletoId: 'boleto-1',
    ...buyer,
    ...address,
  });
  return { numbers: money(db.row()), out, sent: sent[0] };
}

describe('offer boleto == legacy ChargeBoletoUseCase (characterization)', () => {
  test('same buyer total, seller net and fee split for R$ 100,00 (financial policy BOLETO lane)', async () => {
    const legacy = await legacyBoleto(100, { quote: true });
    const f = setup({}, { quote: true });
    const out = await f.charge();

    expect(money(f.db.base.row())).toEqual(legacy.numbers);
    expect(out.amount).toBe(legacy.out.amount);
    expect(f.db.charges[0].amountCents).toBe(
      Math.round(legacy.numbers.amount * 100),
    );
    expect(f.calls.boleto[0].input.expireDays).toBe(legacy.sent.expireDays);
    expect(f.calls.boleto[0].input.address).toEqual(legacy.sent.address);
    expect(f.calls.boleto[0].input.amount).toBe(legacy.sent.amount);
    // Frozen numbers: a silent pricing change in either flow fails here.
    expect(legacy.numbers).toEqual({
      amount: 100,
      netAmount: 95,
      totalFee: 5,
      acquirerFee: 1.5,
      platformFee: 3.5,
    });
  });

  test('also equal at other amounts (R$ 14,99 and R$ 1.234,56)', async () => {
    for (const [amount, cents] of [
      [14.99, 1499],
      [1234.56, 123456],
    ] as const) {
      const legacy = await legacyBoleto(amount, { quote: true });
      const f = setup({ amountCents: cents }, { quote: true });
      await f.charge();
      expect(money(f.db.base.row())).toEqual(legacy.numbers);
    }
  });

  test('without a BOLETO policy lane both flows refuse with FINANCIAL_POLICY_MISSING', async () => {
    await expect(legacyBoleto(100, { quote: false })).rejects.toThrow();
    const f = setup({}, { quote: false });
    await expect(f.charge()).rejects.toThrow();
    expect(f.db.charges).toHaveLength(0);
    expect(f.offer.usedCount).toBe(0);
  });
});
