import type { ReportTransaction } from '../components/report-types';
import {
  toDateKeySaoPaulo,
  type LucroPlataformaDailyRow,
} from './lucroPlataformaChart';

/** Use only persisted owner proceeds. Keep integer cents until chart presentation. */
export function buildOwnedProfitChart(
  transactions: ReportTransaction[],
  start: string,
  end: string,
) {
  const days = new Map<string, Map<string, number>>();
  const tags = new Set<string>();
  let totalCents = 0;
  let missing = 0;
  for (const transaction of transactions) {
    if (transaction.status !== 'COMPLETED') continue;
    const day = toDateKeySaoPaulo(transaction.createdAt);
    if (day < start || day > end) continue;
    if (transaction.netCents == null) {
      missing++;
      continue;
    }
    const tag = transaction.platformTag
      .trim()
      .toUpperCase()
      .replaceAll('_', '-');
    if (!days.has(day)) days.set(day, new Map());
    const values = days.get(day)!;
    values.set(tag, (values.get(tag) ?? 0) + transaction.netCents);
    tags.add(tag);
    totalCents += transaction.netCents;
  }
  const sortedTags = [...tags].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const rows: LucroPlataformaDailyRow[] = [];
  for (
    const date = new Date(`${start}T12:00:00Z`);
    date.toISOString().slice(0, 10) <= end;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const dateKey = date.toISOString().slice(0, 10);
    const row: LucroPlataformaDailyRow = {
      dateKey,
      label: `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`,
    };
    for (const tag of sortedTags)
      row[tag] = (days.get(dateKey)?.get(tag) ?? 0) / 100;
    rows.push(row);
  }
  return { rows, tags: sortedTags, total: totalCents / 100, missing };
}
