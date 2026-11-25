import type { Transacao, TransacaoCoproducao } from './types/transacoes.types';

const coproductionStates: Record<string, string> = {
  AVAILABLE: 'Creditada',
  LOCKED: 'Em mediação',
  REVERSED: 'Estornada',
};

/** Estado da participação de coprodução em português; valores desconhecidos aparecem como vieram. */
export const coproductionStateLabel = (state: string | null | undefined) =>
  state ? (coproductionStates[state] ?? state) : 'Aguardando pagamento';

const toCents = (value: number | string | null | undefined) =>
  value == null || value === '' ? null : Math.round(Number(value) * 100);

/**
 * Divisão do líquido da venda vista pelo dono: parte dos coprodutores, comissão do afiliado e o
 * que restou dele. Usa só campos expostos; `coproducersCents` é null enquanto a alocação do dono
 * ainda não existe. A parte do dono (`myAmountCents`) já desconta o afiliado no backend.
 */
export function ownerSplit(
  row: Pick<Transacao, 'netAmount' | 'coproducao' | 'afiliacao'>,
) {
  const net = toCents(row.netAmount);
  const co = row.coproducao;
  const affiliation = row.afiliacao;
  if (net == null || net <= 0) return null;
  if (co?.role !== 'OWNER' && affiliation?.role !== 'OWNER') return null;
  const affiliate =
    affiliation?.role === 'OWNER'
      ? (affiliation.affiliateCommissionCents ?? 0)
      : 0;
  const mine = co?.role === 'OWNER' ? co.myAmountCents : null;
  const coproducers = mine == null ? null : Math.max(0, net - mine - affiliate);
  const remaining = mine ?? Math.max(0, net - affiliate);
  return {
    netCents: net,
    coproducersCents: co?.role === 'OWNER' ? coproducers : 0,
    affiliateCents: affiliate,
    remainingCents: remaining,
    coproducersPercentage:
      coproducers == null ? null : (coproducers / net) * 100,
  };
}

/** Valor líquido que ficou com o usuário atual, em reais (null quando ainda não calculado). */
export function userNetAmount(
  row: Pick<Transacao, 'netAmount' | 'coproducao' | 'afiliacao'>,
): number | string | null | undefined {
  const own =
    row.coproducao?.role === 'COPRODUCER'
      ? row.coproducao.state
      : row.afiliacao?.role === 'AFFILIATE'
        ? row.afiliacao.state
        : (row.coproducao?.state ?? row.afiliacao?.state);
  // Venda estornada: a parte original foi revertida e nada ficou com o usuário.
  if (own === 'REVERSED') return 0;
  const mine = row.coproducao?.myAmountCents;
  if (mine != null) return mine / 100;
  const affiliation = row.afiliacao;
  if (affiliation?.role === 'AFFILIATE')
    return affiliation.myAmountCents == null
      ? null
      : affiliation.myAmountCents / 100;
  const split = ownerSplit(row);
  if (split && affiliation?.role === 'OWNER') return split.remainingCents / 100;
  return row.netAmount;
}

export type CoproductionCell =
  | {
      kind: 'OWNER';
      divertedCents: number;
      percentage: number;
      state: TransacaoCoproducao['state'];
    }
  | {
      kind: 'COPRODUCER';
      myCents: number;
      state: TransacaoCoproducao['state'];
    };

/** Célula da coluna Coprodução: o dono vê o que saiu para coprodutores; o coprodutor, só a própria parte. */
export function coproductionCell(
  row: Pick<Transacao, 'netAmount' | 'coproducao' | 'afiliacao'>,
): CoproductionCell | null {
  const co = row.coproducao;
  if (!co) return null;
  if (co.role === 'COPRODUCER')
    return co.myAmountCents == null
      ? null
      : { kind: 'COPRODUCER', myCents: co.myAmountCents, state: co.state };
  const split = ownerSplit(row);
  if (!split || split.coproducersCents == null) return null;
  return {
    kind: 'OWNER',
    divertedCents: split.coproducersCents,
    percentage: split.coproducersPercentage ?? 0,
    state: co.state,
  };
}

/**
 * Venda concluída só com afiliado: o dono não tem alocação de coprodução, então o bloco de
 * coprodução não tem o que mostrar (a divisão aparece no card de afiliação).
 */
export function hasCoproducers(
  detail: { status?: string },
  co: TransacaoCoproducao | null | undefined,
  affiliation: { role: string } | null | undefined,
): boolean {
  if (!co) return false;
  if (co.role === 'COPRODUCER') return true;
  return !(
    ['COMPLETED', 'APPROVED'].includes(detail.status ?? '') &&
    co.myAmountCents == null &&
    co.state == null &&
    affiliation?.role === 'OWNER'
  );
}

/**
 * Coluna única "Participação": soma o que o usuário recebeu ou repassou por coprodução e por
 * afiliação, tanto do produto quanto da margem, sem distinguir a origem. Null quando não há valor.
 */
export function participationCell(
  row: Pick<Transacao, 'netAmount' | 'coproducao' | 'afiliacao'>,
): { cents: number; reversed: boolean } | null {
  const co = coproductionCell(row);
  const coCents = co
    ? co.kind === 'OWNER'
      ? co.divertedCents
      : co.myCents
    : null;
  const affiliation = row.afiliacao;
  const affiliationCents = affiliation
    ? affiliation.role === 'AFFILIATE'
      ? affiliation.myAmountCents
      : (affiliation.affiliateCommissionCents ?? null)
    : null;
  if (coCents == null && affiliationCents == null) return null;
  const states = [
    coCents == null ? null : row.coproducao?.state,
    affiliationCents == null ? null : affiliation?.state,
  ].filter((state) => state != null);
  return {
    cents: (coCents ?? 0) + (affiliationCents ?? 0),
    reversed:
      states.length > 0 && states.every((state) => state === 'REVERSED'),
  };
}
