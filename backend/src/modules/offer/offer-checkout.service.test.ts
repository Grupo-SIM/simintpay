import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import {
  PIX_LANE_POLICY,
  useEmptyCaches,
} from '../../application/use-cases/payment-link/charge-characterization.fixture';
import { Acquirer } from '../../core/services/acquirer.enum';
import { acquirerCapabilities } from '../../core/services/acquirer-capabilities';
import { ExternalRefService } from '../billing-core/external-ref.service';
import { markChargeSettled } from '../billing-core/charge-settlement';
import { OfferCheckoutService } from './offer-checkout.service';
import { makeOffer, makeOfferDb, money } from './offer-checkout.fixture';

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
const card = {
  token: 'tok',
  exp_month: '12',
  exp_year: '2030',
  cvv: '123',
  holder_name: 'Ana',
  holder_document: '12345678909',
};

function setup(
  offerOver: Record<string, unknown> = {},
  gw: { pixError?: any; cardStatus?: string; acquirer?: Acquirer } = {},
) {
  const offer = makeOffer(offerOver);
  const db = makeOfferDb(offer);
  const policy = structuredClone(PIX_LANE_POLICY);
  for (const method of ['CREDIT_CARD', 'DEBIT_CARD']) {
    for (let n = 1; n <= (method === 'CREDIT_CARD' ? 12 : 1); n++)
      policy.lanes[`DOM/${method}/ONLINE/${n}`] = structuredClone(
        policy.lanes['DOM/PIX/ONLINE/1'],
      );
  }
  db.prisma.financialPolicyRevision.findMany = async () => [
    { tag: 'GLOBAL', version: 1, document: policy },
  ];
  const calls: any = { create: [], pix: [], card: [] };
  const gateway: any = {
    createPaymentLink: async (_t: string, input: any) => {
      calls.create.push(input);
      return { id: 'dom-link-1' };
    },
    chargePixForLink: async (_t: string, input: any) => {
      calls.pix.push({ input, draft: { ...db.base.row() } });
      if (gw.pixError) throw gw.pixError;
      return {
        id:
          calls.pix.length === 1
            ? 'dom-pay-1'
            : `dom-pay-1-${calls.pix.length}`,
        status: 'pending',
        pixContent: '000201pix',
        qrCode: 'qr',
        pixExpire: '2026-12-01T10:00:00Z',
        amount: input.amount,
      };
    },
    chargePaymentLink: async (_t: string, input: any) => {
      calls.card.push({ input, draft: { ...db.base.row() } });
      return { id: 'dom-pay-2', status: gw.cardStatus ?? 'pending' };
    },
  };
  const acquirer = gw.acquirer ?? Acquirer.DOM;
  const resolver: any = {
    acquirerForSlug: () => acquirer,
    capabilitiesFor: acquirerCapabilities,
    byAcquirer: () => gateway,
  };
  const users: any = { findById: async () => ({ id: 'owner' }) };
  const service = new OfferCheckoutService(
    db.prisma,
    users,
    resolver,
    new ExternalRefService(db.prisma),
  );
  return { service, db, offer, calls };
}

describe('OfferCheckoutService', () => {
  test('PIX: writes Charge + FINAL_NET draft before the gateway, persists after, links gateway id once', async () => {
    const { service, db, offer, calls } = setup();
    const out = await service.charge(offer.code, {
      paymentMethod: 'pix',
      ...buyer,
    });

    expect(Object.keys(out).sort()).toEqual(
      [
        'amount',
        'chargeId',
        'id',
        'pixContent',
        'pixExpire',
        'qrCode',
        'status',
        'transactionId',
      ].sort(),
    );
    expect(out.pixContent).toBe('000201pix');
    expect(calls.pix[0].draft.status).toBe('DRAFT');
    expect(calls.pix[0].draft.settlementBasis).toBe('FINAL_NET');
    expect(calls.pix[0].input.domLinkId).toBe('dom-link-1');
    expect(calls.pix[0].input.codExternal).toBe(out.transactionId);
    expect(calls.pix[0].input.description).toContain(
      `[LINK_CHARGE:${out.transactionId}]`,
    );
    const row = db.base.row();
    expect(row.status).toBe('PENDING');
    expect(row.domPaymentId).toBe('dom-pay-1');
    expect(row.paymentLinkId).toBeUndefined();
    expect(money(row.amount)).toBe(100);
    expect(db.charges).toHaveLength(1);
    expect(db.charges[0]).toMatchObject({
      offerId: offer.id,
      transactionId: out.transactionId,
      status: 'PENDING',
      method: 'PIX',
      amountCents: 10000,
    });
    expect(offer.usedCount).toBe(1);

    await service.charge(offer.code, { paymentMethod: 'pix', ...buyer });
    expect(calls.create).toHaveLength(1);
    expect(db.refs).toHaveLength(1);
  });

  test('coproduction agreement is read under `ofertas` with the offer id, migrated or not', async () => {
    async function lookups(offerOver: Record<string, unknown>) {
      const { service, db, offer } = setup(offerOver);
      const seen: unknown[][] = [];
      const original = db.prisma.$queryRaw;
      db.prisma.$queryRaw = async (strings: any, ...values: unknown[]) => {
        const sql = Array.isArray(strings)
          ? strings.join('?')
          : String(strings);
        if (sql.includes('CoproductionAgreement')) seen.push(values);
        return original(strings, ...values);
      };
      await service.charge(offer.code, { paymentMethod: 'pix', ...buyer });
      return { seen, offer };
    }

    const native = await lookups({});
    expect(native.seen[0]).toEqual(['ofertas', native.offer.id]);

    // A migrated offer keeps the legacy id; the migration renamed its agreement to `ofertas`.
    const migrated = await lookups({
      legacyType: 'PaymentLink',
      legacyId: 'legacy-link-1',
    });
    expect(migrated.seen[0]).toEqual(['ofertas', migrated.offer.id]);
  });

  test('fees follow the editable financial policy', async () => {
    const { service, db, offer } = setup();
    await service.charge(offer.code, { paymentMethod: 'pix', ...buyer });
    const row = db.base.row();
    expect(money(row.netAmount)).toBe(92);
    expect(money(row.amount)).toBe(100);
    expect(row.financialSnapshot.policyTag).toBe('GLOBAL');
  });

  test('missing policy blocks the gateway and draft creation', async () => {
    const { service, db, offer, calls } = setup();
    db.prisma.financialPolicyRevision.findMany = async () => [];
    await expect(
      service.charge(offer.code, { paymentMethod: 'pix', ...buyer }),
    ).rejects.toThrow('não configuradas');
    expect(calls.pix).toHaveLength(0);
    expect(db.charges).toHaveLength(0);
  });

  test('credit card with installments within maxInstallments; approved settles the Charge', async () => {
    const { service, db, offer } = setup({}, { cardStatus: 'paid' });
    const out = await service.charge(offer.code, {
      paymentMethod: 'credit_card',
      installments: 3,
      card,
      ...buyer,
    });
    expect(out).toMatchObject({
      id: 'dom-pay-2',
      status: 'paid',
      pixContent: null,
      redirectUrl: null,
    });
    expect(db.base.row().status).toBe('COMPLETED');
    expect(db.base.row().installments).toBe(3);
    expect(db.charges[0].status).toBe('PAID');
    expect(db.charges[0].paidAt).toBeInstanceOf(Date);
  });

  test('rejects unsupported / unaccepted / invalid requests without touching money', async () => {
    const pixOnly = setup({ acceptedMethods: ['PIX'] });
    await expect(
      pixOnly.service.charge(pixOnly.offer.code, {
        paymentMethod: 'credit_card',
        card,
        ...buyer,
      }),
    ).rejects.toThrow('não aceita');

    const over = setup();
    await expect(
      over.service.charge(over.offer.code, {
        paymentMethod: 'credit_card',
        installments: 4,
        card,
        ...buyer,
      }),
    ).rejects.toThrow('Parcelamento');
    await expect(
      over.service.charge(over.offer.code, {
        paymentMethod: 'credit_card',
        ...buyer,
      }),
    ).rejects.toThrow('cartão');

    const frendz = setup({}, { acquirer: Acquirer.FRENDZ });
    await expect(
      frendz.service.charge(frendz.offer.code, {
        paymentMethod: 'credit_card',
        card,
        ...buyer,
      }),
    ).rejects.toThrow('adquirente');

    const sub = setup({ renewalMode: 'AUTO_CHARGE' });
    await expect(
      sub.service.charge(sub.offer.code, { paymentMethod: 'pix', ...buyer }),
    ).rejects.toThrow('assinatura');

    for (const s of [pixOnly, over, frendz, sub]) {
      expect(s.db.base.rows()).toHaveLength(0);
      expect(s.db.charges).toHaveLength(0);
      expect(s.offer.usedCount).toBe(0);
    }
  });

  test('inactive, expired and exhausted offers are refused', async () => {
    const past = new Date(Date.now() - 1000);
    for (const over of [{ isActive: false }, { expiresAt: past }]) {
      const s = setup(over);
      await expect(
        s.service.charge(s.offer.code, { paymentMethod: 'pix', ...buyer }),
      ).rejects.toThrow('não encontrada');
    }
    const used = setup({ maxUses: 1, usedCount: 1 });
    await expect(
      used.service.charge(used.offer.code, { paymentMethod: 'pix', ...buyer }),
    ).rejects.toThrow('Limite');
    const missing = setup();
    await expect(
      missing.service.charge('NOPE', { paymentMethod: 'pix', ...buyer }),
    ).rejects.toThrow('não encontrada');
  });

  test('concurrent buyers cannot exceed maxUses', async () => {
    const { service, offer, db } = setup({ maxUses: 2 });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.charge(offer.code, { paymentMethod: 'pix', ...buyer }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(offer.usedCount).toBe(2);
    expect(db.charges).toHaveLength(2);
  });

  test('definitive gateway rejection discards draft and Charge and releases the use', async () => {
    const error: any = Object.assign(new Error('rejected'), {});
    const { markPreDispatchNoCharge } =
      await import('../unified-platform/payments/dom-rejection');
    markPreDispatchNoCharge(error);
    const { service, offer, db } = setup({ maxUses: 1 }, { pixError: error });
    await expect(
      service.charge(offer.code, { paymentMethod: 'pix', ...buyer }),
    ).rejects.toThrow('rejected');
    expect(db.base.rows()).toHaveLength(0);
    expect(db.charges).toHaveLength(0);
    expect(offer.usedCount).toBe(0);
  });

  test('ambiguous gateway failure keeps draft, Charge and the reserved use', async () => {
    const { service, offer, db } = setup(
      {},
      { pixError: new Error('timeout') },
    );
    await expect(
      service.charge(offer.code, { paymentMethod: 'pix', ...buyer }),
    ).rejects.toThrow('timeout');
    expect(db.base.row().status).toBe('DRAFT');
    expect(db.charges).toHaveLength(1);
    expect(offer.usedCount).toBe(1);
  });
});

describe('markChargeSettled', () => {
  test('PAID on COMPLETED, idempotent, ignores refunds and non-final states', async () => {
    const { extra, charges } = makeOfferDb(makeOffer());
    await extra.charge.create({
      data: { transactionId: 'tx', status: 'PENDING' },
    });
    expect(await markChargeSettled(extra as never, 'tx', 'PENDING')).toBe(
      false,
    );
    expect(await markChargeSettled(extra as never, 'tx', 'COMPLETED')).toBe(
      true,
    );
    expect(charges[0].status).toBe('PAID');
    const paidAt = charges[0].paidAt;
    expect(await markChargeSettled(extra as never, 'tx', 'COMPLETED')).toBe(
      false,
    );
    expect(await markChargeSettled(extra as never, 'tx', 'FAILED')).toBe(false);
    expect(await markChargeSettled(extra as never, 'tx', 'REFUNDED')).toBe(
      false,
    );
    expect(charges[0].paidAt).toBe(paidAt);
    expect(
      await markChargeSettled(extra as never, 'missing', 'COMPLETED'),
    ).toBe(false);
  });
});
