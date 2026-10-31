import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Channel, Method } from './financial-policy';

export type CostFloor = {
  method: Method;
  channel: 'ONLINE';
  installments: number;
  fixedCents: number;
  ratePpm: number;
};

type Client = Pick<
  Prisma.TransactionClient,
  'acquirerCatalogue' | 'acquirerFeeSchedule'
>;
export type AcquirerCost = {
  acquirer: string;
  fixedCents: number;
  ratePpm: number;
  interestPpm: number;
  base: 'ORIGINAL' | 'BUYER_TOTAL';
  source: string;
  createdAt: Date;
};
export type FeeInput = {
  method: Method;
  channel: Channel;
  installments: number;
  fixedCents: number;
  ratePpm: number;
  interestPpm: number;
  base?: 'ORIGINAL' | 'BUYER_TOTAL';
};

export function validateFee(input: FeeInput) {
  if (
    !['PIX', 'BOLETO', 'DEBIT_CARD', 'CREDIT_CARD'].includes(input.method) ||
    !['ONLINE', 'POS'].includes(input.channel) ||
    !Number.isInteger(input.installments) ||
    input.installments < 1 ||
    input.installments > 12 ||
    (input.method !== 'CREDIT_CARD' && input.installments !== 1) ||
    [input.fixedCents, input.ratePpm, input.interestPpm].some(
      (v) => !Number.isSafeInteger(v) || v < 0 || v > 1_000_000,
    ) ||
    (input.base !== undefined &&
      input.base !== 'ORIGINAL' &&
      input.base !== 'BUYER_TOTAL')
  )
    throw new BadRequestException('Taxa da adquirente inválida');
}

export async function listAcquirerFees(
  prisma: Client,
  method: Method,
  channel: Channel,
  installments: number,
): Promise<AcquirerCost[]> {
  const active = await prisma.acquirerCatalogue.findMany({
    where: { active: true },
    select: { code: true },
  });
  if (!active.length) return [];
  const rows = await prisma.acquirerFeeSchedule.findMany({
    where: {
      acquirerCode: { in: active.map((a) => a.code) },
      method,
      channel,
      installments,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const byCode = new Map<string, AcquirerCost>();
  for (const row of rows)
    if (!byCode.has(row.acquirerCode))
      byCode.set(row.acquirerCode, {
        acquirer: row.acquirerCode,
        fixedCents: row.fixedCents,
        ratePpm: row.ratePpm,
        interestPpm: row.interestPpm,
        base: row.base as AcquirerCost['base'],
        source: row.source,
        createdAt: row.createdAt,
      });
  return [...byCode.values()];
}

export function estimatedCost(
  fee: AcquirerCost,
  originalCents: number,
  buyerTotalCents: number,
) {
  const basis = fee.base === 'BUYER_TOTAL' ? buyerTotalCents : originalCents;
  return (
    fee.fixedCents +
    Math.round((basis * fee.ratePpm) / 1_000_000) +
    Math.round((originalCents * fee.interestPpm) / 1_000_000)
  );
}

export function orderByCost(
  fees: AcquirerCost[],
  originalCents: number,
  buyerTotalCents: number,
) {
  return [...fees].sort(
    (a, b) =>
      estimatedCost(a, originalCents, buyerTotalCents) -
        estimatedCost(b, originalCents, buyerTotalCents) ||
      a.acquirer.localeCompare(b.acquirer),
  );
}

/** Acquirer costs are global: the most expensive active acquirer per lane is the floor for every merchant. */
export async function acquirerCostFloor(prisma: Client): Promise<CostFloor[]> {
  const lanes: { method: Method; installments: number }[] = [
    { method: 'PIX', installments: 1 },
    { method: 'DEBIT_CARD', installments: 1 },
    ...Array.from({ length: 12 }, (_, i) => ({
      method: 'CREDIT_CARD' as Method,
      installments: i + 1,
    })),
  ];
  const floors = await Promise.all(
    lanes.map(async ({ method, installments }): Promise<CostFloor | null> => {
      const fees = await listAcquirerFees(
        prisma,
        method,
        'ONLINE',
        installments,
      );
      if (!fees.length) return null;
      return {
        method,
        channel: 'ONLINE',
        installments,
        fixedCents: Math.max(...fees.map((fee) => fee.fixedCents)),
        ratePpm: Math.max(...fees.map((fee) => fee.ratePpm + fee.interestPpm)),
      };
    }),
  );
  return floors.filter((floor): floor is CostFloor => floor !== null);
}
