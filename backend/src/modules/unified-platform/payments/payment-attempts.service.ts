import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Acquirer,
  PaymentAttemptStatus,
  TransactionStatus,
  Prisma,
  type PaymentAttempt,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

export type AttemptReservation =
  | { kind: 'reserved'; attempt: PaymentAttempt }
  | { kind: 'blocked'; attempt: PaymentAttempt }
  | { kind: 'transaction_blocked'; status: TransactionStatus };
export type AttemptClaim =
  | { kind: 'claimed'; attempt: PaymentAttempt; leaseToken: string }
  | { kind: 'blocked'; attempt: PaymentAttempt };
export type RetryEligibility =
  | { kind: 'eligible'; nextSequence: number }
  | { kind: 'blocked'; attempt: PaymentAttempt }
  | { kind: 'transaction_blocked'; status: TransactionStatus };
export type CorrelatedAttemptResult =
  | { kind: 'updated'; attempt: PaymentAttempt }
  | { kind: 'blocked'; attempt: PaymentAttempt }
  | {
      kind: 'incident';
      attempt: PaymentAttempt;
      reason: 'SUCCESS_AFTER_RETRYABLE_FAILURE';
    }
  | { kind: 'not_found' };
export type CorrelatedAttemptEvidence = {
  transactionId: string;
  provider: Acquirer;
  providerPaymentId?: string;
  externalReference?: string;
  outcome: 'SUCCEEDED' | 'FAILED';
  evidence: Prisma.InputJsonValue;
};

/**
 * An attempt is a durable record of permission to make one provider POST. A lease
 * identifies its owner, but its expiry NEVER grants permission for a second POST.
 * Only proof that the provider did not create a payment makes another attempt safe.
 */
@Injectable()
export class PaymentAttemptsService {
  constructor(private readonly prisma: PrismaService) {}

  private async quarantineExpired(
    db: Prisma.TransactionClient,
    transactionId: string,
  ): Promise<void> {
    await db.paymentAttempt.updateMany({
      where: {
        transactionId,
        status: PaymentAttemptStatus.DISPATCHING,
        leaseExpiresAt: { lt: new Date() },
      },
      data: {
        status: PaymentAttemptStatus.UNKNOWN,
        evidence: {
          reason: 'dispatch_lease_expired',
          requiresReconciliation: true,
        },
      },
    });
  }

  /** Locks the parent transaction so concurrent reservations cannot allocate the same sequence. */
  async reserve(
    transactionId: string,
    provider: Acquirer,
  ): Promise<AttemptReservation> {
    return this.prisma.$transaction(async (db) => {
      const rows = await db.$queryRaw<
        { id: string; status: TransactionStatus }[]
      >`
        SELECT id, status FROM "Transaction" WHERE id = ${transactionId} FOR UPDATE
      `;
      if (!rows.length) throw new NotFoundException('Transaction not found');
      if (rows[0].status !== TransactionStatus.DRAFT)
        return { kind: 'transaction_blocked', status: rows[0].status };
      await this.quarantineExpired(db, transactionId);
      const latest = await db.paymentAttempt.findFirst({
        where: { transactionId },
        orderBy: { sequence: 'desc' },
      });
      if (
        latest &&
        latest.status !== PaymentAttemptStatus.PRE_CREATION_FAILED &&
        latest.status !== PaymentAttemptStatus.TERMINAL_NONPAYABLE
      )
        return { kind: 'blocked', attempt: latest };
      const sequence = (latest?.sequence ?? 0) + 1;
      const attempt = await db.paymentAttempt.create({
        data: {
          transactionId,
          provider,
          sequence,
          externalReference: `pay_${transactionId}_${sequence}`,
          status: PaymentAttemptStatus.RESERVED,
        },
      });
      return { kind: 'reserved', attempt };
    });
  }

  /** A caller must persist this claim before performing any external POST. */
  async claimDispatch(attemptId: string): Promise<AttemptClaim> {
    const leaseToken = randomUUID();
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException('Payment attempt not found');
    const result = await this.prisma.paymentAttempt.updateMany({
      where: { id: attemptId, status: PaymentAttemptStatus.RESERVED },
      data: {
        status: PaymentAttemptStatus.DISPATCHING,
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    const current = await this.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    return result.count === 1
      ? { kind: 'claimed', attempt: current, leaseToken }
      : { kind: 'blocked', attempt: current };
  }

  /** Breaker rejection before claiming the attempt: no provider POST was possible. */
  async markReservedPreDispatchFailed(
    attemptId: string,
    evidence: Prisma.InputJsonValue,
  ): Promise<boolean> {
    const result = await this.prisma.paymentAttempt.updateMany({
      where: { id: attemptId, status: PaymentAttemptStatus.RESERVED },
      data: { status: PaymentAttemptStatus.PRE_CREATION_FAILED, evidence },
    });
    return result.count === 1;
  }

  /** Requires affirmative evidence that the upstream did NOT create a payment. */
  async markPreCreationFailed(
    attemptId: string,
    leaseToken: string,
    evidence: Prisma.InputJsonValue,
  ): Promise<boolean> {
    return this.transition(
      attemptId,
      leaseToken,
      PaymentAttemptStatus.PRE_CREATION_FAILED,
      evidence,
    );
  }

  async markUnknown(
    attemptId: string,
    leaseToken: string,
    evidence: Prisma.InputJsonValue,
  ): Promise<boolean> {
    return this.transition(
      attemptId,
      leaseToken,
      PaymentAttemptStatus.UNKNOWN,
      evidence,
    );
  }

  async recordProviderResponse(
    attemptId: string,
    leaseToken: string,
    response: {
      status: 'ACCEPTED' | 'SUCCEEDED' | 'FAILED';
      providerPaymentId?: string;
      evidence: Prisma.InputJsonValue;
    },
  ): Promise<boolean> {
    if (
      (response.status === 'ACCEPTED' || response.status === 'SUCCEEDED') &&
      !response.providerPaymentId?.trim()
    )
      return false;
    const result = await this.prisma.paymentAttempt.updateMany({
      // Late evidence can resolve an expired lease's UNKNOWN quarantine, but
      // UNKNOWN never grants permission to dispatch a new payment.
      where: {
        id: attemptId,
        status: {
          in: [PaymentAttemptStatus.DISPATCHING, PaymentAttemptStatus.UNKNOWN],
        },
        leaseToken,
      },
      data: {
        status: response.status,
        providerPaymentId: response.providerPaymentId,
        evidence: response.evidence,
        leaseExpiresAt: null,
      },
    });
    return result.count === 1;
  }

  private async transition(
    attemptId: string,
    leaseToken: string,
    status: PaymentAttemptStatus,
    evidence: Prisma.InputJsonValue,
  ): Promise<boolean> {
    const result = await this.prisma.paymentAttempt.updateMany({
      where: {
        id: attemptId,
        status: PaymentAttemptStatus.DISPATCHING,
        leaseToken,
      },
      data: { status, evidence, leaseExpiresAt: null },
    });
    return result.count === 1;
  }

  /**
   * Reconciliation/webhook transitions are tied to an already-known provider ID
   * or an exact attempt reference, never to a transaction or provider alone.
   * They do not depend on a (possibly expired) dispatch lease. Generic FAILED is
   * deliberately not retryable. This API cannot unlock retry: neither a known
   * local reference nor a bare webhook status proves remote non-creation or
   * irreversible nonpayment. The caller must supply sanitized provider evidence.
   */
  async resolveCorrelated(
    input: CorrelatedAttemptEvidence,
  ): Promise<CorrelatedAttemptResult> {
    if (
      (!input.providerPaymentId && !input.externalReference) ||
      (input.providerPaymentId !== undefined && !input.providerPaymentId.trim())
    )
      return { kind: 'not_found' };
    // An exact attempt reference can bind the provider ID before the original
    // dispatching worker records its response. A payment ID alone cannot bind
    // an unrecorded attempt: only an already-matching ID can identify it.
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        transactionId: input.transactionId,
        provider: input.provider,
        ...(input.externalReference
          ? { externalReference: input.externalReference }
          : { providerPaymentId: input.providerPaymentId }),
      },
    });
    if (!attempt) return { kind: 'not_found' };
    if (
      input.providerPaymentId &&
      attempt.providerPaymentId &&
      attempt.providerPaymentId !== input.providerPaymentId
    )
      return { kind: 'blocked', attempt };
    // This contradicts the authoritative evidence that unlocked a later charge.
    // Do not overwrite the audit record or silently treat this as an ordinary
    // replay: the caller must raise an incident and investigate possible double pay.
    if (
      input.outcome === 'SUCCEEDED' &&
      (attempt.status === PaymentAttemptStatus.TERMINAL_NONPAYABLE ||
        attempt.status === PaymentAttemptStatus.PRE_CREATION_FAILED)
    )
      return {
        kind: 'incident',
        attempt,
        reason: 'SUCCESS_AFTER_RETRYABLE_FAILURE',
      };
    // A created provider payment cannot later be called a pre-creation failure.
    if (
      attempt.status === PaymentAttemptStatus.SUCCEEDED ||
      attempt.status === PaymentAttemptStatus.PRE_CREATION_FAILED ||
      attempt.status === PaymentAttemptStatus.TERMINAL_NONPAYABLE
    )
      return { kind: 'blocked', attempt };
    const eligibleStatuses =
      input.outcome === 'FAILED'
        ? [
            PaymentAttemptStatus.DISPATCHING,
            PaymentAttemptStatus.UNKNOWN,
            PaymentAttemptStatus.ACCEPTED,
          ]
        : [
            PaymentAttemptStatus.DISPATCHING,
            PaymentAttemptStatus.UNKNOWN,
            PaymentAttemptStatus.ACCEPTED,
            PaymentAttemptStatus.FAILED,
          ];
    const result = await this.prisma.paymentAttempt.updateMany({
      where: {
        id: attempt.id,
        transactionId: input.transactionId,
        provider: input.provider,
        ...(input.externalReference && {
          externalReference: input.externalReference,
        }),
        ...(input.providerPaymentId && {
          providerPaymentId: attempt.providerPaymentId ?? null,
        }),
        status: { in: eligibleStatuses },
      },
      data: {
        status: input.outcome,
        ...(input.providerPaymentId && {
          providerPaymentId: input.providerPaymentId,
        }),
        evidence: input.evidence,
        leaseExpiresAt: null,
      },
    });
    const current = await this.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    return result.count === 1
      ? { kind: 'updated', attempt: current }
      : { kind: 'blocked', attempt: current };
  }

  async inspectRetryEligibility(
    transactionId: string,
  ): Promise<RetryEligibility> {
    return this.prisma.$transaction(async (db) => {
      const rows = await db.$queryRaw<
        { id: string; status: TransactionStatus }[]
      >`
        SELECT id, status FROM "Transaction" WHERE id = ${transactionId} FOR UPDATE
      `;
      if (!rows.length) throw new NotFoundException('Transaction not found');
      if (rows[0].status !== TransactionStatus.DRAFT)
        return { kind: 'transaction_blocked', status: rows[0].status };
      await this.quarantineExpired(db, transactionId);
      const latest = await db.paymentAttempt.findFirst({
        where: { transactionId },
        orderBy: { sequence: 'desc' },
      });
      if (
        latest &&
        latest.status !== PaymentAttemptStatus.PRE_CREATION_FAILED &&
        latest.status !== PaymentAttemptStatus.TERMINAL_NONPAYABLE
      )
        return { kind: 'blocked', attempt: latest };
      return { kind: 'eligible', nextSequence: (latest?.sequence ?? 0) + 1 };
    });
  }
}
