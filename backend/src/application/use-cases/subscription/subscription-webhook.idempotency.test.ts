import { describe, expect, mock, test } from 'bun:test';
import { SubscriptionWebhookService } from './subscription-webhook.service';

// The fee store would open its own database connection; fees are irrelevant to idempotency.
mock.module('../../../modules/platform-taxas/platform-taxas.store', () => ({
  getPlatformTaxaEffective: (_tag: string, _key: string, fallback: number) =>
    fallback,
  buildUserTaxaTag: (userId: string) => `CLIENT:${userId}`,
}));

/**
 * DOM retries a webhook up to 5 times and may deliver duplicates. A repeated CHARGE-APPROVED /
 * CHARGE-NOT_AUTHORIZED for the same DOM transaction must not settle twice nor credit the wallet
 * twice.
 */
function build() {
  const transactions: any[] = [];
  const balanceLogs: any[] = [];
  const orderUpdates: any[] = [];
  const prisma: any = {
    transaction: {
      findFirst: async ({ where }: any) =>
        transactions.find((t) => t.domPaymentId === where.domPaymentId) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `tx-${transactions.length + 1}`, ...data };
        transactions.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        Object.assign(
          transactions.find((t) => t.id === where.id),
          data,
        );
      },
    },
    subscriptionLinkOrder: {
      findFirst: async () => ({ id: 'order-1', issueStartedAt: null }),
      update: async (args: any) => {
        orderUpdates.push(args);
      },
    },
    billingContract: { findUnique: async () => null },
    subscription: {
      findFirst: async () => ({
        id: 'sub-1',
        userId: 'owner',
        customer: null,
        plan: { name: 'Plano', userId: 'owner', plataformas: [] },
        user: {
          wallet: {
            id: 'w',
            userId: 'owner',
            balance: 0,
            lockedBalance: 0,
            version: 0,
          },
        },
      }),
      update: async () => ({}),
    },
    balanceLog: {
      create: async ({ data }: any) => {
        balanceLogs.push(data);
      },
    },
    wallet: { findUniqueOrThrow: async () => ({ userId: 'owner' }) },
    $transaction: async (fn: any) => fn(prisma),
  };
  const service = new SubscriptionWebhookService(prisma, {} as never);
  return { service, transactions, balanceLogs, orderUpdates, prisma };
}

const payload = (event: string, status: string) => ({
  event,
  data: {
    id: 'dom-tx-1',
    status,
    amount: 10000,
    relations: { id_subscriber: 'dom-sub-1' },
  },
});

describe('subscription webhook idempotency', () => {
  test('a duplicated CHARGE-APPROVED creates one Transaction and credits the wallet once', async () => {
    const { service, transactions, balanceLogs, prisma } = build();
    // Plain subscription path: not a link order.
    prisma.subscriptionLinkOrder.findFirst = async () => null;

    await service.handleWebhook(payload('CHARGE-APPROVED', 'paid'));
    await service.handleWebhook(payload('CHARGE-APPROVED', 'paid'));
    await service.handleWebhook(payload('CHARGE-APPROVED', 'paid'));

    expect(transactions).toHaveLength(1);
    expect(transactions[0].domPaymentId).toBe('dom-tx-1');
    expect(balanceLogs).toHaveLength(1);
    expect(balanceLogs[0].transactionId).toBe(transactions[0].id);
  });

  test('a duplicated CHARGE-APPROVED on a billing contract writes the Transaction once', async () => {
    const { service, transactions, balanceLogs, prisma } = build();
    prisma.subscriptionLinkOrder.findFirst = async () => null;
    prisma.billingContract.findUnique = async () => ({
      userId: 'owner',
      baseAmount: 100,
      description: 'Contrato',
      metadata: null,
      quantity: 1,
      unitAmount: 0,
    });

    await service.handleWebhook(payload('CHARGE-APPROVED', 'paid'));
    await service.handleWebhook(payload('CHARGE-APPROVED', 'paid'));

    expect(transactions).toHaveLength(1);
    expect(transactions[0].status).toBe('COMPLETED');
    expect(balanceLogs).toHaveLength(0);
  });

  test('a duplicated not_authorized charge settles nothing and credits nothing', async () => {
    const { service, transactions, balanceLogs, orderUpdates } = build();

    await service.handleWebhook(payload('CHARGE-APPROVED', 'not_authorized'));
    await service.handleWebhook(payload('CHARGE-APPROVED', 'not_authorized'));

    expect(transactions).toHaveLength(0);
    expect(balanceLogs).toHaveLength(0);
    // Idempotent mark: both deliveries only set the same terminal status.
    expect(orderUpdates.every((u) => u.data.status === 'payment_failed')).toBe(
      true,
    );
  });

  test('a late duplicated approval after a paid transaction is ignored', async () => {
    const { service, transactions, balanceLogs, prisma } = build();
    prisma.subscriptionLinkOrder.findFirst = async () => null;
    await service.handleWebhook(payload('CHARGE-APPROVED', 'paid'));
    await service.handleWebhook(payload('CHARGE-APPROVED', 'not_authorized'));
    expect(transactions).toHaveLength(1);
    expect(transactions[0].status).toBe('COMPLETED');
    expect(balanceLogs).toHaveLength(1);
  });
});
