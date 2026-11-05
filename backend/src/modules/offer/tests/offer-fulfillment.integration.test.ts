import { afterAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { markChargeSettled } from '../../billing-core/charge-settlement';
import {
  OfferFulfillmentService,
  PrismaFulfillmentMarkers,
} from '../offer-fulfillment.service';

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
  'real database: PAID delivers once (markers survive repeats), refund notifies once',
  async () => {
    const prisma = db!;
    const suffix = crypto.randomUUID().slice(0, 8);
    const owner = await prisma.user.create({
      data: {
        email: `${suffix}@offer.local`,
        password: 'local-test',
        name: 'Local',
      },
    });
    const offer = await prisma.offer.create({
      data: {
        ownerUserId: owner.id,
        createdByUserId: owner.id,
        code: `F${suffix}`.toUpperCase(),
        kind: 'PAYMENT_LINK',
        name: 'Curso',
        amountCents: 10000,
        acceptedMethods: ['PIX'],
        fulfillment: {
          emailBody: 'Obrigado',
          webhookUrl: 'https://hooks.example.com/x',
        },
      },
    });
    const tx = await prisma.transaction.create({
      data: {
        userId: owner.id,
        amount: 100,
        netAmount: 87,
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
        offerId: offer.id,
        ownerUserId: owner.id,
        amountCents: 10000,
        method: 'PIX',
        customerName: 'Ana',
        customerEmail: 'ana@test.dev',
        transactionId: tx.id,
        snapshot: { baseAmountCents: 10000, financial: null },
      },
    });

    const emails: unknown[] = [];
    const posts: any[] = [];
    const service = new OfferFulfillmentService(
      prisma as never,
      new PrismaFulfillmentMarkers(prisma as never),
      {
        sendEbookAccessEmail: async (i: unknown) => emails.push(i),
      } as never,
    );
    service.transport = {
      resolve: async () => ['93.184.216.34'],
      fetch: (async (_u: string, init: any) => {
        posts.push(JSON.parse(init.body));
        return { status: 200 };
      }) as never,
    };

    const early = await service.deliver({
      transactionId: tx.id,
      kind: 'PAID',
    });
    expect(early).toBe('retry'); // Charge still PENDING

    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: 'COMPLETED' },
    });
    expect(await markChargeSettled(prisma as never, tx.id, 'COMPLETED')).toBe(
      true,
    );
    await service.deliver({ transactionId: tx.id, kind: 'PAID' });
    await service.deliver({ transactionId: tx.id, kind: 'PAID' });
    // the same marker must also hold across concurrent deliveries
    await Promise.all([
      service.deliver({ transactionId: tx.id, kind: 'PAID' }),
      service.deliver({ transactionId: tx.id, kind: 'PAID' }),
    ]);
    expect(emails).toHaveLength(1);
    expect(posts.map((p) => p.event)).toEqual(['purchase_approved']);

    const stored = await prisma.charge.findUniqueOrThrow({
      where: { id: charge.id },
    });
    const snapshot = stored.snapshot as any;
    expect(snapshot.baseAmountCents).toBe(10000);
    expect(Object.keys(snapshot.fulfillment).sort()).toEqual([
      'email',
      'webhookApproved',
    ]);

    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: 'REFUNDED' },
    });
    await service.deliver({ transactionId: tx.id, kind: 'REFUNDED' });
    await service.deliver({ transactionId: tx.id, kind: 'REFUNDED' });
    expect(posts.map((p) => p.event)).toEqual([
      'purchase_approved',
      'purchase_refunded',
    ]);
    expect(emails).toHaveLength(1);
  },
  60_000,
);
