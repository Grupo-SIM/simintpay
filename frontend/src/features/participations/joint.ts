import {
  formatPercentage,
  percentageBps,
} from '@/features/coproduction/coproduction';
import type {
  AffiliateAgreement,
  AffiliateDraft,
} from '@/features/affiliates/types';

export const TOTAL_BPS = 10000;

type Level = 'offer' | 'platform';

export type JointCoproducer = { email: string; name?: string; bps: number };
export type JointAffiliate = {
  label: string;
  email?: string;
  name?: string;
  bps: number;
  /** Nível que forneceu o percentual (espelha `effectivePercentage` do servidor). */
  level: Level;
};
export type JointInput = {
  coproducers: JointCoproducer[];
  /** Nível da lista de coprodutores: oferta só no acordo próprio. */
  coproducerLevel: Level;
  affiliates: JointAffiliate[];
};
export type JointResult = {
  totalBps: number;
  coproducersBps: number;
  ownerBps: number;
  overBps: number;
  exceeds: boolean;
  /** Afiliado do pior caso, quando ele soma ao total. */
  affiliate?: { label: string; bps: number };
  /** Pessoas que aparecem como coprodutora e afiliada: contam uma vez só. */
  overlaps: string[];
};

const norm = (value?: string) => value?.trim().toLowerCase() ?? '';

function samePerson(
  co: JointCoproducer,
  aff: { email?: string; name?: string },
): boolean {
  if (norm(aff.email) && norm(aff.email) === norm(co.email)) return true;
  return Boolean(norm(aff.name) && norm(aff.name) === norm(co.name));
}

/**
 * Espelha `worstCaseBps` do servidor: maior total, entre as pessoas afiliadas, de esse afiliado
 * somado aos coprodutores da venda, com a mesma pessoa contada uma vez (oferta vence plataforma;
 * empate vale o coprodutor), comparado com a co-produção sozinha.
 */
export function jointTotal(input: JointInput): JointResult {
  const base = input.coproducers.reduce((sum, row) => sum + row.bps, 0);
  let worst = base;
  let worstAffiliate: JointResult['affiliate'];
  const overlaps: string[] = [];
  for (const aff of input.affiliates) {
    const co = input.coproducers.find((row) => samePerson(row, aff));
    let total = base + aff.bps;
    let counted = true;
    if (co) {
      overlaps.push(aff.label);
      if (aff.level === 'offer' && input.coproducerLevel === 'platform')
        total = base - co.bps + aff.bps;
      else {
        total = base;
        counted = false;
      }
    }
    if (total > worst) {
      worst = total;
      worstAffiliate = counted ? { label: aff.label, bps: aff.bps } : undefined;
    }
  }
  return {
    totalBps: worst,
    coproducersBps: base,
    ownerBps: Math.max(0, TOTAL_BPS - worst),
    overBps: Math.max(0, worst - TOTAL_BPS),
    exceeds: worst > TOTAL_BPS,
    affiliate: worstAffiliate,
    overlaps,
  };
}

/** Mensagem única para cliente e para 400 do servidor: total e quem excede. */
export function jointMessage(result: JointResult): string | null {
  if (!result.exceeds) return null;
  const who = result.affiliate
    ? `coprodutores ${formatPercentage(result.coproducersBps)}% + afiliado ${result.affiliate.label} ${formatPercentage(result.affiliate.bps)}%`
    : `coprodutores ${formatPercentage(result.coproducersBps)}%`;
  return `Coprodução e afiliação somam ${formatPercentage(result.totalBps)}% do líquido (${who}), ${formatPercentage(result.overBps)}% acima de 100%. Reduza os percentuais para salvar.`;
}

export const SERVER_JOINT_MESSAGE =
  'Afiliado somado à co-produção não pode ultrapassar 100% do líquido';

const validRowBps = (text: string) => {
  const bps = text.trim() ? percentageBps(text.trim()) : NaN;
  return Number.isInteger(bps) && bps > 0 && bps <= TOTAL_BPS ? bps : null;
};

/** Rascunho de coprodutores (e-mail ainda vazio ou percentual inválido é ignorado). */
export function coproducersFromRows(
  rows: { email: string; name?: string; percentage: string }[],
): JointCoproducer[] {
  const list: JointCoproducer[] = [];
  for (const row of rows) {
    const bps = validRowBps(row.percentage);
    if (bps !== null) list.push({ email: row.email, name: row.name, bps });
  }
  return list;
}

/**
 * Afiliados efetivos do rascunho. Na oferta, os da plataforma (somente leitura, sem e-mail)
 * somam aos próprios; a mesma pessoa vale pelo percentual da oferta.
 */
export function affiliatesFromDraft(
  draft: AffiliateDraft,
  inherited: AffiliateAgreement['inherited'] | undefined,
  platform: boolean,
): JointAffiliate[] {
  const global = validRowBps(draft.defaultPercentage);
  const list: JointAffiliate[] = [];
  const claimed = new Set<string>();
  for (const row of draft.rows) {
    const match = inherited?.affiliates.find(
      (item) => item.code === row.code || (row.name && item.name === row.name),
    );
    if (match) claimed.add(match.code);
    const own = validRowBps(row.percentage);
    const offerLevel = !platform && (own ?? global) !== null;
    const bps =
      own ??
      global ??
      (platform
        ? null
        : (match?.percentageBps ?? inherited?.defaultPercentageBps ?? null));
    if (bps == null) continue;
    list.push({
      label: row.name ?? (row.email || 'afiliado'),
      email: row.email,
      name: row.name,
      bps,
      level: offerLevel ? 'offer' : 'platform',
    });
  }
  for (const item of inherited?.affiliates ?? [])
    if (!claimed.has(item.code))
      list.push({
        label: item.name,
        name: item.name,
        bps: item.percentageBps,
        level: 'platform',
      });
  return list;
}
