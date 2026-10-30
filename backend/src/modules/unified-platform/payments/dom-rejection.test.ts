import { describe, expect, it } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import {
  CircuitOpenException,
  CircuitUnavailableException,
} from '../../../infrastructure/resilience/payment-circuit-breaker';
import { PlatformPaymentExecution } from './platform-payment-execution';
import {
  classifyChargeOutcome,
  discardDraftOnRejection,
  isDefinitiveDomRejection,
  isDefinitiveDomStatus,
  markChargeAttempt,
  markDefinitiveDomRejection,
  markPreDispatchNoCharge,
} from './dom-rejection';

function prismaSpy() {
  const deleted: unknown[] = [];
  const prisma = {
    transaction: {
      deleteMany: async (args: unknown) => {
        deleted.push(args);
        return { count: 1 };
      },
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
    },
  };
  return { deleted, prisma: prisma as any };
}

const axiosError = (status?: number) =>
  Object.assign(new Error('dom'), {
    isAxiosError: true,
    response: status ? { status } : undefined,
  });

describe('charge outcome classification', () => {
  it.each([400, 401, 422, 429, 500, 503])(
    'never infers no-charge from HTTP %i alone',
    (status) => {
      expect(isDefinitiveDomStatus(status)).toBe(false);
      expect(isDefinitiveDomRejection(axiosError(status))).toBe(false);
      expect(classifyChargeOutcome(axiosError(status))).toEqual({
        safeToRetry: false,
        evidenceType: 'ambiguous',
        requestDispatched: null,
        httpStatus: status,
      });
    },
  );

  it('recognizes breaker refusals before provider dispatch', () => {
    for (const refusal of [
      new CircuitOpenException('DOM', 'CARD'),
      new CircuitUnavailableException(),
    ])
      expect(classifyChargeOutcome(refusal)).toEqual({
        safeToRetry: true,
        evidenceType: 'pre_dispatch',
        requestDispatched: false,
      });
  });

  it('recognizes only explicit pre-dispatch and verified no-charge evidence', () => {
    expect(
      classifyChargeOutcome(markPreDispatchNoCharge(new Error('open'))),
    ).toEqual({
      safeToRetry: true,
      evidenceType: 'pre_dispatch',
      requestDispatched: false,
    });
    const refusal = markDefinitiveDomRejection(
      new BadRequestException('invalid'),
    );
    expect(isDefinitiveDomRejection(refusal)).toBe(true);
    expect(classifyChargeOutcome(refusal)).toEqual({
      safeToRetry: true,
      evidenceType: 'provider_no_charge',
      requestDispatched: true,
      provider: 'DOM',
    });
  });

  it('retains dispatched provider metadata without promoting status or code', () => {
    expect(
      classifyChargeOutcome(
        markChargeAttempt(new BadRequestException('failed'), {
          provider: 'FRENDZ',
          httpStatus: 422,
          providerCode: 'INVALID_CUSTOMER',
        }),
      ),
    ).toEqual({
      safeToRetry: false,
      evidenceType: 'ambiguous',
      requestDispatched: true,
      provider: 'FRENDZ',
      httpStatus: 422,
      providerCode: 'INVALID_CUSTOMER',
    });
  });
});

describe('draft discard on DOM rejection', () => {
  it.each([400, 401, 422, 429, 500, 503, undefined])(
    'keeps the draft on unverified failure %s',
    async (status) => {
      const { deleted, prisma } = prismaSpy();
      await expect(
        discardDraftOnRejection(prisma, 'tx-1', async () => {
          throw axiosError(status);
        }),
      ).rejects.toThrow('dom');
      expect(deleted).toEqual([]);
    },
  );

  it('discards only DRAFT after a verified pre-dispatch failure', async () => {
    const { deleted, prisma } = prismaSpy();
    await expect(
      discardDraftOnRejection(prisma, 'tx-1', async () => {
        throw markPreDispatchNoCharge(new Error('breaker open'));
      }),
    ).rejects.toThrow('breaker open');
    expect(deleted).toEqual([{ where: { id: 'tx-1', status: 'DRAFT' } }]);
  });

  it('discards the draft in unified execution when refusal is explicitly verified', async () => {
    const { deleted, prisma } = prismaSpy();
    const refusal = markDefinitiveDomRejection(
      new BadRequestException('invalid'),
    );
    const execution = new PlatformPaymentExecution(prisma);
    await expect(
      execution.charge({
        transactionId: 'tx-1',
        charge: async () => {
          throw refusal;
        },
        references: () => ({}),
      }),
    ).rejects.toBe(refusal);
    expect(deleted).toEqual([{ where: { id: 'tx-1', status: 'DRAFT' } }]);
  });
});
