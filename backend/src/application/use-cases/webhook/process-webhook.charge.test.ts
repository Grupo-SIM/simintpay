import { beforeAll, describe, expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import {
  makeOffer,
  makeOfferDb,
} from '../../../modules/offer/offer-checkout.fixture';
import { useEmptyCaches } from '../payment-link/charge-characterization.fixture';
import { ProcessWebhookUseCase } from './process-webhook.use-case';

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
  const events = {
    findByEventId: async () => null,
    create: async () => ({ id: 'wh' }),
    markProcessed: async () => undefined,
    markFailed: async () => undefined,
  };
  const affiliates = {
    applyForTransaction: async () => undefined,
    reverseForTransaction: async () => undefined,
  };
  const uc = new ProcessWebhookUseCase(
    events as never,
    {} as never,
    {} as never,
    db.prisma as never,
    {} as never,
    affiliates as never,
  );
  const send = (status: string) =>
    uc.execute({
      transactionId: TX,
      payload: {
        event: 'transaction',
        signature: `sig-${status}`,
        data: {
          paymentId: 'dom-pay-1',
          status,
          amountWithoutAllFee: 97,
          description: `Curso [LINK_CHARGE:${TX}]`,
        },
      },
    });
  return { db, send };
}

describe('Generic webhook settles the Charge of a settled Transaction', () => {
  test('paid marks the Charge PAID; a repeated webhook changes nothing', async () => {
    const { db, send } = await seed();
    await send('paid');
    expect(db.base.row().status).toBe('COMPLETED');
    expect(db.charges[0].status).toBe('PAID');
    const paidAt = db.charges[0].paidAt;
    expect(paidAt).toBeInstanceOf(Date);
    const credited = db.base.wallet().balance.toString();
    expect(db.base.logs().length).toBeGreaterThan(0);
    const logCount = db.base.logs().length;

    await send('paid');
    expect(db.charges[0].status).toBe('PAID');
    expect(db.charges[0].paidAt).toBe(paidAt);
    // No double credit: wallet and ledger unchanged by the duplicate delivery.
    expect(db.base.wallet().balance.toString()).toBe(credited);
    expect(db.base.logs().length).toBe(logCount);
  });

  test('failed marks the Charge FAILED; a refund after payment keeps it PAID', async () => {
    const failed = await seed();
    await failed.send('failed');
    expect(failed.db.charges[0].status).toBe('FAILED');

    const refunded = await seed();
    await refunded.send('paid');
    await refunded.send('refunded');
    expect(refunded.db.base.row().status).toBe('REFUNDED');
    expect(refunded.db.charges[0].status).toBe('PAID');
  });
});
