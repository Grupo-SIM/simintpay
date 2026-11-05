import { beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  DomChargeStatusLookup,
  LOOKUP_MAX_PAGES,
  LOOKUP_PAGE_SIZE,
} from './charge-status-lookup';

const NOW = new Date('2026-06-10T12:00:00Z');
const KEY = 'cycle:ch-1:2';

function tx(codExternal: string, status = 'paid') {
  return { id: codExternal, cod_external: codExternal, status };
}
function filler(n: number) {
  return Array.from({ length: n }, (_, i) => tx(`other-${i}`));
}

function setup(opts: { updatedAt?: Date; acquirer?: string } = {}) {
  const list = mock(
    async (): Promise<{ transactions: unknown[]; total: number }> => ({
      transactions: [],
      total: 0,
    }),
  );
  const prisma = {
    charge: {
      findUnique: mock(async () => ({
        updatedAt: opts.updatedAt ?? new Date('2026-06-10T11:00:00Z'),
        offer: { platformTag: null },
        contract: { acquirer: opts.acquirer ?? 'DOM' },
      })),
    },
  };
  const gateways = { byAcquirer: () => ({ listDomTransactions: list }) };
  const lookup = new DomChargeStatusLookup(prisma as never, gateways as never);
  return { lookup, list };
}

describe('DomChargeStatusLookup', () => {
  beforeEach(() => {
    process.env.DOM_TOKEN = 'global-token';
  });

  it('maps a paid transaction to PAID', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce({ transactions: [tx(KEY, 'paid')], total: 1 });
    expect(await lookup.find('ch-1', 2, NOW)).toBe('PAID');
    const [token, input] = list.mock.calls[0] as unknown as [
      string,
      { begin_date: string; page: number },
    ];
    expect(token).toBe('global-token');
    expect(input.page).toBe(1);
    expect(input.begin_date).toBe('2026-06-09');
  });

  it('maps a refused transaction to FAILED, found on a later page', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce({
      transactions: filler(LOOKUP_PAGE_SIZE),
      total: 150,
    });
    list.mockResolvedValueOnce({
      transactions: [tx(KEY, 'refused')],
      total: 150,
    });
    expect(await lookup.find('ch-1', 2, NOW)).toBe('FAILED');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('keeps a still-processing transaction UNKNOWN', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce({
      transactions: [tx(KEY, 'pending')],
      total: 1,
    });
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
  });

  it('returns NOT_FOUND after paging the whole window', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce({
      transactions: filler(LOOKUP_PAGE_SIZE),
      total: 120,
    });
    list.mockResolvedValueOnce({ transactions: filler(20), total: 120 });
    expect(await lookup.find('ch-1', 2, NOW)).toBe('NOT_FOUND');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not match another attempt of the same charge', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce({
      transactions: [tx('cycle:ch-1:1', 'paid')],
      total: 1,
    });
    expect(await lookup.find('ch-1', 2, NOW)).toBe('NOT_FOUND');
  });

  it('treats an API error as UNKNOWN, never NOT_FOUND', async () => {
    const { lookup, list } = setup();
    list.mockRejectedValueOnce(new Error('timeout'));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
  });

  it('stops at the page cap and answers UNKNOWN', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValue({
      transactions: filler(LOOKUP_PAGE_SIZE),
      total: 99999,
    });
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
    expect(list).toHaveBeenCalledTimes(LOOKUP_MAX_PAGES);
  });

  it('is UNKNOWN without calling DOM when the attempt is outside the window', async () => {
    const { lookup, list } = setup({
      updatedAt: new Date('2026-06-01T00:00:00Z'),
    });
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
    expect(list).not.toHaveBeenCalled();
  });

  it('is UNKNOWN for a non-DOM acquirer', async () => {
    const { lookup, list } = setup({ acquirer: 'FRENDZ' });
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
    expect(list).not.toHaveBeenCalled();
  });
});
