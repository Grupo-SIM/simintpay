import { Prisma } from '@prisma/client';

export type ProrationInput = {
  baseAmount: Prisma.Decimal.Value;
  unitAmount: Prisma.Decimal.Value;
  previousQuantity: number;
  targetQuantity: number;
  periodStart: Date;
  periodEnd: Date;
  effectiveAt: Date;
};

export type ProrationResult = {
  previousRecurringAmount: Prisma.Decimal;
  nextRecurringAmount: Prisma.Decimal;
  remainingRatio: Prisma.Decimal;
  prorationAmount: Prisma.Decimal;
};

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

function assertQuantity(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} deve ser um inteiro não negativo`);
  }
}

/**
 * Calcula o ajuste temporal usando a duração real do período em milissegundos.
 * A função é pura: não consulta relógio, banco, gateway ou domínio consumidor.
 */
export function calculateProration(input: ProrationInput): ProrationResult {
  assertQuantity(input.previousQuantity, 'previousQuantity');
  assertQuantity(input.targetQuantity, 'targetQuantity');

  const startMs = input.periodStart.getTime();
  const endMs = input.periodEnd.getTime();
  const effectiveMs = input.effectiveAt.getTime();
  if (![startMs, endMs, effectiveMs].every(Number.isFinite)) {
    throw new Error('Datas do período são inválidas');
  }
  if (endMs <= startMs) {
    throw new Error('periodEnd deve ser posterior a periodStart');
  }

  const base = new Prisma.Decimal(input.baseAmount);
  const unit = new Prisma.Decimal(input.unitAmount);
  if (base.isNegative() || unit.isNegative()) {
    throw new Error('Valores de preço não podem ser negativos');
  }

  const previousRecurringAmount = base
    .plus(unit.times(input.previousQuantity))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const nextRecurringAmount = base
    .plus(unit.times(input.targetQuantity))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const remainingMs = Math.max(
    0,
    Math.min(endMs - startMs, endMs - effectiveMs),
  );
  let remainingRatio = new Prisma.Decimal(remainingMs).div(endMs - startMs);
  if (remainingRatio.lessThan(ZERO)) remainingRatio = ZERO;
  if (remainingRatio.greaterThan(ONE)) remainingRatio = ONE;
  remainingRatio = remainingRatio.toDecimalPlaces(
    10,
    Prisma.Decimal.ROUND_HALF_UP,
  );

  const prorationAmount = nextRecurringAmount
    .minus(previousRecurringAmount)
    .times(remainingRatio)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  return {
    previousRecurringAmount,
    nextRecurringAmount,
    remainingRatio,
    prorationAmount,
  };
}

export function advanceBillingPeriod(
  start: Date,
  intervalType: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR',
  intervalCount: number,
): Date {
  if (!Number.isSafeInteger(intervalCount) || intervalCount < 1) {
    throw new Error('intervalCount deve ser um inteiro positivo');
  }
  const next = new Date(start.getTime());
  switch (intervalType) {
    case 'DAY':
      next.setUTCDate(next.getUTCDate() + intervalCount);
      break;
    case 'WEEK':
      next.setUTCDate(next.getUTCDate() + intervalCount * 7);
      break;
    case 'YEAR': {
      const originalMonth = next.getUTCMonth();
      const originalDay = next.getUTCDate();
      next.setUTCDate(1);
      next.setUTCFullYear(next.getUTCFullYear() + intervalCount);
      next.setUTCMonth(originalMonth);
      const lastDay = new Date(
        Date.UTC(next.getUTCFullYear(), originalMonth + 1, 0),
      ).getUTCDate();
      next.setUTCDate(Math.min(originalDay, lastDay));
      break;
    }
    case 'MONTH':
    default: {
      const originalDay = next.getUTCDate();
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + intervalCount);
      const lastDay = new Date(
        Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
      ).getUTCDate();
      next.setUTCDate(Math.min(originalDay, lastDay));
      break;
    }
  }
  return next;
}

export function retreatBillingPeriod(
  end: Date,
  intervalType: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR',
  intervalCount: number,
): Date {
  if (!Number.isSafeInteger(intervalCount) || intervalCount < 1) {
    throw new Error('intervalCount deve ser um inteiro positivo');
  }
  const previous = new Date(end.getTime());
  switch (intervalType) {
    case 'DAY':
      previous.setUTCDate(previous.getUTCDate() - intervalCount);
      break;
    case 'WEEK':
      previous.setUTCDate(previous.getUTCDate() - intervalCount * 7);
      break;
    case 'YEAR': {
      const originalMonth = previous.getUTCMonth();
      const originalDay = previous.getUTCDate();
      previous.setUTCDate(1);
      previous.setUTCFullYear(previous.getUTCFullYear() - intervalCount);
      previous.setUTCMonth(originalMonth);
      const lastDay = new Date(
        Date.UTC(previous.getUTCFullYear(), originalMonth + 1, 0),
      ).getUTCDate();
      previous.setUTCDate(Math.min(originalDay, lastDay));
      break;
    }
    case 'MONTH':
    default: {
      const originalDay = previous.getUTCDate();
      previous.setUTCDate(1);
      previous.setUTCMonth(previous.getUTCMonth() - intervalCount);
      const lastDay = new Date(
        Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth() + 1, 0),
      ).getUTCDate();
      previous.setUTCDate(Math.min(originalDay, lastDay));
      break;
    }
  }
  return previous;
}
