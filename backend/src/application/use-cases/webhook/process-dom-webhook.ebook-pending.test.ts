import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';

const quoteCardOwnerShare = mock(async () => null as unknown);
mock.module('../../../modules/financial-policy/platform-fee-schedule', () => ({
  quoteCardOwnerShare,
}));

const credits: Record<string, any>[] = [];
const actualLedger =
  await import('../../../modules/wallet-ledger/wallet-ledger');
mock.module('../../../modules/wallet-ledger/wallet-ledger', () => ({
  ...actualLedger,
  applyWalletEntry: async (_client: unknown, entry: Record<string, any>) => {
    credits.push(entry);
  },
}));

const { ProcessDomWebhookUseCase } =
  await import('./process-dom-webhook.use-case');

const dec = (value: number) => new Prisma.Decimal(value);

/** Entry as the canonical route records it: PIX 1x, owner amount R$ 100,00, server net R$ 85,01. */
const pendingRow = (over: Record<string, unknown> = {}) => ({
  id: 'tx-pending',
  userId: 'seller',
  status: 'PENDING',
  amount: dec(100),
  netAmount: dec(85.01),
  financialSnapshot: { policyTag: 'EBOOK' },
  domPaymentId: 'EBOOK_PENDING_ORD-1',
  ...over,
});

function setup(row: Record<string, unknown>) {
  const updates: Record<string, any>[] = [];
  const wallet: Record<string, any>[] = [];
  const prisma: any = {
    transaction: {
      findFirst: async (args: any) =>
        args.where?.domPaymentId === 'dom-real' ? null : row,
    },
    $transaction: async (fn: any) =>
      fn({
        transaction: {
          updateMany: async (args: any) => {
            if (row.status === 'COMPLETED') return { count: 0 };
            updates.push(args.data);
            return { count: 1 };
          },
        },
      }),
  };
  const uc: any = new ProcessDomWebhookUseCase(
    prisma,
    {} as never,
    {} as never,
  );
  uc.calcNet = () => dec(1);
  return { uc, updates, wallet };
}

const data = (over: Record<string, unknown> = {}) =>
  ({
    id: 'dom-real',
    status: 'paid',
    amount: 11_800,
    payment_method: 'credit_card',
    installments: 3,
    ...over,
  }) as never;

const quote = {
  totalAmount: 108.5,
  netAmount: 78.4,
  domFeeAmount: 4.2,
  platformFeeAmount: 6.1,
  financialSnapshot: { interestCostCents: 850 },
};

beforeEach(() => {
  quoteCardOwnerShare.mockReset();
  credits.length = 0;
});

describe('Ebook pending entry completed by the DOM webhook', () => {
  test('a card payment reprices the owner share with the paid installments', async () => {
    quoteCardOwnerShare.mockResolvedValue(quote);
    const { uc, updates } = setup(pendingRow());
    await uc.upsertEbookTransaction(data(), 'ORD-1', null);
    expect(quoteCardOwnerShare.mock.calls[0].slice(1)).toEqual([
      'EBOOK',
      10_000,
      3,
    ]);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: 'COMPLETED',
      paymentMethod: 'CREDIT_CARD',
      installments: 3,
      financialSnapshot: quote.financialSnapshot,
    });
    // Buyer-paid total (interest included) as the amount; the net comes from the owner-share quote.
    expect(updates[0].amount.toNumber()).toBe(118);
    expect(updates[0].netAmount.toNumber()).toBe(78.4);
    expect(updates[0].totalFee.toNumber()).toBeCloseTo(39.6, 2);
    expect(updates[0].platformFee.toNumber()).toBe(6.1);
    // The wallet is credited exactly once, from the repriced net (minus the fixed service fee).
    expect(credits).toHaveLength(1);
    expect(credits[0].balanceDelta.toNumber()).toBeLessThanOrEqual(78.4);
    expect(updates[0].acquirerFee.toNumber()).toBe(4.2);
  });

  test('PIX keeps the net stored when the entry was priced', async () => {
    const { uc, updates } = setup(pendingRow());
    await uc.upsertEbookTransaction(
      data({ payment_method: 'pix', installments: 1 }),
      'ORD-1',
      null,
    );
    expect(quoteCardOwnerShare).not.toHaveBeenCalled();
    expect(updates[0].netAmount.toNumber()).toBe(85.01);
    expect(updates[0].paymentMethod).toBeUndefined();
  });

  test('an owner share above the buyer total keeps the stored net', async () => {
    quoteCardOwnerShare.mockResolvedValue({ ...quote, totalAmount: 130 });
    const { uc, updates } = setup(pendingRow());
    await uc.upsertEbookTransaction(data(), 'ORD-1', null);
    expect(updates[0].netAmount.toNumber()).toBe(85.01);
    expect(updates[0].installments).toBeUndefined();
  });

  test('a failing quote keeps the stored net instead of failing the webhook', async () => {
    quoteCardOwnerShare.mockRejectedValue(new Error('policy'));
    const { uc, updates } = setup(pendingRow());
    await uc.upsertEbookTransaction(data(), 'ORD-1', null);
    expect(updates[0].netAmount.toNumber()).toBe(85.01);
  });

  test('entries without a stored server quote are not repriced', async () => {
    const { uc, updates } = setup(pendingRow({ financialSnapshot: null }));
    await uc.upsertEbookTransaction(data(), 'ORD-1', null);
    expect(quoteCardOwnerShare).not.toHaveBeenCalled();
    expect(updates[0].netAmount.toNumber()).toBe(1);
  });

  test('a completed row is never changed or credited again', async () => {
    const { uc, updates } = setup(pendingRow({ status: 'COMPLETED' }));
    await uc.upsertEbookTransaction(data(), 'ORD-1', null);
    expect(quoteCardOwnerShare).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(credits).toHaveLength(0);
  });
});
