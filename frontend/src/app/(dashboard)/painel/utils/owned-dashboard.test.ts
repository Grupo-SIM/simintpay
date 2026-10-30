import { expect, test } from 'bun:test';
import type { ApiClient } from '@/services/api/api.client';
import type { ReportTransaction } from '../../relatorio/components/report-types';
import { loadOwnedDashboard } from './owned-dashboard';

const sale = (
  id: string,
  createdAt: string,
  grossCents: number,
  status = 'COMPLETED',
): ReportTransaction => ({
  id,
  platformTag: 'ATLAS',
  createdAt,
  grossCents,
  status,
  netCents: grossCents - 100,
  feesCents: 100,
  paymentMethod: 'PIX',
});
const octoberSales = [
  sale('1', '2026-10-01T02:59:59Z', 99999), // September in São Paulo.
  sale('2', '2026-10-01T03:00:00Z', 10001),
  sale('3', '2026-10-09T15:00:00Z', 20002),
  sale('4', '2026-10-09T17:00:00Z', 30003),
  sale('5', '2026-11-01T02:59:59Z', 40004), // October in São Paulo.
  sale('6', '2026-10-09T15:00:00Z', 50000, 'PENDING'),
];
function fixture(rows = octoberSales, failPage?: number, emptyPage?: number) {
  const calls: { path: string; query: Record<string, unknown> }[] = [];
  const api = {
    get: async (path: string, options: { query: Record<string, unknown> }) => {
      const query = options.query;
      calls.push({ path, query });
      if (path === '/relatorios/financeiro')
        return {
          summary: {
            grossCents: 100010,
            salesCount: 4,
            netCents: 99610,
            refundsCents: 900,
            refundsCount: 3,
            refundedCents: 400,
            refundedCount: 1,
            chargebacksCents: 500,
            chargebacksCount: 2,
          },
        };
      const page = Number(query.page);
      if (page === failPage) throw new Error('Falha na consulta');
      return {
        data:
          page === emptyPage ? [] : rows.slice((page - 1) * 100, page * 100),
        total: rows.length,
        page,
        pageSize: 100,
      };
    },
  } as ApiClient;
  return { api, calls };
}

test('Grupo SIM: four October platform sales, real daily values and separate refunds/chargebacks', async () => {
  const { api, calls } = fixture();
  const result = await loadOwnedDashboard(api, '2026-10-01', '2026-10-31');
  expect(result.transactionsByPeriod.totalSales).toBe(1000.1);
  expect(result.transactionsByPeriod.paidTransactions).toBe(4);
  const chart = result.transactionsByPeriod.chartData;
  expect(chart).toHaveLength(31);
  expect(chart[0].online).toBe(100.01);
  expect(chart[8].online).toBe(500.05);
  expect(chart[30].online).toBe(400.04);
  expect(chart[1].online).toBe(0);
  expect(result.chargebacks.refunds).toEqual({ count: 1, amount: 4 });
  expect(result.chargebacks.chargebacks).toEqual({ count: 2, amount: 5 });
  expect(
    calls.every(
      (call) =>
        call.query.startDate === '2026-10-01' &&
        call.query.endDate === '2026-10-31',
    ),
  ).toBe(true);
  expect(calls.some((call) => call.path.includes('/admin/'))).toBe(false);
});

test('single day groups sales by São Paulo hour', async () => {
  const { api } = fixture([
    sale('1', '2026-10-09T03:01:00Z', 1234),
    sale('2', '2026-10-09T23:59:59Z', 5678),
  ]);
  const {
    transactionsByPeriod: { chartData },
  } = await loadOwnedDashboard(api, '2026-10-09', '2026-10-09');
  expect(chartData).toHaveLength(24);
  expect(chartData[0]).toEqual({ label: '00h', online: 12.34, physical: 0 });
  expect(chartData[20].online).toBe(56.78);
});

test('includes later pages and rejects failed/incomplete pagination instead of partial totals', async () => {
  const rows = Array.from({ length: 101 }, (_, index) =>
    sale(String(index), '2026-10-09T15:00:00Z', 100),
  );
  const { api, calls } = fixture(rows);
  const result = await loadOwnedDashboard(api, '2026-10-01', '2026-10-31');
  expect(result.transactionsByPeriod.chartData[8].online).toBe(101);
  expect(calls.some((call) => call.query.page === 2)).toBe(true);
  await expect(
    loadOwnedDashboard(fixture(rows, 2).api, '2026-10-01', '2026-10-31'),
  ).rejects.toThrow('Falha na consulta');
  await expect(
    loadOwnedDashboard(
      fixture(rows, undefined, 2).api,
      '2026-10-01',
      '2026-10-31',
    ),
  ).rejects.toThrow('Paginação incompleta');
});
