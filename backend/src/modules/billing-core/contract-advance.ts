import type { BillingContract, Charge, Offer, Prisma } from '@prisma/client';
import { onCycleFailed, onCyclePaid, type CycleSchedule } from './cycle-policy';

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

/**
 * Moves the contract schedule after a charge was claimed PENDING->PAID/FAILED/EXPIRED.
 * Caller owns the transaction and must only call this for the claim winner. A contract that
 * never had a paid cycle (first charge refused or expired) is cancelled instead of past due.
 */
export async function advanceContractForCharge(
  tx: Prisma.TransactionClient,
  charge: Pick<Charge, 'contractId'>,
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
