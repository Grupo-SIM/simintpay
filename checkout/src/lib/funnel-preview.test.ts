import { describe, expect, test } from 'bun:test';
import {
  isFunnelPreviewMessage,
  normalizeFunnelPreviewDraft,
  nextFunnelPreviewOffer,
  type FunnelPreviewDraft,
} from './funnel-preview';

const draft: FunnelPreviewDraft = {
  offers: [
    {
      id: 'up-1',
      role: 'UPSELL',
      name: 'Oferta',
      description: null,
      amountCents: 1000,
    },
    {
      id: 'down-1',
      role: 'DOWNSELL',
      name: 'Alternativa',
      description: 'Descrição',
      amountCents: 500,
    },
    {
      id: 'up-2',
      role: 'UPSELL',
      name: 'Outra oferta',
      description: '',
      amountCents: 2000,
    },
  ],
};
const message = (value: unknown) => ({
  type: 'payment-link-preview:draft',
  version: 1,
  draft: value,
});

describe('funnel preview public boundary', () => {
  test('accepts display-only offers and rejects credentials, malformed values and duplicate ids', () => {
    expect(isFunnelPreviewMessage(message(draft))).toBe(true);
    for (const invalid of [
      { offers: [] },
      { offers: [draft.offers[1]] },
      { ...draft, customer: { email: 'private@example.com' } },
      { offers: [{ ...draft.offers[0], token: 'secret' }] },
      { offers: [{ ...draft.offers[0], amountCents: -1 }] },
      { offers: [{ ...draft.offers[0], amountCents: 1.5 }] },
      { offers: [{ ...draft.offers[0], role: 'ORDER_BUMP' }] },
      { offers: [draft.offers[0], draft.offers[0]] },
    ])
      expect(isFunnelPreviewMessage(message(invalid))).toBe(false);
    expect(isFunnelPreviewMessage({ ...message(draft), version: 2 })).toBe(
      false,
    );
  });
  test('acceptance advances upsells, decline displays downsell and end remains local', () => {
    expect(nextFunnelPreviewOffer(draft, 0, true)).toBe(2);
    expect(nextFunnelPreviewOffer(draft, 0, false)).toBe(1);
    expect(nextFunnelPreviewOffer(draft, 1, true)).toBe(2);
    expect(nextFunnelPreviewOffer(draft, 1, false)).toBe(-1);
    expect(nextFunnelPreviewOffer(draft, 2, true)).toBe(-1);
  });
});

test('mixed draft order starts with upsells and preserves ordering in each role', () => {
  const normalized = normalizeFunnelPreviewDraft({
    offers: [draft.offers[1], draft.offers[0], draft.offers[2]],
  });
  expect(normalized.offers.map((offer) => offer.id)).toEqual([
    'up-1',
    'up-2',
    'down-1',
  ]);
  expect(nextFunnelPreviewOffer(normalized, 0, true)).toBe(1);
  expect(nextFunnelPreviewOffer(normalized, 0, false)).toBe(2);
});
