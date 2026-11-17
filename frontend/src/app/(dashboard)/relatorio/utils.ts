import type { DateRange, TransacaoDistribuicaoResponse } from './types';

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatDate(date: Date | null) {
  if (!date) return '';
  return date.toLocaleDateString('pt-BR');
}

export function formatRange(range: DateRange) {
  if (!range.start && !range.end) return '';
  if (range.start && !range.end) return `${formatDate(range.start)} -`;
  return `${formatDate(range.start)} - ${formatDate(range.end)}`;
}

export function rangeDays(range: DateRange) {
  if (!range.start || !range.end) return 0;
  const diff =
    startOfDay(range.end).getTime() - startOfDay(range.start).getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
}

export function includesText(source: string, text: string) {
  return source.toLowerCase().includes(text.trim().toLowerCase());
}

/** Há pelo menos uma transação no período (total da API ou soma das quantidades nos itens). */
export function transacaoDistribuicaoTemDados(
  res:
    | (Pick<TransacaoDistribuicaoResponse, 'items'> & { total?: number })
    | null
    | undefined,
): boolean {
  if (!res) return false;
  const t = Number(res.total);
  if (Number.isFinite(t) && t > 0) return true;
  return (res.items ?? []).some((i) => Number(i.quantidade) > 0);
}
