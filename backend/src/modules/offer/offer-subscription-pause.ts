import type { BillingContract } from '@prisma/client';
import { advanceInterval } from '../billing-core/cycle-policy';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dias inteiros (arredondados para cima) que faltam no período; zero ou negativo = vencido. */
export function remainingDaysOf(periodEnd: Date, now: Date): number {
  return Math.ceil((periodEnd.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Período do contrato ao retomar: os dias guardados na pausa contam a partir de agora, e a
 * próxima cobrança acompanha o novo fim. O início nunca fica depois do fim.
 */
export function resumedPeriod(
  contract: Pick<
    BillingContract,
    | 'currentPeriodStart'
    | 'intervalType'
    | 'intervalCount'
    | 'pausedRemainingDays'
  >,
  now: Date,
): { currentPeriodStart: Date; currentPeriodEnd: Date } {
  const remaining = contract.pausedRemainingDays ?? 0;
  const currentPeriodEnd = new Date(now.getTime() + remaining * DAY_MS);
  const fullStart = advanceInterval(
    currentPeriodEnd,
    contract.intervalType,
    -contract.intervalCount,
  );
  return { currentPeriodStart: fullStart, currentPeriodEnd };
}

export type SubscriberStatusGroup = 'active' | 'paused' | 'deactivated';

export const SUBSCRIBER_STATUS_GROUPS: Record<
  SubscriberStatusGroup,
  BillingContract['status'][]
> = {
  active: ['ACTIVE', 'PAST_DUE'],
  paused: ['PAUSED'],
  deactivated: ['SUSPENDED', 'INACTIVE', 'CANCELLED'],
};
