import { afterAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { findOfferByCodeOrId } from '../find-offer-by-code-or-id';

const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Offer integration tests require a local database');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});

test.skipIf(!db)(
  'real database: resolves an offer by code, then by id',
  async () => {
    const prisma = db!;
    const sfx = crypto.randomUUID().slice(0, 8);
    const owner = await prisma.user.create({
      data: {
        email: `lookup-${sfx}@list.local`,
        password: 'x',
        name: 'lookup',
      },
    });
    const data = (code: string) =>
      ({
        ownerUserId: owner.id,
        createdByUserId: owner.id,
        code,
        name: code,
        amountCents: 5000,
        acceptedMethods: ['PIX'],
      }) as never;
    const a = await prisma.offer.create({
      data: data(`LK${sfx}A`.toUpperCase()),
    });
    const b = await prisma.offer.create({
      data: data(`LK${sfx}B`.toUpperCase()),
    });

    expect((await findOfferByCodeOrId(prisma, a.code))?.id).toBe(a.id);
    expect((await findOfferByCodeOrId(prisma, b.id))?.code).toBe(b.code);
    expect(await findOfferByCodeOrId(prisma, crypto.randomUUID())).toBeNull();
    expect(await findOfferByCodeOrId(prisma, 'NOPE')).toBeNull();
  },
);
