import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { useEmptyCaches } from '../src/application/use-cases/payment-link/charge-characterization.fixture';
import { Acquirer } from '../src/core/services/acquirer.enum';
import { acquirerCapabilities } from '../src/core/services/acquirer-capabilities';
import { PrismaUserRepository } from '../src/infrastructure/database/repositories/prisma-user.repository';
import { markChargeSettled } from '../src/modules/billing-core/charge-settlement';
import { ExternalRefService } from '../src/modules/billing-core/external-ref.service';
import { OfferCheckoutService } from '../src/modules/offer/offer-checkout.service';
import { settleFinalNet } from '../src/modules/platform-core/link-settlement';

const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;

let service: OfferCheckoutService;
let ownerId: string;
let gatewayCalls = { link: 0, pix: 0 };

const buyer = {
  customerName: 'Ana',
  customerEmail: 'ana@test.dev',
  customerDocument: '123.456.789-09',
};

async function offer(over: Record<string, unknown> = {}) {
  return db!.offer.create({
    data: {
      ownerUserId: ownerId,
      createdByUserId: ownerId,
      code: `T${crypto.randomUUID().slice(0, 9).toUpperCase()}`,
      kind: 'PAYMENT_LINK',
      name: 'Curso',
      amountCents: 10000,
      acceptedMethods: ['PIX', 'CREDIT_CARD'],
      maxInstallments: 3,
      ...over,
    },
  });
}

beforeAll(async () => {
  if (!db) return;
  process.env.DOM_TOKEN = 'test-token';
  await useEmptyCaches();
  const owner = await db.user.create({
    data: {
      name: 'Seller',
      email: `seller-${crypto.randomUUID()}@test.dev`,
      password: 'x',
      role: 'USER',
      clientStatus: 'APPROVED',
    },
  });
  ownerId = owner.id;
  await db.acquirerCatalogue.upsert({
    where: { code: 'DOM' },
    update: {},
    create: { code: 'DOM', name: 'DOM' },
  });
  const gateway: any = {
    createPaymentLink: async () => {
      gatewayCalls.link++;
      return { id: `dom-link-${crypto.randomUUID()}` };
    },
    chargePixForLink: async (_t: string, input: any) => {
      gatewayCalls.pix++;
      return {
        id: `dom-pay-${crypto.randomUUID()}`,
        status: 'pending',
        pixContent: '000201pix',
        qrCode: null,
        pixExpire: null,
        amount: input.amount,
      };
    },
  };
  service = new OfferCheckoutService(
    db as never,
    new PrismaUserRepository(db as never),
    {
      acquirerForSlug: () => Acquirer.DOM,
      capabilitiesFor: acquirerCapabilities,
      byAcquirer: () => gateway,
    } as never,
    new ExternalRefService(db as never),
  );
});
afterAll(async () => {
  await db?.$disconnect();
});

run(
  'PIX charge persists Charge, draft-turned-pending Transaction and the gateway link ref',
  async () => {
    const o = await offer();
    const out = await service.charge(o.code, {
      paymentMethod: 'pix',
      ...buyer,
    });
    const charge = await db!.charge.findUniqueOrThrow({
      where: { id: out.chargeId },
    });
    const tx = await db!.transaction.findUniqueOrThrow({
      where: { id: out.transactionId },
    });
    expect(charge).toMatchObject({
      offerId: o.id,
      ownerUserId: ownerId,
      status: 'PENDING',
      method: 'PIX',
      transactionId: tx.id,
    });
    expect(tx.status).toBe('PENDING');
    expect(tx.settlementBasis).toBe('FINAL_NET');
    expect(tx.userId).toBe(ownerId);
    expect(Number(tx.amount)).toBe(out.amount);
    expect(charge.amountCents).toBe(Math.round(out.amount * 100));
    expect(tx.pixContent).toBe('000201pix');
    expect(
      await db!.externalRef.count({
        where: { entityType: 'Offer', entityId: o.id, kind: 'PAYMENT_LINK' },
      }),
    ).toBe(1);

    // Second charge reuses the gateway link.
    const before = gatewayCalls.link;
    await service.charge(o.code, { paymentMethod: 'pix', ...buyer });
    expect(gatewayCalls.link).toBe(before);
    expect(
      (await db!.offer.findUniqueOrThrow({ where: { id: o.id } })).usedCount,
    ).toBe(2);
  },
);

run('concurrent buyers never exceed maxUses', async () => {
  const o = await offer({ maxUses: 3 });
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      service.charge(o.code, { paymentMethod: 'pix', ...buyer }),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  const fresh = await db!.offer.findUniqueOrThrow({ where: { id: o.id } });
  expect(fresh.usedCount).toBe(3);
  expect(await db!.charge.count({ where: { offerId: o.id } })).toBe(3);
});

run(
  'rejects subscriptions, unaccepted methods and unavailable offers',
  async () => {
    const sub = await offer({
      renewalMode: 'MANUAL_PAY',
      intervalType: 'MONTH',
      intervalCount: 1,
    });
    await expect(
      service.charge(sub.code, { paymentMethod: 'pix', ...buyer }),
    ).rejects.toThrow('assinatura');
    const pixOnly = await offer({ acceptedMethods: ['PIX'] });
    await expect(
      service.charge(pixOnly.code, {
        paymentMethod: 'credit_card',
        card: {
          token: 't',
          exp_month: '1',
          exp_year: '2030',
          cvv: '1',
          holder_name: 'a',
          holder_document: '1',
        },
        ...buyer,
      }),
    ).rejects.toThrow('não aceita');
    const off = await offer({ isActive: false });
    await expect(
      service.charge(off.code, { paymentMethod: 'pix', ...buyer }),
    ).rejects.toThrow('não encontrada');
    expect(
      await db!.charge.count({
        where: { offerId: { in: [sub.id, pixOnly.id, off.id] } },
      }),
    ).toBe(0);
  },
);

run(
  'settling the Transaction marks the Charge PAID once and credits the wallet once',
  async () => {
    const o = await offer();
    const out = await service.charge(o.code, {
      paymentMethod: 'pix',
      ...buyer,
    });
    const settle = () =>
      db!.$transaction(async (p) => {
        const row = await p.transaction.findUniqueOrThrow({
          where: { id: out.transactionId },
        });
        const settled = await settleFinalNet(
          p,
          row,
          'COMPLETED',
          'DOM_WEBHOOK',
        );
        if (settled) await markChargeSettled(p, row.id, 'COMPLETED');
        return settled;
      });
    const walletBefore = Number(
      (await db!.wallet.findUniqueOrThrow({ where: { userId: ownerId } }))
        .balance,
    );
    expect(await settle()).toBe(true);
    expect(await settle()).toBe(false);
    const charge = await db!.charge.findUniqueOrThrow({
      where: { id: out.chargeId },
    });
    expect(charge.status).toBe('PAID');
    expect(charge.paidAt).not.toBeNull();
    const tx = await db!.transaction.findUniqueOrThrow({
      where: { id: out.transactionId },
    });
    const walletAfter = Number(
      (await db!.wallet.findUniqueOrThrow({ where: { userId: ownerId } }))
        .balance,
    );
    expect(+(walletAfter - walletBefore).toFixed(2)).toBe(Number(tx.netAmount));
  },
);
