import type { BillingContract, Charge, Offer, Prisma } from '@prisma/client';
import {
  advanceInterval,
  onCycleFailed,
  onCyclePaid,
  type CycleSchedule,
} from './cycle-policy';

export function scheduleOf(
  offer: Offer,
  contract: BillingContract,
): CycleSchedule {
  return {
    intervalType: offer.intervalType ?? contract.intervalType,
    intervalCount: offer.intervalCount ?? contract.intervalCount,
    repetitions: offer.repetitions,
    retryDays: offer.retryDays,
    graceDays: offer.graceDays,
  };
}

/** True for the Charge that reactivates a suspended/lapsed contract (snapshot flag `reactivation`). */
export function isReactivationCharge(
  charge: Pick<Charge, 'snapshot'>,
): boolean {
  const s = charge.snapshot as Record<string, unknown> | null;
  return !!s && typeof s === 'object' && s.reactivation === true;
}

/**
 * Moves the contract schedule after a charge was claimed PENDING->PAID/FAILED/EXPIRED.
 * Caller owns the transaction and must only call this for the claim winner. A contract that
 * never had a paid cycle (first charge refused or expired) is cancelled instead of past due.
 */
export async function advanceContractForCharge(
  tx: Prisma.TransactionClient,
  charge: Pick<Charge, 'contractId' | 'snapshot'>,
  outcome: 'PAID' | 'FAILED',
  now: Date,
): Promise<void> {
  if (!charge.contractId) return;
  const contract = await tx.billingContract.findUniqueOrThrow({
    where: { id: charge.contractId },
    include: { offer: true },
  });
  if (!contract.offer) return;
  const schedule = scheduleOf(contract.offer, contract);
  const state = {
    currentPeriodEnd: contract.currentPeriodEnd,
    pastDueAt: contract.pastDueAt,
    retryCount: contract.retryCount,
  };
  const paidCycles = await tx.charge.count({
    where: { contractId: contract.id, status: 'PAID' },
  });
  if (isReactivationCharge(charge)) {
    // A failed/expired reactivation leaves the suspended contract exactly as it was.
    if (outcome !== 'PAID') return;
    // The new period starts when the buyer paid (not at the old period end) and counts as a
    // paid cycle for `repetitions`.
    const end = advanceInterval(
      now,
      schedule.intervalType,
      schedule.intervalCount,
    );
    const finished =
      schedule.repetitions != null &&
      schedule.repetitions > 0 &&
      paidCycles >= schedule.repetitions;
    await tx.billingContract.update({
      where: { id: contract.id },
      data: {
        status: finished ? 'INACTIVE' : 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: end,
        nextChargeAt: finished ? null : end,
        pastDueAt: null,
        suspendedAt: null,
        graceEndsAt: null,
        accessEndsAt: null,
        retryCount: 0,
        version: { increment: 1 },
      },
    });
    return;
  }
  if (
    outcome === 'FAILED' &&
    contract.status === 'INACTIVE' &&
    paidCycles === 0
  ) {
    await tx.billingContract.update({
      where: { id: contract.id },
      data: {
        status: 'CANCELLED',
        nextChargeAt: null,
        accessEndsAt: now,
        version: { increment: 1 },
      },
    });
    return;
  }
  const next =
    outcome === 'PAID'
      ? onCyclePaid(state, schedule, paidCycles, now)
      : onCycleFailed(state, schedule, now);
  await tx.billingContract.update({
    where: { id: contract.id },
    data: {
      status: next.status,
      currentPeriodStart: next.currentPeriodStart,
      currentPeriodEnd: next.currentPeriodEnd,
      nextChargeAt: next.nextChargeAt,
      pastDueAt: next.pastDueAt,
      suspendedAt: next.suspendedAt,
      graceEndsAt: next.graceEndsAt,
      retryCount: next.retryCount,
      accessEndsAt: next.status === 'SUSPENDED' ? now : null,
      version: { increment: 1 },
    },
  });
}
