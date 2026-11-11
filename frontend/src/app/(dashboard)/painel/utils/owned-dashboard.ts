import type { ApiClient } from '@/services/api/api.client';
import type {
  ReportPage,
  ReportSummary,
  ReportTransaction,
} from '../../relatorio/components/report-types';
import { toDateKeySaoPaulo } from '../../relatorio/utils/lucroPlataformaChart';

/** Owner reports include platform sales whose buyer is not the platform owner. */
export async function loadOwnedDashboard(
  api: ApiClient,
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
) {
  const query = { startDate, endDate };
  const [report, transactions] = await Promise.all([
    api.get<ReportSummary>('/relatorios/financeiro', { query, signal }),
    loadTransactions(api, query, signal),
  ]);
  const summary = report.summary;
  const approved = transactions.filter((row) => row.status === 'COMPLETED');
  // Pending charges are undecided: they count neither as approved nor as declined.
  const decided = transactions.filter((row) => row.status !== 'PENDING');
  const accepted = decided.filter((row) =>
    ['COMPLETED', 'REFUNDED', 'CHARGEBACK'].includes(row.status),
  );
  const dailyCents = new Map<string, number>();
  const hourlyCents = new Array<number>(24).fill(0);
  for (const row of approved) {
    const day = toDateKeySaoPaulo(row.createdAt);
    if (day < startDate || day > endDate) continue;
    dailyCents.set(day, (dailyCents.get(day) ?? 0) + row.grossCents);
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(row.createdAt)),
    );
    hourlyCents[hour] += row.grossCents;
  }
  // Coproduction shares credited to the user count as sales alongside owned ones.
  const coproduction = report.coproducao;
  for (const { bucket, creditedCents } of coproduction?.hourly ?? []) {
    const day = bucket.slice(0, 10);
    if (day < startDate || day > endDate) continue;
    dailyCents.set(day, (dailyCents.get(day) ?? 0) + creditedCents);
    hourlyCents[Number(bucket.slice(11, 13))] += creditedCents;
  }
  const chartData: { label: string; online: number; physical: number }[] = [];
  if (startDate === endDate) {
    hourlyCents.forEach((cents, hour) =>
      chartData.push({
        label: `${String(hour).padStart(2, '0')}h`,
        online: cents / 100,
        physical: 0,
      }),
    );
  } else {
    for (
      const day = new Date(`${startDate}T12:00:00Z`);
      day.toISOString().slice(0, 10) <= endDate;
      day.setUTCDate(day.getUTCDate() + 1)
    ) {
      const key = day.toISOString().slice(0, 10);
      chartData.push({
        label: `${key.slice(8, 10)}/${key.slice(5, 7)}`,
        online: (dailyCents.get(key) ?? 0) / 100,
        physical: 0,
      });
    }
  }
  const refundedCents = summary.refundedCents ?? summary.refundsCents;
  const refundedCount = summary.refundedCount ?? summary.refundsCount;
  return {
    transactionsByPeriod: {
      totalSales:
        (summary.grossCents + (coproduction?.creditedCents ?? 0)) / 100,
      paidTransactions: summary.salesCount + (coproduction?.creditedCount ?? 0),
      approvalRate: decided.length
        ? (accepted.length / decided.length) * 100
        : 0,
      chartData,
    },
    chargebacks: {
      totalRefunded: refundedCents / 100,
      refunds: { count: refundedCount, amount: refundedCents / 100 },
      chargebacks: {
        count: summary.chargebacksCount ?? 0,
        amount: (summary.chargebacksCents ?? 0) / 100,
      },
    },
  };
}

async function loadTransactions(
  api: ApiClient,
  query: { startDate: string; endDate: string },
  signal?: AbortSignal,
) {
  const rows: ReportTransaction[] = [];
  const ids = new Set<string>();
  let page = 1;
  let total: number;
  do {
    const result = await api.get<ReportPage<ReportTransaction>>(
      '/relatorios/financeiro/transacoes',
      { query: { ...query, page, pageSize: 100 }, signal },
    );
    if (result.page !== page || result.data.some((row) => ids.has(row.id)))
      throw new Error('Paginação inconsistente do relatório');
    for (const row of result.data) ids.add(row.id);
    rows.push(...result.data);
    total = result.total;
    if (rows.length < total && !result.data.length)
      throw new Error('Paginação incompleta do relatório');
    page++;
  } while (rows.length < total);
  return rows;
}
