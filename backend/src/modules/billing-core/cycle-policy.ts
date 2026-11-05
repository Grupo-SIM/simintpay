import type { BillingIntervalType } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RETRY_DAYS = 3;
export const DEFAULT_GRACE_DAYS = 7;

/** Soma `count` intervalos de calendário (UTC) a uma data. */
export function advanceInterval(
  from: Date,
  type: BillingIntervalType,
  count: number,
): Date {
  const next = new Date(from);
  switch (type) {
    case 'DAY':
      next.setUTCDate(next.getUTCDate() + count);
      break;
    case 'WEEK':
      next.setUTCDate(next.getUTCDate() + 7 * count);
      break;
    case 'YEAR':
      next.setUTCFullYear(next.getUTCFullYear() + count);
      break;
    default:
      next.setUTCMonth(next.getUTCMonth() + count);
  }
  return next;
}

export type CycleSchedule = {
  intervalType: BillingIntervalType;
  intervalCount: number;
  /** Total de ciclos; 0 ou null = até cancelar. */
  repetitions: number | null;
  retryDays: number | null;
  graceDays: number | null;
};

export type ContractCycleState = {
  currentPeriodEnd: Date;
  pastDueAt: Date | null;
  retryCount: number;
};

export type ContractTransition = {
  status: 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'INACTIVE';
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  nextChargeAt: Date | null;
  pastDueAt: Date | null;
  suspendedAt?: Date | null;
  graceEndsAt: Date | null;
  retryCount: number;
};

/**
 * Efeito de um ciclo pago. `paidCycles` já inclui a cobrança que acabou de ser paga.
 * O novo período começa onde o anterior terminou, para que atraso no pagamento
 * não encurte nem estenda o acesso contratado.
 */
export function onCyclePaid(
  state: ContractCycleState,
  schedule: CycleSchedule,
  paidCycles: number,
  paidAt: Date,
): ContractTransition {
  // Primeira cobrança: o período começa quando o comprador efetivamente paga.
  const start = paidCycles === 1 ? paidAt : state.currentPeriodEnd;
  const end = advanceInterval(
    start,
    schedule.intervalType,
    schedule.intervalCount,
  );
  const finished =
    schedule.repetitions != null &&
    schedule.repetitions > 0 &&
    paidCycles >= schedule.repetitions;
  return {
    status: finished ? 'INACTIVE' : 'ACTIVE',
    currentPeriodStart: start,
    currentPeriodEnd: end,
    nextChargeAt: finished ? null : end,
    pastDueAt: null,
    suspendedAt: null,
    graceEndsAt: null,
    retryCount: 0,
  };
}

/** Efeito de uma tentativa que falhou: nova tentativa em `retryDays` até esgotar a carência. */
export function onCycleFailed(
  state: ContractCycleState,
  schedule: CycleSchedule,
  failedAt: Date,
): ContractTransition {
  const pastDueAt = state.pastDueAt ?? failedAt;
  const graceEndsAt = new Date(
    pastDueAt.getTime() + (schedule.graceDays ?? DEFAULT_GRACE_DAYS) * DAY_MS,
  );
  const retryAt = new Date(
    failedAt.getTime() + (schedule.retryDays ?? DEFAULT_RETRY_DAYS) * DAY_MS,
  );
  if (retryAt.getTime() > graceEndsAt.getTime()) {
    return {
      status: 'SUSPENDED',
      nextChargeAt: null,
      pastDueAt,
      suspendedAt: failedAt,
      graceEndsAt,
      retryCount: state.retryCount + 1,
    };
  }
  return {
    status: 'PAST_DUE',
    nextChargeAt: retryAt,
    pastDueAt,
    graceEndsAt,
    retryCount: state.retryCount + 1,
  };
}
