import { afterAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { markChargeSettled } from '../../billing-core/charge-settlement';
import {
  OfferFulfillmentService,
  PrismaFulfillmentMarkers,
} from '../offer-fulfillment.service';
import {
  findOfferVoucherQuote,
  recordVoucherUsageOnce,
} from '../../../application/use-cases/voucher/voucher-offer';

const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Offer integration tests require a local database');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});

async function seed(prisma: PrismaClient, opts: { maxUsage?: number } = {}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const owner = await prisma.user.create({
    data: {
      email: `${suffix}@voucher.local`,
      password: 'local-test',
      name: 'Local',
    },
  });
  const offer = await prisma.offer.create({
    data: {
      ownerUserId: owner.id,
      createdByUserId: owner.id,
      code: `V${suffix}`.toUpperCase(),
      name: 'Curso',
      amountCents: 10000,
      acceptedMethods: ['PIX'],
    },
  });
  const voucher = await prisma.voucher.create({
    data: {
      userId: owner.id,
      code: `OFF${suffix}`.toUpperCase(),
      discountType: 'PERCENTAGE',
      discountValue: 20,
      maxUsage: opts.maxUsage ?? null,
      allowedLinkCodes: [offer.code],
    },
  });
  return { owner, offer, voucher };
}

async function pendingCharge(
  prisma: PrismaClient,
  s: Awaited<ReturnType<typeof seed>>,
) {
  const tx = await prisma.transaction.create({
    data: {
      userId: s.owner.id,
      amount: 80,
      netAmount: 70,
      paymentMethod: 'PIX',
      status: 'PENDING',
      description: 'Curso',
      customerName: 'Ana',
      customerEmail: 'ana@test.dev',
      customerDocument: '12345678909',
    },
  });
  const charge = await prisma.charge.create({
    data: {
      offerId: s.offer.id,
      ownerUserId: s.owner.id,
      amountCents: 8000,
      method: 'PIX',
      customerName: 'Ana',
      customerEmail: 'ana@test.dev',
      transactionId: tx.id,
      snapshot: {
        baseAmountCents: 8000,
        voucher: {
          voucherId: s.voucher.id,
          code: s.voucher.code,
          originalAmountCents: 10000,
          discountAmountCents: 2000,
          finalAmountCents: 8000,
        },
      },
    },
  });
  return { tx, charge };
}

test.skipIf(!db)(
  'real database: quote reads the owner voucher; usage is unique per transaction',
  async () => {
    const prisma = db!;
    const s = await seed(prisma, { maxUsage: 1 });
    const quote = await findOfferVoucherQuote(
      prisma as never,
      s.offer,
      s.voucher.code.toLowerCase(),
      10000,
    );
    expect(quote).toMatchObject({
      discountAmountCents: 2000,
      finalAmountCents: 8000,
    });

    const usage = {
      voucherId: s.voucher.id,
      transactionId: 'tx-real-1',
      customerEmail: 'ana@test.dev',
      customerDocument: '12345678909',
      originalAmount: 100,
      discountAmount: 20,
      finalAmount: 80,
    };
    const results = await Promise.all([
      recordVoucherUsageOnce(prisma as never, usage),
      recordVoucherUsageOnce(prisma as never, usage),
      recordVoucherUsageOnce(prisma as never, usage),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await prisma.voucher.findUniqueOrThrow({
      where: { id: s.voucher.id },
    });
    expect(after.usageCount).toBe(1);
    expect(
      await prisma.voucherUsage.count({ where: { voucherId: s.voucher.id } }),
    ).toBe(1);

    // maxUsage reached: the next quote is refused.
    await expect(
      findOfferVoucherQuote(prisma as never, s.offer, s.voucher.code, 10000),
    ).rejects.toThrow('limite de uso');
  },
);

test.skipIf(!db)(
  'real database: a paid Charge consumes one use (repeat events do not); a failed one consumes none',
  async () => {
    const prisma = db!;
    const s = await seed(prisma);
    const paid = await pendingCharge(prisma, s);
    const failed = await pendingCharge(prisma, s);

    const service = new OfferFulfillmentService(
      prisma as never,
      new PrismaFulfillmentMarkers(prisma as never),
    );
    await prisma.$transaction(async (p) => {
      await p.transaction.update({
        where: { id: failed.tx.id },
        data: { status: 'FAILED' },
      });
      await markChargeSettled(p, failed.tx.id, 'FAILED');
    });
    // A FAILED settle never reaches the fulfillment; even delivering it records nothing.
    expect(
      await service.deliver({ transactionId: failed.tx.id, kind: 'PAID' }),
    ).toBe('retry');

    await prisma.$transaction(async (p) => {
      await p.transaction.update({
        where: { id: paid.tx.id },
        data: { status: 'COMPLETED' },
      });
      await markChargeSettled(p, paid.tx.id, 'COMPLETED');
    });
    const event = { transactionId: paid.tx.id, kind: 'PAID' as const };
    expect(await service.deliver(event)).toBe('done');
    expect(await service.deliver(event)).toBe('done');
    expect(await service.deliver(event)).toBe('done');

    const voucher = await prisma.voucher.findUniqueOrThrow({
      where: { id: s.voucher.id },
    });
    expect(voucher.usageCount).toBe(1);
    const usages = await prisma.voucherUsage.findMany({
      where: { voucherId: s.voucher.id },
    });
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      transactionId: paid.tx.id,
      originalAmount: 100,
      discountAmount: 20,
      finalAmount: 80,
    });
  },
);
