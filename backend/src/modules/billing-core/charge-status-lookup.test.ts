import { beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  DomChargeStatusLookup,
  LOOKUP_MAX_PAGES,
} from './charge-status-lookup';

const NOW = new Date('2026-06-10T12:00:00Z');
const KEY = 'cycle:ch-1:2';
const PER_PAGE = 100;

function tx(codExternal: string, status = 'paid') {
  return { id: codExternal, cod_external: codExternal, status };
}
function filler(n: number) {
  return Array.from({ length: n }, (_, i) => tx(`other-${i}`));
}
/** A DOM response as the client returns it: per_page/total come from the response. */
function res(
  transactions: unknown[],
  total: number | undefined,
  perPage: number | null = PER_PAGE,
) {
  return {
    transactions,
    total: total ?? transactions.length,
    reported_total: total,
    per_page: perPage ?? undefined,
  };
}

function setup(
  opts: { createdAt?: Date; acquirer?: string; noUser?: boolean } = {},
) {
  const list = mock(async (): Promise<unknown> => res([], 0));
  const prisma = {
    charge: {
      findUnique: mock(async () => ({
        createdAt: opts.createdAt ?? new Date('2026-06-10T11:00:00Z'),
        contract: { acquirer: opts.acquirer ?? 'DOM', userId: 'u-1' },
      })),
    },
    user: {
      findUnique: mock(async () =>
        opts.noUser
          ? null
          : {
              domToken: 'owner-token',
              clientStatus: false,
              platform: { tag: 'SOME-PLATFORM' },
            },
      ),
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

  it('maps a paid transaction to PAID and queries by creation date without limit', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res([tx(KEY, 'paid')], 1));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('PAID');
    const [token, input] = list.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(token).toBe('owner-token');
    expect(input.page).toBe(1);
    expect(input.begin_date).toBe('2026-06-09');
    expect(input.end_date).toBe('2026-06-11');
    expect(input.type_date).toBe('created');
    expect('limit' in input).toBe(false);
  });

  it('anchors the window on the charge creation, not on its last update', async () => {
    const { lookup, list } = setup({
      createdAt: new Date('2026-06-08T09:00:00Z'),
    });
    list.mockResolvedValueOnce(res([tx(KEY, 'paid')], 1));
    await lookup.find('ch-1', 2, NOW);
    const [, input] = list.mock.calls[0] as unknown as [
      string,
      { begin_date: string },
    ];
    expect(input.begin_date).toBe('2026-06-07');
  });

  it('maps a failed transaction to FAILED, found on a later page', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res(filler(PER_PAGE), 150));
    list.mockResolvedValueOnce(res([tx(KEY, 'failed')], 150));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('FAILED');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('keeps a still-processing transaction UNKNOWN', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res([tx(KEY, 'pending')], 1));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
  });

  it('returns NOT_FOUND once page * per_page reaches the total (short last page)', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res(filler(PER_PAGE), 120));
    list.mockResolvedValueOnce(res(filler(20), 120));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('NOT_FOUND');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not assume a page size: uses the response per_page', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res(filler(15), 20, 15));
    list.mockResolvedValueOnce(res(filler(5), 20, 15));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('NOT_FOUND');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('returns NOT_FOUND on an exactly full last page', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res(filler(PER_PAGE), 100));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('NOT_FOUND');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('returns NOT_FOUND for an empty window (total 0)', async () => {
    const { lookup } = setup();
    expect(await lookup.find('ch-1', 2, NOW)).toBe('NOT_FOUND');
  });

  it('does not match another attempt of the same charge', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res([tx('cycle:ch-1:1', 'paid')], 1));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('NOT_FOUND');
  });

  it('is UNKNOWN when a short page still has a pending total (mismatch)', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res(filler(40), 500));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
  });

  it('is UNKNOWN when the last page disagrees with the total', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res(filler(PER_PAGE), 120));
    list.mockResolvedValueOnce(res(filler(5), 120));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
  });

  it('is UNKNOWN when an empty page appears while the total says more remain', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res([], 50));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
  });

  it('is UNKNOWN when the response has no total or no per_page', async () => {
    const noTotal = setup();
    noTotal.list.mockResolvedValueOnce(res(filler(3), undefined));
    expect(await noTotal.lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');

    const noPerPage = setup();
    noPerPage.list.mockResolvedValueOnce(res(filler(3), 3, null));
    expect(await noPerPage.lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
  });

  it('treats an API error as UNKNOWN, never NOT_FOUND', async () => {
    const { lookup, list } = setup();
    list.mockRejectedValueOnce(new Error('timeout'));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
  });

  it('treats an API error on a later page as UNKNOWN', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res(filler(PER_PAGE), 250));
    list.mockRejectedValueOnce(new Error('502'));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
  });

  it('stops at the page cap and answers UNKNOWN', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValue(res(filler(PER_PAGE), 99999));
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
    expect(list).toHaveBeenCalledTimes(LOOKUP_MAX_PAGES);
  });

  it('truncates an old window: a hit is still reported, a miss is UNKNOWN', async () => {
    const old = new Date('2026-06-01T00:00:00Z');
    const hit = setup({ createdAt: old });
    hit.list.mockResolvedValueOnce(res([tx(KEY, 'paid')], 1));
    expect(await hit.lookup.find('ch-1', 2, NOW)).toBe('PAID');
    const [, input] = hit.list.mock.calls[0] as unknown as [
      string,
      { begin_date: string },
    ];
    expect(input.begin_date).toBe('2026-06-07');

    const miss = setup({ createdAt: old });
    miss.list.mockResolvedValueOnce(res(filler(2), 2));
    expect(await miss.lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
  });

  it('is UNKNOWN for a non-DOM acquirer', async () => {
    const { lookup, list } = setup({ acquirer: 'FRENDZ' });
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
    expect(list).not.toHaveBeenCalled();
  });

  it('uses the executor token (owner domToken), not the global or platform one', async () => {
    const { lookup, list } = setup();
    list.mockResolvedValueOnce(res([tx(KEY, 'paid')], 1));
    await lookup.find('ch-1', 2, NOW);
    const [token] = list.mock.calls[0] as unknown as [string];
    expect(token).toBe('owner-token');
    expect(token).not.toBe(process.env.DOM_TOKEN);
  });

  it('is UNKNOWN without calling DOM when the owner token cannot be resolved', async () => {
    delete process.env.DOM_TOKEN;
    const { lookup, list } = setup({ noUser: true });
    expect(await lookup.find('ch-1', 2, NOW)).toBe('UNKNOWN');
    expect(list).not.toHaveBeenCalled();
  });
});
