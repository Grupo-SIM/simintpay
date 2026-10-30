import { expect, test } from 'bun:test';
import { listAssinantes } from './assinantes.service';
import { createApiClient } from '@/services/api/api.client';

test('subscriber filters reach API and unknown or paused states cannot be deleted', async () => {
  let received: URL | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    received = new URL(String(input));
    return Response.json({
      data: [
        { id: 'active', status: 'ACTIVE' },
        {
          id: 'deactivated',
          status: 'CANCELLED',
          frequencia: 'YEARLY',
          intervalo: 1,
        },
        { id: 'paused', status: 'CANCELLED', isPaused: true },
        { id: 'unknown', status: 'NEW_STATUS' },
      ],
      total: 4,
      page: 2,
      pageSize: 20,
      hasNextPage: true,
    });
  };
  try {
    const result = await listAssinantes(
      createApiClient({ baseUrl: 'http://127.0.0.1:1' }),
      {
        page: 2,
        pageSize: 20,
        search: 'Ana',
        statusGroup: 'deactivated',
        frequency: 'YEARLY',
        platform: 'BOSQUE',
      },
    );
    expect(received?.searchParams.get('page')).toBe('2');
    expect(received?.searchParams.get('search')).toBe('Ana');
    expect(received?.searchParams.get('statusGroup')).toBe('deactivated');
    expect(received?.searchParams.get('frequency')).toBe('YEARLY');
    expect(received?.searchParams.get('platform')).toBe('BOSQUE');
    expect(
      result.rows.filter((row) => row.deactivated).map((row) => row.id),
    ).toEqual(['deactivated']);
    expect(result.rows[1].intervalUnit).toBe('ANO');
    expect(result.rows[0].active).toBe(true);
    expect(result.rows[2].isPaused).toBe(true);
    expect(result.hasNextPage).toBe(true);
  } finally {
    globalThis.fetch = original;
  }
});
