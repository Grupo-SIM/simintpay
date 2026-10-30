import { describe, expect, it } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { PlatformPaymentExecution } from './platform-payment-execution';
import {
  discardDraftOnRejection,
  markDefinitiveDomRejection,
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

describe('draft discard on DOM rejection', () => {
  it.each([400, 401, 422])(
    'discards the draft on definitive %i',
    async (status) => {
      const { deleted, prisma } = prismaSpy();
      await expect(
        discardDraftOnRejection(prisma, 'tx-1', async () => {
          throw axiosError(status);
        }),
      ).rejects.toThrow('dom');
      expect(deleted).toEqual([{ where: { id: 'tx-1', status: 'DRAFT' } }]);
    },
  );

  it.each([undefined, 429, 500, 503])(
    'keeps the draft on uncertain failure %s',
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

  it('discards the draft in the unified execution when the refusal is marked definitive', async () => {
    const { deleted, prisma } = prismaSpy();
    const refusal = markDefinitiveDomRejection(
      new BadRequestException('invalid'),
    );
    await expect(
      new PlatformPaymentExecution(prisma).charge({
        transactionId: 'tx-2',
        charge: async () => {
          throw refusal;
        },
        references: () => ({}),
      }),
    ).rejects.toBe(refusal);
    expect(deleted).toEqual([{ where: { id: 'tx-2', status: 'DRAFT' } }]);
  });

  it('keeps the draft in the unified execution on unmarked errors', async () => {
    const { deleted, prisma } = prismaSpy();
    await expect(
      new PlatformPaymentExecution(prisma).charge({
        transactionId: 'tx-3',
        charge: async () => {
          throw new BadRequestException('timeout');
        },
        references: () => ({}),
      }),
    ).rejects.toThrow('timeout');
    expect(deleted).toEqual([]);
  });
});
