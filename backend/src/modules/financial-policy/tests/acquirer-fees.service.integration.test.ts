import { describe, expect, test } from 'bun:test';
import { Prisma, Role } from '@prisma/client';
import { of } from 'rxjs';
import { AcquirerFeesService } from '../acquirer-fees.service';
import type { JwtPayload } from '../../../infrastructure/security/strategies/jwt.strategy';

const admin = { sub: 'admin', authMode: 'user' } as JwtPayload;
const now = new Date('2026-01-01T00:00:00.000Z');
const fee = (acquirerCode: string, ratePpm: number) => ({
  id: `${acquirerCode}-${ratePpm}`,
  acquirerCode,
  method: 'PIX',
  channel: 'ONLINE',
  installments: 1,
  fixedCents: 0,
  ratePpm,
  interestPpm: 0,
  base: 'BUYER_TOTAL',
  source: 'MANUAL',
  createdAt: now,
});
const lane = () => ({
  active: true,
  contract: {
    fixedCents: 0,
    ratePpm: 0,
    cashbackCents: 0,
    interestPpm: 0,
    base: 'BUYER_TOTAL' as const,
    reference: 'test',
  },
  sim: { fixedCents: 0, ratePpm: 20_000, interestPpm: 0 },
});

function mockService(overrides: Record<string, unknown> = {}) {
  const created: Array<Record<string, unknown>> = [];
  const revisions: Array<Record<string, unknown>> = [];
  const tx = {
    acquirerCatalogue: {
      findUnique: async () => ({
        code: 'DOM',
        active: true,
        syncAdapter: 'DOM',
      }),
      findMany: async () => [{ code: 'DOM' }, { code: 'FRENDZ' }],
      update: async ({ data }: { data: unknown }) => data,
    },
    acquirerFeeSchedule: {
      findFirst: async () => fee('DOM', 100_000),
      findMany: async () => [fee('DOM', 100_000), fee('FRENDZ', 50_000)],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      },
    },
    financialPolicyRevision: {
      findMany: async () => [
        {
          tag: 'GLOBAL',
          version: 1,
          document: {
            schemaVersion: 1,
            lanes: { 'DOM/PIX/ONLINE/1': lane() },
            owner: {},
          },
        },
      ],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        revisions.push(data);
        return data;
      },
    },
    ...overrides,
  };
  const prisma = {
    user: {
      findUnique: async () => ({
        role: Role.ADMIN,
        isActive: true,
        isPurged: false,
      }),
    },
    $transaction: async (
      callback: (client: typeof tx) => Promise<unknown>,
      options: { isolationLevel: unknown },
    ) => {
      expect(options.isolationLevel).toBe(
        Prisma.TransactionIsolationLevel.Serializable,
      );
      return callback(tx);
    },
  };
  return {
    service: new AcquirerFeesService(prisma as never, {} as never),
    created,
    revisions,
  };
}

describe('acquirer fee service transactions', () => {
  test('deactivation snapshots every active provider and SIM before disabling', async () => {
    const { service, revisions } = mockService();
    await service.setActive(admin, 'DOM', false);
    expect(revisions).toHaveLength(1);
    const document = revisions[0]!.document as {
      lanes: Record<
        string,
        {
          priceFloor: {
            fees: Array<{ acquirer: string; ratePpm: number }>;
            sim: { ratePpm: number };
          };
        }
      >;
    };
    expect(
      document.lanes['DOM/PIX/ONLINE/1']!.priceFloor.fees.map((row) => [
        row.acquirer,
        row.ratePpm,
      ]),
    ).toEqual([
      ['DOM', 100_000],
      ['FRENDZ', 50_000],
    ]);
    expect(document.lanes['DOM/PIX/ONLINE/1']!.priceFloor.sim.ratePpm).toBe(
      20_000,
    );
  });

  test('manual fee saves classify increases and decreases and retain the old floor', async () => {
    const { service, created, revisions } = mockService();
    await service.save(admin, 'DOM', {
      method: 'PIX',
      channel: 'ONLINE',
      installments: 1,
      fixedCents: 0,
      ratePpm: 80_000,
      interestPpm: 0,
    });
    expect(created[0]?.changeDirection).toBe('DECREASE');
    expect(revisions).toHaveLength(1);
    const document = revisions[0]!.document as {
      lanes: Record<
        string,
        { priceFloor: { fees: Array<{ acquirer: string }> } }
      >;
    };
    expect(
      document.lanes['DOM/PIX/ONLINE/1']!.priceFloor.fees.map(
        (row) => row.acquirer,
      ),
    ).toEqual(['DOM', 'FRENDZ']);
    const increasing = mockService();
    await increasing.service.save(admin, 'DOM', {
      method: 'PIX',
      channel: 'ONLINE',
      installments: 1,
      fixedCents: 0,
      ratePpm: 120_000,
      interestPpm: 0,
    });
    expect(increasing.created[0]?.changeDirection).toBe('INCREASE');
    expect(increasing.revisions).toHaveLength(0);
  });
});

function physicalNegotiation() {
  const installments = Array.from({ length: 12 }, (_, index) => ({
    installment: index + 1,
    mdr: 3.99,
    interest_rate_our: index === 0 ? 0 : 4.31,
    effective_rate: index === 0 ? 3.99 : 8.3,
  }));
  return {
    negotiation: {
      credit: { fee_transaction: 1, installments },
      pix_online: { mdr: 0.98, fee_transaction: 1 },
      boleto: { mdr: 3.49, mdr_type: 'FIXED', fee_transaction: 1 },
      pix_physical: { negotiation: { mdr: 0, fee_transaction: 0 } },
      debit_physical: {
        fee_transaction: 0,
        brands: {
          VISA: { mdr: 3.99 },
          MASTERCARD: { mdr: 3.5 },
          OTHERS: { mdr: 3.5 },
        },
      },
      credit_physical: {
        fee_transaction: 0,
        installments: installments.map(({ installment, ...rates }) => ({
          installment,
          VISA: rates,
          OTHERS: rates,
          MASTERCARD: { mdr: 3.5, interest_rate_our: 0, effective_rate: 3.5 },
        })),
      },
    },
  };
}

function mockDomSync(response: unknown) {
  const schedules: Array<Record<string, unknown>> = [];
  let transactions = 0;
  const tx = {
    acquirerCatalogue: {
      findUnique: async () => ({
        code: 'DOM',
        active: true,
        syncAdapter: 'DOM',
      }),
    },
    acquirerFeeSchedule: {
      findMany: async () => [...schedules].reverse(),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: String(schedules.length), createdAt: now };
        schedules.push(row);
        return row;
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
      transactions++;
      return callback(tx);
    },
  };
  const http = { get: () => of({ data: response }) };
  return {
    service: new AcquirerFeesService(prisma as never, http as never),
    schedules,
    transactions: () => transactions,
  };
}

describe('DOM physical fee synchronization', () => {
  test('persists physical negotiation separately from online fees and is idempotent', async () => {
    const previousToken = process.env.DOM_TOKEN;
    process.env.DOM_TOKEN = 'local-test-token';
    try {
      const { service, schedules } = mockDomSync(physicalNegotiation());
      const first = await service.syncDom();
      expect(first.data.changed).toHaveLength(28);
      const physical = schedules.filter((row) => row.channel === 'POS');
      expect(physical).toHaveLength(14);
      expect(physical.find((row) => row.method === 'PIX')).toMatchObject({
        acquirerCode: 'DOM',
        channel: 'POS',
        installments: 1,
        fixedCents: 0,
        ratePpm: 0,
        interestPpm: 0,
        source: 'SYNC',
      });
      expect(physical.find((row) => row.method === 'DEBIT_CARD')).toMatchObject(
        {
          fixedCents: 0,
          ratePpm: 39_900,
          interestPpm: 0,
          source: 'SYNC',
        },
      );
      expect(
        physical.find(
          (row) => row.method === 'CREDIT_CARD' && row.installments === 2,
        ),
      ).toMatchObject({
        fixedCents: 0,
        ratePpm: 39_900,
        interestPpm: 43_100,
        source: 'SYNC',
      });
      expect(
        schedules.find(
          (row) =>
            row.channel === 'ONLINE' &&
            row.method === 'CREDIT_CARD' &&
            row.installments === 2,
        ),
      ).toMatchObject({ fixedCents: 100 });
      const second = await service.syncDom();
      expect(second.data.changed).toEqual([]);
      expect(schedules).toHaveLength(28);
    } finally {
      if (previousToken === undefined) delete process.env.DOM_TOKEN;
      else process.env.DOM_TOKEN = previousToken;
    }
  });

  test('rejects malformed physical rates before starting a transaction or writing online fees', async () => {
    const previousToken = process.env.DOM_TOKEN;
    process.env.DOM_TOKEN = 'local-test-token';
    try {
      const response = physicalNegotiation();
      response.negotiation.credit_physical.installments[11]!.VISA.effective_rate = 0;
      const { service, schedules, transactions } = mockDomSync(response);
      await expect(service.syncDom()).rejects.toThrow();
      expect(transactions()).toBe(0);
      expect(schedules).toEqual([]);
    } finally {
      if (previousToken === undefined) delete process.env.DOM_TOKEN;
      else process.env.DOM_TOKEN = previousToken;
    }
  });
});
