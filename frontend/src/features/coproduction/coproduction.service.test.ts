import { expect, test } from 'bun:test';
import { createApiClient } from '@/services/api/api.client';
import {
  CoproductionConfirmationError,
  getCoproduction,
  saveCoproduction,
} from './coproduction.service';

const apiWith = (put: unknown) => ({
  ...createApiClient({ baseUrl: 'http://127.0.0.1' }),
  put: async () => put,
});

test('save requires persisted participants and an incremented version', async () => {
  const participants = [{ email: 'partner@example.test', percentageBps: 2550 }];
  const saved = { basis: 'NET', version: 2, participants };
  const api = apiWith({ data: saved }) as ReturnType<typeof createApiClient>;
  expect(await saveCoproduction(api, 'planos', 'id', 1, participants)).toEqual(
    saved,
  );
  for (const data of [
    { ...saved, version: 1 },
    { ...saved, participants: [] },
    {},
    null,
  ]) {
    await expect(
      saveCoproduction(
        apiWith({ data }) as typeof api,
        'planos',
        'id',
        1,
        participants,
      ),
    ).rejects.toBeInstanceOf(CoproductionConfirmationError);
  }
});

test('failed GET never creates an empty agreement and requests no-store', async () => {
  const api = createApiClient({ baseUrl: 'http://127.0.0.1' });
  const broken = {
    ...api,
    get: async (_path: string, options: { cache?: string }) => {
      expect(options.cache).toBe('no-store');
      throw new Error('HTTP 404');
    },
  } as typeof api;
  await expect(getCoproduction(broken, 'boletos', 'id')).rejects.toThrow(
    'HTTP 404',
  );
});
