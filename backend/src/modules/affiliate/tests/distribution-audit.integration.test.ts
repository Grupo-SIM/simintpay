import { expect } from 'bun:test';
import type { User } from '@prisma/client';
import { DashboardSummaryUseCase } from '../../../application/use-cases/report/dashboard-summary.use-case';
import { GetTransactionDetailsUseCase } from '../../../application/use-cases/transactions/get-transaction-details.use-case';
import { ListTransactionsUseCase } from '../../../application/use-cases/transactions/list-transactions.use-case';
import { OwnedPlatformReportsService } from '../../../application/services/owned-platform-reports.service';
import {
  captureCoproduction,
  withCoproduction,
} from '../../coproduction/coproduction.service';
import { contractAffiliate, renewalAffiliate } from '../affiliate-capture';
import { db, fixture, run } from './affiliate-fixture.test';

type F = Awaited<ReturnType<typeof fixture>>;
type Share = { user: User; cents: number };
/** What one sale must have produced, per role. `absent` people must have received nothing. */
type Spec = {
  netCents: number;
  ownerCents: number;
  coproducer?: Share;
  affiliate?: Share;
  absent?: User[];
  state: 'AVAILABLE' | 'REVERSED';
  isRenewal?: boolean;
  /** False when earlier sales of the same people make period totals cumulative. */
  aggregates?: boolean;
};

const reais = (cents: number) => (cents / 100).toFixed(2);
const BUYER = {
  customerEmail: 'comprador@privado.test',
  customerName: 'Comprador Privado',
  customerDocument: '12345678909',
};

async function walletsOf(f: F, users: User[]) {
  const out = new Map<string, string>();
  for (const u of users) out.set(u.id, (await f.wallet(u.id)).balance);
  return out;
}

/** Books a pending sale with buyer data; `via` offer carries the offer id, API sales do not. */
async function book(
  f: F,
  code: string | undefined,
  opts: { netCents: number; via?: 'offer' | 'api' },
) {
  const via = opts.via ?? 'offer';
  const { row, snapshot } = await f.sale(code, {
    net: opts.netCents / 100,
    via,
  });
  await db!.transaction.update({
    where: { id: row.id },
    data: { ...BUYER, offerId: via === 'offer' ? f.offer.id : null },
  });
  return { row, snapshot };
}

const asOf = (u: User) =>
  ({ sub: u.id, role: 'USER', email: u.email }) as never;

/** Everything a person can read about the sale, through the real read paths. */
async function reads(f: F, u: User, txId: string) {
  const list = await new ListTransactionsUseCase(db! as never).execute({
    userId: u.id,
    role: 'USER',
    query: {} as never,
  });
  const item = list.data.transactions.find((t) => t.id === txId) ?? null;
  const detail = item
    ? await new GetTransactionDetailsUseCase(db! as never, {} as never).execute(
        { userId: u.id, role: 'USER', id: txId },
      )
    : null;
  const dash = await new DashboardSummaryUseCase(db! as never).execute({
    userId: u.id,
  });
  const report = await new OwnedPlatformReportsService(db! as never)
    .summary(asOf(u), { platform: f.platform.tag })
    .catch(() => null);
  return { item, detail, dash, report: report as NonNullable<typeof report> };
}

/** Wallets, ledger, allocations and every read response against one expectation. */
async function expectSale(
  f: F,
  txId: string,
  before: Map<string, string>,
  spec: Spec,
) {
  const { owner } = f;
  const credited = spec.state === 'AVAILABLE';
  const people = [
    owner,
    spec.coproducer?.user,
    spec.affiliate?.user,
    ...(spec.absent ?? []),
  ].filter(Boolean) as User[];
  // Money: allocations add up to the net, the owner keeps every rounding residue
  const coAlloc = await db!.$queryRaw<
    { userId: string; cents: bigint; state: string }[]
  >`
    SELECT "userId", (amount * 100)::bigint AS cents, state::text AS state FROM "CoproductionAllocation" WHERE "transactionId" = ${txId}`;
  const afAlloc = await db!.$queryRaw<
    { userId: string; cents: bigint; state: string }[]
  >`
    SELECT "userId", (amount * 100)::bigint AS cents, state::text AS state FROM "AffiliateAllocation" WHERE "transactionId" = ${txId}`;
  const total = [...coAlloc, ...afAlloc].reduce(
    (s, a) => s + Number(a.cents),
    0,
  );
  const logs = await db!.balanceLog.findMany({
    where: { transactionId: txId },
  });
  const logged = (userId: string) =>
    logs
      .filter((l) => l.userId === userId)
      .reduce((s, l) => s + Math.round(Number(l.balanceDelta) * 100), 0);
  const expected = new Map<string, number>([[owner.id, spec.ownerCents]]);
  if (spec.coproducer)
    expected.set(spec.coproducer.user.id, spec.coproducer.cents);
  if (spec.affiliate)
    expected.set(spec.affiliate.user.id, spec.affiliate.cents);
  expect(
    spec.ownerCents +
      (spec.coproducer?.cents ?? 0) +
      (spec.affiliate?.cents ?? 0),
  ).toBe(spec.netCents);
  if (coAlloc.length) {
    // mixed sale: the owner row of the allocation is the residue, the affiliate has its own table
    expect(total).toBe(spec.netCents);
    expect(Number(coAlloc.find((a) => a.userId === owner.id)!.cents)).toBe(
      spec.ownerCents,
    );
  } else {
    expect(afAlloc.reduce((s, a) => s + Number(a.cents), 0)).toBe(
      spec.affiliate?.cents ?? 0,
    );
  }
  for (const a of [...coAlloc, ...afAlloc]) expect(a.state).toBe(spec.state);
  for (const u of people) {
    const want = credited ? (expected.get(u.id) ?? 0) : 0;
    expect(logged(u.id)).toBe(want);
    expect(Number((await f.wallet(u.id)).balance)).toBeCloseTo(
      Number(before.get(u.id)) + want / 100,
      2,
    );
  }
  // Reads
  const o = await reads(f, owner, txId);
  const co = spec.coproducer
    ? await reads(f, spec.coproducer.user, txId)
    : null;
  const af = spec.affiliate ? await reads(f, spec.affiliate.user, txId) : null;
  const state = spec.state;
  const owned = credited ? spec.ownerCents : 0;
  // owner
  expect(o.item).not.toBeNull();
  expect(o.item!.customerEmail).toBe(BUYER.customerEmail);
  if (spec.affiliate) {
    expect(o.item!.afiliacao).toMatchObject({
      role: 'OWNER',
      readOnly: false,
      affiliateCommissionCents: spec.affiliate.cents,
      state,
      isRenewal: spec.isRenewal ?? false,
    });
    expect(
      typeof (o.item!.afiliacao as { affiliateCode?: unknown }).affiliateCode,
    ).toBe('string');
    expect(o.detail!.afiliacao).toMatchObject({
      role: 'OWNER',
      affiliateCommissionCents: spec.affiliate.cents,
      state,
    });
  } else {
    expect(o.item!.afiliacao ?? null).toBeNull();
    expect(o.detail!.afiliacao ?? null).toBeNull();
  }
  if (coAlloc.length)
    expect(o.item!.coproducao).toMatchObject({
      role: 'OWNER',
      myAmountCents: spec.ownerCents,
      state,
    });
  else expect(o.item!.coproducao ?? null).toBeNull();
  const totals = spec.aggregates !== false;
  expect(o.dash.coproducao.count).toBe(0);
  expect(o.dash.afiliacao.count).toBe(0);
  expect(o.report.coproducao?.count ?? 0).toBe(0);
  expect(o.report.afiliados).toEqual(o.dash.afiliados);
  if (totals) {
    expect(o.dash.afiliados).toEqual({
      count: spec.affiliate && credited ? 1 : 0,
      commissionCents: spec.affiliate && credited ? spec.affiliate.cents : 0,
    });
    expect(o.report.summary.netCents).toBe(owned);
    expect(o.dash.transactionsByPeriod.totalSales).toBeCloseTo(owned / 100, 2);
  }
  // coproducer: own share, no commission of the affiliate
  if (co && spec.coproducer) {
    const mine = spec.coproducer.cents;
    expect(co.item!.coproducao).toMatchObject({
      role: 'COPRODUCER',
      readOnly: true,
      myAmountCents: mine,
      state,
    });
    expect(co.detail!.coproducao).toMatchObject({ myAmountCents: mine, state });
    const sameAsAffiliate = spec.affiliate?.user.id === spec.coproducer.user.id;
    if (!sameAsAffiliate) {
      expect(co.item!.afiliacao ?? null).toBeNull();
      expect(co.detail!.afiliacao ?? null).toBeNull();
      expect(JSON.stringify([co.item, co.detail])).not.toContain(
        'affiliateCode',
      );
    }
    for (const view of [co.dash, co.report]) {
      if (totals)
        expect(view.coproducao).toMatchObject({
          count: 1,
          creditedCents: credited ? mine : 0,
          reversedCents: credited ? 0 : mine,
        });
      expect(view.afiliados).toEqual({ count: 0, commissionCents: 0 });
    }
    expect(co.report.summary.netCents).toBe(0);
  }
  // affiliate: own commission only, no buyer, no net, no coproducers
  if (af && spec.affiliate) {
    const mine = spec.affiliate.cents;
    expect(af.item!.afiliacao).toMatchObject({
      role: 'AFFILIATE',
      readOnly: true,
      myAmountCents: mine,
      state,
      isRenewal: spec.isRenewal ?? false,
    });
    expect(af.detail!.afiliacao).toMatchObject({ myAmountCents: mine, state });
    expect(af.item!.coproducao ?? null).toBeNull();
    expect(af.detail!.coproducao ?? null).toBeNull();
    expect(af.item!.netAmount).toBeNull();
    expect(af.item!.customerEmail).toBeNull();
    expect(af.item!.customerDocument).toBeNull();
    expect(JSON.stringify([af.item, af.detail])).not.toMatch(
      /privado|12345678909|affiliateCode|affiliateCommission/,
    );
    for (const view of [af.dash, af.report]) {
      if (totals)
        expect(view.afiliacao).toEqual({
          count: 1,
          creditedCents: credited ? mine : 0,
          lockedCents: 0,
          reversedCents: credited ? 0 : mine,
        });
      expect(view.afiliados).toEqual({ count: 0, commissionCents: 0 });
      expect(view.coproducao?.count ?? 0).toBe(0);
    }
    expect(af.report.summary.netCents).toBe(0);
  }
  // nobody else sees the sale; nobody ever sees a third party's e-mail
  for (const u of spec.absent ?? [])
    expect((await reads(f, u, txId)).item).toBeNull();
  const emails = [f.aff1.email, f.aff2.email].filter(
    (e) =>
      e !== spec.coproducer?.user.email && e !== spec.affiliate?.user.email,
  );
  for (const e of [f.aff1.email, f.aff2.email, f.outsider.email]) {
    const seenByOwner = JSON.stringify([o.item, o.detail]);
    expect(seenByOwner).not.toContain(e);
  }
  for (const view of [co, af])
    for (const e of emails)
      expect(
        JSON.stringify(view ? [view.item, view.detail] : ''),
      ).not.toContain(e);
}

const agreement = (email: string, percentageBps: number, version = 0) => ({
  basis: 'NET' as const,
  version,
  participants: [{ email, percentageBps }],
});
async function withWallets(f: F) {
  for (const u of [f.outsider, f.buyer])
    await f.prisma.wallet.upsert({
      where: { userId: u.id },
      update: {},
      create: { userId: u.id, balance: 0 },
    });
}

for (const via of ['offer', 'api'] as const) {
  // R$ 100,00 (exact) and R$ 90,01 (rounding residue: floors of 5% are 4,50 and the owner keeps 81,01)
  for (const [netCents, co5, af5, ownerCents] of [
    [10000, 500, 500, 9000],
    [9001, 450, 450, 8101],
  ] as const)
    run(
      `5% coproducer + 5% affiliate: each 5%, owner the rest (${via}, net ${reais(netCents)})`,
      async () => {
        const f = await fixture();
        await withWallets(f);
        await f.copro.save(
          f.owner.id,
          'plataformas',
          f.platform.id,
          agreement(f.aff2.email, 500),
        );
        await f.savePlatform({
          defaultPercentageBps: 500,
          affiliates: [{ email: f.aff1.email, percentageBps: null }],
        });
        const code = await f.codeOf(f.aff1.id);
        const before = await walletsOf(f, [f.owner, f.aff1, f.aff2]);
        const { row, snapshot } = await book(f, code, { netCents, via });
        expect(snapshot!.participants).toEqual([
          { userId: f.aff2.id, percentageBps: 500 },
        ]);
        expect(snapshot!.affiliate).toMatchObject({
          userId: f.aff1.id,
          percentageBps: 500,
        });
        await f.settle(row.id, 'COMPLETED');
        const spec: Spec = {
          netCents,
          ownerCents,
          coproducer: { user: f.aff2, cents: co5 },
          affiliate: { user: f.aff1, cents: af5 },
          state: 'AVAILABLE',
        };
        await expectSale(f, row.id, before, spec);
        // replay creates nothing
        expect(await f.settle(row.id, 'COMPLETED')).toBe(false);
        await expectSale(f, row.id, before, spec);
        // mediation locks every share, chargeback reverts exactly the original everywhere
        await f.settle(row.id, 'IN_MEDIATION');
        expect((await f.wallet(f.aff1.id)).locked).toBe(reais(af5));
        expect((await f.wallet(f.aff2.id)).locked).toBe(reais(co5));
        expect((await f.wallet(f.owner.id)).locked).toBe(reais(ownerCents));
        await f.settle(row.id, 'CHARGEBACK');
        await expectSale(f, row.id, before, { ...spec, state: 'REVERSED' });
        for (const u of [f.owner, f.aff1, f.aff2])
          expect((await f.wallet(u.id)).locked).toBe('0.00');
        // a refund of a completed sale (fresh platform) reverts the same way
        const g = await fixture();
        await withWallets(g);
        await g.copro.save(
          g.owner.id,
          'plataformas',
          g.platform.id,
          agreement(g.aff2.email, 500),
        );
        await g.savePlatform({
          defaultPercentageBps: 500,
          affiliates: [{ email: g.aff1.email, percentageBps: null }],
        });
        const mid = await walletsOf(g, [g.owner, g.aff1, g.aff2]);
        const second = await book(g, await g.codeOf(g.aff1.id), {
          netCents,
          via,
        });
        await g.settle(second.row.id, 'COMPLETED');
        await g.settle(second.row.id, 'REFUNDED');
        await expectSale(g, second.row.id, mid, {
          ...spec,
          coproducer: { user: g.aff2, cents: co5 },
          affiliate: { user: g.aff1, cents: af5 },
          state: 'REVERSED',
        });
      },
    );
}

for (const via of ['offer', 'api'] as const)
  run(
    `platform affiliate + coproducer: offer OWN replaces the platform list, API keeps it (${via})`,
    async () => {
      const f = await fixture();
      await withWallets(f);
      // platform list: outsider 20%; offer OWN: aff2 10%; platform affiliate aff1 5%
      await f.copro.save(
        f.owner.id,
        'plataformas',
        f.platform.id,
        agreement(f.outsider.email, 2000),
      );
      await f.copro.save(
        f.owner.id,
        'ofertas',
        f.offer.id,
        agreement(f.aff2.email, 1000),
      );
      await f.savePlatform({
        defaultPercentageBps: 500,
        affiliates: [{ email: f.aff1.email, percentageBps: null }],
      });
      const code = await f.codeOf(f.aff1.id);
      const before = await walletsOf(f, [f.owner, f.aff1, f.aff2, f.outsider]);
      const { row } = await book(f, code, { netCents: 9001, via });
      await f.settle(row.id, 'COMPLETED');
      if (via === 'offer')
        // 10% of 90,01 floors to 9,00; affiliate 4,50; owner 76,51
        await expectSale(f, row.id, before, {
          netCents: 9001,
          ownerCents: 7651,
          coproducer: { user: f.aff2, cents: 900 },
          affiliate: { user: f.aff1, cents: 450 },
          absent: [f.outsider],
          state: 'AVAILABLE',
        });
      else
        // API: platform list (outsider 20% = 18,00); affiliate 4,50; owner 67,51; aff2 gets nothing
        await expectSale(f, row.id, before, {
          netCents: 9001,
          ownerCents: 6751,
          coproducer: { user: f.outsider, cents: 1800 },
          affiliate: { user: f.aff1, cents: 450 },
          absent: [f.aff2],
          state: 'AVAILABLE',
        });
    },
  );

run(
  'same person as coproducer and affiliate: one share, no duplicate credit',
  async () => {
    // tie (both offer level): the coproducer wins, 10% of 90,01 floors to 9,00
    const f = await fixture();
    await withWallets(f);
    await f.copro.save(
      f.owner.id,
      'ofertas',
      f.offer.id,
      agreement(f.aff1.email, 1000),
    );
    const saved = await f.saveOffer({
      affiliates: [{ email: f.aff1.email, percentageBps: 500 }],
    });
    const before = await walletsOf(f, [f.owner, f.aff1]);
    const { row, snapshot } = await book(
      f,
      saved.data.affiliates[0].code as string,
      { netCents: 9001 },
    );
    expect(snapshot!.deduplication!.discarded).toBe('affiliate');
    await f.settle(row.id, 'COMPLETED');
    await expectSale(f, row.id, before, {
      netCents: 9001,
      ownerCents: 8101,
      coproducer: { user: f.aff1, cents: 900 },
      state: 'AVAILABLE',
    });
    // the audit never reaches the people involved
    for (const u of [f.owner, f.aff1])
      expect(JSON.stringify((await reads(f, u, row.id)).item)).not.toMatch(
        /deduplication|discarded/,
      );
    // affiliate wins: platform coproducer 20%, offer affiliate 5% for the same person
    const g = await fixture();
    await withWallets(g);
    await g.copro.save(
      g.owner.id,
      'plataformas',
      g.platform.id,
      agreement(g.aff1.email, 2000),
    );
    const offerSaved = await g.saveOffer({
      affiliates: [{ email: g.aff1.email, percentageBps: 500 }],
    });
    const beforeG = await walletsOf(g, [g.owner, g.aff1]);
    const won = await book(g, offerSaved.data.affiliates[0].code as string, {
      netCents: 9001,
    });
    expect(won.snapshot!.deduplication!.discarded).toBe('coproducer');
    await g.settle(won.row.id, 'COMPLETED');
    await expectSale(g, won.row.id, beforeG, {
      netCents: 9001,
      ownerCents: 8551,
      affiliate: { user: g.aff1, cents: 450 },
      state: 'AVAILABLE',
    });
    await g.settle(won.row.id, 'CHARGEBACK');
    await expectSale(g, won.row.id, beforeG, {
      netCents: 9001,
      ownerCents: 8551,
      affiliate: { user: g.aff1, cents: 450 },
      state: 'REVERSED',
    });
  },
);

run(
  'renewals follow commissionOnRenewals; the coproducer is paid in every cycle',
  async () => {
    for (const onRenewals of [true, false]) {
      const f = await fixture();
      await withWallets(f);
      await f.copro.save(
        f.owner.id,
        'ofertas',
        f.offer.id,
        agreement(f.aff2.email, 500),
      );
      await f.savePlatform({
        commissionOnRenewals: onRenewals,
        defaultPercentageBps: 500,
        affiliates: [{ email: f.aff1.email, percentageBps: null }],
      });
      const code = await f.codeOf(f.aff1.id);
      const before = await walletsOf(f, [f.owner, f.aff1, f.aff2]);
      const first = await book(f, code, { netCents: 10000 });
      await f.settle(first.row.id, 'COMPLETED');
      await expectSale(f, first.row.id, before, {
        netCents: 10000,
        ownerCents: 9000,
        coproducer: { user: f.aff2, cents: 500 },
        affiliate: { user: f.aff1, cents: 500 },
        state: 'AVAILABLE',
      });
      // second cycle, built from what the contract froze at the first sale
      const stored = contractAffiliate({
        affiliate: first.snapshot!.affiliate,
      } as never);
      const snapshot = renewalAffiliate(
        await captureCoproduction(
          f.prisma,
          'ofertas',
          f.offer.id,
          f.owner.id,
          f.platform.tag,
        ),
        stored,
        true,
        'ofertas',
        f.offer.id,
        f.owner.id,
      )!;
      snapshot.baseCents = 10000;
      const mid = await walletsOf(f, [f.owner, f.aff1, f.aff2]);
      const row = await f.prisma.transaction.create({
        data: {
          userId: f.owner.id,
          amount: 105,
          netAmount: 100,
          status: 'PENDING',
          settlementBasis: 'FINAL_NET',
          platformTag: f.platform.tag,
          offerId: f.offer.id,
          ...BUYER,
          financialSnapshot: withCoproduction(undefined, snapshot),
        },
      } as never);
      await f.settle(row.id, 'COMPLETED');
      await expectSale(
        f,
        row.id,
        mid,
        onRenewals
          ? {
              netCents: 10000,
              ownerCents: 9000,
              coproducer: { user: f.aff2, cents: 500 },
              affiliate: { user: f.aff1, cents: 500 },
              state: 'AVAILABLE',
              isRenewal: true,
              aggregates: false,
            }
          : {
              netCents: 10000,
              ownerCents: 9500,
              coproducer: { user: f.aff2, cents: 500 },
              absent: [f.aff1],
              state: 'AVAILABLE',
              aggregates: false,
            },
      );
      // period totals add both cycles: the owner paid the commission once or twice
      const paid = onRenewals ? 2 : 1;
      expect((await reads(f, f.owner, row.id)).dash.afiliados).toEqual({
        count: paid,
        commissionCents: paid * 500,
      });
      expect((await reads(f, f.aff1, row.id)).dash.afiliacao).toMatchObject({
        count: paid,
        creditedCents: paid * 500,
      });
      expect((await reads(f, f.aff2, row.id)).dash.coproducao).toMatchObject({
        count: 2,
        creditedCents: 1000,
      });
      // refunding the renewal reverts only that cycle
      await f.settle(row.id, 'REFUNDED');
      const after = await walletsOf(f, [f.owner, f.aff1, f.aff2]);
      expect(after).toEqual(mid);
    }
  },
);

for (const via of ['offer', 'api'] as const)
  run(
    `sale without an affiliate code: coproduction only (${via})`,
    async () => {
      const f = await fixture();
      await withWallets(f);
      await f.copro.save(
        f.owner.id,
        'plataformas',
        f.platform.id,
        agreement(f.aff2.email, 500),
      );
      await f.savePlatform({
        defaultPercentageBps: 500,
        affiliates: [{ email: f.aff1.email, percentageBps: null }],
      });
      const before = await walletsOf(f, [f.owner, f.aff1, f.aff2]);
      const { row, snapshot } = await book(f, undefined, {
        netCents: 9001,
        via,
      });
      expect(snapshot!.affiliate).toBeUndefined();
      await f.settle(row.id, 'COMPLETED');
      await expectSale(f, row.id, before, {
        netCents: 9001,
        ownerCents: 8551,
        coproducer: { user: f.aff2, cents: 450 },
        absent: [f.aff1],
        state: 'AVAILABLE',
      });
      expect(
        await f.prisma.affiliateAllocation.count({
          where: { transactionId: row.id },
        }),
      ).toBe(0);
    },
  );
