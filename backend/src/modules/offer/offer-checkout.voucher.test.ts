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
import { markPreDispatchNoCharge } from '../unified-platform/payments/dom-rejection';
import { OfferCheckoutService } from './offer-checkout.service';
import { OfferFulfillmentService } from './offer-fulfillment.service';
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

const voucherRow = (over: Record<string, unknown> = {}) => ({
  id: 'voucher-1',
  userId: 'owner',
  code: 'OFF20',
  isActive: true,
  discountType: 'PERCENTAGE',
  discountValue: 20,
  maxUsage: null,
  usageCount: 0,
  maxDiscountValue: null,
  validFrom: null,
  validUntil: null,
  minOrderValue: null,
  applicablePlans: [],
  allowedLinkCodes: [],
  allowedChannels: ['PAGATG'],
  ...over,
});

function setup(
  offerOver: Record<string, unknown> = {},
  gw: { pixError?: unknown } = {},
  vouchers = [voucherRow()],
) {
  const offer = makeOffer(offerOver);
  const db = makeOfferDb(offer);
  const policy = structuredClone(PIX_LANE_POLICY);
  db.prisma.financialPolicyRevision.findMany = async () => [
    { tag: 'GLOBAL', version: 1, document: policy },
  ];
  // Voucher table + usage rows, with the unique (voucherId, transactionId) index.
  const usages: any[] = [];
  const voucherDb = {
    findFirst: async ({ where }: any) =>
      vouchers.find(
        (v) => v.userId === where.userId && v.code === where.code,
      ) ?? null,
    update: async ({ where, data }: any) => {
      const v = vouchers.find((x) => x.id === where.id)!;
      v.usageCount += data.usageCount.increment;
      return v;
    },
  };
  const voucherUsage = {
    createMany: async ({ data }: any) => {
      let count = 0;
      for (const row of data)
        if (
          !usages.some(
            (u) =>
              u.voucherId === row.voucherId &&
              u.transactionId === row.transactionId,
          )
        ) {
          usages.push(row);
          count++;
        }
      return { count };
    },
  };
  db.prisma.voucher = voucherDb;
  db.prisma.voucherUsage = voucherUsage;
  const original$transaction = db.prisma.$transaction;
  db.prisma.$transaction = (fn: any) =>
    original$transaction((p: any) =>
      fn({ ...p, voucher: voucherDb, voucherUsage }),
    );

  const calls: { pix: any[] } = { pix: [] };
  const gateway: any = {
    createPaymentLink: async () => ({ id: 'dom-link-1' }),
    chargePixForLink: async (_t: string, input: any) => {
      calls.pix.push(input);
      if (gw.pixError) throw gw.pixError;
      return {
        id: `dom-pay-${calls.pix.length}`,
        status: 'pending',
        pixContent: '000201pix',
        qrCode: 'qr',
        pixExpire: '2026-12-01T10:00:00Z',
        amount: input.amount,
      };
    },
  };
  const resolver: any = {
    acquirerForSlug: () => Acquirer.DOM,
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
  return { service, db, offer, calls, vouchers, usages };
}

describe('offer checkout voucher', () => {
  test('the discount applies to the sale before fees (same fees as an offer priced at the discounted amount)', async () => {
    const withVoucher = setup();
    const out = await withVoucher.service.charge(withVoucher.offer.code, {
      paymentMethod: 'pix',
      voucherCode: 'off20',
      ...buyer,
    });
    const plain = setup({ amountCents: 8000 });
    await plain.service.charge(plain.offer.code, {
      paymentMethod: 'pix',
      ...buyer,
    });

    const a = withVoucher.db.base.row();
    const b = plain.db.base.row();
    expect(money(a.amount)).toBe(money(b.amount));
    expect(money(a.netAmount)).toBe(money(b.netAmount));
    expect(money(a.totalFee)).toBe(money(b.totalFee));
    expect(out.amount).toBe(money(b.amount));
    expect(withVoucher.calls.pix[0].amount).toBe(out.amount);
    expect(withVoucher.db.charges[0].snapshot).toMatchObject({
      baseAmountCents: 8000,
      voucher: {
        voucherId: 'voucher-1',
        code: 'OFF20',
        originalAmountCents: 10000,
        discountAmountCents: 2000,
        finalAmountCents: 8000,
      },
    });
  });

  test('charging does not consume a use; a pre-dispatch rejection leaves nothing behind', async () => {
    const error = markPreDispatchNoCharge(new Error('rejected'));
    const { service, offer, vouchers, usages, db } = setup(
      {},
      { pixError: error },
    );
    await expect(
      service.charge(offer.code, {
        paymentMethod: 'pix',
        voucherCode: 'OFF20',
        ...buyer,
      }),
    ).rejects.toThrow('rejected');
    expect(vouchers[0].usageCount).toBe(0);
    expect(usages).toHaveLength(0);
    expect(db.charges).toHaveLength(0);
  });

  test('a pending charge does not consume a use either, and FAILED never does', async () => {
    const { service, offer, vouchers, usages, db } = setup();
    const out = await service.charge(offer.code, {
      paymentMethod: 'pix',
      voucherCode: 'OFF20',
      ...buyer,
    });
    expect(vouchers[0].usageCount).toBe(0);
    await markChargeSettled(db.extra as never, out.transactionId, 'FAILED');
    expect(db.charges[0].status).toBe('FAILED');
    expect(vouchers[0].usageCount).toBe(0);
    expect(usages).toHaveLength(0);
  });

  test('payment records the use once, however often the settle event repeats', async () => {
    const { service, offer, vouchers, usages, db } = setup();
    const out = await service.charge(offer.code, {
      paymentMethod: 'pix',
      voucherCode: 'OFF20',
      ...buyer,
    });
    await markChargeSettled(db.extra as never, out.transactionId, 'COMPLETED');
    const fulfillment = new OfferFulfillmentService(
      {
        ...db.prisma,
        charge: {
          findUnique: async () => db.charges[0],
        },
        transaction: {
          findUnique: async () => ({
            id: out.transactionId,
            status: 'COMPLETED',
            customerEmail: buyer.customerEmail,
            customerDocument: '12345678909',
          }),
        },
        offer: {
          ...db.prisma.offer,
          findUnique: async () => offer,
          findMany: async () => [offer],
        },
      } as never,
      { claim: async () => false, release: async () => undefined },
    );
    const event = { transactionId: out.transactionId, kind: 'PAID' as const };
    expect(await fulfillment.deliver(event)).toBe('done');
    expect(await fulfillment.deliver(event)).toBe('done');
    await fulfillment.deliver(event);
    expect(vouchers[0].usageCount).toBe(1);
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      voucherId: 'voucher-1',
      transactionId: out.transactionId,
      originalAmount: 100,
      discountAmount: 20,
      finalAmount: 80,
    });
  });

  test('invalid vouchers are refused before any draft, Charge or reserved use', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ isActive: false }, 'não encontrado'],
      [{ maxUsage: 1, usageCount: 1 }, 'limite de uso'],
      [{ minOrderValue: 500 }, 'Valor mínimo'],
      [{ validUntil: new Date('2020-01-01') }, 'expirado'],
      [{ applicablePlans: ['another-offer'] }, 'esta oferta'],
      [{ discountType: 'FIXED', discountValue: 1000 }, 'zerar'],
    ];
    for (const [over, message] of cases) {
      const s = setup({}, {}, [voucherRow(over)]);
      await expect(
        s.service.charge(s.offer.code, {
          paymentMethod: 'pix',
          voucherCode: 'OFF20',
          ...buyer,
        }),
      ).rejects.toThrow(message);
      expect(s.db.base.rows()).toHaveLength(0);
      expect(s.db.charges).toHaveLength(0);
      expect(s.offer.usedCount).toBe(0);
    }
    // Voucher of another seller, or unknown code.
    const other = setup({}, {}, [voucherRow({ userId: 'someone-else' })]);
    await expect(
      other.service.charge(other.offer.code, {
        paymentMethod: 'pix',
        voucherCode: 'OFF20',
        ...buyer,
      }),
    ).rejects.toThrow('inválido');
  });

  test('validateVoucher quotes without consuming and rejects like the charge does', async () => {
    const { service, offer, vouchers } = setup();
    const quote = await service.validateVoucher(offer.code, {
      voucherCode: ' off20 ',
    });
    expect(quote).toMatchObject({
      valid: true,
      code: 'OFF20',
      originalAmountCents: 10000,
      discountAmountCents: 2000,
      finalAmountCents: 8000,
      offerId: offer.id,
    });
    expect(vouchers[0].usageCount).toBe(0);
    await expect(
      service.validateVoucher(offer.code, { voucherCode: 'NOPE' }),
    ).rejects.toThrow('inválido');
    await expect(
      service.validateVoucher('MISSING', { voucherCode: 'OFF20' }),
    ).rejects.toThrow('não encontrada');
  });
});
