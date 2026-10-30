import { describe, expect, mock, test } from 'bun:test';
import type { PrismaService } from '../database/prisma/prisma.service';
import {
  CircuitOpenException,
  CircuitUnavailableException,
  PaymentCircuitBreaker,
} from './payment-circuit-breaker';

function fixture(
  status: 'CLOSED' | 'OPEN' | 'HALF_OPEN',
  options: { expired?: boolean; fail?: boolean } = {},
) {
  const state = {
    status,
    fence: 2n,
    leaseToken: 'probe-token',
    leaseExpiresAt: new Date(Date.now() + (options.expired ? -1000 : 60_000)),
    cooldownUntil: new Date(Date.now() + (options.expired ? -1000 : 60_000)),
  };
  const db = {
    $executeRaw: mock(async () => 1),
    $queryRaw: mock(
      async (sql: { strings?: readonly string[] } | readonly string[]) => {
        if (options.fail) throw new Error('postgres unavailable');
        const query = (
          'strings' in sql && sql.strings ? sql.strings : sql
        ).join('?');
        if (query.includes('FOR UPDATE')) return [state];
        if (query.includes('clock_timestamp() AS now'))
          return [{ now: new Date() }];
        return [{ success: 0n, failure: 10n }];
      },
    ),
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db),
  };
  return {
    breaker: new PaymentCircuitBreaker(prisma as unknown as PrismaService),
    db,
    state,
  };
}

describe('distributed payment circuit', () => {
  test('fails closed if its state database is unavailable', async () => {
    const { breaker } = fixture('CLOSED', { fail: true });
    await expect(breaker.begin('DOM', 'CREATE_PIX')).rejects.toBeInstanceOf(
      CircuitUnavailableException,
    );
  });

  test('denies requests during OPEN cooldown', async () => {
    const { breaker } = fixture('OPEN');
    await expect(breaker.begin('DOM', 'CREATE_PIX')).rejects.toBeInstanceOf(
      CircuitOpenException,
    );
  });

  test('admits only the fenced probe after cooldown', async () => {
    const { breaker, db } = fixture('OPEN', { expired: true });
    const permit = await breaker.begin('DOM', 'CREATE_PIX');
    expect(permit.probe).toBe(true);
    expect(permit.fence).toBe(3n);
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
  });

  test('fences expired probes and restarts cooldown instead of assuming payment failure', async () => {
    const { breaker, db } = fixture('HALF_OPEN', { expired: true });
    await expect(breaker.begin('DOM', 'CREATE_PIX')).rejects.toBeInstanceOf(
      CircuitOpenException,
    );
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
  });

  test('does not admit another probe while the lease is active', async () => {
    const { breaker } = fixture('HALF_OPEN');
    await expect(breaker.begin('DOM', 'CREATE_PIX')).rejects.toBeInstanceOf(
      CircuitOpenException,
    );
  });

  test('ignores stale probe completions and validation declines', async () => {
    const { breaker, db } = fixture('CLOSED');
    await breaker.complete(
      {
        provider: 'DOM',
        operation: 'CREATE_PIX',
        token: 'old',
        fence: 1n,
        probe: true,
      },
      'FAILURE',
    );
    await breaker.complete(
      {
        provider: 'DOM',
        operation: 'CREATE_PIX',
        token: 'ignored',
        fence: 2n,
        probe: false,
      },
      'IGNORE',
    );
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw.mock.calls[0]?.[0].join('')).toContain(
      'INSERT INTO "PaymentCircuitEvent"',
    );
  });

  test('records CLOSED IGNORE as terminal and rejects a conflicting later FAILURE', async () => {
    const { breaker, db } = fixture('CLOSED');
    const completedTokens = new Set<string>();
    db.$executeRaw.mockImplementation(
      async (_sql: readonly string[], token?: string) => {
        if (completedTokens.has(token ?? '')) return 0;
        completedTokens.add(token ?? '');
        return 1;
      },
    );
    const permit = {
      provider: 'DOM',
      operation: 'CREATE_PIX',
      token: 'ignored',
      fence: 2n,
      probe: false,
    } as const;
    await breaker.complete(permit, 'IGNORE');
    await breaker.complete(permit, 'FAILURE');
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
    expect(
      db.$queryRaw.mock.calls.filter(([sql]) =>
        ('strings' in sql && sql.strings ? sql.strings : sql)
          .join('?')
          .includes('count(*) FILTER'),
      ),
    ).toHaveLength(0);
  });

  test('reopens after an ignored probe without claiming provider health', async () => {
    const { breaker, db } = fixture('HALF_OPEN');
    await breaker.complete(
      {
        provider: 'DOM',
        operation: 'CREATE_PIX',
        token: 'probe-token',
        fence: 2n,
        probe: true,
      },
      'IGNORE',
    );
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
    expect(db.$executeRaw.mock.calls[1]?.[0].join('')).toContain(
      '"status" = \'OPEN\'',
    );
  });

  test('rejects a successful probe result that arrives after its lease expires', async () => {
    const { breaker, db } = fixture('HALF_OPEN', { expired: true });
    await breaker.complete(
      {
        provider: 'DOM',
        operation: 'CREATE_PIX',
        token: 'probe-token',
        fence: 2n,
        probe: true,
      },
      'SUCCESS',
    );
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw.mock.calls[0]?.[0].join('')).toContain(
      '"status" = \'OPEN\'',
    );
  });

  test('closes after a successful probe within its lease', async () => {
    const { breaker, db } = fixture('HALF_OPEN');
    await breaker.complete(
      {
        provider: 'DOM',
        operation: 'CREATE_PIX',
        token: 'probe-token',
        fence: 2n,
        probe: true,
      },
      'SUCCESS',
    );
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
    expect(db.$executeRaw.mock.calls[1]?.[0].join('')).toContain(
      '"status" = \'CLOSED\'',
    );
  });

  test('opens on minimum rolling failures', async () => {
    const { breaker, db } = fixture('CLOSED');
    await breaker.complete(
      {
        provider: 'DOM',
        operation: 'CREATE_PIX',
        token: 'failure',
        fence: 2n,
        probe: false,
      },
      'FAILURE',
    );
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
  });
});
