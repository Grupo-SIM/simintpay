import { describe, expect, test } from 'bun:test';
import {
  StoredCardCycleExecutor,
  outcomeFromGatewayStatus,
} from './stored-card-cycle.executor';

const charge = { id: 'ch1', attempts: 2, amountCents: 4990 } as never;
const contract = {
  id: 'ct1',
  userId: 'u1',
  acquirer: 'DOM',
  description: 'Plano',
} as never;

function build(opts: {
  supported?: boolean;
  hasMethod?: boolean;
  stored?: { storedCardId: string; token: string } | null;
  charge?: (token: string, input: any) => Promise<{ status: string }>;
}) {
  const calls: any[] = [];
  const gateway: any = {};
  if (opts.hasMethod !== false) {
    gateway.chargeStoredCardToken = async (t: string, input: any) => {
      calls.push(input);
      return opts.charge!(t, input);
    };
  }
  const executor = new StoredCardCycleExecutor(
    {
      user: {
        findUnique: async () => ({
          domToken: 'seller-token',
          clientStatus: false,
          platform: null,
        }),
      },
    } as never,
    {
      resolveForContract: async () =>
        opts.stored === undefined
          ? { storedCardId: 's1', token: 'tok_secret' }
          : opts.stored,
    } as never,
    {
      capabilitiesFor: () => ({ chargeStoredCard: opts.supported !== false }),
      byAcquirer: () => gateway,
    } as never,
  );
  return { executor, calls };
}

describe('StoredCardCycleExecutor', () => {
  test('pays and derives the idempotency key from charge id and attempts', async () => {
    const { executor, calls } = build({
      charge: async () => ({ status: 'paid' }),
    });
    expect(await executor.charge({ charge, contract })).toEqual({
      outcome: 'PAID',
    });
    expect(calls[0].idempotencyKey).toBe('cycle:ch1:2');
    expect(calls[0].codExternal).toBe('cycle:ch1:2');
    expect(calls[0].amount).toBe(49.9);
  });

  test('a refusal status fails the cycle', async () => {
    const { executor } = build({ charge: async () => ({ status: 'refused' }) });
    expect((await executor.charge({ charge, contract })).outcome).toBe(
      'FAILED',
    );
  });

  test('a pending status is unknown, not paid or failed', async () => {
    const { executor } = build({ charge: async () => ({ status: 'pending' }) });
    expect((await executor.charge({ charge, contract })).outcome).toBe(
      'UNKNOWN',
    );
  });

  test('a timeout or 5xx is unknown; a 4xx is a definite failure', async () => {
    const timeout = build({
      charge: async () => {
        throw new Error('timeout of 30000ms exceeded');
      },
    });
    expect((await timeout.executor.charge({ charge, contract })).outcome).toBe(
      'UNKNOWN',
    );
    const serverError = build({
      charge: async () => {
        throw Object.assign(new Error('bad gateway'), {
          response: { status: 502 },
        });
      },
    });
    expect(
      (await serverError.executor.charge({ charge, contract })).outcome,
    ).toBe('UNKNOWN');
    const declined = build({
      charge: async () => {
        throw Object.assign(new Error('declined'), {
          response: { status: 422 },
        });
      },
    });
    expect((await declined.executor.charge({ charge, contract })).outcome).toBe(
      'FAILED',
    );
  });

  test('fails without calling the gateway when no stored card exists', async () => {
    const { executor, calls } = build({
      stored: null,
      charge: async () => ({ status: 'paid' }),
    });
    expect((await executor.charge({ charge, contract })).outcome).toBe(
      'FAILED',
    );
    expect(calls).toHaveLength(0);
  });

  test('is unsupported when the acquirer lacks the capability or the method', () => {
    expect(build({ supported: false }).executor.canCharge(contract)).toBe(
      false,
    );
    expect(build({ hasMethod: false }).executor.canCharge(contract)).toBe(
      false,
    );
    expect(build({}).executor.canCharge(contract)).toBe(true);
  });

  test('an unsupported acquirer leaves the cycle unknown instead of failing it', async () => {
    const { executor, calls } = build({
      supported: false,
      charge: async () => ({ status: 'paid' }),
    });
    expect((await executor.charge({ charge, contract })).outcome).toBe(
      'UNKNOWN',
    );
    expect(calls).toHaveLength(0);
  });

  test('maps gateway statuses', () => {
    expect(outcomeFromGatewayStatus('Approved')).toBe('PAID');
    expect(outcomeFromGatewayStatus('denied')).toBe('FAILED');
    expect(outcomeFromGatewayStatus('processing')).toBe('UNKNOWN');
  });
});
