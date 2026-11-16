import type { OfferInterval } from '../offers';

export const OFFER_SUBSCRIBERS_QUERY_KEY = 'cliente-ofertas-assinantes';
export const SUBSCRIBERS_PAGE_SIZE = 20;

export type ContractStatus =
  'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'INACTIVE' | 'CANCELLED' | 'PAUSED';

export type OfferSubscriber = {
  id: string;
  status: ContractStatus;
  customerName: string | null;
  customerEmail: string | null;
  offer: {
    id: string;
    name: string;
    code: string;
    platformTag: string | null;
  } | null;
  amount: number;
  intervalType: OfferInterval;
  intervalCount: number;
  paidCycles: number;
  createdAt: string;
  currentPeriodEnd: string;
  nextChargeAt: string | null;
  pausedAt: string | null;
  remainingDays: number | null;
};

export type OfferSubscribersResponse = {
  data: OfferSubscriber[];
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
};

export const STATUS_GROUPS = ['active', 'paused', 'deactivated'] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];
export const statusGroupLabels: Record<StatusGroup, string> = {
  active: 'Ativas',
  paused: 'Pausadas',
  deactivated: 'Desativadas',
};

/** Rótulos do enum do backend; o valor bruto só aparece como fallback. */
export const contractStatusLabels: Record<ContractStatus, string> = {
  ACTIVE: 'Ativa',
  PAST_DUE: 'Em atraso',
  SUSPENDED: 'Suspensa',
  INACTIVE: 'Encerrada',
  CANCELLED: 'Cancelada',
  PAUSED: 'Pausada',
};

export const FREQUENCIES = ['MONTHLY', 'YEARLY'] as const;
export const frequencyLabels: Record<(typeof FREQUENCIES)[number], string> = {
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
};

export type SubscriberFilters = {
  search: string;
  statusGroup: '' | StatusGroup;
  frequency: '' | (typeof FREQUENCIES)[number];
  platform: string;
  page: number;
};

export const emptySubscriberFilters: SubscriberFilters = {
  search: '',
  statusGroup: '',
  frequency: '',
  platform: '',
  page: 1,
};

export function filtersToQuery(filters: SubscriberFilters) {
  return {
    page: filters.page,
    pageSize: SUBSCRIBERS_PAGE_SIZE,
    search: filters.search.trim() || undefined,
    statusGroup: filters.statusGroup || undefined,
    frequency: filters.frequency || undefined,
    platform: filters.platform || undefined,
  };
}

export const canPause = (row: Pick<OfferSubscriber, 'status'>) =>
  row.status === 'ACTIVE';
export const canResume = (row: Pick<OfferSubscriber, 'status'>) =>
  row.status === 'PAUSED';
