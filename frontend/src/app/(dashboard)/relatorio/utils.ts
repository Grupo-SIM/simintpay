import type {
  DateRange,
  PeriodPreset,
  TransacaoDistribuicaoResponse,
} from './types';

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

export function parseBrDate(value: string) {
  const [day, month, year] = value.split('/').map(Number);
  if (!day || !month || !year) return null;
  return new Date(year, month - 1, day);
}

export function includesText(source: string, text: string) {
  return source.toLowerCase().includes(text.trim().toLowerCase());
}

const PRESET_ORDER: PeriodPreset[] = ['today', '30d', '3m', '12m', 'custom'];

export function isPeriodPreset(s: string | null): s is PeriodPreset {
  return s != null && PRESET_ORDER.includes(s as PeriodPreset);
}

/** Intervalo efetivo para presets fixos. Não usar com `custom`. */
export function computePresetDateRange(
  preset: Exclude<PeriodPreset, 'custom'>,
): DateRange {
  const end = startOfDay(new Date());
  if (preset === 'today') {
    return { start: end, end };
  }
  const start = new Date(end);
  if (preset === '30d') {
    start.setDate(start.getDate() - 29);
    return { start: startOfDay(start), end };
  }
  if (preset === '3m') {
    start.setMonth(start.getMonth() - 3);
    return { start: startOfDay(start), end };
  }
  start.setFullYear(start.getFullYear() - 1);
  return { start: startOfDay(start), end };
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

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Hoje',
  '30d': 'Últimos 30 dias',
  '3m': 'Últimos 3 meses',
  '12m': 'Últimos 12 meses',
  custom: 'Personalizado',
};
