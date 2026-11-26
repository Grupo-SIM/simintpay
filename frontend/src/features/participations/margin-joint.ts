import { formatPercentage } from '@/features/coproduction/coproduction';
import { affiliatesFromDraft, TOTAL_BPS, validRowBps } from './joint';
import { marginAffiliateDraft } from './people';
import type { MarginAgreement } from '@/features/margin-affiliates/types';
import type { ParticipationsDraft } from './types';

export type MarginResult = {
  coproducersBps: number;
  affiliateBps: number;
  affiliate?: string;
  totalBps: number;
  overBps: number;
  exceeds: boolean;
};

const norm = (value?: string) => value?.trim().toLowerCase() ?? '';

/**
 * SimIntPay: soma dos coprodutores SimIntPay + maior percentual efetivo de um afiliado
 * que não seja também coprodutor SimIntPay (coprodutor vence). Plataforma e oferta somam; a
 * oferta vence para a mesma pessoa. Independe da divisão do líquido.
 */
export function marginTotal(
  draft: ParticipationsDraft,
  inherited: MarginAgreement['inherited'] | undefined,
  platform: boolean,
): MarginResult {
  const own = draft.people.filter((person) => person.coMargin.on);
  const ownCo = own.flatMap((person) => {
    const bps = validRowBps(person.coMargin.percentage);
    return bps === null
      ? []
      : [{ email: norm(person.email), name: norm(person.name), bps }];
  });
  const ownNames = new Set(ownCo.map((row) => row.name).filter(Boolean));
  const inheritedCo = platform
    ? []
    : (inherited?.coproducers ?? []).filter(
        (row) => !ownNames.has(norm(row.name)),
      );
  const coproducersBps =
    ownCo.reduce((sum, row) => sum + row.bps, 0) +
    inheritedCo.reduce((sum, row) => sum + row.percentageBps, 0);
  const coEmails = new Set(own.map((person) => norm(person.email)));
  const coNames = new Set([
    ...ownNames,
    ...inheritedCo.map((row) => norm(row.name)),
  ]);
  const affiliates = affiliatesFromDraft(
    marginAffiliateDraft(draft, coEmails),
    platform ? undefined : inherited,
    platform,
  ).filter((item) => !coNames.has(norm(item.name)));
  let affiliateBps = 0;
  let affiliate: string | undefined;
  for (const item of affiliates)
    if (item.bps > affiliateBps) {
      affiliateBps = item.bps;
      affiliate = item.label;
    }
  const totalBps = coproducersBps + affiliateBps;
  return {
    coproducersBps,
    affiliateBps,
    affiliate,
    totalBps,
    overBps: Math.max(0, totalBps - TOTAL_BPS),
    exceeds: totalBps > TOTAL_BPS,
  };
}

export function marginMessage(result: MarginResult): string | null {
  if (!result.exceeds) return null;
  return `A parte SimIntPay soma ${formatPercentage(result.totalBps)}% (coprodutores ${formatPercentage(result.coproducersBps)}% + afiliado ${formatPercentage(result.affiliateBps)}%), ${formatPercentage(result.overBps)}% acima de 100%. Reduza os percentuais SimIntPay para salvar.`;
}
