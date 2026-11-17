import { afterAll, expect, test } from 'bun:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ownedReportSource } from '../../../application/services/owned-report-source';

/** Plan 0023 phase 3: owned report rows and totals are read through Offer. */
const url = process.env.COPRODUCTION_TEST_DATABASE_URL;
if (
  url &&
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)
) {
  throw new Error('Tests require a local isolated database');
}
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});

test.skipIf(!db)(
  'owned report source returns the rows and totals of sales that carry only offerId',
  async () => {
    const s = crypto.randomUUID().slice(0, 8).toUpperCase();
    const owner = await db!.user.create({
      data: {
        email: `${crypto.randomUUID()}@local.test`,
        name: 'Owner',
        password: 'x',
        role: 'USER',
      },
    });
    const platform = await db!.platform.create({
      data: { tag: `PARITY-${s}`, name: 'Parity', ownerUserId: owner.id },
    });
    const offer = await db!.offer.create({
      data: {
        ownerUserId: owner.id,
        createdByUserId: owner.id,
        code: crypto.randomUUID(),
        name: 'Produto',
        amountCents: 1000,
        platformTag: platform.tag,
      },
    });
    for (const amount of [10, 25.5]) {
      await db!.transaction.create({
        data: {
          userId: owner.id,
          amount,
          netAmount: amount,
          status: 'COMPLETED',
          platformTag: platform.tag,
          offerId: offer.id,
        },
      });
    }
    const rows = await db!.$queryRaw<
      { id: string; amount: Prisma.Decimal; netAmount: Prisma.Decimal }[]
    >(
      Prisma.sql`SELECT id, amount, "netAmount" FROM (${ownedReportSource(
        [{ id: platform.id, tag: platform.tag, ownerUserId: owner.id }],
        {},
      )}) r ORDER BY id`,
    );
    expect(rows).toHaveLength(2);
    expect(
      rows
        .reduce((sum, r) => sum.plus(r.netAmount), new Prisma.Decimal(0))
        .toString(),
    ).toBe('35.5');
  },
  30000,
);
