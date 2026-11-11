import type { SubscriberRow } from './types';

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatBrl(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Slugs usados no filtro (alinhado a admin/usuarios e coluna Plataforma). */
export const SUBSCRIBER_PLATFORM_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: 'areaflix', label: 'Áreaflix' },
  { value: 'atlas', label: 'AtlasHosting' },
  { value: 'bosque', label: 'Bosque' },
  { value: 'ebooksim', label: 'EbookSim' },
  { value: 'pagatg', label: 'PagaTG' },
  { value: 'renovada', label: 'Renovada' },
];

function normalizePlatformKey(s: string) {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\s_-]+/g, '');
}

/** Sinônimos / nomes exibidos → slug do filtro */
const PLATFORM_FILTER_ALIASES: Record<string, string[]> = {
  areaflix: ['areaflix', 'areaflix'],
  atlas: ['atlas', 'atlashosting'],
  bosque: ['bosque', 'ibb'],
  ebook: ['ebook', 'ebooksim'],
  ebooksim: ['ebook', 'ebooksim'],
  pagatg: ['pagatg', 'pagatg'],
  renovada: ['renovada'],
};

function platformKeysForSlug(slug: string): string[] {
  const base = normalizePlatformKey(slug);
  const aliases = PLATFORM_FILTER_ALIASES[slug] ?? [];
  return [base, ...aliases.map(normalizePlatformKey)];
}

export function rowMatchesPlatform(plataforma: string, filterSlug: string) {
  if (!filterSlug.trim()) return true;
  const rowKey = normalizePlatformKey(plataforma);
  if (!rowKey || rowKey === normalizePlatformKey('—')) return false;

  const candidates = platformKeysForSlug(filterSlug);
  return candidates.some(
    (c) => rowKey === c || rowKey.includes(c) || c.includes(rowKey),
  );
}

/** Resolve tag a partir do cadastro de planos quando a API não envia plataforma no assinante. */
export function enrichSubscriberPlatforms(
  rows: SubscriberRow[],
  planTagById: Map<string, string>,
): SubscriberRow[] {
  return rows.map((row) => {
    if (row.plataforma && row.plataforma !== '—') return row;
    const planId = row.planoId?.trim();
    if (!planId) return row;
    const tag = planTagById.get(planId);
    if (!tag) return row;
    return { ...row, plataforma: tag };
  });
}
