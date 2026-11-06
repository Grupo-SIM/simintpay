import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { BillingCycleService } from '../../billing-core/billing-cycle.service';
import { markChargeSettled } from '../../billing-core/charge-settlement';
import { StoredCardVaultService } from '../../billing-core/stored-card-vault.service';
import { decryptPlatformSecret } from '../../platform-integrations/platform-secrets';
import { OfferSubscribeService } from '../offer-subscribe.service';

const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Offer integration tests require a local database');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;

beforeAll(async () => {
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'cd'.repeat(32);
  process.env.DOM_TOKEN = 'private-api-token';
  await db?.acquirerCatalogue.upsert({
    where: { code: 'DOM' },
    update: {},
    create: { code: 'DOM', name: 'DOM' } as never,
  });
}, 60_000);
afterAll(async () => {
  await db?.$disconnect();
});

function buildService(prisma: PrismaClient) {
  const gateway: any = {};
  return new OfferSubscribeService(
    prisma as never,
    {} as never,
    {
      acquirerForSlug: () => 'DOM',
      capabilitiesFor: () => ({
        methods: new Set(['CREDIT_CARD']),
        chargeStoredCard: true,
      }),
      byAcquirer: () => gateway,
    } as never,
    {} as never,
    new BillingCycleService(prisma as never),
    new StoredCardVaultService(prisma as never),
    { kind: 'customer-token' } as never,
  );
}

async function seedOffer(prisma: PrismaClient, trialDays: number) {
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
      code: `T${suffix}`.toUpperCase(),
      name: 'Plano',
      amountCents: 4990,
      acceptedMethods: ['CREDIT_CARD'],
      renewalMode: 'AUTO_CHARGE',
      intervalType: 'MONTH',
      intervalCount: 1,
      trialDays,
    },
  });
  return { owner, offer, suffix };
}

const cardBody = {
  token: 'wallet-token-1',
  customerId: 'cus-1',
  last4: '4242',
  exp_month: '12',
  exp_year: '2099',
  holder_name: 'Ana',
  brand: 'visa',
};
const buyer = {
  paymentMethod: 'credit_card' as const,
  customerName: 'Ana',
  customerEmail: 'ana@test.dev',
  customerDocument: '12345678909',
  card: cardBody,
};

test.skipIf(!db)(
  'webhook-settled first payment stores the card exactly once (idempotent, concurrent)',
  async () => {
    const prisma = db!;
    const { owner, offer } = await seedOffer(prisma, 0);
    const service = buildService(prisma);
    service.onModuleInit();
    try {
      const billing = new BillingCycleService(prisma as never);
      const { contract, charge } = await billing.subscribe({
        offerId: offer.id,
        customerName: 'Ana',
        customerEmail: 'ana@test.dev',
      });
      const pending = (service as any).cardMetadata(cardBody);
      await prisma.billingContract.update({
        where: { id: contract.id },
        data: { acquirer: 'DOM', metadata: { pendingCard: pending } },
      });
      const tx = await prisma.transaction.create({
        data: {
          userId: owner.id,
          amount: 49.9,
          netAmount: 40,
          paymentMethod: 'CREDIT_CARD',
          status: 'PENDING',
          description: 'Plano',
          customerName: 'Ana',
          customerEmail: 'ana@test.dev',
          customerDocument: '12345678909',
        },
      });
      await prisma.charge.update({
        where: { id: charge.id },
        data: { transactionId: tx.id, method: 'CREDIT_CARD' },
      });

      // Webhook path: Transaction COMPLETED -> Charge PAID -> contract ACTIVE -> listener.
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: 'COMPLETED' },
      });
      await prisma.$transaction((p) =>
        markChargeSettled(p as never, tx.id, 'COMPLETED'),
      );
      await Bun.sleep(1500);

      // Repeats and concurrent captures must not store a second card.
      await Promise.all([
        service.captureForTransaction(tx.id),
        service.captureForTransaction(tx.id),
        service.captureForTransaction(tx.id),
      ]);
      await prisma.$transaction((p) =>
        markChargeSettled(p as never, tx.id, 'COMPLETED'),
      );
      await Bun.sleep(900);

      const cards = await prisma.storedCard.findMany({
        where: { contractId: contract.id },
        include: { tokens: true },
      });
      expect(cards).toHaveLength(1);
      expect(cards[0].status).toBe('ACTIVE');
      expect(cards[0].last4).toBe('4242');
      expect(cards[0].tokens).toHaveLength(1);
      expect(cards[0].tokens[0].acquirerCustomerId).toBe('cus-1');
      expect(cards[0].tokens[0].encryptedToken).not.toContain('wallet-token-1');
      expect(decryptPlatformSecret(cards[0].tokens[0].encryptedToken)).toBe(
        'wallet-token-1',
      );
      const after = await prisma.billingContract.findUniqueOrThrow({
        where: { id: contract.id },
      });
      expect(after.metadata).toBeNull();
      expect(after.status).toBe('ACTIVE');
    } finally {
      service.onModuleDestroy();
    }
  },
  60_000,
);

test.skipIf(!db)(
  'trial: card stored now, contract ACTIVE with no charge, first Charge issued by runDue at trial end',
  async () => {
    const prisma = db!;
    const { offer } = await seedOffer(prisma, 7);
    const service = buildService(prisma);
    const now = new Date('2026-12-01T12:00:00Z');

    const result = await service.subscribe(offer.code, buyer, now);
    expect(result).toMatchObject({
      existing: false,
      chargeId: null,
      transactionId: null,
      chargeStatus: 'TRIAL',
      contractStatus: 'ACTIVE',
      cardSaved: true,
      amount: 49.9,
      nextChargeAt: '2026-12-08T12:00:00.000Z',
    });
    expect(
      await prisma.charge.count({ where: { contractId: result.contractId } }),
    ).toBe(0);
    const stored = await prisma.storedCard.findMany({
      where: { contractId: result.contractId },
      include: { tokens: true },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].tokens[0].acquirerCustomerId).toBe('cus-1');

    // Repeating the request changes nothing.
    const again = await service.subscribe(offer.code, buyer, now);
    expect(again.existing).toBe(true);
    expect(
      await prisma.storedCard.count({
        where: { contractId: result.contractId },
      }),
    ).toBe(1);
    expect(
      (await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } }))
        .usedCount,
    ).toBe(1);

    // Not due before the trial ends; at the end runDue issues exactly one Charge.
    const billing = new BillingCycleService(prisma as never);
    const executor = { charge: async () => ({ outcome: 'UNKNOWN' as const }) };
    await billing.runDue(new Date('2026-12-07T12:00:00Z'), executor);
    expect(
      await prisma.charge.count({ where: { contractId: result.contractId } }),
    ).toBe(0);
    const run = await billing.runDue(
      new Date('2026-12-08T12:00:01Z'),
      executor,
    );
    expect(run.issued).toBeGreaterThanOrEqual(1);
    await billing.runDue(new Date('2026-12-08T12:05:00Z'), executor);
    const charges = await prisma.charge.findMany({
      where: { contractId: result.contractId },
    });
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      amountCents: 4990,
      status: 'PENDING',
      cycleKey: '2026-12-08T12:00:00.000Z',
    });
  },
  60_000,
);

test.skipIf(!db)(
  'rejects PAN/CVV in customer-token mode before touching the database state',
  async () => {
    const prisma = db!;
    const { offer } = await seedOffer(prisma, 0);
    const service = buildService(prisma);
    await expect(
      service.subscribe(offer.code, {
        ...buyer,
        card: { ...cardBody, number: '4111111111111111', cvv: '123' },
      }),
    ).rejects.toThrow('não são aceitos');
    expect(
      await prisma.billingContract.count({ where: { offerId: offer.id } }),
    ).toBe(0);
    expect(
      (await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } }))
        .usedCount,
    ).toBe(0);
  },
  60_000,
);
