import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { CheckoutController } from '../src/presentation/controllers/checkout.controller';
import { ProcessDomWebhookUseCase } from '../src/application/use-cases/webhook/process-dom-webhook.use-case';
import { initializePlatformRegistryCache } from '../src/modules/module.registry';
import { initializePlatformIntegrationsCache } from '../src/modules/platform-integrations/platform-integrations.store';
import { emptyPolicy } from '../src/modules/financial-policy/financial-policy';
import { enrollEbook } from '../src/modules/platform-core/ebook-enrollment';
import { validateEbookManifest } from '../src/modules/platform-core/ebook-manifest';
import { quoteCardOwnerShare } from '../src/modules/financial-policy/platform-fee-schedule';
import { getEbookTaxaServico } from '../src/modules/ebooksim/ebooksim.config';

/**
 * Plan 0026, Phase A5: the public checkout pays the seller's EBOOK_PENDING_<order> entry (orders without a
 * settlement manifest) instead of a parallel FINAL_NET draft under the platform owner, and the seller is
 * credited exactly once. Needs a disposable, fully migrated local database (CHECKOUT_PENDING_TEST_DATABASE_URL).
 */
const url = process.env.CHECKOUT_PENDING_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;

let platformOwner: string, seller: string, affiliate: string;
let sequence = 0;
const taxa = () => new Prisma.Decimal(getEbookTaxaServico());

const lane = (ratePpm: number, interestPpm: number) => ({
  active: true,
  contract: {
    fixedCents: 0,
    ratePpm,
    interestPpm,
    cashbackCents: 0,
    base: 'BUYER_TOTAL' as const,
    reference: 'local',
  },
  sim: { fixedCents: 0, ratePpm: 0, interestPpm },
});

beforeAll(async () => {
  if (!db) return;
  await db.user.updateMany({
    where: { cpf: { in: ['52998224725', '11144477735'] } },
    data: { cpf: null },
  });
  await db.acquirerFeeSchedule.deleteMany({ where: { source: 'LOCAL_TEST' } });
  await db.financialPolicyRevision.deleteMany({ where: { tag: 'EBOOK' } });
  const user = (name: string, extra: Record<string, unknown> = {}) =>
    db.user.create({
      data: {
        name,
        email: `${name}-${crypto.randomUUID()}@test.local`,
        password: 'disabled',
        wallet: { create: {} },
        ...extra,
      },
    });
  [platformOwner, seller, affiliate] = (
    await Promise.all([
      user('platform-owner'),
      user('seller', { cpf: '52998224725' }),
      user('affiliate', { cpf: '11144477735' }),
    ])
  ).map((u) => u.id);
  await db.platform.upsert({
    where: { tag: 'EBOOK' },
    create: {
      tag: 'EBOOK',
      name: 'Ebook local',
      ownerUserId: platformOwner,
      acquirer: 'DOM',
    },
    update: { ownerUserId: platformOwner },
  });
  const policy = emptyPolicy();
  policy.lanes['DOM/PIX/ONLINE/1'] = lane(10_000, 0);
  for (const n of [1, 2, 3])
    policy.lanes[`DOM/CREDIT_CARD/ONLINE/${n}`] = lane(
      40_000 + n * 5_000,
      n > 1 ? 20_000 : 0,
    );
  await db.financialPolicyRevision.create({
    data: {
      tag: 'EBOOK',
      version: 100,
      document: policy as any,
      actorId: seller,
    },
  });
  await db.acquirerCatalogue.upsert({
    where: { code: 'DOM' },
    create: { code: 'DOM', name: 'Local fake', active: true },
    update: { active: true },
  });
  for (const [method, n] of [
    ['PIX', 1],
    ['CREDIT_CARD', 1],
    ['CREDIT_CARD', 2],
    ['CREDIT_CARD', 3],
  ] as const)
    await db.acquirerFeeSchedule.create({
      data: {
        acquirerCode: 'DOM',
        method,
        channel: 'ONLINE',
        installments: n,
        fixedCents: 0,
        ratePpm: method === 'PIX' ? 10_000 : 40_000 + n * 5_000,
        interestPpm: n > 1 ? 20_000 : 0,
        source: 'LOCAL_TEST',
      },
    });
  process.env.DOM_TOKEN = 'local-fake-token';
  process.env.INTERNAL_SERVICE_TOKEN = 'local-internal-test';
  await initializePlatformIntegrationsCache(db);
  await initializePlatformRegistryCache(db);
});
afterAll(async () => {
  delete process.env.DOM_TOKEN;
  delete process.env.INTERNAL_SERVICE_TOKEN;
  globalThis.fetch = realFetch;
  await db?.$disconnect();
});

const realFetch = globalThis.fetch;
const webhook = () =>
  new ProcessDomWebhookUseCase(
    db as any,
    {} as any,
    {
      applyForTransaction: async () => {},
      reverseForTransaction: async () => {},
    } as any,
  );
const order = () =>
  `ORD-2026-${String(100000 + Math.floor(Math.random() * 900000))}-${++sequence}`;

/** Entry as `POST .../finance/entries` records it: PIX 1x at the owner amount with the server quote. */
const entry = (orderNumber: string, over: Record<string, unknown> = {}) =>
  db!.transaction.create({
    data: {
      userId: seller,
      domPaymentId: `EBOOK_PENDING_${orderNumber}`,
      amount: 100,
      netAmount: 85,
      totalFee: 15,
      status: 'PENDING',
      paymentMethod: 'PIX',
      platformTag: 'EBOOK',
      description: `${orderNumber} [TENANT:EBOOK]`,
      financialSnapshot: { policyTag: 'EBOOK' },
      ...over,
    },
  });

/** Fake acquirer: records the charges; `onCreate` lets a test fire a webhook before the response returns. */
function fixture(
  onCreate?: (codExternal: string, paymentId: string) => Promise<void>,
) {
  const charges: { codExternal: string; paymentId: string }[] = [];
  let seq = 0;
  const gateway = {
    createPixCheckout: async (_t: string, input: any) => {
      const paymentId = `pix-${crypto.randomUUID()}`;
      charges.push({ codExternal: input.codExternal, paymentId });
      await onCreate?.(input.codExternal, paymentId);
      return { id: paymentId, pixContent: 'pix', qrCode: 'qr' };
    },
  };
  const resolver = { acquirerForSlug: () => 'DOM', byAcquirer: () => gateway };
  const checkout = new CheckoutController(
    db as any,
    gateway as any,
    resolver as any,
    {} as any,
  );
  const card = async (body: Record<string, unknown>) => {
    globalThis.fetch = (async (_url: string, init: any) => {
      const paymentId = `card-${crypto.randomUUID()}`;
      const cod = JSON.parse(init.body).cod_external;
      charges.push({ codExternal: cod, paymentId });
      await onCreate?.(cod, paymentId);
      return {
        ok: true,
        json: async () => ({ data: { id: paymentId, status: 'pending' } }),
      };
    }) as any;
    try {
      return await checkout.createPublicCard({
        price: 120,
        description: 'Ebook',
        name: 'Buyer',
        holder_name: 'Buyer',
        token: 'tok',
        bin: '411111',
        brand: 'visa',
        email: 'buyer@test.local',
        document: '52998224725',
        store: 'ebook',
        installments: 3,
        ...body,
      } as any);
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  const pix = (body: Record<string, unknown>) =>
    checkout.createPublicPix({
      price: 120,
      description: 'Ebook',
      name: 'Buyer',
      email: 'buyer@test.local',
      document: '52998224725',
      mobile_phone: '',
      store: 'ebook',
      ...body,
    } as any);
  return { charges, pix, card, seq: () => ++seq };
}

const paid = (
  paymentId: string,
  codExternal: string,
  over: Record<string, unknown> = {},
  signature = `sig-${crypto.randomUUID()}`,
) => ({
  event: 'transaction',
  signature,
  data: {
    id: paymentId,
    status: 'paid',
    amount: 12_000,
    cod_external: codExternal,
    payment_method: 'pix',
    installments: 1,
    description: 'Ebook',
    customer: { name: 'Buyer', email: 'buyer@test.local' },
    ...over,
  },
});

const credits = (transactionId: string) =>
  db!.balanceLog.findMany({ where: { transactionId } });
const sellerBalance = async () =>
  Number(
    (await db!.wallet.findUniqueOrThrow({ where: { userId: seller } })).balance,
  );
const draftsFor = (orderNumber: string) =>
  db!.transaction.count({
    where: { description: { contains: `[ORDER:${orderNumber}]` } },
  });

run(
  'PIX: the checkout pays the pending entry and the seller is credited once, however often the webhook repeats',
  async () => {
    const orderNumber = order();
    const pending = await entry(orderNumber);
    const f = fixture();
    const before = await sellerBalance();
    const created = await f.pix({ orderNumber });
    expect(created.transactionId).toBe(pending.id);
    expect(await draftsFor(orderNumber)).toBe(0);
    const bound = await db!.transaction.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(bound).toMatchObject({
      status: 'PENDING',
      externalPaymentId: created.id,
      domPaymentId: `EBOOK_PENDING_${orderNumber}`,
      acquirer: 'DOM',
    });
    const event = paid(created.id, pending.id);
    await webhook().execute(event);
    await webhook().execute(event); // same signature
    await webhook().execute(paid(created.id, pending.id)); // redelivery with a new signature
    await webhook().execute(paid('other-id', pending.id)); // unknown payment id for the settled entry
    const done = await db!.transaction.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(done.status).toBe('COMPLETED');
    expect(Number(done.amount)).toBe(120); // total paid by the buyer
    expect(Number(done.netAmount)).toBe(85); // PIX keeps the stored net
    const logs = await credits(pending.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(seller);
    expect(new Prisma.Decimal(logs[0].balanceDelta).toNumber()).toBe(
      new Prisma.Decimal(85).sub(taxa()).toNumber(),
    );
    expect((await sellerBalance()) - before).toBeCloseTo(
      85 - Number(taxa()),
      2,
    );
    // the platform owner is never credited for this order
    expect(
      await db!.balanceLog.count({ where: { userId: platformOwner } }),
    ).toBe(0);
    // the checkout status endpoints resolve the gateway id
    expect(
      (
        await new CheckoutController(
          db as any,
          {} as any,
          {} as any,
          {} as any,
        ).getPaymentStatus(created.id)
      ).status,
    ).toBe('COMPLETED');
  },
);

run(
  'card 3x: installments and the repriced net reach the seller entry, credited once',
  async () => {
    const orderNumber = order();
    const pending = await entry(orderNumber);
    const f = fixture();
    const created = await f.card({ orderNumber });
    expect(created.transactionId).toBe(pending.id);
    expect(await draftsFor(orderNumber)).toBe(0);
    const bound = await db!.transaction.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(bound).toMatchObject({
      paymentMethod: 'CREDIT_CARD',
      installments: 3,
      externalPaymentId: created.id,
    });
    const totalPaidCents = Math.round(created.totalAmount * 100);
    const event = paid(created.id, pending.id, {
      amount: totalPaidCents,
      payment_method: 'credit_card',
      installments: 3,
    });
    await webhook().execute(event);
    await webhook().execute({
      ...event,
      signature: 'again-' + event.signature,
    });
    const done = await db!.transaction.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(done).toMatchObject({
      status: 'COMPLETED',
      paymentMethod: 'CREDIT_CARD',
      installments: 3,
    });
    expect(Number(done.amount)).toBe(totalPaidCents / 100);
    // Repriced on the owner base (R$ 100,00) with the paid installments, not the stored PIX net.
    const repriced = await quoteCardOwnerShare(db as any, 'EBOOK', 10_000, 3);
    expect(Number(done.netAmount)).toBe(repriced!.netAmount);
    expect(Number(done.netAmount)).not.toBe(85);
    const logs = await credits(pending.id);
    expect(logs).toHaveLength(1);
    expect(new Prisma.Decimal(logs[0].balanceDelta).toNumber()).toBeCloseTo(
      Number(done.netAmount) - Number(taxa()),
      2,
    );
  },
);

run(
  'settlement-manifest order: the entry is untouched and only the manifest credits',
  async () => {
    const orderNumber = order();
    const manifest = validateEbookManifest({
      version: 1,
      manifestId: crypto.randomUUID(),
      orderId: 7,
      orderNumber,
      currency: 'BRL',
      grossCents: 12_000,
      fixedFeeSnapshot: { version: 1 },
      items: [
        {
          itemId: 'item-1',
          productId: 1,
          quantity: 1,
          grossCents: 12_000,
          fixedFeeCents: 0,
          owner: {
            externalUserId: `seller-${crypto.randomUUID()}`,
            document: '52998224725',
          },
          buyer: {
            externalUserId: `buyer-${crypto.randomUUID()}`,
            document: null,
          },
        },
      ],
    });
    const pending = await entry(orderNumber);
    const f = fixture();
    // Without the capability token a manifest order never falls back to the entry.
    await enrollEbook(db as any, manifest);
    await expect(f.pix({ orderNumber })).rejects.toThrow();
    const enrolled = await enrollEbook(db as any, manifest);
    const created = await f.pix({
      orderNumber,
      settlementId: enrolled.settlementId,
      settlementToken: enrolled.settlementToken,
    });
    expect(created.transactionId).not.toBe(pending.id);
    const draft = await db!.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
    });
    expect(draft.settlementBasis).toBe('EBOOK_V1');
    await webhook().execute(paid(created.id, created.transactionId));
    expect(await credits(pending.id)).toHaveLength(0);
    const untouched = await db!.transaction.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(untouched).toMatchObject({
      status: 'PENDING',
      externalPaymentId: null,
    });
    expect(await credits(created.transactionId)).not.toHaveLength(0);
    // the manifest settlement, not the entry, is what credited
    expect(
      (await credits(created.transactionId)).every(
        (log) => log.source === 'EBOOK_V1',
      ),
    ).toBe(true);
  },
);

run(
  'checkout retry: new PIX, then card, on the same entry; late webhooks of replaced payments never credit twice',
  async () => {
    const orderNumber = order();
    const pending = await entry(orderNumber);
    const f = fixture();
    const first = await f.pix({ orderNumber });
    const second = await f.pix({ orderNumber });
    const third = await f.card({ orderNumber });
    expect([first, second, third].map((c) => c.transactionId)).toEqual([
      pending.id,
      pending.id,
      pending.id,
    ]);
    expect(await draftsFor(orderNumber)).toBe(0);
    expect(
      (await db!.transaction.findUniqueOrThrow({ where: { id: pending.id } }))
        .externalPaymentId,
    ).toBe(third.id);
    // The buyer pays the card; the old QR codes are paid afterwards.
    await webhook().execute(
      paid(third.id, pending.id, {
        amount: Math.round(third.totalAmount * 100),
        payment_method: 'credit_card',
        installments: 3,
      }),
    );
    await webhook().execute(paid(first.id, pending.id));
    await webhook().execute(paid(second.id, 'unrelated-reference'));
    expect(
      (await db!.transaction.findUniqueOrThrow({ where: { id: pending.id } }))
        .status,
    ).toBe('COMPLETED');
    expect(await credits(pending.id)).toHaveLength(1);
    // Once paid, a further checkout falls back to the legacy draft instead of re-adopting a settled entry.
    const after = await f.pix({ orderNumber });
    expect(after.transactionId).not.toBe(pending.id);
    expect(await credits(pending.id)).toHaveLength(1);
  },
);

run(
  'early webhook (before the checkout binds the payment) completes the entry once',
  async () => {
    const orderNumber = order();
    const pending = await entry(orderNumber);
    const f = fixture(async (cod, paymentId) => {
      await webhook().execute(paid(paymentId, cod));
    });
    const created = await f.pix({ orderNumber });
    expect(created.transactionId).toBe(pending.id);
    const done = await db!.transaction.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(done.status).toBe('COMPLETED');
    expect(await credits(pending.id)).toHaveLength(1);
  },
);

run(
  'a charge below the entry owner amount, unpaid statuses and non-adoptable entries never credit',
  async () => {
    const orderNumber = order();
    const pending = await entry(orderNumber);
    const f = fixture();
    const created = await f.pix({ orderNumber });
    await webhook().execute(paid(created.id, pending.id, { status: 'failed' }));
    await webhook().execute(
      paid(created.id, pending.id, { status: 'expired' }),
    );
    expect(
      (await db!.transaction.findUniqueOrThrow({ where: { id: pending.id } }))
        .status,
    ).toBe('PENDING');
    await expect(
      webhook().execute(paid(created.id, pending.id, { amount: 5_000 })),
    ).rejects.toThrow('EBOOK_PENDING_AMOUNT_MISMATCH');
    expect(await credits(pending.id)).toHaveLength(0);
    // entries not priced by the server (legacy route) and owner amount above the order total keep the old path
    const legacyOrder = order();
    const legacy = await entry(legacyOrder, {
      financialSnapshot: Prisma.DbNull,
      netAmount: null,
    });
    expect((await f.pix({ orderNumber: legacyOrder })).transactionId).not.toBe(
      legacy.id,
    );
    const bigOrder = order();
    const big = await entry(bigOrder, { amount: 500 });
    expect((await f.pix({ orderNumber: bigOrder })).transactionId).not.toBe(
      big.id,
    );
    expect(await credits(legacy.id)).toHaveLength(0);
    expect(await credits(big.id)).toHaveLength(0);
  },
);
