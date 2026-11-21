import { expect } from 'bun:test';
import {
  captureCoproduction,
  withCoproduction,
} from '../../coproduction/coproduction.service';
import { contractAffiliate, renewalAffiliate } from '../affiliate-capture';
import { saleAffiliateEvent } from '../affiliate-event';
import { settleAffiliate } from '../affiliate-settlement';
import { snapshotFrom } from '../../coproduction/coproduction';
import { fixture, run } from './affiliate-fixture.test';

run(
  'config: security, optimistic version, stable codes and read-only inheritance',
  async () => {
    const f = await fixture();
    const p = await f.savePlatform({
      defaultPercentageBps: 1000,
      linkBaseUrl: 'https://rastrewin.com/',
      affiliates: [{ email: f.aff1.email.toUpperCase(), percentageBps: null }],
    });
    expect(p.data.version).toBe(1);
    expect(p.data.affiliates[0]).toMatchObject({
      email: f.aff1.email,
      percentageBps: null,
    });
    const code = p.data.affiliates[0].code as string;
    expect(code).toMatch(/^[A-Za-z0-9_-]{3,40}$/);
    expect(code).not.toContain('@');
    // stale version, outsider, owner as affiliate, duplicate, bad link, integration-less users
    await expect(f.savePlatform({}, 0)).rejects.toThrow('outra sessão');
    await expect(f.savePlatform({}, 1, f.outsider.id)).rejects.toThrow(
      'restritos',
    );
    await expect(
      f.savePlatform(
        { affiliates: [{ email: f.owner.email, percentageBps: 100 }] },
        1,
      ),
    ).rejects.toThrow('duplicado');
    await expect(
      f.savePlatform(
        {
          affiliates: [
            { email: f.aff2.email, percentageBps: 100 },
            { email: f.aff2.email.toUpperCase(), percentageBps: 100 },
          ],
        },
        1,
      ),
    ).rejects.toThrow('duplicado');
    await expect(
      f.savePlatform({ linkBaseUrl: 'http://x.com' }, 1),
    ).rejects.toThrow('HTTPS');
    await expect(
      f.savePlatform({ commissionOnRenewals: null }, 1),
    ).rejects.toThrow();
    // admin can configure; the same person in an offer list keeps the platform code
    expect(
      (
        await f.savePlatform(
          {
            defaultPercentageBps: 1000,
            linkBaseUrl: 'https://rastrewin.com/',
            affiliates: [{ email: f.aff1.email, percentageBps: null }],
          },
          1,
          f.admin.id,
        )
      ).data.version,
    ).toBe(2);
    const o = await f.saveOffer({
      affiliates: [
        { email: f.aff1.email, percentageBps: 500 },
        { email: f.aff2.email, percentageBps: null },
      ],
    });
    expect(o.data.affiliates.find((a) => a.email === f.aff1.email)!.code).toBe(
      code,
    );
    expect(o.data.affiliates.find((a) => a.email === f.aff2.email)!.code).toBe(
      await f.codeOf(f.aff2.id),
    );
    expect(o.data.inherited).toEqual({
      defaultPercentageBps: 1000,
      commissionOnRenewals: true,
      affiliates: [{ name: 'Pessoa', code, percentageBps: null }],
    });
    expect(JSON.stringify(o.data.inherited)).not.toContain('@');
    expect(
      (await f.service.get(f.owner.id, 'plataformas', f.platform.id)).data
        .linkBaseUrl,
    ).toBe('https://rastrewin.com/');
    // codes are per platform and unique
    expect(await f.codeOf(f.aff1.id)).toBe(code);
    // immutable revisions kept
    expect(
      Number(
        (
          await f.prisma.$queryRaw<
            { n: bigint }[]
          >`SELECT count(*) n FROM "AffiliateAgreementRevision" WHERE "productId" = ${f.platform.id}`
        )[0].n,
      ),
    ).toBe(2);
    // concurrent saves: one wins
    const results = await Promise.allSettled([
      f.saveOffer({}, 1),
      f.saveOffer({}, 1),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  },
);

run(
  'precedence: person in offer > offer default > person in platform > platform default',
  async () => {
    const f = await fixture();
    await f.savePlatform({
      defaultPercentageBps: 1000,
      affiliates: [
        { email: f.aff1.email, percentageBps: 3000 },
        { email: f.aff2.email, percentageBps: null },
      ],
    });
    const c1 = await f.codeOf(f.aff1.id);
    const c2 = await f.codeOf(f.aff2.id);
    // platform only through the API path
    expect(
      (await f.sale(c1, { via: 'api' })).snapshot!.affiliate,
    ).toMatchObject({ percentageBps: 3000, level: 'platform' });
    expect(
      (await f.sale(c2, { via: 'api' })).snapshot!.affiliate,
    ).toMatchObject({ percentageBps: 1000, level: 'platform' });
    // offer unions with the platform list (no offer config yet): platform people also sell the offer
    expect((await f.sale(c1)).snapshot!.affiliate).toMatchObject({
      percentageBps: 3000,
      level: 'platform',
    });
    // offer default beats the person's platform percentage
    await f.saveOffer({ defaultPercentageBps: 500 });
    const s = (await f.sale(c1)).snapshot!.affiliate!;
    expect(s).toMatchObject({
      percentageBps: 500,
      level: 'offer',
      versions: { platform: 1, offer: 1 },
    });
    // person in the offer beats everything, including the offer default; same person in both
    await f.saveOffer(
      {
        defaultPercentageBps: 500,
        affiliates: [{ email: f.aff1.email, percentageBps: 2000 }],
      },
      1,
    );
    expect((await f.sale(c1)).snapshot!.affiliate).toMatchObject({
      percentageBps: 2000,
      level: 'offer',
    });
    expect((await f.sale(c2)).snapshot!.affiliate).toMatchObject({
      percentageBps: 500,
      level: 'offer',
    });
    // the API path ignores the offer list
    expect(
      (await f.sale(c1, { via: 'api' })).snapshot!.affiliate,
    ).toMatchObject({ percentageBps: 3000 });
    // person with null in the offer falls through offer default -> platform person
    await f.saveOffer(
      { affiliates: [{ email: f.aff1.email, percentageBps: null }] },
      2,
    );
    expect((await f.sale(c1)).snapshot!.affiliate).toMatchObject({
      percentageBps: 3000,
      level: 'platform',
    });
  },
);

run(
  'invalid, unknown, removed codes, self-referral and the buyer himself earn nothing',
  async () => {
    const f = await fixture();
    await f.savePlatform({
      defaultPercentageBps: 1000,
      affiliates: [{ email: f.aff1.email, percentageBps: null }],
    });
    const code = await f.codeOf(f.aff1.id);
    expect((await f.sale('ZZZ-unknown')).snapshot).toBeNull();
    expect((await f.sale('a@b.com')).snapshot).toBeNull();
    expect((await f.sale(undefined)).snapshot).toBeNull();
    expect(
      (await f.sale(code, { buyerEmail: f.aff1.email.toUpperCase() })).snapshot,
    ).toBeNull();
    expect((await f.sale(code)).snapshot!.affiliate).toBeTruthy();
    // removed from the list: code kept but ignored
    await f.savePlatform({ affiliates: [] }, 1);
    expect(await f.codeOf(f.aff1.id)).toBe(code);
    expect((await f.sale(code)).snapshot).toBeNull();
    // owner: even forcing their own code gives no commission
    await f.prisma
      .$executeRaw`INSERT INTO "AffiliateCode" ("platformId","userId",code) VALUES (${f.platform.id}, ${f.owner.id}, 'OWNERCODE')`;
    expect((await f.sale('OWNERCODE')).snapshot).toBeNull();
  },
);

run(
  'settlement: credit, mediation lock, chargeback reversal, idempotency, API and offer',
  async () => {
    const f = await fixture();
    await f.savePlatform({
      defaultPercentageBps: 1000,
      affiliates: [{ email: f.aff1.email, percentageBps: null }],
    });
    const code = await f.codeOf(f.aff1.id);
    for (const via of ['api', 'offer'] as const) {
      const before = {
        owner: await f.wallet(f.owner.id),
        aff: await f.wallet(f.aff1.id),
      };
      const { row } = await f.sale(code, { via, net: 10.01 });
      expect(await f.settle(row.id, 'COMPLETED')).toBe(true);
      expect(await f.settle(row.id, 'COMPLETED')).toBe(false);
      const aff = await f.wallet(f.aff1.id);
      const own = await f.wallet(f.owner.id);
      // 10% of 1001 cents floored = 100 cents
      expect(Number(aff.balance) - Number(before.aff.balance)).toBeCloseTo(
        1.0,
        2,
      );
      expect(Number(own.balance) - Number(before.owner.balance)).toBeCloseTo(
        9.01,
        2,
      );
      expect(
        await f.prisma.balanceLog.count({
          where: { transactionId: row.id, nature: 'AFFILIATE' },
        }),
      ).toBe(1);
      // direct replay is a no-op
      await f.prisma.$transaction(async (tx) => {
        const current = await tx.transaction.findUniqueOrThrow({
          where: { id: row.id },
        });
        await settleAffiliate(
          tx,
          current,
          snapshotFrom(current.financialSnapshot)!,
          'COMPLETED',
          'REPLAY',
        );
      });
      expect(
        await f.prisma.balanceLog.count({
          where: { transactionId: row.id, nature: 'AFFILIATE' },
        }),
      ).toBe(1);
      await f.settle(row.id, 'IN_MEDIATION');
      expect((await f.wallet(f.aff1.id)).locked).toBe(
        (Number(before.aff.locked) + 1).toFixed(2),
      );
      expect(await f.settle(row.id, 'CHARGEBACK')).toBe(true);
      // reversed to the original amount, no recalculation
      expect(await f.wallet(f.aff1.id)).toEqual(before.aff);
      expect(await f.wallet(f.owner.id)).toEqual(before.owner);
      const allocation = (
        await f.prisma.$queryRaw<
          { amount: unknown; state: string; isRenewal: boolean }[]
        >`SELECT amount, state, "isRenewal" FROM "AffiliateAllocation" WHERE "transactionId" = ${row.id}`
      )[0];
      expect(allocation).toMatchObject({ state: 'REVERSED', isRenewal: false });
    }
    // refund of a completed sale reverses it too
    const { row } = await f.sale(code, { net: 50 });
    await f.settle(row.id, 'COMPLETED');
    const w = await f.wallet(f.aff1.id);
    await f.settle(row.id, 'REFUNDED');
    expect(Number((await f.wallet(f.aff1.id)).balance)).toBeCloseTo(
      Number(w.balance) - 5,
      2,
    );
    // receipts of the affiliate
    const receipts = await f.service.receipts(f.aff1.id);
    expect(receipts.total).toBe(3);
    expect(receipts.summary.reversedCents).toBe(100 + 100 + 500);
    await expect(f.service.receipts(f.outsider.id)).resolves.toMatchObject({
      total: 0,
    });
  },
);

run(
  'coproduction + affiliate: commission comes out of the owner share and the sum is guarded',
  async () => {
    const f = await fixture();
    await f.copro.save(f.owner.id, 'ofertas', f.offer.id, {
      basis: 'NET',
      version: 0,
      participants: [{ email: f.aff2.email, percentageBps: 6000 }],
    });
    await expect(
      f.saveOffer({
        defaultPercentageBps: 5000,
        affiliates: [{ email: f.aff1.email, percentageBps: null }],
      }),
    ).rejects.toThrow('100%');
    const saved = await f.saveOffer({
      defaultPercentageBps: 4000,
      affiliates: [{ email: f.aff1.email, percentageBps: null }],
    });
    const code = saved.data.affiliates[0].code as string;
    const { row, snapshot } = await f.sale(code, { net: 100 });
    expect(snapshot!.affiliate!.percentageBps).toBe(4000);
    await f.settle(row.id, 'COMPLETED');
    expect((await f.wallet(f.aff1.id)).balance).toBe('40.00');
    expect((await f.wallet(f.aff2.id)).balance).toBe('60.00');
    expect((await f.wallet(f.owner.id)).balance).toBe('0.00');
    // coproduction raised after the agreement: capture revalidates and refuses the sale
    // (the PUT now refuses it, so a legacy overflow is forced straight into the table)
    await expect(
      f.copro.save(f.owner.id, 'ofertas', f.offer.id, {
        basis: 'NET',
        version: 1,
        participants: [{ email: f.aff2.email, percentageBps: 7000 }],
      }),
    ).rejects.toThrow('100%');
    await f.prisma
      .$executeRaw`UPDATE "CoproductionAgreement" SET participants = jsonb_set(participants, '{0,percentageBps}', '7000') WHERE product = 'ofertas' AND "productId" = ${f.offer.id}`;
    await expect(f.sale(code)).rejects.toThrow('100%');
    // a platform list cannot overflow either, checked against offers of the platform
    await expect(
      f.savePlatform({
        defaultPercentageBps: 3500,
        affiliates: [{ email: f.aff1.email, percentageBps: null }],
      }),
    ).rejects.toThrow('100%');
  },
);

run(
  'renewals follow the original snapshot and the commissionOnRenewals option',
  async () => {
    const f = await fixture();
    await f.savePlatform({
      defaultPercentageBps: 1000,
      affiliates: [{ email: f.aff1.email, percentageBps: null }],
    });
    const code = await f.codeOf(f.aff1.id);
    const first = (await f.sale(code)).snapshot!;
    const metadata = { pendingCard: {}, affiliate: first.affiliate };
    const stored = contractAffiliate(metadata as never);
    expect(stored?.code).toBe(code);
    // option on: the renewal is paid and marked
    const paid = renewalAffiliate(
      null,
      stored,
      true,
      'ofertas',
      f.offer.id,
      f.owner.id,
    );
    expect(paid!.affiliate).toMatchObject({
      percentageBps: 1000,
      isRenewal: true,
    });
    paid!.baseCents = 10000;
    const row = await f.prisma.transaction.create({
      data: {
        userId: f.owner.id,
        amount: 105,
        netAmount: 100,
        status: 'PENDING',
        settlementBasis: 'FINAL_NET',
        platformTag: f.platform.tag,
        financialSnapshot: withCoproduction(undefined, paid),
      },
    } as never);
    await f.settle(row.id, 'COMPLETED');
    expect(
      (
        await f.prisma.$queryRaw<
          { isRenewal: boolean }[]
        >`SELECT "isRenewal" FROM "AffiliateAllocation" WHERE "transactionId" = ${row.id}`
      )[0].isRenewal,
    ).toBe(true);
    // option off: renewal has no allocation and no event block, the first cycle still pays
    const off = { ...stored!, commissionOnRenewals: false };
    expect(
      renewalAffiliate(null, off, true, 'ofertas', f.offer.id, f.owner.id),
    ).toBeNull();
    expect(
      renewalAffiliate(null, off, false, 'ofertas', f.offer.id, f.owner.id)!
        .affiliate,
    ).toBeTruthy();
    expect(
      renewalAffiliate(null, null, true, 'ofertas', f.offer.id, f.owner.id),
    ).toBeNull();
    // contract without affiliate metadata
    expect(contractAffiliate(null)).toBeNull();
    expect(contractAffiliate({ pendingCard: {} } as never)).toBeNull();
    // effective option snapshot: offer overrides platform, null falls back
    await f.savePlatform(
      {
        commissionOnRenewals: false,
        defaultPercentageBps: 1000,
        affiliates: [{ email: f.aff1.email, percentageBps: null }],
      },
      1,
    );
    expect((await f.sale(code)).snapshot!.affiliate!.commissionOnRenewals).toBe(
      false,
    );
    await f.saveOffer({ commissionOnRenewals: true });
    expect((await f.sale(code)).snapshot!.affiliate!.commissionOnRenewals).toBe(
      true,
    );
  },
);

run(
  'sales event carries only code, commission and name; absent without commission',
  async () => {
    const f = await fixture();
    await f.savePlatform({
      defaultPercentageBps: 1500,
      affiliates: [{ email: f.aff1.email, percentageBps: null }],
    });
    const code = await f.codeOf(f.aff1.id);
    const { row } = await f.sale(code, { net: 20 });
    const event = saleAffiliateEvent(row as never);
    expect(event).toEqual({ code, commissionCents: 300, name: 'Pessoa' });
    expect(JSON.stringify(event)).not.toContain(f.aff1.email);
    const plain = await f.sale(undefined);
    expect(saleAffiliateEvent(plain.row as never)).toBeUndefined();
  },
);

const agreement = (email: string, percentageBps: number, version = 0) => ({
  basis: 'NET' as const,
  version,
  participants: [{ email, percentageBps }],
});
const balanceLogs = (f: Awaited<ReturnType<typeof fixture>>, id: string) =>
  f.prisma.balanceLog.count({ where: { transactionId: id } });

run(
  'dedup: same person coproducer and affiliate at the same level keeps only the coproducer',
  async () => {
    const f = await fixture();
    await f.copro.save(
      f.owner.id,
      'ofertas',
      f.offer.id,
      agreement(f.aff1.email, 1000),
    );
    const saved = await f.saveOffer({
      affiliates: [{ email: f.aff1.email, percentageBps: 500 }],
    });
    const code = saved.data.affiliates[0].code as string;
    const { row, snapshot } = await f.sale(code, { net: 100 });
    expect(snapshot!.affiliate).toBeUndefined();
    expect(snapshot!.participants).toEqual([
      { userId: f.aff1.id, percentageBps: 1000 },
    ]);
    expect(snapshot!.deduplication).toEqual({
      discarded: 'affiliate',
      coproducerLevel: 'offer',
      affiliateLevel: 'offer',
      discardedPercentageBps: 500,
    });
    expect(JSON.stringify(snapshot!.deduplication)).not.toContain('@');
    expect(saleAffiliateEvent(row as never)).toBeUndefined();
    await f.settle(row.id, 'COMPLETED');
    expect(await f.wallet(f.aff1.id)).toEqual({
      balance: '10.00',
      locked: '0.00',
    });
    expect((await f.wallet(f.owner.id)).balance).toBe('90.00');
    expect(
      await f.prisma.affiliateAllocation.count({
        where: { transactionId: row.id },
      }),
    ).toBe(0);
    // idempotent, and a refund reverts the single share
    expect(await f.settle(row.id, 'COMPLETED')).toBe(false);
    await f.settle(row.id, 'REFUNDED');
    expect((await f.wallet(f.aff1.id)).balance).toBe('0.00');
    expect((await f.wallet(f.owner.id)).balance).toBe('0.00');
  },
);

run(
  'dedup: platform coproducer replaced by the same person as offer affiliate',
  async () => {
    const f = await fixture();
    await f.copro.save(
      f.owner.id,
      'plataformas',
      f.platform.id,
      agreement(f.aff1.email, 2000),
    );
    const saved = await f.saveOffer({
      affiliates: [{ email: f.aff1.email, percentageBps: 500 }],
    });
    const code = saved.data.affiliates[0].code as string;
    const { row, snapshot } = await f.sale(code, { net: 100 });
    expect(snapshot!.participants).toEqual([]);
    expect(snapshot!.affiliate).toMatchObject({
      userId: f.aff1.id,
      percentageBps: 500,
      level: 'offer',
    });
    expect(snapshot!.deduplication).toEqual({
      discarded: 'coproducer',
      coproducerLevel: 'platform',
      affiliateLevel: 'offer',
      discardedPercentageBps: 2000,
    });
    expect(snapshot!.affiliate!.deduplication).toEqual(snapshot!.deduplication);
    expect(saleAffiliateEvent(row as never)).toEqual({
      code,
      commissionCents: 500,
      name: 'Pessoa',
    });
    await f.settle(row.id, 'COMPLETED');
    expect((await f.wallet(f.aff1.id)).balance).toBe('5.00');
    expect((await f.wallet(f.owner.id)).balance).toBe('95.00');
    expect(await balanceLogs(f, row.id)).toBe(2);
    expect(await f.settle(row.id, 'COMPLETED')).toBe(false);
    expect(await balanceLogs(f, row.id)).toBe(2);
    await f.settle(row.id, 'CHARGEBACK');
    expect((await f.wallet(f.aff1.id)).balance).toBe('0.00');
    expect((await f.wallet(f.owner.id)).balance).toBe('0.00');
    // renewal keeps the first sale's outcome: still a single share for the person
    const stored = contractAffiliate({
      affiliate: snapshot!.affiliate,
    } as never);
    const renewal = renewalAffiliate(
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
    );
    expect(renewal!.participants).toEqual([]);
    expect(renewal!.affiliate).toMatchObject({
      userId: f.aff1.id,
      isRenewal: true,
    });
    expect(renewal!.deduplication!.discarded).toBe('coproducer');
  },
);

run(
  'dedup: offer OWN coproducer beats the same person as platform affiliate, and renewals keep it',
  async () => {
    const f = await fixture();
    await f.copro.save(
      f.owner.id,
      'ofertas',
      f.offer.id,
      agreement(f.aff1.email, 1000),
    );
    await f.savePlatform({
      defaultPercentageBps: 500,
      affiliates: [{ email: f.aff1.email, percentageBps: null }],
    });
    const code = await f.codeOf(f.aff1.id);
    const { row, snapshot } = await f.sale(code, { net: 100 });
    expect(snapshot!.affiliate).toBeUndefined();
    expect(snapshot!.participants).toHaveLength(1);
    expect(snapshot!.deduplication).toMatchObject({
      discarded: 'affiliate',
      coproducerLevel: 'offer',
      affiliateLevel: 'platform',
    });
    await f.settle(row.id, 'COMPLETED');
    expect((await f.wallet(f.aff1.id)).balance).toBe('10.00');
    // nothing stored on the contract, so renewals pay the coproducer only
    const renewal = renewalAffiliate(
      await captureCoproduction(
        f.prisma,
        'ofertas',
        f.offer.id,
        f.owner.id,
        f.platform.tag,
      ),
      contractAffiliate({ pendingCard: {} } as never),
      true,
      'ofertas',
      f.offer.id,
      f.owner.id,
    );
    expect(renewal!.affiliate).toBeUndefined();
    expect(renewal!.participants).toHaveLength(1);
  },
);

run(
  'dedup: different people keep both shares and the owner keeps the rest',
  async () => {
    const f = await fixture();
    await f.copro.save(
      f.owner.id,
      'ofertas',
      f.offer.id,
      agreement(f.aff2.email, 500),
    );
    const saved = await f.saveOffer({
      affiliates: [{ email: f.aff1.email, percentageBps: 500 }],
    });
    const { row, snapshot } = await f.sale(
      saved.data.affiliates[0].code as string,
      { net: 100 },
    );
    expect(snapshot!.deduplication).toBeUndefined();
    await f.settle(row.id, 'COMPLETED');
    expect((await f.wallet(f.aff1.id)).balance).toBe('5.00');
    expect((await f.wallet(f.aff2.id)).balance).toBe('5.00');
    expect((await f.wallet(f.owner.id)).balance).toBe('90.00');
  },
);

run(
  'dedup: the 100% limit is checked on the deduplicated list (worst case counts the person once)',
  async () => {
    const f = await fixture();
    await f.prisma.wallet.upsert({
      where: { userId: f.buyer.id },
      update: {},
      create: { userId: f.buyer.id, balance: 0 },
    });
    await f.copro.save(f.owner.id, 'plataformas', f.platform.id, {
      basis: 'NET',
      version: 0,
      participants: [
        { email: f.aff1.email, percentageBps: 6000 },
        { email: f.aff2.email, percentageBps: 3000 },
      ],
    });
    // naive sum 6000 + 3000 + 7000 would overflow; aff1 counted once is exactly 100%
    await expect(
      f.saveOffer({
        affiliates: [{ email: f.aff1.email, percentageBps: 7001 }],
      }),
    ).rejects.toThrow('100%');
    const saved = await f.saveOffer({
      affiliates: [{ email: f.aff1.email, percentageBps: 7000 }],
    });
    const { snapshot } = await f.sale(saved.data.affiliates[0].code as string);
    expect(snapshot!.participants).toEqual([
      { userId: f.aff2.id, percentageBps: 3000 },
    ]);
    expect(snapshot!.affiliate!.percentageBps).toBe(7000);
  },
);
