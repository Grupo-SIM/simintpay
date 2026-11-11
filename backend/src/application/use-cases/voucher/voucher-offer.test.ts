import { describe, expect, test } from 'bun:test';
import {
  findOfferVoucherQuote,
  quoteOfferVoucher,
  recordVoucherUsageOnce,
  type VoucherRow,
} from './voucher-offer';

const offer = {
  id: 'offer-1',
  code: 'OFFER00001',
  platformTag: null as string | null,
  ownerUserId: 'owner',
};

const voucher = (over: Partial<VoucherRow> = {}): VoucherRow => ({
  id: 'v1',
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

describe('quoteOfferVoucher', () => {
  test('percentage and fixed discounts stay in integer cents, capped at the amount', () => {
    expect(quoteOfferVoucher(voucher(), offer, 10000)).toMatchObject({
      discountAmountCents: 2000,
      finalAmountCents: 8000,
      originalAmountCents: 10000,
    });
    expect(
      quoteOfferVoucher(
        voucher({ discountType: 'FIXED', discountValue: 12.34 }),
        offer,
        10000,
      ),
    ).toMatchObject({ discountAmountCents: 1234, finalAmountCents: 8766 });
    expect(
      quoteOfferVoucher(
        voucher({ discountType: 'FIXED', discountValue: 500 }),
        offer,
        10000,
      ),
    ).toMatchObject({ discountAmountCents: 10000, finalAmountCents: 0 });
    // 33,333...% de R$ 0,10 arredonda para o centavo mais próximo.
    expect(
      quoteOfferVoucher(voucher({ discountValue: 33.3333 }), offer, 10),
    ).toMatchObject({ discountAmountCents: 3 });
  });

  test('maxDiscountValue caps a percentage discount', () => {
    expect(
      quoteOfferVoucher(voucher({ maxDiscountValue: 5 }), offer, 10000),
    ).toMatchObject({ discountAmountCents: 500, finalAmountCents: 9500 });
  });

  test('refuses missing, inactive, not yet valid, expired, exhausted and below-minimum vouchers', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    const cases: [VoucherRow | null, string][] = [
      [null, 'não encontrado'],
      [voucher({ isActive: false }), 'não encontrado'],
      [voucher({ validFrom: new Date('2026-07-01') }), 'ainda não'],
      [voucher({ validUntil: new Date('2026-05-01') }), 'expirado'],
      [voucher({ maxUsage: 2, usageCount: 2 }), 'limite de uso'],
      [voucher({ minOrderValue: 150 }), 'Valor mínimo'],
    ];
    for (const [row, message] of cases)
      expect(() => quoteOfferVoucher(row, offer, 10000, now)).toThrow(message);
  });

  test('applicablePlans lists offer ids and allowedLinkCodes lists offer codes', () => {
    expect(() =>
      quoteOfferVoucher(voucher({ applicablePlans: ['other'] }), offer, 10000),
    ).toThrow('esta oferta');
    expect(
      quoteOfferVoucher(voucher({ applicablePlans: ['offer-1'] }), offer, 10000)
        .voucherId,
    ).toBe('v1');
    expect(() =>
      quoteOfferVoucher(voucher({ allowedLinkCodes: ['NOPE'] }), offer, 10000),
    ).toThrow('esta oferta');
    expect(
      quoteOfferVoucher(
        voucher({ allowedLinkCodes: ['offer00001'] }),
        offer,
        10000,
      ).voucherId,
    ).toBe('v1');
  });

  test('channel is enforced only for offers that belong to a platform', () => {
    const v = voucher({ allowedChannels: ['PAGATG'] });
    expect(quoteOfferVoucher(v, offer, 10000).voucherId).toBe('v1');
    expect(
      quoteOfferVoucher(v, { ...offer, platformTag: 'pagatg' }, 10000)
        .voucherId,
    ).toBe('v1');
    expect(() =>
      quoteOfferVoucher(v, { ...offer, platformTag: 'EBOOK' }, 10000),
    ).toThrow('canal');
  });
});

describe('findOfferVoucherQuote', () => {
  test('looks the code up (case-insensitive) under the offer owner only', async () => {
    const seen: unknown[] = [];
    const db = {
      voucher: {
        findFirst: async (args: unknown) => {
          seen.push(args);
          return voucher();
        },
      },
    };
    const quote = await findOfferVoucherQuote(db, offer, ' off20 ', 10000);
    expect(seen).toEqual([{ where: { userId: 'owner', code: 'OFF20' } }]);
    expect(quote.finalAmountCents).toBe(8000);
    await expect(findOfferVoucherQuote(db, offer, '  ', 100)).rejects.toThrow(
      'não informado',
    );
  });
});

describe('recordVoucherUsageOnce', () => {
  function fake() {
    const usages: { voucherId: string; transactionId: string }[] = [];
    const counts = new Map<string, number>([['v1', 0]]);
    const tx = {
      voucherUsage: {
        // skipDuplicates: the unique (voucherId, transactionId) index drops the repeat.
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
      },
      voucher: {
        update: async ({ where, data }: any) =>
          counts.set(
            where.id,
            counts.get(where.id)! + data.usageCount.increment,
          ),
      },
    };
    return {
      usages,
      counts,
      prisma: { $transaction: (fn: any) => fn(tx) },
    };
  }
  const usage = (transactionId: string) => ({
    voucherId: 'v1',
    transactionId,
    customerEmail: 'ana@test.dev',
    customerDocument: '12345678909',
    originalAmount: 100,
    discountAmount: 20,
    finalAmount: 80,
  });

  test('counts a transaction once however many times the event repeats', async () => {
    const f = fake();
    expect(await recordVoucherUsageOnce(f.prisma, usage('tx-1'))).toBe(true);
    expect(await recordVoucherUsageOnce(f.prisma, usage('tx-1'))).toBe(false);
    expect(await recordVoucherUsageOnce(f.prisma, usage('tx-1'))).toBe(false);
    expect(f.counts.get('v1')).toBe(1);
    expect(await recordVoucherUsageOnce(f.prisma, usage('tx-2'))).toBe(true);
    expect(f.counts.get('v1')).toBe(2);
    expect(f.usages).toHaveLength(2);
  });
});
