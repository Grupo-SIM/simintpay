import { BadRequestException } from '@nestjs/common';

export type AffiliateProduct = 'plataformas' | 'ofertas';
export type AffiliateEntry = { userId: string; percentageBps: number | null };
/** Stored configuration of one scope (platform or offer). */
export type AffiliateConfig = {
  version: number;
  defaultPercentageBps: number | null;
  commissionOnRenewals: boolean | null;
  linkBaseUrl: string | null;
  affiliates: AffiliateEntry[];
};
/** Resolved affiliate of one sale, frozen in the sale snapshot. */
export type AffiliateSnapshot = {
  userId: string;
  code: string;
  name?: string;
  platformId: string;
  /** Effective percentage over the net base, in basis points. */
  percentageBps: number;
  /** Which level provided the percentage. */
  level: 'offer' | 'platform';
  versions: { platform?: number; offer?: number };
  /** Effective renewal option frozen at the first sale. */
  commissionOnRenewals: boolean;
  /** True on the snapshot of a renewal charge. */
  isRenewal?: boolean;
};
export type AffiliateInput = {
  version: number;
  defaultPercentageBps: number | null;
  commissionOnRenewals: boolean | null;
  linkBaseUrl: string | null;
  affiliates: { email: string; percentageBps: number | null }[];
};

export const emptyConfig = (product: AffiliateProduct): AffiliateConfig => ({
  version: 0,
  defaultPercentageBps: null,
  commissionOnRenewals: product === 'plataformas' ? true : null,
  linkBaseUrl: null,
  affiliates: [],
});

const validPercentage = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= 1 &&
  (value as number) <= 10000;

export function validateAffiliateInput(
  body: unknown,
  product: AffiliateProduct,
): AffiliateInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Configuração inválida');
  const row = body as Record<string, unknown>;
  if (!Number.isSafeInteger(row.version) || (row.version as number) < 0)
    throw new BadRequestException('Versão inválida');
  const def = row.defaultPercentageBps ?? null;
  if (def !== null && !validPercentage(def))
    throw new BadRequestException('Percentual global inválido');
  const renewals = row.commissionOnRenewals ?? null;
  if (renewals !== null && typeof renewals !== 'boolean')
    throw new BadRequestException('Opção de renovação inválida');
  if (product === 'plataformas' && renewals === null)
    throw new BadRequestException(
      'Opção de renovação obrigatória na plataforma',
    );
  let linkBaseUrl: string | null = null;
  const link = row.linkBaseUrl ?? null;
  if (link !== null) {
    if (product !== 'plataformas')
      throw new BadRequestException('Link base só existe na plataforma');
    if (typeof link !== 'string' || link.length > 300)
      throw new BadRequestException('Link base inválido');
    let url: URL;
    try {
      url = new URL(link.trim());
    } catch {
      throw new BadRequestException('Link base inválido');
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new BadRequestException('Link base deve usar HTTPS');
    linkBaseUrl = url.toString();
  }
  if (!Array.isArray(row.affiliates) || row.affiliates.length > 200)
    throw new BadRequestException('Configuração inválida');
  const seen = new Set<string>();
  const affiliates = row.affiliates.map((entry) => {
    const a = entry as { email?: unknown; percentageBps?: unknown };
    const pct = a?.percentageBps ?? null;
    if (
      !a ||
      typeof a.email !== 'string' ||
      (pct !== null && !validPercentage(pct))
    )
      throw new BadRequestException('Afiliado inválido');
    const email = a.email.trim().toLowerCase();
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      seen.has(email)
    )
      throw new BadRequestException('E-mail inválido ou duplicado');
    seen.add(email);
    return { email, percentageBps: pct as number | null };
  });
  for (const a of affiliates)
    if (a.percentageBps === null && def === null && product === 'plataformas')
      throw new BadRequestException(
        'Afiliado sem percentual próprio exige percentual global',
      );
  return {
    version: row.version as number,
    defaultPercentageBps: def as number | null,
    commissionOnRenewals: renewals as boolean | null,
    linkBaseUrl,
    affiliates,
  };
}

/**
 * Percentage of one person: person in the offer, offer default, person in the platform,
 * platform default. Platform and offer lists add up; the offer level wins for the same person.
 */
export function effectivePercentage(
  userId: string,
  offer: AffiliateConfig | null,
  platform: AffiliateConfig | null,
): { percentageBps: number; level: 'offer' | 'platform' } | null {
  const inOffer = offer?.affiliates.find((a) => a.userId === userId);
  const inPlatform = platform?.affiliates.find((a) => a.userId === userId);
  if (!inOffer && !inPlatform) return null;
  if (inOffer?.percentageBps != null)
    return { percentageBps: inOffer.percentageBps, level: 'offer' };
  if (offer?.defaultPercentageBps != null)
    return { percentageBps: offer.defaultPercentageBps, level: 'offer' };
  if (inPlatform?.percentageBps != null)
    return { percentageBps: inPlatform.percentageBps, level: 'platform' };
  if (platform?.defaultPercentageBps != null)
    return { percentageBps: platform.defaultPercentageBps, level: 'platform' };
  return null;
}

/** Offer option wins when set; otherwise the platform's, which defaults to every renewal. */
export function effectiveRenewals(
  offer: AffiliateConfig | null,
  platform: AffiliateConfig | null,
): boolean {
  return offer?.commissionOnRenewals ?? platform?.commissionOnRenewals ?? true;
}

/** Worst single-affiliate percentage any sale of this scope pair can carry (one code = one person). */
export function worstPercentage(
  offer: AffiliateConfig | null,
  platform: AffiliateConfig | null,
): number {
  const ids = new Set([
    ...(offer?.affiliates ?? []).map((a) => a.userId),
    ...(platform?.affiliates ?? []).map((a) => a.userId),
  ]);
  let worst = 0;
  for (const id of ids)
    worst = Math.max(
      worst,
      effectivePercentage(id, offer, platform)?.percentageBps ?? 0,
    );
  return worst;
}

export function generateAffiliateCode(random: (n: number) => Buffer): string {
  return random(6).toString('base64url');
}
