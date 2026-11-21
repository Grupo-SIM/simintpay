'use client';

import { useState } from 'react';
import { draftFromAgreement } from './affiliates';
import type {
  AffiliateAgreement,
  AffiliateDraft,
  AffiliateDraftRow,
} from './types';

/** Rascunho local do diálogo; só é substituído quando o formulário é remontado (recarga). */
export function useAffiliatesDraft(
  initial: AffiliateAgreement,
  platform: boolean,
) {
  const [draft, setDraft] = useState<AffiliateDraft>(() =>
    draftFromAgreement(initial, platform),
  );
  return {
    draft,
    reset: (next: AffiliateAgreement) =>
      setDraft(draftFromAgreement(next, platform)),
    patch: (next: Partial<AffiliateDraft>) =>
      setDraft((previous) => ({ ...previous, ...next })),
    addRow: () =>
      setDraft((previous) => ({
        ...previous,
        rows: [
          ...previous.rows,
          { id: crypto.randomUUID(), email: '', percentage: '' },
        ],
      })),
    updateRow: (row: AffiliateDraftRow) =>
      setDraft((previous) => ({
        ...previous,
        rows: previous.rows.map((item) => (item.id === row.id ? row : item)),
      })),
    removeRow: (id: string) =>
      setDraft((previous) => ({
        ...previous,
        rows: previous.rows.filter((item) => item.id !== id),
      })),
  };
}

export type AffiliatesDraftState = ReturnType<typeof useAffiliatesDraft>;
