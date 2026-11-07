import { describe, expect, test } from 'bun:test';
import { parseDomNegotiation } from '../dom-negotiation';
import {
  calculateFinancials,
  emptyPolicy,
  laneKey,
  ownerResult,
  resolvePolicy,
} from '../financial-policy';
import {
  acquirerCostFloor,
  estimatedCost,
  orderByCost,
  validateFee,
  type AcquirerCost,
} from '../acquirer-fees';

const response = {
  user: { email: 'private@example.invalid', mfa_name: 'secret' },
  negotiation: {
    credit: {
      fee_transaction: 1,
      installments: Array.from({ length: 12 }, (_, i) => ({
        installment: i + 1,
        mdr: 3.99,
        fees: i === 0 ? 0 : 4.51,
        effective_rate: i === 0 ? 3.99 : 8.3,
        interest_rate_our: i === 0 ? 0 : 4.31,
      })),
    },
    pix_online: { mdr: 0.98, fee_transaction: 1 },
    boleto: { mdr: 3.49, mdr_type: 'FIXED', fee_transaction: 1 },
  },
};

describe('DOM negotiation import', () => {
  test('floors use latest active provider combined rates and independent fixed maxima', async () => {
    const imported = parseDomNegotiation(response).map((fee) => ({
      ...fee,
      acquirerCode: 'DOM',
      source: 'SYNC',
      createdAt: new Date('2026-10-01'),
      id: 'latest',
    }));
    const rows = [
      ...imported,
      ...imported.map((fee) => ({
        ...fee,
        id: 'older',
        createdAt: new Date('2026-09-01'),
        ratePpm: 900_000,
      })),
      ...imported.map((fee) => ({
        ...fee,
        acquirerCode: 'INACTIVE',
        ratePpm: 950_000,
      })),
      ...imported.map((fee) => ({
        ...fee,
        acquirerCode: 'OTHER',
        ratePpm: 60_000,
        interestPpm: 10_000,
        fixedCents: 250,
      })),
    ];
    const client = {
      acquirerCatalogue: {
        findMany: async ({ where }: { where: { active: boolean } }) => {
          expect(where).toEqual({ active: true });
          return [{ code: 'DOM' }, { code: 'OTHER' }];
        },
      },
      acquirerFeeSchedule: {
        findMany: async ({
          where,
          orderBy,
        }: {
          where: {
            acquirerCode: { in: string[] };
            method: string;
            channel: string;
            installments: number;
          };
          orderBy: unknown;
        }) => {
          expect(orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
          return rows
            .filter(
              (row) =>
                where.acquirerCode.in.includes(row.acquirerCode) &&
                row.method === where.method &&
                row.channel === where.channel &&
                row.installments === where.installments,
            )
            .sort(
              (a, b) =>
                b.createdAt.getTime() - a.createdAt.getTime() ||
                b.id.localeCompare(a.id),
            );
        },
      },
    } as unknown as Parameters<typeof acquirerCostFloor>[0];
    const floors = await acquirerCostFloor(client);
    for (const installments of [2, 6, 12]) {
      expect(
        floors.find(
          (fee) =>
            fee.method === 'CREDIT_CARD' && fee.installments === installments,
        ),
      ).toEqual({
        method: 'CREDIT_CARD',
        channel: 'ONLINE',
        installments,
        fixedCents: 250,
        ratePpm: 83_000,
      });
    }
    expect(
      floors.find(
        (fee) => fee.method === 'CREDIT_CARD' && fee.installments === 1,
      )?.ratePpm,
    ).toBe(70_000);
    // DOM has zero interest for PIX; OTHER's combined rate remains the floor.
    expect(floors.find((fee) => fee.method === 'PIX')?.ratePpm).toBe(70_000);
  });

  test('maps credit 1x, installment interest, PIX and fixed boleto without identity data', () => {
    const fees = parseDomNegotiation(response);
    expect(fees).toHaveLength(14);
    expect(fees[0]).toEqual({
      method: 'CREDIT_CARD',
      channel: 'ONLINE',
      installments: 1,
      fixedCents: 100,
      ratePpm: 39_900,
      interestPpm: 0,
      base: 'BUYER_TOTAL',
    });
    expect(fees[1]).toMatchObject({
      installments: 2,
      ratePpm: 39_900,
      interestPpm: 43_100,
    });
    expect(fees[12]).toMatchObject({
      method: 'PIX',
      fixedCents: 100,
      ratePpm: 9_800,
    });
    expect(fees[13]).toMatchObject({
      method: 'BOLETO',
      fixedCents: 449,
      ratePpm: 0,
    });
    expect(JSON.stringify(fees)).not.toContain('private@example.invalid');
    fees.forEach(validateFee);
  });

  test('rejects incomplete or inconsistent rates before persisting anything', () => {
    expect(() =>
      parseDomNegotiation({
        ...response,
        negotiation: {
          ...response.negotiation,
          credit: {
            ...response.negotiation.credit,
            installments: response.negotiation.credit.installments.slice(0, 11),
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseDomNegotiation({
        ...response,
        negotiation: {
          ...response.negotiation,
          credit: {
            ...response.negotiation.credit,
            installments: [
              {
                ...response.negotiation.credit.installments[0],
                effective_rate: 0,
              },
              ...response.negotiation.credit.installments.slice(1),
            ],
          },
        },
      }),
    ).toThrow();
  });

  test('orders acquirers by monetary cost, not raw percentages', () => {
    const base: AcquirerCost = {
      acquirer: 'DOM',
      fixedCents: 100,
      ratePpm: 39_900,
      interestPpm: 0,
      base: 'BUYER_TOTAL',
      source: 'SYNC',
      createdAt: new Date(),
    };
    const alternative = {
      ...base,
      acquirer: 'OTHER',
      fixedCents: 0,
      ratePpm: 45_000,
    };
    expect(
      orderByCost([alternative, base], 10_000, 10_000).map(
        (fee) => fee.acquirer,
      ),
    ).toEqual(['OTHER', 'DOM']);
    expect(estimatedCost(base, 10_000, 10_000)).toBe(499);
  });
});

test('simulation exposes synchronized DOM rates instead of a stale policy contract', () => {
  const document = emptyPolicy();
  const key = laneKey('DOM', 'CREDIT_CARD', 'ONLINE', 2);
  document.interestOnly = true;
  document.lanes[key] = {
    active: true,
    contract: {
      fixedCents: 100,
      ratePpm: 91500,
      interestPpm: 45100,
      cashbackCents: 0,
      base: 'BUYER_TOTAL',
      reference: 'Legacy',
    },
    sim: { fixedCents: 400, ratePpm: 90000, interestPpm: 35200 },
  };
  document.owner[key] = { fixedCents: 0, ratePpm: 0, passInterestPpm: 1000000 };
  const imported = parseDomNegotiation(response).find(
    (fee) => fee.method === 'CREDIT_CARD' && fee.installments === 2,
  )!;
  const result = calculateFinancials(
    resolvePolicy(document, emptyPolicy(), '1:0'),
    key,
    10000,
    undefined,
    {
      fees: [
        {
          ...imported,
          base: imported.base!,
          acquirer: 'DOM',
          source: 'SYNC',
          createdAt: new Date('2026-11-06').toISOString(),
        },
      ],
      routedAcquirer: 'DOM',
    },
  );
  expect(result.effectiveFees.acquirer?.ratePpm).toBe(39900);
  expect(result.effectiveFees.acquirer?.interestPpm).toBe(43100);
  expect(result.acquirerInterestCents).toBe(431);
  expect(result.simInterestCents).toBe(352);
  expect(result.buyerInterestCents).toBe(783);
  expect(ownerResult(result)).not.toHaveProperty('effectiveFees');
  expect(document.lanes[key]!.contract.interestPpm).toBe(45100);
});

test('effective interest includes the SimIntPay residual preserved by a historical floor', () => {
  const key = laneKey('DOM', 'CREDIT_CARD', 'ONLINE', 2);
  const document = emptyPolicy();
  document.interestOnly = true;
  document.owner[key] = { fixedCents: 0, ratePpm: 0, passInterestPpm: 1000000 };
  const current = {
    acquirer: 'DOM',
    fixedCents: 100,
    ratePpm: 39900,
    interestPpm: 43100,
    base: 'BUYER_TOTAL' as const,
    source: 'SYNC',
    createdAt: new Date('2026-11-06').toISOString(),
  };
  document.lanes[key] = {
    active: true,
    contract: {
      ...current,
      interestPpm: 45100,
      cashbackCents: 0,
      reference: 'Legacy',
    },
    sim: { fixedCents: 400, ratePpm: 90000, interestPpm: 35200 },
    priceFloor: {
      fees: [{ ...current, ratePpm: 91500, interestPpm: 45100 }],
      sim: { fixedCents: 400, ratePpm: 90000, interestPpm: 35200 },
    },
  };
  const result = calculateFinancials(
    resolvePolicy(document, emptyPolicy(), '1:0'),
    key,
    10000,
    undefined,
    { fees: [current], routedAcquirer: 'DOM' },
  );
  expect(result.effectiveFees.priceFloorApplied).toBe(true);
  expect(result.effectiveFees.acquirer?.interestPpm).toBe(43100);
  expect(result.effectiveFees.sim.interestPpm).toBe(37200);
  expect(result.simInterestCents).toBe(372);
  expect(result).toMatchObject({
    buyerTotalCents: 10803,
    buyerAdditionCents: 0,
    buyerInterestCents: 803,
    acquirerProcessingCents: 531,
    acquirerInterestCents: 431,
  });
});

test('current scheduled PIX deducts additions without grossing up processor costs', () => {
  const key = laneKey('DOM', 'PIX', 'ONLINE', 1);
  const document = emptyPolicy();
  document.interestOnly = true;
  document.lanes[key] = {
    active: true,
    contract: {
      fixedCents: 0,
      ratePpm: 9800,
      interestPpm: 0,
      cashbackCents: 0,
      base: 'BUYER_TOTAL',
      reference: 'Legacy',
    },
    sim: { fixedCents: 800, ratePpm: 90000, interestPpm: 0 },
  };
  const result = calculateFinancials(
    resolvePolicy(document, emptyPolicy(), '1:0'),
    key,
    10000,
    undefined,
    {
      fees: [
        {
          acquirer: 'DOM',
          fixedCents: 100,
          ratePpm: 9800,
          interestPpm: 0,
          base: 'BUYER_TOTAL',
          source: 'SYNC',
          createdAt: new Date('2026-11-06').toISOString(),
        },
      ],
      routedAcquirer: 'DOM',
    },
  );
  expect(result).toMatchObject({
    buyerTotalCents: 10000,
    buyerAdditionCents: 0,
    acquirerProcessingCents: 198,
    simAdditionCents: 1700,
    netCents: 8102,
  });
});
