export type FunnelPreviewDraft = {
  offers: {
    id: string;
    role: 'UPSELL' | 'DOWNSELL';
    name: string;
    description: string | null;
    amountCents: number;
  }[];
};

/** Only public offer fields cross the preview boundary. */
export function isFunnelPreviewMessage(
  value: unknown,
): value is { draft: FunnelPreviewDraft } {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (
    message.type !== 'payment-link-preview:draft' ||
    message.version !== 1 ||
    !message.draft ||
    typeof message.draft !== 'object'
  )
    return false;
  const draft = message.draft as Record<string, unknown>;
  if (
    Object.keys(draft).length !== 1 ||
    !Array.isArray(draft.offers) ||
    !draft.offers.length
  )
    return false;
  const ids = new Set<string>();
  return (
    draft.offers.some(
      (value: unknown) =>
        !!value &&
        typeof value === 'object' &&
        (value as Record<string, unknown>).role === 'UPSELL',
    ) &&
    draft.offers.every((value: unknown) => {
      if (!value || typeof value !== 'object') return false;
      const offer = value as Record<string, unknown>;
      const keys = ['id', 'role', 'name', 'description', 'amountCents'];
      if (
        Object.keys(offer).length !== keys.length ||
        !keys.every((key) => Object.hasOwn(offer, key)) ||
        typeof offer.id !== 'string' ||
        !offer.id ||
        offer.id.length > 500 ||
        ids.has(offer.id) ||
        !['UPSELL', 'DOWNSELL'].includes(String(offer.role)) ||
        typeof offer.name !== 'string' ||
        offer.name.length > 500 ||
        !(
          offer.description === null ||
          (typeof offer.description === 'string' &&
            offer.description.length <= 10000)
        ) ||
        !Number.isSafeInteger(offer.amountCents) ||
        Number(offer.amountCents) < 0 ||
        Number(offer.amountCents) > 1e11
      )
        return false;
      ids.add(offer.id);
      return true;
    })
  );
}

export function nextFunnelPreviewOffer(
  draft: FunnelPreviewDraft,
  index: number,
  accepted: boolean,
): number {
  const role = accepted
    ? 'UPSELL'
    : draft.offers[index]?.role === 'UPSELL'
      ? 'DOWNSELL'
      : null;
  return role
    ? draft.offers.findIndex(
        (offer, nextIndex) => nextIndex > index && offer.role === role,
      )
    : -1;
}

export function normalizeFunnelPreviewDraft(
  draft: FunnelPreviewDraft,
): FunnelPreviewDraft {
  return {
    offers: [
      ...draft.offers.filter((offer) => offer.role === 'UPSELL'),
      ...draft.offers.filter((offer) => offer.role === 'DOWNSELL'),
    ],
  };
}
