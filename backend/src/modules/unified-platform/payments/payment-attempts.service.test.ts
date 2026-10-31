import { describe, expect, mock, test } from 'bun:test';
import {
  Acquirer,
  PaymentAttemptStatus,
  TransactionStatus,
} from '@prisma/client';
import { PaymentAttemptsService } from './payment-attempts.service';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

function fixture(status: PaymentAttemptStatus = PaymentAttemptStatus.RESERVED) {
  const attempt = {
    id: 'attempt-1',
    transactionId: 'transaction-1',
    sequence: 1,
    externalReference: 'pay_transaction-1_1',
    provider: Acquirer.DOM,
    status,
    leaseToken: null,
    leaseExpiresAt: null,
    evidence: null,
  };
  const db = {
    $queryRaw: mock(async () => [
      { id: 'transaction-1', status: TransactionStatus.DRAFT },
    ]),
    paymentAttempt: {
      findFirst: mock(async () => attempt),
      create: mock(async ({ data }: { data: object }) => ({
        ...attempt,
        ...data,
      })),
      findUnique: mock(async () => attempt),
      findUniqueOrThrow: mock(async () => attempt),
      updateMany: mock(async () => ({ count: 1 })),
    },
  };
  const prisma = {
    ...db,
    $transaction: async (callback: (client: typeof db) => Promise<unknown>) =>
      callback(db),
  };
  return {
    service: new PaymentAttemptsService(prisma as unknown as PrismaService),
    db,
  };
}

describe('durable payment attempts', () => {
  test('blocks a replay when a provider dispatch is already uncertain', async () => {
    const { service, db } = fixture(PaymentAttemptStatus.DISPATCHING);
    expect((await service.reserve('transaction-1', Acquirer.FRENDZ)).kind).toBe(
      'blocked',
    );
    expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });

  test('allocates an immutable distinct reference only after proven pre-creation failure', async () => {
    const { service, db } = fixture(PaymentAttemptStatus.PRE_CREATION_FAILED);
    const result = await service.reserve('transaction-1', Acquirer.FRENDZ);
    expect(result.kind).toBe('reserved');
    expect(db.paymentAttempt.create).toHaveBeenCalledWith({
      data: {
        transactionId: 'transaction-1',
        provider: Acquirer.FRENDZ,
        sequence: 2,
        externalReference: 'pay_transaction-1_2',
        status: PaymentAttemptStatus.RESERVED,
      },
    });
  });

  test('terminal nonpayable evidence unlocks the next attempt, generic failure does not', async () => {
    const terminal = fixture(PaymentAttemptStatus.TERMINAL_NONPAYABLE);
    expect(
      (await terminal.service.reserve('transaction-1', Acquirer.FRENDZ)).kind,
    ).toBe('reserved');
    const generic = fixture(PaymentAttemptStatus.FAILED);
    expect(
      (await generic.service.reserve('transaction-1', Acquirer.FRENDZ)).kind,
    ).toBe('blocked');
  });

  test('correlated evidence requires an exact identifier and provider', async () => {
    const { service, db } = fixture(PaymentAttemptStatus.UNKNOWN);
    const base = {
      transactionId: 'transaction-1',
      provider: Acquirer.DOM,
      outcome: 'SUCCEEDED' as const,
      evidence: { reason: 'confirmed_paid' },
    };
    expect((await service.resolveCorrelated(base)).kind).toBe('not_found');
    expect(db.paymentAttempt.findFirst).not.toHaveBeenCalled();
    await service.resolveCorrelated({
      ...base,
      providerPaymentId: 'provider-1',
      externalReference: 'pay_transaction-1_1',
    });
    expect(db.paymentAttempt.findFirst).toHaveBeenCalledWith({
      where: {
        transactionId: 'transaction-1',
        provider: Acquirer.DOM,
        externalReference: 'pay_transaction-1_1',
      },
    });
    expect(db.paymentAttempt.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'attempt-1',
        provider: Acquirer.DOM,
        providerPaymentId: null,
        externalReference: 'pay_transaction-1_1',
        status: { in: expect.arrayContaining([PaymentAttemptStatus.UNKNOWN]) },
      }),
      data: {
        status: 'SUCCEEDED',
        providerPaymentId: 'provider-1',
        evidence: base.evidence,
        leaseExpiresAt: null,
      },
    });
  });

  test('cannot reverse success or claim no-creation after a provider payment exists', async () => {
    const successful = fixture(PaymentAttemptStatus.SUCCEEDED);
    const input = {
      transactionId: 'transaction-1',
      provider: Acquirer.DOM,
      externalReference: 'pay_transaction-1_1',
      evidence: { reason: 'authoritative' },
    };
    expect(
      (
        await successful.service.resolveCorrelated({
          ...input,
          outcome: 'FAILED',
        })
      ).kind,
    ).toBe('blocked');
    expect(successful.db.paymentAttempt.updateMany).not.toHaveBeenCalled();
    const created = fixture(PaymentAttemptStatus.UNKNOWN);
    created.db.paymentAttempt.findFirst.mockResolvedValueOnce({
      ...(await created.db.paymentAttempt.findFirst()),
      providerPaymentId: 'provider-1',
    });
    expect(
      (
        await created.service.resolveCorrelated({
          ...input,
          outcome: 'FAILED',
          providerPaymentId: 'another-payment',
        })
      ).kind,
    ).toBe('blocked');
  });

  test('reports an incident when success contradicts terminal nonpayable evidence', async () => {
    const { service, db } = fixture(PaymentAttemptStatus.TERMINAL_NONPAYABLE);
    const result = await service.resolveCorrelated({
      transactionId: 'transaction-1',
      provider: Acquirer.DOM,
      externalReference: 'pay_transaction-1_1',
      outcome: 'SUCCEEDED',
      evidence: { reason: 'provider_confirmed_paid' },
    });
    expect(result).toMatchObject({
      kind: 'incident',
      reason: 'SUCCESS_AFTER_RETRYABLE_FAILURE',
    });
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });

  test('terminal transactions cannot reserve or become retry-eligible', async () => {
    const { service, db } = fixture(PaymentAttemptStatus.PRE_CREATION_FAILED);
    db.$queryRaw.mockResolvedValue([
      { id: 'transaction-1', status: TransactionStatus.FAILED },
    ]);
    expect(await service.reserve('transaction-1', Acquirer.FRENDZ)).toEqual({
      kind: 'transaction_blocked',
      status: TransactionStatus.FAILED,
    });
    expect(await service.inspectRetryEligibility('transaction-1')).toEqual({
      kind: 'transaction_blocked',
      status: TransactionStatus.FAILED,
    });
    expect(db.paymentAttempt.create).not.toHaveBeenCalled();
  });

  test('cannot correlate another provider ID to an already-bound attempt', async () => {
    const { service, db } = fixture(PaymentAttemptStatus.UNKNOWN);
    db.paymentAttempt.findFirst.mockResolvedValueOnce({
      ...(await db.paymentAttempt.findFirst()),
      providerPaymentId: 'existing-id',
    });
    const result = await service.resolveCorrelated({
      transactionId: 'transaction-1',
      provider: Acquirer.DOM,
      externalReference: 'pay_transaction-1_1',
      providerPaymentId: 'different-id',
      outcome: 'SUCCEEDED',
      evidence: { reason: 'confirmed' },
    });
    expect(result.kind).toBe('blocked');
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });

  test('claim is conditional on RESERVED and does not reclaim a lease', async () => {
    const { service, db } = fixture(PaymentAttemptStatus.RESERVED);
    await service.claimDispatch('attempt-1');
    expect(db.paymentAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: PaymentAttemptStatus.RESERVED },
      data: {
        status: PaymentAttemptStatus.DISPATCHING,
        leaseToken: expect.any(String),
        leaseExpiresAt: expect.any(Date),
      },
    });
    db.paymentAttempt.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await service.claimDispatch('attempt-1')).kind).toBe('blocked');
  });

  test('breaker rejection marks only RESERVED attempts as pre-dispatch failures', async () => {
    const { service, db } = fixture(PaymentAttemptStatus.RESERVED);
    const evidence = { reason: 'circuit_open' };
    expect(
      await service.markReservedPreDispatchFailed('attempt-1', evidence),
    ).toBe(true);
    expect(db.paymentAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: PaymentAttemptStatus.RESERVED },
      data: { status: PaymentAttemptStatus.PRE_CREATION_FAILED, evidence },
    });
    db.paymentAttempt.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(
      await service.markReservedPreDispatchFailed('attempt-1', evidence),
    ).toBe(false);
  });

  test('accepted provider responses require a nonblank payment ID', async () => {
    const { service, db } = fixture(PaymentAttemptStatus.DISPATCHING);
    expect(
      await service.recordProviderResponse('attempt-1', 'lease', {
        status: 'ACCEPTED',
        evidence: { reason: 'provider_answered' },
      }),
    ).toBe(false);
    expect(
      await service.recordProviderResponse('attempt-1', 'lease', {
        status: 'SUCCEEDED',
        providerPaymentId: ' ',
        evidence: { reason: 'provider_answered' },
      }),
    ).toBe(false);
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });

  test('definitive failure requires the dispatch token and leaves evidence', async () => {
    const { service, db } = fixture(PaymentAttemptStatus.DISPATCHING);
    const evidence = { reason: 'provider_rejected_before_creation' };
    await service.markPreCreationFailed('attempt-1', 'lease-1', evidence);
    expect(db.paymentAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'attempt-1',
        status: PaymentAttemptStatus.DISPATCHING,
        leaseToken: 'lease-1',
      },
      data: {
        status: PaymentAttemptStatus.PRE_CREATION_FAILED,
        evidence,
        leaseExpiresAt: null,
      },
    });
  });

  test('expired dispatch becomes UNKNOWN, never eligible for retry', async () => {
    const { service, db } = fixture(PaymentAttemptStatus.UNKNOWN);
    expect((await service.inspectRetryEligibility('transaction-1')).kind).toBe(
      'blocked',
    );
    expect(db.paymentAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        transactionId: 'transaction-1',
        status: PaymentAttemptStatus.DISPATCHING,
        leaseExpiresAt: { lt: expect.any(Date) },
      },
      data: {
        status: PaymentAttemptStatus.UNKNOWN,
        evidence: {
          reason: 'dispatch_lease_expired',
          requiresReconciliation: true,
        },
      },
    });
  });
});
