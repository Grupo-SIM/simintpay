import { beforeAll, describe, expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import {
  makeOffer,
  makeOfferDb,
} from '../../../modules/offer/offer-checkout.fixture';
import { useEmptyCaches } from '../payment-link/charge-characterization.fixture';
import { ProcessDomWebhookUseCase } from './process-dom-webhook.use-case';

beforeAll(useEmptyCaches);

const TX = '11111111-1111-4111-8111-111111111111';

async function seed() {
  const db = makeOfferDb(makeOffer());
  await db.prisma.$transaction(async (p: any) => {
    await p.transaction.create({
      data: {
        id: TX,
        userId: 'owner',
        status: 'PENDING',
        settlementBasis: 'FINAL_NET',
        amount: new Prisma.Decimal(100),
        netAmount: new Prisma.Decimal(97),
        platformFee: new Prisma.Decimal(1),
        domPaymentId: 'dom-pay-1',
        description: `Curso [LINK_CHARGE:${TX}]`,
      },
    });
    await p.charge.create({
      data: { transactionId: TX, offerId: 'offer-1', ownerUserId: 'owner' },
    });
  });
  // The shared fake's findFirst serves funnel parents; here it must find the link transaction.
  db.prisma.transaction.findFirst = async () => {
    const row = db.base.rows().find((r: any) => r.id === TX);
    return row ? { ...row } : null;
  };
  db.prisma.webhookEvent = {
    findFirst: async () => null,
    create: async () => ({ id: 'wh' }),
    update: async () => ({}),
  };
  const uc = new ProcessDomWebhookUseCase(db.prisma, {} as never, {} as never);
  (uc as any).affiliateCommission = {
    applyForTransaction: async () => undefined,
    reverseForTransaction: async () => undefined,
  };
  return { db, uc };
}

const event = (status: string) =>
  ({
    event: 'transaction',
    signature: `sig-${status}`,
    data: {
      id: 'dom-pay-1',
      status,
      amount: 10000,
      description: `Curso [LINK_CHARGE:${TX}]`,
    },
  }) as never;

describe('DOM webhook settles the Charge of a settled Transaction', () => {
  test('paid marks the Charge PAID; a repeated webhook changes nothing', async () => {
    const { db, uc } = await seed();
    await (uc as any).handleTransaction(event('paid'));
    expect(db.base.row().status).toBe('COMPLETED');
    expect(db.charges[0].status).toBe('PAID');
    const paidAt = db.charges[0].paidAt;
    expect(paidAt).toBeInstanceOf(Date);

    await (uc as any).handleTransaction(event('paid'));
    expect(db.charges[0].status).toBe('PAID');
    expect(db.charges[0].paidAt).toBe(paidAt);
  });

  test('failed marks the Charge FAILED; a refund after payment keeps it PAID', async () => {
    const failed = await seed();
    await (failed.uc as any).handleTransaction(event('failed'));
    expect(failed.db.charges[0].status).toBe('FAILED');

    const refunded = await seed();
    await (refunded.uc as any).handleTransaction(event('paid'));
    await (refunded.uc as any).handleTransaction(event('refunded'));
    expect(refunded.db.base.row().status).toBe('REFUNDED');
    expect(refunded.db.charges[0].status).toBe('PAID');
  });
});
