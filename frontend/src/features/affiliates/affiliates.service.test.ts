import { expect, test } from 'bun:test';
import { createApiClient } from '@/services/api/api.client';
import {
  AffiliateConfirmationError,
  getAffiliateReceipts,
  getAffiliates,
  saveAffiliates,
} from './affiliates.service';
import {
  affiliateLink,
  draftFromAgreement,
  parseAffiliates,
  serializeAffiliates,
  validateAffiliates,
} from './affiliates';

const apiWith = (put: unknown) => ({
  ...createApiClient({ baseUrl: 'http://127.0.0.1' }),
  put: async () => put,
});
const input = {
  defaultPercentageBps: 1000,
  commissionOnRenewals: true,
  linkBaseUrl: null,
  affiliates: [{ email: 'a@example.test', percentageBps: null }],
};
const saved = {
  version: 2,
  defaultPercentageBps: 1000,
  commissionOnRenewals: true,
  linkBaseUrl: null,
  affiliates: [
    { email: 'a@example.test', name: 'A', code: 'ABC123', percentageBps: null },
  ],
};

test('save requires persisted affiliates and an incremented version', async () => {
  const api = apiWith({ data: saved }) as ReturnType<typeof createApiClient>;
  expect(
    (await saveAffiliates(api, 'plataformas', 'id', 1, input)).version,
  ).toBe(2);
  for (const data of [
    { ...saved, version: 1 },
    { ...saved, affiliates: [] },
    { ...saved, defaultPercentageBps: 500 },
    {},
    null,
  ])
    await expect(
      saveAffiliates(
        apiWith({ data }) as typeof api,
        'plataformas',
        'id',
        1,
        input,
      ),
    ).rejects.toBeInstanceOf(AffiliateConfirmationError);
});

test('failed GET (even 404) never becomes an empty agreement', async () => {
  const api = {
    ...createApiClient({ baseUrl: 'http://127.0.0.1' }),
    get: async (_p: string, options: { cache?: string }) => {
      expect(options.cache).toBe('no-store');
      throw new Error('HTTP 404');
    },
  } as ReturnType<typeof createApiClient>;
  await expect(getAffiliates(api, 'ofertas', 'id')).rejects.toThrow('HTTP 404');
});

test('wire format uses basis points and tri-state renewals on offers', () => {
  const agreement = parseAffiliates({ ...saved, commissionOnRenewals: null });
  const draft = draftFromAgreement(agreement, false);
  expect(draft.renewals).toBe('platform');
  expect(draft.defaultPercentage).toBe('10');
  draft.rows[0].percentage = '25,5';
  expect(serializeAffiliates(draft, false)).toEqual({
    defaultPercentageBps: 1000,
    commissionOnRenewals: null,
    affiliates: [{ email: 'a@example.test', percentageBps: 2550 }],
  });
  draft.renewals = 'first';
  expect(serializeAffiliates(draft, false).commissionOnRenewals).toBe(false);
});

test('validation: global fallback, owner, duplicates and link base', () => {
  const base = draftFromAgreement(parseAffiliates(saved), true);
  const opts = { platform: true };
  expect(validateAffiliates(base, opts)).toBeNull();
  expect(validateAffiliates({ ...base, defaultPercentage: '' }, opts)).toMatch(
    /percentual/,
  );
  expect(
    validateAffiliates(base, { ...opts, ownerEmail: 'A@example.test' }),
  ).toMatch(/proprietário/);
  expect(
    validateAffiliates({ ...base, rows: [...base.rows, base.rows[0]] }, opts),
  ).toMatch(/duas vezes/);
  expect(
    validateAffiliates({ ...base, linkBaseUrl: 'http://x.com' }, opts),
  ).toMatch(/https/);
  expect(affiliateLink('https://x.com/?a=1', 'ABC')).toBe(
    'https://x.com/?a=1&aff=ABC',
  );
});

test('receipts send the report filters and page, no-store, dropping unset ones', async () => {
  const calls: { path: string; options: Record<string, unknown> }[] = [];
  const api = {
    ...createApiClient({ baseUrl: 'http://127.0.0.1' }),
    get: async (path: string, options: Record<string, unknown>) => {
      calls.push({ path, options });
      return { data: [], total: 0 };
    },
  } as unknown as ReturnType<typeof createApiClient>;
  await getAffiliateReceipts(
    api,
    {
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      platform: 'ATLAS',
      paymentMethod: 'PIX',
      // anything else the report holds must not leak into the request
      ...({ search: 'x' } as object),
    },
    2,
  );
  await getAffiliateReceipts(api);
  expect(calls[0].path).toBe('/comissoes/recebimentos');
  expect(calls[0].options).toEqual({
    query: {
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      platform: 'ATLAS',
      paymentMethod: 'PIX',
      page: 2,
    },
    cache: 'no-store',
  });
  expect(calls[1].options).toEqual({
    query: {
      startDate: undefined,
      endDate: undefined,
      platform: undefined,
      paymentMethod: undefined,
      page: 1,
    },
    cache: 'no-store',
  });
});
