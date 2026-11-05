import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { ChargePixPaymentLinkUseCase } from '../src/application/use-cases/payment-link/charge-pix-payment-link.use-case';
import { ChargePaymentLinkUseCase } from '../src/application/use-cases/payment-link/charge-payment-link.use-case';
import { useEmptyCaches } from '../src/application/use-cases/payment-link/charge-characterization.fixture';
import { settleFinalNet } from '../src/modules/platform-core/link-settlement';
import { markPreDispatchNoCharge } from '../src/modules/unified-platform/payments/dom-rejection';

/**
 * CHARACTERIZATION (DB-backed) of the payment-link PIX charge: real Postgres, mocked gateway.
 * Local disposable database only: PAYMENT_LINK_CHARGE_TEST_DATABASE_URL (prisma db push applied).
 * Skipped when the variable is absent.
 */
const url = process.env.PAYMENT_LINK_CHARGE_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Tests require a local isolated database');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = (name: string, body: () => Promise<void>) =>
  test.skipIf(!db)(name, body, 30000);

const migrationSql = readFileSync(
  resolve(
    import.meta.dir,
    '../prisma/migrations/20261031130000_balance_log_drives_wallet/migration.sql',
  ),
  'utf8',
);
const guardRe =
  /-- wallet-ledger-divergence-guard:begin[\s\S]*?-- wallet-ledger-divergence-guard:end/;

const oldToken = process.env.DOM_TOKEN;
beforeAll(async () => {
  if (!url) return;
  process.env.DOM_TOKEN = 'test-token';
  await useEmptyCaches();
  const pg = new Client({ connectionString: url });
  await pg.connect();
  try {
    await pg.query(migrationSql.replace(guardRe, ''));
  } finally {
    await pg.end();
  }
});
afterAll(async () => {
  if (oldToken === undefined) delete process.env.DOM_TOKEN;
  else process.env.DOM_TOKEN = oldToken;
  await db?.$disconnect();
});

const newUser = () =>
  db!.user.create({
    data: {
      email: `${crypto.randomUUID()}@local.test`,
      name: 'Owner',
      password: 'x',
      role: 'USER',
    },
  });
const newLink = (userId: string, over: Record<string, unknown> = {}) =>
  db!.paymentLink.create({
    data: {
      userId,
      title: 'Plan',
      amount: 100,
      domPaymentLinkId: `dom-${crypto.randomUUID()}`,
      plataformas: ['GLOBAL'],
      ...over,
    },
  });

function build(gatewayError?: unknown) {
  const calls: any[] = [];
  const gateway: any = {
    chargePixForLink: async (_t: string, input: any) => {
      calls.push(input);
      if (gatewayError) throw gatewayError;
      return {
        id: `pay-${crypto.randomUUID()}`,
        pixContent: 'copy',
        qrCode: 'qr',
        pixExpire: '2030-01-01T00:00:00.000Z',
      };
    },
    chargePaymentLink: async (_t: string, input: any) => {
      calls.push(input);
      return { id: `pay-${crypto.randomUUID()}`, status: 'approved' };
    },
  };
  const links: any = {
    findById: (id: string) => db!.paymentLink.findUnique({ where: { id } }),
    update: (id: string, data: any) =>
      db!.paymentLink.update({ where: { id }, data }),
  };
  const users: any = {
    findById: (id: string) => db!.user.findUnique({ where: { id } }),
  };
  return {
    calls,
    pix: new ChargePixPaymentLinkUseCase(links, users, gateway, db as never),
    generic: new ChargePaymentLinkUseCase(links, users, gateway, db as never),
  };
}
const buyer = (linkId: string, extra: Record<string, unknown> = {}) => ({
  linkId,
  customerName: 'Buyer',
  customerEmail: 'buyer@example.test',
  customerDocument: '123.456.789-01',
  customerPhone: '81999999999',
  ...extra,
});
const stored = (t: {
  amount: Prisma.Decimal;
  netAmount: Prisma.Decimal | null;
  totalFee: Prisma.Decimal | null;
  domFee: Prisma.Decimal | null;
  platformFee: Prisma.Decimal | null;
}) =>
  [t.amount, t.netAmount, t.totalFee, t.domFee, t.platformFee].map((v) =>
    v?.toFixed(2),
  );
const walletOf = (userId: string) =>
  db!.wallet.findUniqueOrThrow({ where: { userId } });

run(
  'plain PIX: persisted numbers, PENDING FINAL_NET, wallet untouched until settlement',
  async () => {
    const owner = await newUser();
    const link = await newLink(owner.id);
    const f = build();
    const out = await f.pix.execute(buyer(link.id));
    const tx = await db!.transaction.findUniqueOrThrow({
      where: { id: out.transactionId },
    });
    expect(stored(tx)).toEqual(['100.00', '87.00', '13.00', '4.99', '8.01']);
    expect(tx).toMatchObject({
      status: 'PENDING',
      settlementBasis: 'FINAL_NET',
      paymentMethod: 'PIX',
      paymentLinkId: link.id,
      userId: owner.id,
      customerDocument: '12345678901',
    });
    expect(tx.domPaymentId).toStartWith('pay-');
    expect(tx.pixContent).toBe('copy');
    expect(tx.financialSnapshot).toBeNull();
    expect((await walletOf(owner.id)).balance.toFixed(2)).toBe('0.00');
    expect(
      (await db!.paymentLink.findUniqueOrThrow({ where: { id: link.id } }))
        .currentUses,
    ).toBe(1);
    expect(
      await db!.balanceLog.count({ where: { transactionId: tx.id } }),
    ).toBe(0);

    // Settlement (webhook path) credits exactly netAmount, once.
    await db!.$transaction((p) => settleFinalNet(p, tx, 'COMPLETED', 'TEST'));
    expect((await walletOf(owner.id)).balance.toFixed(2)).toBe('87.00');
    const logs = await db!.balanceLog.findMany({
      where: { transactionId: tx.id },
    });
    expect(logs.map((l) => [l.action, l.balanceDelta.toFixed(2)])).toEqual([
      ['LINK_SETTLEMENT_COMPLETED', '87.00'],
    ]);
    await db!.$transaction((p) => settleFinalNet(p, tx, 'COMPLETED', 'TEST'));
    expect((await walletOf(owner.id)).balance.toFixed(2)).toBe('87.00');
  },
);

run(
  'card approved immediately through the generic endpoint credits netAmount, not the buyer total',
  async () => {
    const owner = await newUser();
    const link = await newLink(owner.id);
    const f = build();
    const out = await f.generic.execute({
      ...buyer(link.id),
      paymentMethod: 'credit_card',
      installments: 1,
      card: { token: 'fake' } as never,
    });
    const tx = await db!.transaction.findUniqueOrThrow({
      where: { id: out.transactionId },
    });
    expect(stored(tx)).toEqual(['104.99', '87.00', '17.99', '4.99', '13.00']);
    expect(tx.status).toBe('COMPLETED');
    expect((await walletOf(owner.id)).balance.toFixed(2)).toBe('87.00');
  },
);

run(
  'order bump: charged base includes the bump and an offer sale is recorded',
  async () => {
    const owner = await newUser();
    const link = await newLink(owner.id);
    const bump = await db!.paymentLinkOffer.create({
      data: {
        paymentLinkId: link.id,
        type: 'ORDER_BUMP',
        title: 'Bump',
        price: 20,
      },
    });
    const f = build();
    const out = await f.pix.execute(
      buyer(link.id, { orderBumpIds: [bump.id] }),
    );
    const tx = await db!.transaction.findUniqueOrThrow({
      where: { id: out.transactionId },
    });
    expect(stored(tx)).toEqual(['120.00', '105.20', '14.80', '5.79', '9.01']);
    expect(tx.description).toBe('Plan + Bump');
    const sales = await db!.paymentLinkOfferSale.findMany({
      where: { transactionId: tx.id },
    });
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      offerId: bump.id,
      type: 'ORDER_BUMP',
      parentTransactionId: null,
    });
    expect(sales[0].price.toFixed(2)).toBe('20.00');
  },
);

run(
  'upsell: needs an approved parent, charges only the offer and leaves currentUses alone',
  async () => {
    const owner = await newUser();
    const link = await newLink(owner.id, { maxUses: 1, currentUses: 1 });
    const upsell = await db!.paymentLinkOffer.create({
      data: { paymentLinkId: link.id, type: 'UPSELL', title: 'Up', price: 50 },
    });
    const parent = await db!.transaction.create({
      data: {
        userId: owner.id,
        paymentLinkId: link.id,
        amount: 100,
        netAmount: 87,
        status: 'COMPLETED',
        customerEmail: 'buyer@example.test',
        domPaymentId: `parent-${crypto.randomUUID()}`,
      },
    });
    const f = build();
    // main purchase is blocked by maxUses, the funnel offer is not
    await expect(f.pix.execute(buyer(link.id))).rejects.toThrow(
      'Limite de usos do link atingido',
    );
    const out = await f.pix.execute(
      buyer(link.id, { offerId: upsell.id, parentPaymentId: parent.id }),
    );
    const tx = await db!.transaction.findUniqueOrThrow({
      where: { id: out.transactionId },
    });
    expect(stored(tx)).toEqual(['50.00', '41.50', '8.50', '3.00', '5.50']);
    const sale = await db!.paymentLinkOfferSale.findFirstOrThrow({
      where: { transactionId: tx.id },
    });
    expect(sale).toMatchObject({
      type: 'UPSELL',
      parentTransactionId: parent.id,
    });
    expect(
      (await db!.paymentLink.findUniqueOrThrow({ where: { id: link.id } }))
        .currentUses,
    ).toBe(1);
  },
);

run(
  'guards write nothing: expired, maxUses reached, PIX not accepted',
  async () => {
    const owner = await newUser();
    const f = build();
    const cases: [Record<string, unknown>, string][] = [
      [
        { expiresAt: new Date(Date.now() - 1000) },
        'Link de pagamento expirado',
      ],
      [{ maxUses: 1, currentUses: 1 }, 'Limite de usos do link atingido'],
      [{ aceitaPix: false }, 'Este link não aceita pagamento via PIX'],
    ];
    for (const [over, message] of cases) {
      const link = await newLink(owner.id, over);
      await expect(f.pix.execute(buyer(link.id))).rejects.toThrow(message);
      expect(
        await db!.transaction.count({ where: { paymentLinkId: link.id } }),
      ).toBe(0);
    }
    expect(f.calls).toHaveLength(0);
  },
);

run(
  'gateway rejection: pre-dispatch failure deletes the DRAFT, ambiguous failure keeps it',
  async () => {
    const owner = await newUser();
    const link = await newLink(owner.id);
    await expect(
      build(markPreDispatchNoCharge(new Error('breaker open'))).pix.execute(
        buyer(link.id),
      ),
    ).rejects.toThrow('breaker open');
    expect(
      await db!.transaction.count({ where: { paymentLinkId: link.id } }),
    ).toBe(0);
    await expect(
      build(new Error('timeout')).pix.execute(buyer(link.id)),
    ).rejects.toThrow('timeout');
    const rows = await db!.transaction.findMany({
      where: { paymentLinkId: link.id },
    });
    expect(rows.map((r) => [r.status, r.domPaymentId])).toEqual([
      ['DRAFT', null],
    ]);
    expect(
      (await db!.paymentLink.findUniqueOrThrow({ where: { id: link.id } }))
        .currentUses,
    ).toBe(0);
  },
);

run(
  'coproduction: snapshot frozen at charge time and the net is split on settlement',
  async () => {
    const owner = await newUser();
    const co = await newUser();
    const link = await newLink(owner.id);
    await db!
      .$executeRaw`INSERT INTO "CoproductionAgreement" (product, "productId", version, participants, "actorId", mode)
    VALUES ('links-pagamento', ${link.id}, 4, ${JSON.stringify([{ userId: co.id, percentageBps: 3000 }])}::jsonb, ${owner.id}, 'OWN')`;
    const f = build();
    const out = await f.pix.execute(buyer(link.id));
    const tx = await db!.transaction.findUniqueOrThrow({
      where: { id: out.transactionId },
    });
    expect(stored(tx)).toEqual(['100.00', '87.00', '13.00', '4.99', '8.01']);
    expect(tx.financialSnapshot).toEqual({
      coproduction: {
        basis: 'NET',
        version: 4,
        product: 'links-pagamento',
        productId: link.id,
        ownerUserId: owner.id,
        participants: [{ userId: co.id, percentageBps: 3000 }],
      },
    });
    // editing the agreement afterwards must not change the frozen snapshot
    await db!
      .$executeRaw`UPDATE "CoproductionAgreement" SET version = 5, participants = '[]'::jsonb WHERE "productId" = ${link.id}`;
    await db!.$transaction((p) => settleFinalNet(p, tx, 'COMPLETED', 'TEST'));
    const allocations = await db!.$queryRaw<
      { userId: string; amount: Prisma.Decimal; state: string }[]
    >`SELECT "userId", amount, state FROM "CoproductionAllocation" WHERE "transactionId" = ${tx.id}`;
    const byUser = Object.fromEntries(
      allocations.map((a) => [a.userId, [Number(a.amount), a.state]]),
    );
    // 30% of 87 = 26.10 to the co-producer, residual 60.90 to the owner
    expect(byUser[co.id]).toEqual([26.1, 'AVAILABLE']);
    expect(byUser[owner.id]).toEqual([60.9, 'AVAILABLE']);
    expect((await walletOf(co.id)).balance.toFixed(2)).toBe('26.10');
    expect((await walletOf(owner.id)).balance.toFixed(2)).toBe('60.90');
  },
);
