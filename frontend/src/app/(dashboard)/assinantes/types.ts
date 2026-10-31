import type { DateRange } from '../relatorio/types';

export type SubscriberRow = {
  id: string;
  name: string;
  description: string;
  /** Texto bruto para filtro, ex.: "A cada MÊS" */
  intervalText: string;
  /** Unidade em destaque (MÊS, ANO, etc.) */
  intervalUnit: string;
  valueBrl: number;
  cycle: number;
  active: boolean;
  deactivated?: boolean;
  firstCharge: string;
  firstChargeIso: string | null;
  nextCharge: string;
  plataforma: string;
  planoId?: string | null;
  /** true quando o admin pausou esta assinatura */
  isPaused: boolean;
  /** dias restantes gravados no momento da pausa; null quando não pausada */
  remainingDays: number | null;
  /** ISO string de quando foi pausada; null quando não pausada */
  pausedAt: string | null;
};

export type SubscriberFiltersState = {
  search: string;
  statusGroup: string;
  frequency: string;
  /** Slug da plataforma; vazio = todas */
  plataforma: string;
  dateRange: DateRange;
};
