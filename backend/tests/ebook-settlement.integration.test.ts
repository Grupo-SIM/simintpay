import { beforeAll, afterAll, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import {
  buildEbookFunding,
  settleEbookPayment,
} from '../src/modules/platform-core/ebook-settlement';
import {
  ebookHash,
  validateEbookManifest,
} from '../src/modules/platform-core/ebook-manifest';
import {
  enrollEbook,
  claimEbookPayment,
} from '../src/modules/platform-core/ebook-enrollment';
import { recoverEbookPayment } from '../src/modules/platform-core/ebook-recovery';
import { CheckoutController } from '../src/presentation/controllers/checkout.controller';
import { ProcessWebhookUseCase } from '../src/application/use-cases/webhook/process-webhook.use-case';
import { ProcessDomWebhookUseCase } from '../src/application/use-cases/webhook/process-dom-webhook.use-case';
import { initializePlatformRegistryCache } from '../src/modules/module.registry';
import { initializePlatformIntegrationsCache } from '../src/modules/platform-integrations/platform-integrations.store';
import { emptyPolicy } from '../src/modules/financial-policy/financial-policy';
const url = process.env.EBOOK_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;
const manifest = validateEbookManifest({
  version: 1,
  manifestId: '11111111-1111-4111-8111-111111111111',
  orderId: 1,
  orderNumber: 'TEST-1',
  currency: 'BRL',
  grossCents: 10000,
  fixedFeeSnapshot: { version: 1 },
  items: [
    {
      itemId: 'item-1',
      productId: 1,
      quantity: 1,
      grossCents: 10000,
      fixedFeeCents: 0,
      owner: { externalUserId: 'owner', document: '52998224725' },
      affiliate: {
        externalUserId: 'affiliate',
        document: '11144477735',
        linkId: 1,
        linkCode: 'TEST',
        commissionRateBps: 2000,
      },
      buyer: { externalUserId: 'buyer', document: null },
    },
  ],
});
let owner: string, affiliate: string, partner: string, transactionId: string;
beforeAll(async () => {
  if (!db) return;
  const pg = new Client({ connectionString: url });
  await pg.connect();
  await pg.query(
    'DROP TABLE IF EXISTS "EbookSettlementReceipt", "EbookSettlement", "EbookBeneficiaryIdentity" CASCADE',
  );
  for (const migration of [
    '20261031130000_balance_log_drives_wallet',
    '20261102120000_ebook_settlement_v1',
    '20261118090000_transaction_settlement_basis_ebook_v1',
  ])
    await pg.query(
      readFileSync(
        new URL(
          `../prisma/migrations/${migration}/migration.sql`,
          import.meta.url,
        ),
        'utf8',
      ),
    );
  await pg.query(
    'TRUNCATE "EbookSettlementReceipt", "EbookSettlement", "EbookBeneficiaryIdentity" CASCADE',
  );
  await pg.end();
  const users = await Promise.all(
    ['owner', 'affiliate', 'partner'].map((name) =>
      db.user.create({
        data: {
          name,
          email: `${name}-${crypto.randomUUID()}@test.local`,
          password: 'disabled',
          wallet: { create: {} },
        },
      }),
    ),
  );
  [owner, affiliate, partner] = users.map((u) => u.id);
  const transaction = await db.transaction.create({
    data: {
      userId: owner,
      amount: 100,
      netAmount: 90,
      status: 'PENDING',
      settlementBasis: 'EBOOK_V1',
      platformTag: 'EBOOK',
    },
  });
  transactionId = transaction.id;
  const funding = buildEbookFunding(
    manifest,
    1000,
    { owner, affiliate },
    [{ userId: partner, percentageBps: 5000 }],
    { fixedFeeCents: 1000 },
  );
  await db.$executeRaw`INSERT INTO "EbookSettlement" (id,"manifestId","orderNumber","manifestHash",manifest,identities,"capabilityHash",funding,state,"providerPaymentId","transactionId") VALUES ('enrollment-test','11111111-1111-4111-8111-111111111111','TEST-1',${ebookHash(manifest)},${JSON.stringify(manifest)}::jsonb,'{}'::jsonb,'test',${JSON.stringify(funding)}::jsonb,'PENDING','fake-provider-payment',${transactionId})`;
});
afterAll(async () => {
  await db?.$disconnect();
});
run(
  'gross affiliate precedes copro; duplicates/concurrent payment, mediation and reversal conserve allocations',
  async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        settleEbookPayment(db!, 'fake-provider-payment', 'paid'),
      ),
    );
    expect(results.every(Boolean)).toBe(true);
    const balances = async () =>
      Promise.all(
        [owner, affiliate, partner].map(async (userId) => {
          const w = await db!.wallet.findUniqueOrThrow({ where: { userId } });
          return [Number(w.balance), Number(w.lockedBalance)];
        }),
      );
    expect(await balances()).toEqual([
      [35, 0],
      [20, 0],
      [35, 0],
    ]);
    expect(await db!.balanceLog.count({ where: { transactionId } })).toBe(3);
    await settleEbookPayment(db!, 'fake-provider-payment', 'in_mediation');
    expect(await balances()).toEqual([
      [0, 35],
      [0, 20],
      [0, 35],
    ]);
    await settleEbookPayment(db!, 'fake-provider-payment', 'paid');
    expect(await balances()).toEqual([
      [35, 0],
      [20, 0],
      [35, 0],
    ]);
    await settleEbookPayment(db!, 'fake-provider-payment', 'chargeback');
    expect(await balances()).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    await settleEbookPayment(db!, 'fake-provider-payment', 'paid');
    expect(await balances()).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    const receipts = await db!.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM "EbookSettlementReceipt"`;
    expect(Number(receipts[0].count)).toBe(4);
    if (process.env.EBOOK_SETTLEMENT_RECEIPT_FILE) {
      const produced = await db!.$queryRaw<
        { payload: unknown }[]
      >`SELECT payload FROM "EbookSettlementReceipt" WHERE "settlementId" = 'enrollment-test' ORDER BY (payload->>'revision')::integer`;
      writeFileSync(
        process.env.EBOOK_SETTLEMENT_RECEIPT_FILE,
        JSON.stringify({
          manifest,
          receipts: produced.map((row) => row.payload),
        }),
      );
    }
  },
);
run(
  'pre-payment reversal is terminal; pre-payment mediation locks instead of available credit',
  async () => {
    for (const [name, status] of [
      ['early-refund', 'refunded'],
      ['early-mediation', 'in_mediation'],
    ]) {
      const t = await db!.transaction.create({
        data: {
          userId: owner,
          amount: 100,
          netAmount: 90,
          status: 'PENDING',
          platformTag: 'EBOOK',
          settlementBasis: 'EBOOK_V1',
        },
      });
      const funding = buildEbookFunding(
        manifest,
        1000,
        { owner, affiliate },
        [],
        {},
      );
      await db!
        .$executeRaw`INSERT INTO "EbookSettlement" (id,"manifestId","orderNumber","manifestHash",manifest,identities,"capabilityHash",funding,state,"providerPaymentId","transactionId") VALUES (${name},${name},${name},'hash',${JSON.stringify(manifest)}::jsonb,'{}'::jsonb,'hash',${JSON.stringify(funding)}::jsonb,'PENDING',${name},${t.id})`;
      await settleEbookPayment(db!, name, status);
      const logs = await db!.balanceLog.findMany({
        where: { transactionId: t.id },
      });
      expect(logs.reduce((sum, l) => sum + Number(l.balanceDelta), 0)).toBe(0);
      expect(logs.reduce((sum, l) => sum + Number(l.lockedDelta), 0)).toBe(
        status === 'in_mediation' ? 90 : 0,
      );
      if (status === 'refunded') {
        await settleEbookPayment(db!, name, 'paid');
        expect(
          await db!.transaction.findUnique({ where: { id: t.id } }),
        ).toMatchObject({ status: 'REFUNDED' });
      }
    }
  },
);
run(
  'actual checkout -> fake provider early webhook -> exact binding -> DOM ledger, no legacy fallthrough',
  async () => {
    await db!.user.updateMany({
      where: { cpf: { in: ['52998224725', '11144477735'] } },
      data: { cpf: null },
    });
    await db!.user.update({
      where: { id: owner },
      data: { cpf: '52998224725' },
    });
    await db!.user.update({
      where: { id: affiliate },
      data: { cpf: '11144477735' },
    });
    await db!.platform.upsert({
      where: { tag: 'EBOOK' },
      create: {
        tag: 'EBOOK',
        name: 'Ebook local',
        ownerUserId: owner,
        acquirer: 'DOM',
      },
      update: { ownerUserId: owner },
    });
    const policy = emptyPolicy();
    policy.lanes['DOM/PIX/ONLINE/1'] = {
      active: true,
      contract: {
        fixedCents: 1000,
        ratePpm: 0,
        interestPpm: 0,
        cashbackCents: 0,
        base: 'BUYER_TOTAL',
        reference: 'local',
      },
      sim: { fixedCents: 0, ratePpm: 0, interestPpm: 0 },
    };
    await db!.financialPolicyRevision.upsert({
      where: { tag_version: { tag: 'EBOOK', version: 100 } },
      create: {
        tag: 'EBOOK',
        version: 100,
        document: policy as any,
        actorId: owner,
      },
      update: { document: policy as any },
    });
    await db!.acquirerCatalogue.upsert({
      where: { code: 'DOM' },
      create: { code: 'DOM', name: 'Local fake', active: true },
      update: { active: true },
    });
    await db!.acquirerFeeSchedule.create({
      data: {
        acquirerCode: 'DOM',
        method: 'PIX',
        channel: 'ONLINE',
        installments: 1,
        fixedCents: 1000,
        ratePpm: 0,
        interestPpm: 0,
        source: 'LOCAL_TEST',
      },
    });
    const platform = await db!.platform.findUniqueOrThrow({
      where: { tag: 'EBOOK' },
    });
    await db!.platformIntegration.upsert({
      where: { platformId_key: { platformId: platform.id, key: 'DOM_TOKEN' } },
      create: {
        platformId: platform.id,
        key: 'DOM_TOKEN',
        url: 'local-fake-token',
      },
      update: { url: 'local-fake-token' },
    });
    await initializePlatformIntegrationsCache(db!);
    await initializePlatformRegistryCache(db!);
    process.env.INTERNAL_SERVICE_TOKEN = 'local-internal-test';
    process.env.DOM_TOKEN = 'fake-local-only';
    await db!.webhookEvent.deleteMany({
      where: { eventId: 'local-fake-event' },
    });
    await db!.transaction.updateMany({
      where: {
        OR: [
          { domPaymentId: 'local-fake-payment' },
          { externalPaymentId: 'local-fake-payment' },
        ],
      },
      data: { domPaymentId: null, externalPaymentId: null },
    });
    let legacy = 0;
    let providerCalls = 0;
    let earlyFailed = false;
    const webhook = new ProcessDomWebhookUseCase(
      db as any,
      {} as any,
      {
        onTransactionStatusChanged: async () => {
          legacy++;
        },
      } as any,
    );
    const event = (reference: string) => ({
      event: 'transaction',
      signature: 'local-fake-event',
      data: {
        id: 'local-fake-payment',
        status: 'paid',
        amount: 100,
        cod_external: reference,
      },
    });
    let genericFailed = 0;
    const genericEvents = {
      findByEventId: async () => null,
      create: async () => ({ id: 'generic-local' }),
      markFailed: async () => {
        genericFailed++;
      },
      markProcessed: async () => {
        throw new Error('early generic must not acknowledge');
      },
    };
    const generic = new ProcessWebhookUseCase(
      genericEvents as any,
      {} as any,
      {} as any,
      db as any,
      {} as any,
      {
        onTransactionStatusChanged: async () => {
          legacy++;
        },
      } as any,
    );
    const gateway = {
      createPixCheckout: async (_token: string, input: any) => {
        providerCalls++;
        try {
          await webhook.execute(event(input.codExternal));
        } catch {
          earlyFailed = true;
        }
        try {
          await generic.execute({
            transactionId: input.codExternal,
            payload: {
              event: 'transaction',
              signature: 'generic-local',
              data: {
                paymentId: 'local-fake-payment',
                status: 'paid',
                amountWithoutAllFee: 90,
              },
            } as any,
          });
        } catch {
          /* durable failure expected before exact provider binding */
        }
        return { id: 'local-fake-payment', pixContent: 'local-pix' };
      },
    };
    const resolver = {
      acquirerForSlug: () => 'DOM',
      byAcquirer: () => gateway,
    };
    const checkout = new CheckoutController(
      db as any,
      gateway as any,
      resolver as any,
      {} as any,
    );
    const flowManifest = {
      ...manifest,
      manifestId: '22222222-2222-4222-8222-222222222222',
      orderNumber: 'FLOW-1',
    };
    delete process.env.INTERNAL_SERVICE_TOKEN;
    await expect(
      checkout.buildEbookCheckoutUrl(
        {
          value: 10000,
          description: 'local',
          store: 'ebook',
          settlement: flowManifest,
        },
        '',
      ),
    ).rejects.toThrow('Credencial interna obrigatória');
    process.env.INTERNAL_SERVICE_TOKEN = 'local-internal-test';
    await expect(
      checkout.buildEbookCheckoutUrl(
        {
          value: 10000,
          description: 'local',
          store: 'ebook',
          settlement: flowManifest,
        },
        'wrong',
      ),
    ).rejects.toThrow();
    const result = await checkout.buildEbookCheckoutUrl(
      {
        value: 10000,
        description: 'local',
        orderNumber: 'FLOW-1',
        store: 'ebook',
        settlement: flowManifest,
      },
      'local-internal-test',
    );
    const params = new URL(result.checkoutUrl, 'http://localhost').searchParams;
    const created = await checkout.createPublicPix({
      price: 100,
      description: 'local',
      name: 'Buyer',
      email: 'buyer@test.local',
      document: '52998224725',
      mobile_phone: '',
      store: 'ebook',
      orderNumber: 'FLOW-1',
      settlementId: params.get('settlementId')!,
      settlementToken: params.get('settlementToken')!,
    });
    expect(earlyFailed).toBe(true);
    expect(legacy).toBe(0);
    expect(providerCalls).toBe(1);
    expect(genericFailed).toBe(1);
    expect(
      await db!.balanceLog.count({
        where: { transactionId: created.transactionId },
      }),
    ).toBe(0);
    await webhook.execute(event(created.transactionId));
    expect(
      await db!.balanceLog.count({
        where: { transactionId: created.transactionId },
      }),
    ).toBe(2);
    expect(legacy).toBe(0);
    delete process.env.INTERNAL_SERVICE_TOKEN;
    delete process.env.DOM_TOKEN;
  },
);
run(
  'credential-scoped recovery rejects absent/wrong proof and is idempotent',
  async () => {
    const rows = await db!.$queryRaw<
      { id: string; transactionId: string }[]
    >`SELECT id,"transactionId" FROM "EbookSettlement" WHERE "orderNumber" = 'FLOW-1'`;
    const row = rows[0];
    const proof = {
      id_transaction: 'local-fake-payment',
      order_id: row.transactionId,
      total: 100,
      type_payment: 'pix',
      type: 'paid',
    };
    for (const detail of [
      null,
      { ...proof, order_id: 'wrong-account-order' },
      { ...proof, total: 99 },
      { ...proof, type_payment: 'credit_card' },
      { ...proof, id_transaction: 'other-id' },
    ])
      await expect(
        recoverEbookPayment(
          db as any,
          { getDomTransactionDetail: async () => detail } as any,
          'local-fake-token',
          row.id,
          'local-fake-payment',
        ),
      ).rejects.toThrow('PROOF_MISMATCH');
    await expect(
      recoverEbookPayment(
        db as any,
        { getDomTransactionDetail: async () => proof } as any,
        'rotated-key',
        row.id,
        'local-fake-payment',
      ),
    ).rejects.toThrow('CREDENTIAL_CHANGED');
    const before = await db!.balanceLog.count({
      where: { transactionId: row.transactionId },
    });
    await recoverEbookPayment(
      db as any,
      { getDomTransactionDetail: async () => proof } as any,
      'local-fake-token',
      row.id,
      'local-fake-payment',
    );
    await recoverEbookPayment(
      db as any,
      { getDomTransactionDetail: async () => proof } as any,
      'local-fake-token',
      row.id,
      'local-fake-payment',
    );
    expect(
      await db!.balanceLog.count({
        where: { transactionId: row.transactionId },
      }),
    ).toBe(before);
  },
);
run(
  'uncertain CREATING recovers once under concurrent verified detail, never creates a charge',
  async () => {
    const m = {
      ...manifest,
      manifestId: '44444444-4444-4444-8444-444444444444',
      orderNumber: 'RECOVER-1',
    };
    const e = await enrollEbook(db as any, m);
    const t = await db!.transaction.create({
      data: {
        userId: owner,
        amount: 100,
        status: 'PENDING',
        platformTag: 'EBOOK',
        acquirer: 'DOM',
      },
    });
    await claimEbookPayment(
      db as any,
      {
        settlementId: e.settlementId,
        settlementToken: e.settlementToken,
        orderNumber: m.orderNumber,
        store: 'ebook',
        price: 100,
      },
      t.id,
      {
        totalAmount: 100,
        netAmount: 90,
        financialSnapshot: { fixedFeeCents: 1000 },
      },
    );
    const proof = {
      id_transaction: 'recovered-fake-payment',
      order_id: t.id,
      total: 100,
      type_payment: 'pix',
      type: 'paid',
    };
    await Promise.all(
      [1, 2].map(() =>
        recoverEbookPayment(
          db as any,
          { getDomTransactionDetail: async () => proof } as any,
          'local-fake-token',
          e.settlementId,
          'recovered-fake-payment',
        ),
      ),
    );
    expect(await db!.balanceLog.count({ where: { transactionId: t.id } })).toBe(
      2,
    );
    expect(
      await db!.transactionStatusHistory.count({
        where: { transactionId: t.id },
      }),
    ).toBe(1);
    await settleEbookPayment(db as any, 'recovered-fake-payment', 'paid', t.id);
    expect(await db!.balanceLog.count({ where: { transactionId: t.id } })).toBe(
      2,
    );
  },
);
run(
  'deterministic underfunding creates durable BLOCKED receipt, no provider movement',
  async () => {
    const m = {
      ...manifest,
      manifestId: '33333333-3333-4333-8333-333333333333',
      orderNumber: 'BLOCKED-1',
    };
    const e = await enrollEbook(db as any, m);
    const t = await db!.transaction.create({
      data: {
        userId: owner,
        amount: 100,
        status: 'PENDING',
        platformTag: 'EBOOK',
      },
    });
    await expect(
      claimEbookPayment(
        db as any,
        {
          settlementId: e.settlementId,
          settlementToken: e.settlementToken,
          orderNumber: m.orderNumber,
          store: 'ebook',
          price: 100,
        },
        t.id,
        {
          totalAmount: 100,
          netAmount: 10,
          financialSnapshot: { fixedFeeCents: 9000 },
        },
      ),
    ).rejects.toThrow('INSUFFICIENT');
    const rows = await db!.$queryRaw<
      { state: string }[]
    >`SELECT state FROM "EbookSettlement" WHERE id = ${e.settlementId}`;
    expect(rows[0].state).toBe('BLOCKED');
    expect(await db!.balanceLog.count({ where: { transactionId: t.id } })).toBe(
      0,
    );
    const receipts = await db!.$queryRaw<
      { payload: any }[]
    >`SELECT payload FROM "EbookSettlementReceipt" WHERE "settlementId" = ${e.settlementId}`;
    expect(receipts[0].payload.status).toBe('BLOCKED');
  },
);
run('insufficient current sale fails without looking at seller wallet', () => {
  expect(() =>
    buildEbookFunding(manifest, 9000, { owner, affiliate }, [], {}),
  ).toThrow('EBOOK_INSUFFICIENT_CURRENT_SALE');
});
