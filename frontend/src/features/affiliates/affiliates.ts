import {
  formatPercentage,
  maskPercentage,
  percentageBps,
} from '@/features/coproduction/coproduction';
import type {
  Affiliate,
  AffiliateAgreement,
  AffiliateDraft,
  AffiliateDraftRow,
  AffiliateSaveInput,
} from './types';

export { formatPercentage, maskPercentage, percentageBps };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validBps = (value: unknown) =>
  Number.isInteger(value) && Number(value) > 0 && Number(value) <= 10000;

export function affiliateLink(linkBaseUrl: string, code: string): string {
  const url = new URL(linkBaseUrl);
  url.searchParams.set('aff', code);
  return url.toString();
}

export function validLinkBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Rejeita respostas incompletas em vez de exibir um acordo vazio inventado. */
export function parseAffiliates(value: unknown): AffiliateAgreement {
  const data = value as Partial<AffiliateAgreement> | null;
  if (
    !data ||
    !Number.isSafeInteger(data.version) ||
    Number(data.version) < 0 ||
    !Array.isArray(data.affiliates) ||
    (data.defaultPercentageBps != null &&
      !validBps(data.defaultPercentageBps)) ||
    (data.commissionOnRenewals != null &&
      typeof data.commissionOnRenewals !== 'boolean')
  )
    throw new Error(
      'O servidor retornou uma configuração de afiliados inválida.',
    );
  if (
    data.affiliates.some(
      (row) =>
        !row ||
        typeof row.email !== 'string' ||
        (row.name !== undefined && typeof row.name !== 'string') ||
        (row.code !== undefined && typeof row.code !== 'string') ||
        (row.percentageBps != null && !validBps(row.percentageBps)),
    )
  )
    throw new Error('O servidor retornou afiliados inválidos.');
  let inherited: AffiliateAgreement['inherited'];
  if (data.inherited != null) {
    const source = data.inherited;
    if (
      !Array.isArray(source.affiliates) ||
      source.affiliates.some(
        (row) =>
          typeof row?.code !== 'string' ||
          typeof row.name !== 'string' ||
          !validBps(row.percentageBps),
      )
    )
      throw new Error('O servidor retornou afiliados herdados inválidos.');
    inherited = {
      defaultPercentageBps: source.defaultPercentageBps ?? null,
      commissionOnRenewals: source.commissionOnRenewals !== false,
      affiliates: source.affiliates.map(({ name, code, percentageBps }) => ({
        name,
        code,
        percentageBps,
      })),
    };
  }
  return {
    version: Number(data.version),
    defaultPercentageBps: data.defaultPercentageBps ?? null,
    commissionOnRenewals: data.commissionOnRenewals ?? null,
    ...(data.linkBaseUrl !== undefined
      ? { linkBaseUrl: data.linkBaseUrl ?? null }
      : {}),
    affiliates: data.affiliates.map((row) => ({
      email: row.email,
      ...(row.name ? { name: row.name } : {}),
      ...(row.code ? { code: row.code } : {}),
      percentageBps: row.percentageBps ?? null,
    })),
    ...(inherited ? { inherited } : {}),
  };
}

export function draftFromAgreement(
  agreement: AffiliateAgreement,
  platform: boolean,
): AffiliateDraft {
  return {
    rows: agreement.affiliates.map((row, i) => ({
      id: String(i),
      email: row.email,
      name: row.name,
      code: row.code,
      percentage:
        row.percentageBps == null ? '' : formatPercentage(row.percentageBps),
    })),
    defaultPercentage:
      agreement.defaultPercentageBps == null
        ? ''
        : formatPercentage(agreement.defaultPercentageBps),
    renewals: platform
      ? agreement.commissionOnRenewals === false
        ? 'first'
        : 'all'
      : agreement.commissionOnRenewals == null
        ? 'platform'
        : agreement.commissionOnRenewals
          ? 'all'
          : 'first',
    linkBaseUrl: agreement.linkBaseUrl ?? '',
  };
}

const optionalBps = (text: string) =>
  text.trim() ? percentageBps(text) : null;

export function validateAffiliates(
  draft: AffiliateDraft,
  options: {
    ownerEmail?: string;
    platform: boolean;
    inheritedDefaultBps?: number | null;
  },
): string | null {
  const global = optionalBps(draft.defaultPercentage);
  if (global !== null && !validBps(global))
    return 'O percentual global deve ser maior que 0% e no máximo 100%.';
  if (options.platform && draft.linkBaseUrl.trim()) {
    if (!validLinkBaseUrl(draft.linkBaseUrl.trim()))
      return 'O link base deve ser uma URL https válida.';
  }
  const seen = new Set<string>();
  let worst = 0;
  for (const row of draft.rows) {
    const email = row.email.trim().toLowerCase();
    if (!EMAIL.test(email))
      return 'Informe um e-mail válido para cada afiliado.';
    if (email === options.ownerEmail?.trim().toLowerCase())
      return 'O proprietário não pode ser afiliado da própria venda.';
    if (seen.has(email))
      return 'O mesmo afiliado não pode aparecer duas vezes.';
    seen.add(email);
    const own = optionalBps(row.percentage);
    if (own !== null && !validBps(own))
      return 'Cada percentual deve ser maior que 0% e no máximo 100%.';
    const effective = own ?? global ?? options.inheritedDefaultBps ?? null;
    if (effective === null)
      return 'Informe o percentual do afiliado ou o percentual global.';
    worst = Math.max(worst, effective);
  }
  return worst > 10000 ? 'O percentual não pode ultrapassar 100%.' : null;
}

export function serializeAffiliates(
  draft: AffiliateDraft,
  platform: boolean,
): AffiliateSaveInput {
  return {
    defaultPercentageBps: optionalBps(draft.defaultPercentage),
    commissionOnRenewals: platform
      ? draft.renewals !== 'first'
      : draft.renewals === 'platform'
        ? null
        : draft.renewals === 'all',
    ...(platform ? { linkBaseUrl: draft.linkBaseUrl.trim() || null } : {}),
    affiliates: draft.rows.map((row) => ({
      email: row.email.trim().toLowerCase(),
      percentageBps: optionalBps(row.percentage),
    })),
  };
}

export type { Affiliate, AffiliateDraftRow };
