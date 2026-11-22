import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { initializePlatformIntegrationsCache } from '../../platform-integrations/platform-integrations.store';
import { encryptPlatformSecret } from '../../platform-integrations/platform-secrets';
import {
  OfferFulfillmentService,
  PrismaFulfillmentMarkers,
} from '../offer-fulfillment.service';
import { OfferLegacyWebhookCron } from '../offer-legacy-webhook.cron';
import { OfferLegacyWebhookSender } from '../offer-legacy-webhook.sender';

const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Offer integration tests require a local database');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;

process.env.PLATFORM_CONFIG_ENCRYPTION_KEY ??= 'cd'.repeat(32);
const TAG = `WH${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

beforeAll(async () => {
  if (!db) return;
  // The platform token comes from the integrations cache (decrypted WEBHOOK_SECRET).
  await initializePlatformIntegrationsCache({
    platformIntegration: {
      findMany: async () => [
        {
          key: 'WEBHOOK_SECRET',
          url: null,
          encryptedValue: encryptPlatformSecret('secret-of-' + TAG),
          platform: { tag: TAG },
        },
      ],
    },
  } as never);
});
afterAll(async () => {
  await db?.$disconnect();
});

type Call = { url: string; headers: Record<string, string>; body: any };

function build(prisma: PrismaClient, status = 200) {
  const sender = new OfferLegacyWebhookSender();
  const calls: Call[] = [];
  sender.resolve = async () => ['93.184.216.34'];
  sender.post = async (u, init) => {
    calls.push({ url: u, headers: init.headers, body: JSON.parse(init.body) });
    return { status: state.status };
  };
  const state = { status };
  const service = new OfferFulfillmentService(
    prisma as never,
    new PrismaFulfillmentMarkers(prisma as never),
    undefined,
    undefined,
    undefined,
    sender,
  );
  return { service, sender, calls, state };
}

async function seed(
  prisma: PrismaClient,
  opts: { webhookUrl: string; recurring?: boolean },
) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const owner = await prisma.user.create({
    data: { email: `${suffix}@wh.local`, password: 'x', name: 'Local' },
  });
  const offer = await prisma.offer.create({
    data: {
      ownerUserId: owner.id,
      createdByUserId: owner.id,
      code: `W${suffix}`.toUpperCase(),
      name: 'Plano',
      amountCents: 3990,
      acceptedMethods: ['CREDIT_CARD'],
      platformTag: TAG,
      metadata: { webhookUrl: opts.webhookUrl },
      ...(opts.recurring
        ? {
            renewalMode: 'AUTO_CHARGE' as const,
            intervalType: 'MONTH' as const,
            intervalCount: 1,
          }
        : {}),
    },
  });
  const contract = opts.recurring
    ? await prisma.billingContract.create({
        data: {
          userId: owner.id,
          resourceType: 'OFFER',
          resourceId: `${offer.id}:ana@test.dev`,
          unitAmount: 39.9,
          quantity: 1,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          status: 'ACTIVE',
          offerId: offer.id,
          customerEmail: 'ana@test.dev',
          customerName: 'Ana',
        },
      })
    : null;
  return { owner, offer, contract };
}

async function pay(
  prisma: PrismaClient,
  s: Awaited<ReturnType<typeof seed>>,
  cycle: number,
) {
  const tx = await prisma.transaction.create({
    data: {
      userId: s.owner.id,
      amount: 39.9,
      netAmount: 36.5,
      paymentMethod: 'CREDIT_CARD',
      status: 'COMPLETED',
      description: 'Plano',
      customerName: 'Ana',
      customerEmail: 'ana@test.dev',
      customerDocument: '12345678909',
      customerPhone: '11999999999',
    },
  });
  const charge = await prisma.charge.create({
    data: {
      offerId: s.offer.id,
      contractId: s.contract?.id,
      cycleKey: s.contract ? `cycle-${cycle}` : null,
      ownerUserId: s.owner.id,
      amountCents: 3990,
      method: 'CREDIT_CARD',
      status: 'PAID',
      paidAt: new Date(Date.UTC(2026, 0, cycle)),
      customerName: 'Ana',
      customerEmail: 'ana@test.dev',
      customerDocument: '12345678909',
      transactionId: tx.id,
      snapshot: {},
    },
  });
  return { tx, charge };
}

test.skipIf(!db)(
  'real database: one-off offer sends purchase_approved once with the platform token, then purchase_refunded',
  async () => {
    const prisma = db!;
    const s = await seed(prisma, { webhookUrl: 'https://app.example/hook' });
    const { tx } = await pay(prisma, s, 1);
    const f = build(prisma);

    const paid = { transactionId: tx.id, kind: 'PAID' as const };
    expect(await f.service.deliver(paid)).toBe('done');
    await f.service.deliver(paid);
    await Promise.all([f.service.deliver(paid), f.service.deliver(paid)]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('https://app.example/hook');
    expect(f.calls[0].headers['x-simpay-token']).toBe('secret-of-' + TAG);
    expect(f.calls[0].body).toEqual({
      event: 'purchase_approved',
      customerEmail: 'ana@test.dev',
      customerName: 'Ana',
      planName: 'Plano',
      items: [{ tipo: 'PRINCIPAL', titulo: 'Plano', valor: 39.9 }],
      paymentMethod: 'CREDIT_CARD',
      amountCharged: 39.9,
      netAmount: 36.5,
      orderId: tx.id,
      linkId: s.offer.id,
      cpf: '12345678909',
      phone: '11999999999',
    });

    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: 'REFUNDED' },
    });
    const refunded = { transactionId: tx.id, kind: 'REFUNDED' as const };
    await f.service.deliver(refunded);
    await f.service.deliver(refunded);
    expect(f.calls.map((c) => c.body.event)).toEqual([
      'purchase_approved',
      'purchase_refunded',
    ]);
  },
  60_000,
);

test.skipIf(!db)(
  'real database: a failing receiver releases the marker and the retry delivers',
  async () => {
    const prisma = db!;
    const s = await seed(prisma, { webhookUrl: 'https://app.example/hook' });
    const { tx } = await pay(prisma, s, 1);
    const f = build(prisma, 503);
    const paid = { transactionId: tx.id, kind: 'PAID' as const };
    expect(await f.service.deliver(paid)).toBe('retry');
    f.state.status = 200;
    expect(await f.service.deliver(paid)).toBe('done');
    expect(await f.service.deliver(paid)).toBe('done');
    expect(f.calls).toHaveLength(2);
  },
  60_000,
);

test.skipIf(!db)(
  'real database: unsafe webhook URLs are never requested and count as handled',
  async () => {
    const prisma = db!;
    const s = await seed(prisma, { webhookUrl: 'http://127.0.0.1:8080/hook' });
    const { tx } = await pay(prisma, s, 1);
    const f = build(prisma);
    expect(
      await f.service.deliver({ transactionId: tx.id, kind: 'PAID' }),
    ).toBe('done');
    const rebinding = await seed(prisma, {
      webhookUrl: 'https://rebind.example/hook',
    });
    const second = await pay(prisma, rebinding, 1);
    f.sender.resolve = async () => ['169.254.169.254'];
    await f.service.deliver({ transactionId: second.tx.id, kind: 'PAID' });
    expect(f.calls).toHaveLength(0);
  },
  60_000,
);

test.skipIf(!db)(
  'real database: contract sends activated, renewed and, once ended, expired exactly once each',
  async () => {
    const prisma = db!;
    const s = await seed(prisma, {
      webhookUrl: 'https://app.example/hook',
      recurring: true,
    });
    const first = await pay(prisma, s, 1);
    const second = await pay(prisma, s, 2);
    const f = build(prisma);

    for (const t of [first.tx, second.tx, first.tx, second.tx])
      await f.service.deliver({ transactionId: t.id, kind: 'PAID' });
    expect(f.calls.map((c) => c.body.event)).toEqual([
      'subscription_activated',
      'subscription_renewed',
    ]);
    expect(f.calls[0].body).toMatchObject({
      planName: 'Plano',
      frequencyType: 'MONTHLY',
      orderId: first.tx.id,
      linkId: s.offer.id,
    });
    expect(f.calls[1].body.orderId).toBe(second.tx.id);
    expect(f.calls[1].headers['x-simpay-token']).toBe('secret-of-' + TAG);

    // Active contract: nothing to expire.
    const cron = new OfferLegacyWebhookCron(prisma as never, f.service);
    await cron.run();
    expect(f.calls).toHaveLength(2);

    await prisma.billingContract.update({
      where: { id: s.contract!.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    await cron.run();
    await cron.run();
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2].body).toEqual({
      event: 'subscription_expired',
      customerEmail: 'ana@test.dev',
      customerName: 'Ana',
      planName: 'Plano',
      paymentMethod: 'CREDIT_CARD',
      frequencyType: 'MONTHLY',
      amountCharged: 0,
      netAmount: 0,
      orderId: s.contract!.id,
      linkId: s.offer.id,
    });
    expect(f.calls[2].headers['x-simpay-token']).toBe('secret-of-' + TAG);

    // A cancellation whose access has not ended yet keeps the access: no event.
    await prisma.billingContract.update({
      where: { id: s.contract!.id },
      data: {
        status: 'CANCELLED',
        accessEndsAt: new Date(Date.now() + 86_400_000),
      },
    });
    const early = await seed(prisma, {
      webhookUrl: 'https://app.example/hook',
      recurring: true,
    });
    await pay(prisma, early, 1);
    await prisma.billingContract.update({
      where: { id: early.contract!.id },
      data: {
        status: 'CANCELLED',
        accessEndsAt: new Date(Date.now() + 86_400_000),
      },
    });
    await cron.run();
    expect(f.calls).toHaveLength(3);
  },
  60_000,
);
