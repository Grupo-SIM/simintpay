import { expect, test } from 'bun:test';
import { createApiClient } from '@/services/api/api.client';
import { AffiliateConfirmationError } from '@/features/affiliates/affiliates.service';
import { draftFromAgreement } from '@/features/affiliates/affiliates';
import { marginWorstBps, serializeMarginAffiliates } from './margin-affiliates';
import {
  getMarginAffiliates,
  saveMarginAffiliates,
} from './margin-affiliates.service';

const base = createApiClient({ baseUrl: 'http://127.0.0.1' });
const input = {
  defaultPercentageBps: 1000,
  commissionOnRenewals: true,
  affiliates: [{ email: 'a@example.test', percentageBps: null }],
};
const saved = {
  version: 2,
  defaultPercentageBps: 1000,
  commissionOnRenewals: true,
  affiliates: [
    { email: 'a@example.test', name: 'A', code: 'ABC123', percentageBps: null },
  ],
};

test('uses margin endpoints and sends no link base', async () => {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const api = {
    ...base,
    get: async (path: string) => {
      calls.push({ method: 'GET', path });
      return { data: saved };
    },
    put: async (path: string, body: unknown) => {
      calls.push({ method: 'PUT', path, body });
      return { data: saved };
    },
  } as unknown as typeof base;
  await getMarginAffiliates(api, 'ofertas', 'o 1');
  await saveMarginAffiliates(api, 'plataformas', 'p1', 1, {
    ...input,
    linkBaseUrl: 'https://x.test',
  });
  expect(calls[0].path).toBe('/comissoes/margem/ofertas/o%201');
  expect(calls[1].path).toBe('/comissoes/margem/plataformas/p1');
  expect(calls[1].body).toEqual({ version: 1, ...input });
});

test('save requires persisted affiliates and an incremented version', async () => {
  const apiWith = (put: unknown) =>
    ({ ...base, put: async () => put }) as typeof base;
  expect(
    (
      await saveMarginAffiliates(
        apiWith({ data: saved }),
        'plataformas',
        'id',
        1,
        input,
      )
    ).version,
  ).toBe(2);
  for (const data of [
    { ...saved, version: 1 },
    { ...saved, affiliates: [] },
    { ...saved, commissionOnRenewals: false },
    {},
    null,
  ])
    await expect(
      saveMarginAffiliates(apiWith({ data }), 'plataformas', 'id', 1, input),
    ).rejects.toBeInstanceOf(AffiliateConfirmationError);
});

test('failed GET never becomes an empty agreement', async () => {
  const api = {
    ...base,
    get: async () => {
      throw new Error('403');
    },
  } as unknown as typeof base;
  await expect(getMarginAffiliates(api, 'plataformas', 'id')).rejects.toThrow();
});

test('serialize drops link base; worst bps follows own then global limits', () => {
  const draft = draftFromAgreement(
    {
      ...saved,
      linkBaseUrl: 'https://x.test',
      affiliates: [
        { email: 'a@example.test', percentageBps: 2500 },
        { email: 'b@example.test', percentageBps: null },
      ],
    },
    true,
  );
  expect('linkBaseUrl' in serializeMarginAffiliates(draft, true)).toBe(false);
  expect(marginWorstBps(draft)).toBe(2500);
  expect(marginWorstBps({ ...draft, rows: [] })).toBe(0);
});
