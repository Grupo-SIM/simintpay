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
import { getEbookTaxaServico } from '../src/modules/ebooksim/ebooksim.config';
import { PlatformFinanceService } from '../src/modules/unified-platform/finance/platform-finance.service';
import { PlatformAttributedBalance } from '../src/modules/platform-core/platform-attributed-balance';
import { settleFinalNet } from '../src/modules/platform-core/link-settlement';

/**
 * Plan 0026, Phase A6: a sale of X with an affiliate commission of Y credits at most X minus fees in total
 * (never X + Y), on every path that can pay an Ebook order. Needs a disposable, fully migrated local database
 * (EBOOK_CREDITS_TEST_DATABASE_URL).
 */
const url = process.env.EBOOK_CREDITS_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;

const GROSS = 100; // order total paid by the buyer (X)
const COMMISSION = 10; // 10% affiliate commission (Y)
let platformOwner: string;
let platformId: string;
let sequence = 0;
const taxa = () => Number(getEbookTaxaServico());
const realFetch = globalThis.fetch;

const lane = (ratePpm: number) => ({
  active: true,
  contract: {
    fixedCents: 0,
    ratePpm,
    interestPpm: 0,
    cashbackCents: 0,
    base: 'BUYER_TOTAL' as const,
    reference: 'local',
  },
  sim: { fixedCents: 0, ratePpm: 0, interestPpm: 0 },
});

/** Valid CPF from a 9 digit seed. */
function cpf(seed: number) {
  const base = String(seed).padStart(9, '0').slice(-9).split('').map(Number);
  const digit = (digits: number[]) => {
    const sum = digits.reduce((s, d, i) => s + d * (digits.length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = digit(base);
  const d2 = digit([...base, d1]);
  return [...base, d1, d2].join('');
}
let cpfSeed = 300_000_000 + Math.floor(Math.random() * 90_000_000);

const user = (name: string, withCpf = false) =>
  db!.user.create({
    data: {
      name,
      email: `${name}-${crypto.randomUUID()}@test.local`,
      password: 'disabled',
      wallet: { create: {} },
      ...(withCpf ? { cpf: cpf(cpfSeed++) } : {}),
    },
  });

beforeAll(async () => {
  if (!db) return;
  await db.acquirerFeeSchedule.deleteMany({ where: { source: 'LOCAL_TEST' } });
  await db.financialPolicyRevision.deleteMany({ where: { tag: 'EBOOK' } });
  platformOwner = (await user('platform-owner')).id;
  const platform = await db.platform.upsert({
    where: { tag: 'EBOOK' },
    create: {
      tag: 'EBOOK',
      name: 'Ebook local',
      ownerUserId: platformOwner,
      acquirer: 'DOM',
    },
    update: { ownerUserId: platformOwner },
  });
  platformId = platform.id;
  const policy = emptyPolicy();
  policy.lanes['DOM/PIX/ONLINE/1'] = lane(10_000);
  await db.financialPolicyRevision.create({
    data: {
      tag: 'EBOOK',
      version: 200,
      document: policy as any,
      actorId: platformOwner,
    },
  });
  await db.acquirerCatalogue.upsert({
    where: { code: 'DOM' },
    create: { code: 'DOM', name: 'Local fake', active: true },
    update: { active: true },
  });
  await db.acquirerFeeSchedule.create({
    data: {
      acquirerCode: 'DOM',
      method: 'PIX',
      channel: 'ONLINE',
      installments: 1,
      fixedCents: 0,
      ratePpm: 10_000,
      interestPpm: 0,
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

const webhook = () =>
  new ProcessDomWebhookUseCase(
    db as any,
    {} as any,
    {
      applyForTransaction: async () => {},
      reverseForTransaction: async () => {},
    } as any,
  );
const finance = () => new PlatformFinanceService(db as any);
const context = () => ({
  id: platformId,
  tag: 'EBOOK',
  ownerUserId: platformOwner,
  acquirer: 'DOM' as const,
});
const order = () =>
  `ORD-2026-${String(100000 + Math.floor(Math.random() * 900000))}-${++sequence}`;

/** The seller entry as the back-ebook sends it: the owner amount (X - Y), priced by the server. */
const sendPending = (
  seller: string,
  orderNumber: string,
  amountCents = (GROSS - COMMISSION) * 100,
) =>
  finance().importEntry(
    context(),
    {
      referenceId: orderNumber,
      kind: 'pending',
      amountCents,
      paymentMethod: 'PIX',
      description: orderNumber,
    },
    seller,
    { merchant: true },
  );
const sendCommission = (affiliate: string, orderNumber: string) =>
  finance().importEntry(
    context(),
    {
      referenceId: `AFF-${orderNumber}`,
      orderNumber,
      kind: 'commission',
      amountCents: COMMISSION * 100,
      paymentMethod: 'PIX',
      description: 'Comissão de afiliado',
    },
    affiliate,
    { merchant: true },
  );

function fixture() {
  const gateway = {
    createPixCheckout: async (_t: string, input: any) => ({
      id: `pix-${crypto.randomUUID()}`,
      pixContent: 'pix',
      qrCode: 'qr',
      _cod: input.codExternal,
    }),
  };
  const resolver = { acquirerForSlug: () => 'DOM', byAcquirer: () => gateway };
  const checkout = new CheckoutController(
    db as any,
    gateway as any,
    resolver as any,
    {} as any,
  );
  return (body: Record<string, unknown>) =>
    checkout.createPublicPix({
      price: GROSS,
      description: 'Ebook',
      name: 'Buyer',
      email: 'buyer@test.local',
      document: '52998224725',
      mobile_phone: '',
      store: 'ebook',
      ...body,
    } as any);
}
const paid = (paymentId: string, codExternal: string) => ({
  event: 'transaction',
  signature: `sig-${crypto.randomUUID()}`,
  data: {
    id: paymentId,
    status: 'paid',
    amount: GROSS * 100,
    cod_external: codExternal,
    payment_method: 'pix',
    installments: 1,
    description: 'Ebook',
    customer: { name: 'Buyer', email: 'buyer@test.local' },
  },
});

/** Every wallet credit (BalanceLog) of the given accounts, per user. */
async function creditsPerUser(users: Record<string, string>) {
  const logs = await db!.balanceLog.findMany({
    where: { userId: { in: Object.values(users) } },
    orderBy: { createdAt: 'asc' },
  });
  const result: Record<string, number> = {};
  for (const [name, id] of Object.entries(users))
    result[name] = logs
      .filter((log) => log.userId === id)
      .reduce((sum, log) => sum + Number(log.balanceDelta), 0);
  return {
    perUser: Object.fromEntries(
      Object.entries(result).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    ),
    total:
      Math.round(Object.values(result).reduce((a, b) => a + b, 0) * 100) / 100,
    logs,
  };
}
const walletOf = async (userId: string) =>
  Number((await db!.wallet.findUniqueOrThrow({ where: { userId } })).balance);

run(
  'PATH A, adopted pending entry (owner X-Y) + commission entry: credits sum to X minus fees, in either arrival order',
  async () => {
    for (const commissionFirst of [false, true]) {
      const seller = (await user('seller')).id;
      const affiliate = (await user('affiliate')).id;
      const orderNumber = order();
      if (commissionFirst) await sendCommission(affiliate, orderNumber);
      await sendPending(seller, orderNumber);
      if (!commissionFirst) await sendCommission(affiliate, orderNumber);
      const created = await fixture()({ orderNumber });
      await webhook().execute(paid(created.id, created.transactionId));
      const entry = await db!.transaction.findUniqueOrThrow({
        where: { id: created.transactionId },
      });
      expect(entry.userId).toBe(seller);
      expect(entry.status).toBe('COMPLETED');
      const { perUser, total } = await creditsPerUser({ seller, affiliate });
      // owner net of the owner base (fee only on X-Y) minus the per-sale service fee, plus the commission
      expect(perUser.affiliate).toBe(COMMISSION);
      expect(perUser.seller).toBeCloseTo(Number(entry.netAmount) - taxa(), 2);
      const fees = GROSS - Number(entry.netAmount) - COMMISSION + taxa();
      expect(total).toBeCloseTo(GROSS - fees, 2);
      expect(total).toBeLessThan(GROSS);
      expect(await walletOf(seller)).toBeCloseTo(perUser.seller, 2);
      // the order never credits the platform owner
      expect(
        (await creditsPerUser({ platformOwner })).logs.filter(
          (l) => l.transactionId === created.transactionId,
        ),
      ).toHaveLength(0);
      console.log(
        `PROOF A (commission ${commissionFirst ? 'before' : 'after'} payment):`,
        JSON.stringify(perUser),
        'total',
        total,
      );
    }
  },
);

run(
  'PATH B, entry without server pricing paid through the checkout (FINAL_NET draft of the platform owner) + commission: total is X minus fees',
  async () => {
    for (const commissionFirst of [false, true]) {
      const seller = (await user('seller')).id;
      const affiliate = (await user('affiliate')).id;
      const orderNumber = order();
      const platformBefore = await walletOf(platformOwner);
      // legacy entry: no snapshot, so it is not adopted and the checkout falls back to the draft
      await db!.transaction.create({
        data: {
          userId: seller,
          domPaymentId: `EBOOK_PENDING_${orderNumber}`,
          amount: GROSS - COMMISSION,
          netAmount: null,
          status: 'PENDING',
          paymentMethod: 'PIX',
          platformTag: 'EBOOK',
          description: `${orderNumber} [TENANT:EBOOK]`,
        },
      });
      if (commissionFirst) await sendCommission(affiliate, orderNumber);
      const created = await fixture()({ orderNumber });
      const draft = await db!.transaction.findUniqueOrThrow({
        where: { id: created.transactionId },
      });
      expect(draft.settlementBasis).toBe('FINAL_NET');
      expect(draft.userId).toBe(platformOwner);
      await webhook().execute(paid(created.id, created.transactionId));
      if (!commissionFirst) await sendCommission(affiliate, orderNumber);
      const { perUser, total } = await creditsPerUser({
        seller,
        affiliate,
        platformOwner,
      });
      const net = Number(draft.netAmount);
      expect(perUser.affiliate).toBe(COMMISSION);
      expect(perUser.seller).toBe(0);
      // the platform owner holds the order credit; the commission is moved out of it, never added on top
      const ownerCredit = (await walletOf(platformOwner)) - platformBefore;
      expect(ownerCredit + perUser.affiliate).toBeCloseTo(net, 2);
      expect(ownerCredit + perUser.affiliate).toBeLessThan(GROSS);
      expect(net).toBeLessThan(GROSS);
      console.log(
        `PROOF B (commission ${commissionFirst ? 'before' : 'after'} payment): platform owner credit`,
        ownerCredit,
        'affiliate',
        perUser.affiliate,
        'sum',
        ownerCredit + perUser.affiliate,
        'net',
        net,
      );
    }
  },
);

run(
  'PATH C, payment without any prior entry (upsert path, full order credited to the owner) + commission: total is X minus fees',
  async () => {
    for (const commissionFirst of [false, true]) {
      const owner = await user('owner', true);
      const affiliate = (await user('affiliate')).id;
      const orderNumber = order();
      if (commissionFirst) await sendCommission(affiliate, orderNumber);
      const id = `pix-${crypto.randomUUID()}`;
      await (webhook() as any).upsertEbookTransaction(
        paid(id, 'x').data,
        orderNumber,
        owner.cpf,
        'Owner',
      );
      if (!commissionFirst) await sendCommission(affiliate, orderNumber);
      const row = await db!.transaction.findFirstOrThrow({
        where: { domPaymentId: id },
      });
      const { perUser, total } = await creditsPerUser({
        owner: owner.id,
        affiliate,
      });
      expect(perUser.affiliate).toBe(COMMISSION);
      expect(row.userId).toBe(owner.id);
      expect(total).toBeCloseTo(Number(row.netAmount) - taxa(), 2);
      expect(total).toBeLessThan(GROSS);
      expect(await walletOf(owner.id)).toBeCloseTo(perUser.owner, 2);
      // the merchant projection (Transaction row + funding debit) agrees with the wallet, counted once
      const ownerBalance = await new PlatformAttributedBalance(
        db as any,
      ).readMerchant(context(), owner.id);
      expect(ownerBalance.earnedCents / 100).toBeCloseTo(perUser.owner, 2);
      console.log(
        `PROOF C (commission ${commissionFirst ? 'before' : 'after'} payment):`,
        JSON.stringify(perUser),
        'total',
        total,
      );
    }
  },
);

run(
  'PATH D, legacy entry (no snapshot) completed by a payment without a bound transaction + commission: total is X minus fees',
  async () => {
    const seller = (await user('seller', true)).id;
    const affiliate = (await user('affiliate')).id;
    const orderNumber = order();
    const entry = await db!.transaction.create({
      data: {
        userId: seller,
        domPaymentId: `EBOOK_PENDING_${orderNumber}`,
        amount: GROSS - COMMISSION,
        netAmount: null,
        status: 'PENDING',
        paymentMethod: 'PIX',
        platformTag: 'EBOOK',
        description: `${orderNumber} [TENANT:EBOOK]`,
      },
    });
    const id = `pix-${crypto.randomUUID()}`;
    await (webhook() as any).upsertEbookTransaction(
      paid(id, 'x').data,
      orderNumber,
      null,
      null,
    );
    await sendCommission(affiliate, orderNumber);
    const done = await db!.transaction.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(done.status).toBe('COMPLETED');
    const { perUser, total } = await creditsPerUser({ seller, affiliate });
    expect(perUser.affiliate).toBe(COMMISSION);
    // priced on the owner amount of the entry (X - Y), not on the whole payment
    expect(Number(done.netAmount)).toBeLessThan(GROSS - COMMISSION);
    expect(perUser.seller).toBeCloseTo(Number(done.netAmount) - taxa(), 2);
    expect(total).toBeLessThan(GROSS);
    console.log('PROOF D:', JSON.stringify(perUser), 'total', total);
  },
);

run(
  'commission is idempotent and funded once; a replay never moves money twice',
  async () => {
    const owner = await user('owner', true);
    const affiliate = (await user('affiliate')).id;
    const orderNumber = order();
    const id = `pix-${crypto.randomUUID()}`;
    await (webhook() as any).upsertEbookTransaction(
      paid(id, 'x').data,
      orderNumber,
      owner.cpf,
      'Owner',
    );
    for (let i = 0; i < 3; i++) await sendCommission(affiliate, orderNumber);
    const row = await db!.transaction.findFirstOrThrow({
      where: { domPaymentId: id },
    });
    const { perUser, total } = await creditsPerUser({
      owner: owner.id,
      affiliate,
    });
    expect(perUser.affiliate).toBe(COMMISSION);
    expect(row.userId).toBe(owner.id);
    expect(total).toBeCloseTo(Number(row.netAmount) - taxa(), 2);
    const funded = await db!.balanceLog.count({
      where: { userId: owner.id, action: 'EBOOK_COMMISSION_FUNDED' },
    });
    expect(funded).toBe(1);
    // a second, different commission of the same order funds only its own part
    await finance().importEntry(
      context(),
      {
        referenceId: `AFF2-${orderNumber}`,
        orderNumber,
        kind: 'commission',
        amountCents: 500,
        paymentMethod: 'PIX',
      },
      affiliate,
      { merchant: true },
    );
    expect(
      (await creditsPerUser({ owner: owner.id, affiliate })).total,
    ).toBeLessThan(GROSS);
  },
);

/** Manifest order: owner, affiliate (10%) and optionally a platform coproducer. */
async function manifestOrder(withCoproducer: boolean) {
  const owner = await user('owner', true);
  const affiliate = await user('affiliate', true);
  const partner = await user('partner');
  if (withCoproducer)
    await db!
      .$executeRaw`INSERT INTO "CoproductionAgreement" (product, "productId", version, participants, "actorId") VALUES ('plataformas', ${platformId}, 1, ${JSON.stringify([{ userId: partner.id, percentageBps: 3000 }])}::jsonb, ${platformOwner})`;
  try {
    const orderNumber = order();
    const manifest = validateEbookManifest({
      version: 1,
      manifestId: crypto.randomUUID(),
      orderId: 9,
      orderNumber,
      currency: 'BRL',
      grossCents: GROSS * 100,
      fixedFeeSnapshot: { version: 1 },
      items: [
        {
          itemId: 'item-1',
          productId: 1,
          quantity: 1,
          grossCents: GROSS * 100,
          fixedFeeCents: 0,
          owner: {
            externalUserId: `seller-${crypto.randomUUID()}`,
            document: owner.cpf,
          },
          affiliate: {
            externalUserId: `aff-${crypto.randomUUID()}`,
            document: affiliate.cpf,
            linkId: 1,
            linkCode: 'LINK',
            commissionRateBps: 1000,
          },
          buyer: {
            externalUserId: `buyer-${crypto.randomUUID()}`,
            document: null,
          },
        },
      ],
    });
    const enrolled = await enrollEbook(db as any, manifest);
    const created = await fixture()({
      orderNumber,
      settlementId: enrolled.settlementId,
      settlementToken: enrolled.settlementToken,
    });
    await webhook().execute(paid(created.id, created.transactionId));
    // the back-ebook skips the commission entry for manifest orders; if it were sent, nothing is credited
    const skipped = await sendCommission(affiliate.id, orderNumber);
    expect((skipped as any).skipped).toBe('SETTLEMENT_CREDITS_AFFILIATE');
    const settlement = await db!.$queryRaw<
      { funding: { feeCents: number } }[]
    >`SELECT funding FROM "EbookSettlement" WHERE "orderNumber" = ${orderNumber}`;
    return {
      owner: owner.id,
      affiliate: affiliate.id,
      partner: partner.id,
      transactionId: created.transactionId as string,
      feeCents: settlement[0].funding.feeCents,
    };
  } finally {
    if (withCoproducer)
      await db!
        .$executeRaw`DELETE FROM "CoproductionAgreement" WHERE product = 'plataformas' AND "productId" = ${platformId}`;
  }
}

run(
  'PATH E, manifest order (settleEbookPayment): allocations sum to X minus the fee; the skipped commission entry credits nothing more',
  async () => {
    const m = await manifestOrder(false);
    const { perUser, total } = await creditsPerUser({
      owner: m.owner,
      affiliate: m.affiliate,
    });
    expect(perUser.affiliate).toBe(COMMISSION);
    expect(total).toBeCloseTo(GROSS - m.feeCents / 100, 2);
    expect(total).toBeLessThan(GROSS);
    console.log('PROOF E:', JSON.stringify(perUser), 'total', total);
  },
);

run(
  'PATH F, manifest order with a platform coproducer (EBOOK_V1): owner + affiliate + coproducer sum to X minus the fee, tagged EBOOK and counted once per merchant',
  async () => {
    const m = await manifestOrder(true);
    const { perUser, total, logs } = await creditsPerUser({
      owner: m.owner,
      affiliate: m.affiliate,
      partner: m.partner,
    });
    expect(perUser.affiliate).toBe(COMMISSION);
    expect(perUser.partner).toBeGreaterThan(0);
    expect(total).toBeCloseTo(GROSS - m.feeCents / 100, 2);
    expect(logs.every((l) => l.platformTag === 'EBOOK')).toBe(true);
    for (const [name, id] of Object.entries({
      owner: m.owner,
      affiliate: m.affiliate,
      partner: m.partner,
    })) {
      const balance = await new PlatformAttributedBalance(
        db as any,
      ).readMerchant(context(), id);
      expect(balance.earnedCents / 100).toBeCloseTo(perUser[name], 2);
    }
    console.log('PROOF F:', JSON.stringify(perUser), 'total', total);
  },
);

run(
  'PATH G, FINAL_NET row with a coproduction agreement: owner and coproducer credits sum to the net, carry platformTag EBOOK and are counted once per merchant',
  async () => {
    const owner = (await user('owner')).id;
    const partner = (await user('partner')).id;
    const orderNumber = order();
    const row = await db!.transaction.create({
      data: {
        userId: owner,
        amount: GROSS,
        netAmount: 85,
        status: 'PENDING',
        settlementBasis: 'FINAL_NET',
        platformTag: 'EBOOK',
        paymentMethod: 'PIX',
        description: `Ebook [TENANT:EBOOK] [ORDER:${orderNumber}]`,
        financialSnapshot: {
          coproduction: {
            basis: 'NET',
            version: 1,
            product: 'plataformas',
            productId: platformId,
            ownerUserId: owner,
            participants: [{ userId: partner, percentageBps: 3000 }],
          },
        },
      },
    });
    await db!.$transaction((p) =>
      settleFinalNet(p, row, 'COMPLETED', 'DOM_WEBHOOK'),
    );
    const { perUser, total, logs } = await creditsPerUser({ owner, partner });
    expect(perUser).toEqual({ owner: 59.5, partner: 25.5 });
    expect(total).toBe(85);
    expect(logs.every((l) => l.platformTag === 'EBOOK')).toBe(true);
    const ownerBalance = await new PlatformAttributedBalance(
      db as any,
    ).readMerchant(context(), owner);
    const partnerBalance = await new PlatformAttributedBalance(
      db as any,
    ).readMerchant(context(), partner);
    // owner: Transaction row (owner share) minus the per-sale service fee, once; coproducer: its credit once
    expect(ownerBalance.earnedCents / 100).toBeCloseTo(59.5 - taxa(), 2);
    expect(partnerBalance.earnedCents / 100).toBeCloseTo(25.5, 2);
    console.log('PROOF G:', JSON.stringify(perUser), 'total', total);
  },
);

run(
  'PATH G2, FINAL_NET row with coproduction + commission (either order): owner, coproducer and affiliate sum to X minus the fee on the owner base',
  async () => {
    for (const commissionFirst of [false, true]) {
      const owner = (await user('owner')).id;
      const partner = (await user('partner')).id;
      const affiliate = (await user('affiliate')).id;
      const orderNumber = order();
      const row = await db!.transaction.create({
        data: {
          userId: owner,
          amount: GROSS,
          netAmount: 90,
          status: 'PENDING',
          settlementBasis: 'FINAL_NET',
          platformTag: 'EBOOK',
          paymentMethod: 'PIX',
          description: `Ebook [TENANT:EBOOK] [ORDER:${orderNumber}]`,
          financialSnapshot: {
            coproduction: {
              basis: 'NET',
              version: 1,
              product: 'plataformas',
              productId: platformId,
              ownerUserId: owner,
              participants: [{ userId: partner, percentageBps: 3000 }],
            },
          },
        },
      });
      if (commissionFirst) await sendCommission(affiliate, orderNumber);
      await db!.$transaction((p) =>
        settleFinalNet(p, row, 'COMPLETED', 'DOM_WEBHOOK'),
      );
      if (!commissionFirst) await sendCommission(affiliate, orderNumber);
      const { perUser, total } = await creditsPerUser({
        owner,
        partner,
        affiliate,
      });
      expect(perUser.affiliate).toBe(COMMISSION);
      expect(perUser.partner).toBe(27);
      expect(perUser.owner).toBe(53);
      // the order net is 90: the owner bears the commission, the coproducer keeps its share
      expect(total).toBeCloseTo(90, 2);
      expect(total).toBeLessThan(GROSS);
      const merchant = (id: string) =>
        new PlatformAttributedBalance(db as any).readMerchant(context(), id);
      expect((await merchant(owner)).earnedCents / 100).toBeCloseTo(
        perUser.owner - taxa(), // pre-existing: the projection charges the per-sale fee the FINAL_NET credit never took
        2,
      );
      expect((await merchant(partner)).earnedCents / 100).toBeCloseTo(27, 2);
      console.log(
        `PROOF G2 (commission ${commissionFirst ? 'before' : 'after'}):`,
        JSON.stringify(perUser),
        'total',
        total,
      );
    }
  },
);

run(
  'PATH H, FINAL_NET row without coproduction for an Ebook order: the credit carries platformTag EBOOK',
  async () => {
    const owner = (await user('owner')).id;
    const row = await db!.transaction.create({
      data: {
        userId: owner,
        amount: GROSS,
        netAmount: 90,
        status: 'PENDING',
        settlementBasis: 'FINAL_NET',
        platformTag: 'EBOOK',
        paymentMethod: 'PIX',
        description: `Ebook [TENANT:EBOOK] [ORDER:${order()}]`,
      },
    });
    await db!.$transaction((p) =>
      settleFinalNet(p, row, 'COMPLETED', 'DOM_WEBHOOK'),
    );
    const { logs, total } = await creditsPerUser({ owner });
    expect(total).toBe(90);
    expect(logs.map((l) => l.platformTag)).toEqual(['EBOOK']);
    // a non Ebook row stays untagged (forward-only, Ebook only)
    const other = await db!.transaction.create({
      data: {
        userId: owner,
        amount: GROSS,
        netAmount: 90,
        status: 'PENDING',
        settlementBasis: 'FINAL_NET',
        platformTag: 'PAGATG',
        paymentMethod: 'PIX',
        description: 'x [TENANT:PAGATG]',
      },
    });
    await db!.$transaction((p) =>
      settleFinalNet(p, other, 'COMPLETED', 'DOM_WEBHOOK'),
    );
    const after = await creditsPerUser({ owner });
    expect(
      after.logs.filter((l) => l.transactionId === other.id)[0].platformTag,
    ).toBeNull();
  },
);

void Prisma;
