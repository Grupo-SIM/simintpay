import { expect } from 'bun:test';
import { DashboardSummaryUseCase } from '../../../application/use-cases/report/dashboard-summary.use-case';
import { GetTransactionDetailsUseCase } from '../../../application/use-cases/transactions/get-transaction-details.use-case';
import { ListTransactionsUseCase } from '../../../application/use-cases/transactions/list-transactions.use-case';
import { OwnedPlatformReportsService } from '../../../application/services/owned-platform-reports.service';
import { PlatformsService } from '../../../application/services/platforms.service';
import { db, fixture, run } from './affiliate-fixture.test';

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Owner offer with aff1 at 10%; one credited sale of R$ 100 net and the buyer on the row. */
async function creditedSale(
  f: Fixture,
  state: 'COMPLETED' | 'REFUNDED' = 'COMPLETED',
) {
  const saved = await f.saveOffer({
    defaultPercentageBps: 1000,
    affiliates: [{ email: f.aff1.email, percentageBps: null }],
  });
  const code = saved.data.affiliates[0].code as string;
  const { row } = await f.sale(code, { net: 100 });
  await db!.transaction.update({
    where: { id: row.id },
    data: {
      customerEmail: 'comprador@privado.test',
      customerName: 'Comprador Privado',
      customerDocument: '12345678909',
      offerId: f.offer.id,
    },
  });
  await f.settle(row.id, 'COMPLETED');
  if (state === 'REFUNDED') await f.settle(row.id, 'REFUNDED');
  return { row, code };
}
const list = (userId: string) =>
  new ListTransactionsUseCase(db! as never).execute({
    userId,
    role: 'USER',
    query: {} as never,
  });
const details = (userId: string, id: string) =>
  new GetTransactionDetailsUseCase(db! as never, {} as never).execute({
    userId,
    role: 'USER',
    id,
  });

run('affiliate sees only the own commission, never the buyer', async () => {
  const f = await fixture();
  const { row, code } = await creditedSale(f);
  // another sale of the owner without affiliate must stay invisible to the affiliate
  await f.sale(undefined, { net: 50 });
  const own = (await list(f.aff1.id)).data;
  expect(own.total).toBe(1);
  const item = own.transactions[0];
  expect(item.id).toBe(row.id);
  expect(item.afiliacao).toMatchObject({
    role: 'AFFILIATE',
    readOnly: true,
    myAmountCents: 1000,
    state: 'AVAILABLE',
    isRenewal: false,
  });
  expect(item.coproducao).toBeNull();
  expect(JSON.stringify(item)).not.toMatch(/privado|12345678909/i);
  expect(item.netAmount).toBeNull();
  const detail = await details(f.aff1.id, row.id);
  expect(detail.afiliacao?.myAmountCents).toBe(1000);
  expect(JSON.stringify(detail)).not.toMatch(
    /privado|12345678909|client_email|client_name|total_liquid/i,
  );
  expect((await list(f.outsider.id)).data.total).toBe(0);
  await expect(details(f.outsider.id, row.id)).rejects.toThrow();
  // the code is not leaked to the affiliate view of the owner fields
  expect(item.afiliacao).not.toHaveProperty('affiliateCode');
  expect(code.length).toBeGreaterThan(2);
});

run('owner sees commission and code, never the affiliate e-mail', async () => {
  const f = await fixture();
  const { row, code } = await creditedSale(f);
  const item = (await list(f.owner.id)).data.transactions.find(
    (t) => t.id === row.id,
  )!;
  expect(item.afiliacao).toMatchObject({
    role: 'OWNER',
    readOnly: false,
    affiliateCommissionCents: 1000,
    affiliateCode: code,
    state: 'AVAILABLE',
  });
  expect(JSON.stringify(item.afiliacao)).not.toContain(f.aff1.email);
  const detail = await details(f.owner.id, row.id);
  expect(detail.afiliacao).toMatchObject({
    role: 'OWNER',
    affiliateCommissionCents: 1000,
    affiliateCode: code,
  });
  expect(JSON.stringify(detail.afiliacao)).not.toContain(f.aff1.email);
  // the owner keeps the buyer
  expect(item.customerEmail).toBe('comprador@privado.test');
});

run(
  'dashboards: block per user, filters and owner reconciliation',
  async () => {
    const f = await fixture();
    await creditedSale(f);
    const dash = (id: string) =>
      new DashboardSummaryUseCase(db! as never).execute({ userId: id });
    expect((await dash(f.aff1.id)).afiliacao).toEqual({
      count: 1,
      creditedCents: 1000,
      lockedCents: 0,
      reversedCents: 0,
    });
    expect((await dash(f.owner.id)).afiliacao.count).toBe(0);
    expect((await dash(f.owner.id)).afiliados).toEqual({
      count: 1,
      commissionCents: 1000,
    });
    expect((await dash(f.owner.id)).transactionsByPeriod.totalSales).toBe(90);
    const reports = new OwnedPlatformReportsService(db! as never);
    const tag = f.platform.tag;
    const ownerReport = await reports.summary(
      { sub: f.owner.id, role: 'USER', email: f.owner.email } as never,
      { platform: tag },
    );
    expect(ownerReport.afiliados).toEqual({ count: 1, commissionCents: 1000 });
    expect(ownerReport.summary.netCents).toBe(9000);
    const mine = await reports.summary({ sub: f.aff1.id } as never, {
      platform: tag,
    });
    expect(mine.participationOnly).toBe(true);
    expect(mine.summary.netCents).toBe(0);
    expect(mine.afiliacao).toMatchObject({ count: 1, creditedCents: 1000 });
    expect(mine.afiliados).toEqual({ count: 0, commissionCents: 0 });
    // payment method and period filters apply to both blocks
    expect(
      (
        await reports.summary({ sub: f.aff1.id } as never, {
          platform: tag,
          paymentMethod: 'CREDIT_CARD',
        })
      ).afiliacao?.count,
    ).toBe(0);
    expect(
      (
        await reports.summary({ sub: f.owner.id, role: 'USER' } as never, {
          platform: tag,
          paymentMethod: 'CREDIT_CARD',
        })
      ).afiliados,
    ).toEqual({ count: 0, commissionCents: 0 });
    expect(
      (
        await reports.summary({ sub: f.aff1.id } as never, {
          platform: tag,
          startDate: '2000-01-01',
          endDate: '2000-01-02',
        })
      ).afiliacao?.count,
    ).toBe(0);
    await expect(
      reports.summary({ sub: f.outsider.id } as never, { platform: tag }),
    ).rejects.toThrow();
  },
);

run(
  'platform catalogue lists the platform read-only for the affiliate',
  async () => {
    const f = await fixture();
    await creditedSale(f);
    const catalogue = await new PlatformsService(db! as never).list(
      { sub: f.aff1.id, role: 'USER', email: f.aff1.email } as never,
      true,
    );
    expect(catalogue.data.find((row) => row.id === f.platform.id)).toEqual({
      id: f.platform.id,
      tag: f.platform.tag,
      name: f.platform.name,
      isActive: true,
      coproducao: null,
      afiliacao: { role: 'AFFILIATE', readOnly: true },
    });
    const other = await new PlatformsService(db! as never).list(
      { sub: f.outsider.id, role: 'USER', email: f.outsider.email } as never,
      true,
    );
    expect(other.data.find((row) => row.id === f.platform.id)).toBeUndefined();
  },
);

run(
  'refund shows as reversed and leaves the owner reconciliation',
  async () => {
    const f = await fixture();
    const { row } = await creditedSale(f, 'REFUNDED');
    const own = (await list(f.aff1.id)).data.transactions[0];
    expect(own.afiliacao).toMatchObject({
      state: 'REVERSED',
      myAmountCents: 1000,
    });
    const dash = await new DashboardSummaryUseCase(db! as never).execute({
      userId: f.aff1.id,
    });
    expect(dash.afiliacao).toEqual({
      count: 1,
      creditedCents: 0,
      lockedCents: 0,
      reversedCents: 1000,
    });
    const owner = await new DashboardSummaryUseCase(db! as never).execute({
      userId: f.owner.id,
    });
    expect(owner.afiliados).toEqual({ count: 0, commissionCents: 0 });
    expect((await details(f.aff1.id, row.id)).afiliacao?.state).toBe(
      'REVERSED',
    );
  },
);

run(
  'same user as coproducer and affiliate gets a single coproducer line (tie: coproducer wins)',
  async () => {
    const f = await fixture();
    await f.copro.save(f.owner.id, 'ofertas', f.offer.id, {
      basis: 'NET',
      version: 0,
      participants: [{ email: f.aff1.email, percentageBps: 2000 }],
    });
    const { row } = await creditedSale(f);
    const item = (await list(f.aff1.id)).data.transactions.find(
      (t) => t.id === row.id,
    )!;
    expect(item.coproducao).toMatchObject({
      role: 'COPRODUCER',
      myAmountCents: 2000,
    });
    // same person, same level: the affiliate entry is discarded (docs/afiliados.md)
    expect(item.afiliacao ?? null).toBeNull();
    // coproducers keep the complete read-only view they already had
    expect(item.customerEmail).toBe('comprador@privado.test');
    const dash = await new DashboardSummaryUseCase(db! as never).execute({
      userId: f.aff1.id,
    });
    expect(dash.coproducao).toMatchObject({ creditedCents: 2000 });
    expect(dash.afiliacao?.creditedCents ?? 0).toBe(0);
    const owner = await new DashboardSummaryUseCase(db! as never).execute({
      userId: f.owner.id,
    });
    expect(owner.transactionsByPeriod.totalSales).toBe(80);
  },
);

run(
  'affiliate receipts filter by period, platform and payment method like coproduction',
  async () => {
    const f = await fixture();
    const saved = await f.saveOffer({
      defaultPercentageBps: 1000,
      affiliates: [{ email: f.aff1.email, percentageBps: null }],
    });
    const code = saved.data.affiliates[0].code as string;
    const book = async (
      net: number,
      data: Record<string, unknown>,
      status: 'COMPLETED' | 'REFUNDED' = 'COMPLETED',
    ) => {
      const { row } = await f.sale(code, { net });
      await db!.transaction.update({
        where: { id: row.id },
        data: data as never,
      });
      await f.settle(row.id, 'COMPLETED');
      if (status === 'REFUNDED') await f.settle(row.id, 'REFUNDED');
      return row;
    };
    // São Paulo days: 02:00Z on 11/03 is still 10/03 in -03:00
    const a = await book(100, {
      createdAt: new Date('2026-03-10T15:00:00Z'),
      paymentMethod: 'PIX',
    });
    const b = await book(200, {
      createdAt: new Date('2026-03-11T02:00:00Z'),
      paymentMethod: 'CREDIT_CARD',
    });
    const c = await book(
      400,
      {
        createdAt: new Date('2026-03-20T15:00:00Z'),
        paymentMethod: 'PIX',
        platformTag: 'OTHER-TAG',
      },
      'REFUNDED',
    );
    const all = await f.service.receipts(f.aff1.id);
    expect(all.total).toBe(3);
    expect(all.summary).toEqual({
      creditedCents: 1000 + 2000,
      lockedCents: 0,
      reversedCents: 4000,
    });
    // endDate is inclusive in São Paulo time: 10/03 holds a and b (02:00Z of 11/03)
    const day = await f.service.receipts(f.aff1.id, '1', {
      startDate: '2026-03-10',
      endDate: '2026-03-10',
    });
    expect(day.data.map((r) => r.transactionId).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect(day.summary).toEqual({
      creditedCents: 3000,
      lockedCents: 0,
      reversedCents: 0,
    });
    const from = await f.service.receipts(f.aff1.id, '1', {
      startDate: '2026-03-11',
    });
    expect(from.data.map((r) => r.transactionId)).toEqual([c.id]);
    const pix = await f.service.receipts(f.aff1.id, '1', {
      paymentMethod: 'PIX',
    });
    expect(pix.total).toBe(2);
    expect(pix.summary).toEqual({
      creditedCents: 1000,
      lockedCents: 0,
      reversedCents: 4000,
    });
    const other = await f.service.receipts(f.aff1.id, '1', {
      platform: 'other_tag',
    });
    expect(other.data.map((r) => r.transactionId)).toEqual([c.id]);
    const own = await f.service.receipts(f.aff1.id, '1', {
      platform: f.platform.tag,
      paymentMethod: 'PIX',
    });
    expect(own.data.map((r) => r.transactionId)).toEqual([a.id]);
    expect(
      (await f.service.receipts(f.aff1.id, '1', { platform: 'NONE' })).total,
    ).toBe(0);
    // pagination never changes totals
    for (let i = 0; i < 11; i++) await book(10, { paymentMethod: 'PIX' });
    const p1 = await f.service.receipts(f.aff1.id, '1', {
      paymentMethod: 'PIX',
    });
    const p2 = await f.service.receipts(f.aff1.id, '2', {
      paymentMethod: 'PIX',
    });
    expect(p1.data).toHaveLength(10);
    expect(p2.data).toHaveLength(3);
    expect(p2.total).toBe(p1.total);
    expect(p2.summary).toEqual(p1.summary);
    // same validation as coproduction receipts
    await expect(
      f.service.receipts(f.aff1.id, '1', { startDate: '2026-02-30' }),
    ).rejects.toThrow('Data inválida');
    await expect(
      f.service.receipts(f.aff1.id, '1', {
        startDate: '2026-02-02',
        endDate: '2026-02-01',
      }),
    ).rejects.toThrow('Intervalo inválido');
    await expect(
      f.service.receipts(f.aff1.id, '1', { paymentMethod: 'INVALID' }),
    ).rejects.toThrow('Método inválido');
    await expect(
      f.service.receipts(f.aff1.id, '1', { platform: [] as never }),
    ).rejects.toThrow('Filtro inválido');
    // other users' receipts never leak through filters
    expect(
      (await f.service.receipts(f.outsider.id, '1', { paymentMethod: 'PIX' }))
        .total,
    ).toBe(0);
  },
);
