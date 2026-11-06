import { describe, expect, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { PaymentLinkController } from './payment-link.controller';

function controller(opts: {
  transactions?: Array<{ domPaymentId: string; status: string }>;
  charges?: Array<{ transactionId: string; transaction: { status: string } }>;
}) {
  const prisma = {
    transaction: {
      findFirst: async ({ where }: any) =>
        (opts.transactions ?? []).find(
          (t) => t.domPaymentId === where.domPaymentId,
        ) ?? null,
    },
    charge: {
      findFirst: async ({ where }: any) =>
        (opts.charges ?? []).find(
          (c) => c.transactionId === where.transactionId,
        ) ?? null,
    },
  };
  const instance = Object.create(PaymentLinkController.prototype);
  instance.prisma = prisma;
  return instance as PaymentLinkController;
}

describe('public pix-status route', () => {
  test('legacy links still resolve by domPaymentId', async () => {
    const c = controller({
      transactions: [{ domPaymentId: 'dom-1', status: 'COMPLETED' }],
    });
    expect(await c.getPixStatusRoute('dom-1')).toEqual({
      status: 'COMPLETED',
    });
  });

  test('resolves the transaction of an Offer Charge by Charge.transactionId', async () => {
    const c = controller({
      charges: [
        { transactionId: 'tx-offer', transaction: { status: 'PENDING' } },
      ],
    });
    expect(await c.getPixStatusRoute('tx-offer')).toEqual({
      status: 'PENDING',
    });
  });

  test('prefers the legacy match over a Charge lookup', async () => {
    const c = controller({
      transactions: [{ domPaymentId: 'same', status: 'COMPLETED' }],
      charges: [{ transactionId: 'same', transaction: { status: 'PENDING' } }],
    });
    expect(await c.getPixStatusRoute('same')).toEqual({ status: 'COMPLETED' });
  });

  test('an unknown id is still 404', async () => {
    await expect(
      controller({}).getPixStatusRoute('nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
