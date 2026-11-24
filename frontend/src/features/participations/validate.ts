import { validateAffiliates } from '@/features/affiliates/affiliates';
import { validateParticipants } from '@/features/coproduction/coproduction';
import {
  affiliatesFromDraft,
  coproducersFromRows,
  jointMessage,
  jointTotal,
  type JointResult,
} from './joint';
import { marginMessage, marginTotal, type MarginResult } from './margin-joint';
import {
  coproducerRows,
  emailKey,
  inheritsCoproduction,
  marginAffiliateDraft,
  marginCoproducerRows,
  productAffiliateDraft,
} from './people';
import type {
  Agreements,
  ParticipationsContext,
  ParticipationsDraft,
} from './types';

export type Totals = {
  joint: JointResult;
  margin?: MarginResult;
};

/** Indicadores: total conjunto do líquido e, só admin, o limite próprio da margem. */
export function computeTotals(
  draft: ParticipationsDraft,
  agreements: Agreements,
  context: ParticipationsContext,
): Totals {
  const { co, aff, margin } = agreements;
  const { platform } = context;
  const inherits = inheritsCoproduction(draft, context);
  const joint = jointTotal({
    coproducers: inherits
      ? (co.effective?.source ? co.effective.participants : []).map((row) => ({
          email: row.email,
          name: row.name,
          bps: row.percentageBps,
        }))
      : coproducersFromRows(coproducerRows(draft)),
    coproducerLevel: platform || inherits ? 'platform' : 'offer',
    affiliates: affiliatesFromDraft(
      productAffiliateDraft(draft),
      aff.inherited,
      platform,
    ),
  });
  return {
    joint,
    margin: context.admin
      ? marginTotal(draft, margin?.inherited, platform)
      : undefined,
  };
}

/** Primeira falha de validação do rascunho inteiro (produto e, para admin, margem). */
export function validateDraft(
  draft: ParticipationsDraft,
  agreements: Agreements,
  context: ParticipationsContext,
): string | null {
  const seen = new Set<string>();
  for (const person of draft.people) {
    const key = emailKey(person.email);
    if (seen.has(key)) return 'A mesma pessoa não pode aparecer duas vezes.';
    seen.add(key);
  }
  const { ownerEmail, platform, admin } = context;
  const inherits = inheritsCoproduction(draft, context);
  const coError = inherits
    ? null
    : validateParticipants(coproducerRows(draft), ownerEmail);
  if (coError) return coError;
  const affError = validateAffiliates(productAffiliateDraft(draft), {
    ownerEmail,
    platform,
    inheritedDefaultBps: agreements.aff.inherited?.defaultPercentageBps,
  });
  if (affError) return affError;
  const totals = computeTotals(draft, agreements, context);
  const jointError = jointMessage(totals.joint);
  if (jointError) return jointError;
  if (!admin) return null;
  const marginCoError = validateParticipants(marginCoproducerRows(draft));
  if (marginCoError) return `Margem: ${marginCoError}`;
  const marginAffError = validateAffiliates(marginAffiliateDraft(draft), {
    platform: false,
    inheritedDefaultBps: agreements.margin?.inherited?.defaultPercentageBps,
  });
  if (marginAffError) return `Margem: ${marginAffError}`;
  return totals.margin ? marginMessage(totals.margin) : null;
}
