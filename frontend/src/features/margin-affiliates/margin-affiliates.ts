import {
  percentageBps,
  serializeAffiliates,
} from '@/features/affiliates/affiliates';
import type {
  AffiliateDraft,
  AffiliateSaveInput,
} from '@/features/affiliates/types';

/** Mesmo corpo dos afiliados, sem o link base (a margem não gera link). */
export function serializeMarginAffiliates(
  draft: AffiliateDraft,
  platform: boolean,
): AffiliateSaveInput {
  const { linkBaseUrl: _ignored, ...input } = serializeAffiliates(draft, false);
  void platform;
  return input;
}

/**
 * Maior percentual efetivo da margem entre os afiliados do rascunho (bps).
 * Limite próprio: independe do total conjunto de coprodutores e afiliados.
 */
export function marginWorstBps(
  draft: AffiliateDraft,
  inheritedDefaultBps?: number | null,
): number {
  const optional = (text: string) => (text.trim() ? percentageBps(text) : null);
  const global = optional(draft.defaultPercentage);
  let worst = 0;
  for (const row of draft.rows) {
    const effective = optional(row.percentage) ?? global ?? inheritedDefaultBps;
    if (effective != null && Number.isFinite(effective))
      worst = Math.max(worst, effective);
  }
  return worst;
}
