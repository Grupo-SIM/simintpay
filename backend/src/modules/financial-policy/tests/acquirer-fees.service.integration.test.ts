import { describe, expect, test } from 'bun:test';
import { Prisma, Role } from '@prisma/client';
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
