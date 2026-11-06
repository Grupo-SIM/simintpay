import type { PrismaClient } from '@prisma/client';

const DAY = 86_400_000;

/**
 * Seeds the edge cases of scripts/sql/migrate-paid-subscription-orders.sql in a disposable
 * database. Every row gets a fresh uuid, so it can run several times in the same database.
 */
export async function seedScenario(db: PrismaClient) {
  const now = Date.now();
  const uid = () => crypto.randomUUID();
  const seller = await db.user.create({
    data: { name: 'Seller', email: `seller-${uid()}@t.dev`, password: 'x' },
  });
  await db.wallet.create({ data: { userId: seller.id, balance: '1234.56' } });
  await db.balanceLog.create({
    data: {
      userId: seller.id,
      action: 'CREDIT',
      balanceDelta: '1234.56',
      lockedDelta: '0',
      source: 'test',
    },
  });

  const link = async (
    frequencyType: 'ANUAL' | 'MONTHLY',
    withOffer: boolean,
  ) => {
    const l = await db.subscriptionLink.create({
      data: {
        userId: seller.id,
        name: `Link ${frequencyType}`,
        amount: '199.90',
        frequencyType,
      },
    });
    const offer = withOffer
      ? await db.offer.create({
          data: {
            ownerUserId: seller.id,
            createdByUserId: seller.id,
            code: uid().slice(0, 10).toUpperCase(),
            kind: 'SUBSCRIPTION_LINK',
            name: `Offer ${frequencyType}`,
            amountCents: 19990,
            renewalMode: 'MANUAL_PAY',
            intervalType: frequencyType === 'ANUAL' ? 'YEAR' : 'MONTH',
            intervalCount: 1,
            legacyType: 'SubscriptionLink',
            legacyId: l.id,
          },
        })
      : null;
    return { link: l, offer };
  };

  const yearly = await link('ANUAL', true);
  const noOffer = await link('ANUAL', false);

  async function order(
    target: { id: string },
    email: string,
    opts: {
      settledAt: Date;
      amount?: string;
      pixPaid?: boolean;
      txStatus?: 'COMPLETED' | 'PENDING';
      domSubscriptionId?: string;
      paymentMethod?: 'PIX' | 'CREDIT_CARD';
      history?: boolean;
    },
  ) {
    const amount = opts.amount ?? '199.90';
    const payment = `pix-${uid()}`;
    const tx = await db.transaction.create({
      data: {
        userId: seller.id,
        amount,
        status: opts.txStatus ?? 'COMPLETED',
        domPaymentId: payment,
        createdAt: opts.settledAt,
        updatedAt: opts.settledAt,
      },
    });
    if (opts.history)
      await db.transactionStatusHistory.create({
        data: {
          transactionId: tx.id,
          fromStatus: 'PENDING',
          toStatus: 'COMPLETED',
          createdAt: opts.settledAt,
        },
      });
    const o = await db.subscriptionLinkOrder.create({
      data: {
        subscriptionLinkId: target.id,
        userId: seller.id,
        customerName: 'Buyer',
        customerEmail: email,
        customerDocument: '12345678909',
        paymentMethod: opts.paymentMethod ?? 'PIX',
        status: opts.pixPaid === false ? 'pending' : 'paid',
        domPixPaymentId: payment,
        domSubscriptionId: opts.domSubscriptionId,
        amountCharged: amount,
      },
    });
    return { order: o, transaction: tx };
  }

  const recent = new Date(now - 10 * DAY);
  const leap = new Date('2024-02-29T12:00:00.123Z');
  const t = (name: string) => `${name}-${uid()}@buyer.dev`;
  const rows = {
    active: await order(yearly.link, t('active'), {
      settledAt: recent,
      history: true,
    }),
    expired: await order(yearly.link, t('expired'), {
      settledAt: new Date(now - 400 * DAY),
    }),
    leap: await order(yearly.link, t('leap'), {
      settledAt: leap,
      history: true,
    }),
    noOffer: await order(noOffer.link, t('nooffer'), { settledAt: recent }),
    card: await order(yearly.link, t('card'), {
      settledAt: recent,
      paymentMethod: 'CREDIT_CARD',
      domSubscriptionId: `sub-${uid()}`,
    }),
    pendingTx: await order(yearly.link, t('pending'), {
      settledAt: recent,
      txStatus: 'PENDING',
    }),
  };
  const dup = `Dup-${uid()}@Buyer.dev`;
  const dupFirst = await order(yearly.link, dup, {
    settledAt: new Date(now - 30 * DAY),
  });
  const dupSecond = await order(yearly.link, dup.toLowerCase(), {
    settledAt: new Date(now - 5 * DAY),
  });

  return {
    seller,
    offer: yearly.offer!,
    rows: { ...rows, dupFirst, dupSecond },
  };
}
