import { expect, test } from 'bun:test';
import type { ReportTransaction } from '../components/report-types';
import { buildOwnedProfitChart } from './owned-profit-chart';

const sale = (changes: Partial<ReportTransaction> = {}): ReportTransaction => ({
  id: 'sale',
  platformTag: 'SHOP-A',
  createdAt: '2026-10-02T02:30:00Z',
  status: 'COMPLETED',
  paymentMethod: 'PIX',
  grossCents: 1200,
  feesCents: 200,
  netCents: 1000,
  ...changes,
});

test('owner profit uses persisted cents, approved sales and São Paulo dates', () => {
  const chart = buildOwnedProfitChart(
    [
      sale(),
      sale({ platformTag: 'shop_a', netCents: 5 }),
      sale({ platformTag: 'SHOP-B', netCents: -250 }),
      sale({ status: 'REFUNDED', netCents: 9000 }),
      sale({ status: 'PENDING' }),
      sale({ netCents: null }),
      sale({ createdAt: '2026-09-30T12:00:00Z' }),
      sale({ createdAt: '2026-10-04T03:00:00Z' }),
    ],
    '2026-10-01',
    '2026-10-03',
  );
  expect(chart.tags).toEqual(['SHOP-A', 'SHOP-B']);
  expect(chart.rows).toEqual([
    { dateKey: '2026-10-01', label: '01/10', 'SHOP-A': 10.05, 'SHOP-B': -2.5 },
    { dateKey: '2026-10-02', label: '02/10', 'SHOP-A': 0, 'SHOP-B': 0 },
    { dateKey: '2026-10-03', label: '03/10', 'SHOP-A': 0, 'SHOP-B': 0 },
  ]);
  expect(chart.total).toBe(7.55);
  expect(chart.missing).toBe(1);
});

test('empty and missing snapshots do not invent daily profit', () => {
  expect(buildOwnedProfitChart([], '2026-10-01', '2026-10-02')).toMatchObject({
    tags: [],
    total: 0,
    missing: 0,
  });
  expect(
    buildOwnedProfitChart(
      [sale({ netCents: null })],
      '2026-10-01',
      '2026-10-02',
    ),
  ).toMatchObject({ tags: [], total: 0, missing: 1 });
});
