import type { ApiClient } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import type { SubscriberRow } from '@/app/(dashboard)/assinantes/types';

interface ApiAssinante {
  id: string;
  status?: string | null;
  nome?: string | null;
  descricao?: string | null;
  valor?: number | null;
  frequencia?: string | null;
  intervalo?: number | null;
  ciclo?: number | null;
  primeiraCobranca?: string | null;
  proximaCobranca?: string | null;
  planoId?: string | null;
  plataforma?: string | null;
  isPaused?: boolean;
  remainingDays?: number | null;
  pausedAt?: string | null;
  cliente?: {
    nome?: string | null;
    email?: string | null;
    documento?: string | null;
    telefone?: string | null;
  } | null;
  criadoEm?: string | null;
}

interface ApiAssinantesResponse {
  data: ApiAssinante[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  total: number;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return '-';
  }
}

function mapFrequency(
  freq: string | null | undefined,
  interval: number | null | undefined,
): { text: string; unit: string } {
  const i = interval ?? 1;
  switch ((freq ?? '').toUpperCase()) {
    case 'YEAR':
    case 'ANNUAL':
    case 'ANUAL':
    case 'YEARLY':
      return {
        text: `A cada ${i > 1 ? i + ' ' : ''}`,
        unit: i === 1 ? 'ANO' : 'ANOS',
      };
    case 'WEEK':
    case 'WEEKLY':
      return {
        text: `A cada ${i > 1 ? i + ' ' : ''}`,
        unit: i === 1 ? 'SEMANA' : 'SEMANAS',
      };
    default:
      return {
        text: `A cada ${i > 1 ? i + ' ' : ''}`,
        unit: i === 1 ? 'MÊS' : 'MESES',
      };
  }
}

function resolvePlataformaFromApi(raw: ApiAssinante): string {
  const direct = raw.plataforma?.trim();
  if (direct) return direct;

  const extra = raw as ApiAssinante & {
    plataformas?: string[] | null;
    modulo?: string | null;
    module?: string | null;
    tenant?: string | null;
    plan?: {
      plataforma?: string | null;
      platform?: string | null;
      plataformas?: string[] | null;
      modulo?: string | null;
    } | null;
  };

  if (Array.isArray(extra.plataformas) && extra.plataformas[0]?.trim()) {
    return extra.plataformas[0].trim();
  }

  const plan = extra.plan;
  if (plan) {
    const fromPlan =
      plan.plataforma?.trim() ||
      plan.platform?.trim() ||
      plan.modulo?.trim() ||
      (Array.isArray(plan.plataformas) ? plan.plataformas[0]?.trim() : '');
    if (fromPlan) return fromPlan;
  }

  const modulo =
    extra.modulo?.trim() || extra.module?.trim() || extra.tenant?.trim();
  if (modulo) return modulo;

  return '—';
}

function mapAssinante(raw: ApiAssinante): SubscriberRow {
  const { text, unit } = mapFrequency(raw.frequencia, raw.intervalo);
  const isPaused =
    (raw.status ?? '').trim().toLowerCase() === 'paused' || !!raw.isPaused;
  return {
    id: raw.id,
    name: raw.nome ?? raw.cliente?.nome ?? '—',
    description:
      raw.descricao ?? (raw.planoId ? `Plano ${raw.planoId.slice(0, 8)}` : '—'),
    intervalText: text,
    intervalUnit: unit,
    valueBrl: raw.valor ?? 0,
    cycle: raw.ciclo ?? 0,
    active:
      !isPaused &&
      ['active', 'actived', 'activated', 'true', '1'].includes(
        (raw.status ?? '').trim().toLowerCase(),
      ),
    deactivated:
      !isPaused &&
      ['cancelled', 'canceled', 'inactive', 'disabled', 'deactivated'].includes(
        (raw.status ?? '').trim().toLowerCase(),
      ),
    firstCharge: formatDate(raw.primeiraCobranca ?? raw.criadoEm),
    firstChargeIso: raw.primeiraCobranca ?? raw.criadoEm ?? null,
    nextCharge: formatDate(raw.proximaCobranca),
    plataforma: resolvePlataformaFromApi(raw),
    planoId: raw.planoId ?? null,
    isPaused,
    remainingDays: raw.remainingDays ?? null,
    pausedAt: raw.pausedAt ?? null,
  };
}

export async function listAssinantes(
  api: ApiClient,
  query: {
    page?: number;
    pageSize?: number;
    statusGroup?: string;
    frequency?: string;
    search?: string;
    platform?: string;
    firstChargeFrom?: string;
    firstChargeTo?: string;
  },
): Promise<{
  rows: SubscriberRow[];
  total: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}> {
  const pageSize = query.pageSize ?? 20;
  const res = await api.get<ApiAssinantesResponse>(endpoints.assinantes.list, {
    query: {
      ...query,
      page: query.page ?? 1,
      pageSize,
    },
  });

  return {
    rows: (res.data ?? []).map(mapAssinante),
    total: res.total ?? (res.data ?? []).length,
    page: res.page ?? 1,
    pageSize: res.pageSize ?? pageSize,
    hasNextPage: res.hasNextPage ?? false,
  };
}

export async function cancelAssinante(
  api: ApiClient,
  id: string,
): Promise<void> {
  await api.put(endpoints.assinantes.cancel(id));
}

export async function removeAssinanteFromHistory(
  api: ApiClient,
  id: string,
): Promise<void> {
  await api.delete(endpoints.assinantes.removeHistory(id));
}

export async function pauseAssinante(
  api: ApiClient,
  id: string,
): Promise<{
  remainingDays: number;
  pausedAt: string;
  warningMessage: string;
}> {
  return api.put(endpoints.assinantes.pause(id));
}

export async function resumeAssinante(
  api: ApiClient,
  id: string,
): Promise<{ newExpiresAt: string; remainingDays: number }> {
  return api.put(endpoints.assinantes.resume(id));
}

/** Resposta bruta de GET /recurrence/subscriptions/:id (via BFF). */
export async function getSubscriptionDetail(
  api: ApiClient,
  id: string,
): Promise<Record<string, unknown>> {
  const data = await api.get<Record<string, unknown>>(
    endpoints.assinantes.subscriptionDetail(id),
  );
  return data ?? {};
}
