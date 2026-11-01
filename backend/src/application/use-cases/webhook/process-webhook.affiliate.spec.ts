import { ProcessWebhookUseCase } from './process-webhook.use-case';
import { TransactionStatus } from '@prisma/client';

describe('ProcessWebhookUseCase — hook de comissão de afiliado', () => {
  function buildUseCase(existingTx: any) {
    const applyForTransaction = jest.fn().mockResolvedValue(undefined);
    const reverseForTransaction = jest.fn().mockResolvedValue(undefined);

    const wallet = {
      id: 'wallet1',
      balance: { add: () => wallet.balance, sub: () => wallet.balance },
      lockedBalance: {
        add: () => wallet.lockedBalance,
        sub: () => wallet.lockedBalance,
      },
      version: 1,
    };

    const prismaTxClient = {
      transaction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      transactionStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      wallet: {
        findUnique: jest.fn().mockResolvedValue(wallet),
        findUniqueOrThrow: jest.fn().mockResolvedValue(wallet),
      },
      balanceLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const events = {
      findByEventId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'evt1' }),
      markProcessed: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    } as any;

    const transactions = {
      findByDomPaymentId: jest.fn().mockResolvedValue(existingTx),
    } as any;

    const balanceLogs = {} as any;

    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ platform: null }) },
      $transaction: jest
        .fn()
        .mockImplementation((cb: any) => cb(prismaTxClient)),
    } as any;

    const renovadaEvents = { emitTransaction: jest.fn() } as any;

    // Sexto arg (affiliateCommission) é sobrescrito logo abaixo — `undefined as any`
    // só pra bater a contagem de parâmetros do construtor.
    const uc = new ProcessWebhookUseCase(
      events,
      transactions,
      balanceLogs,
      prisma,
      renovadaEvents,
      undefined as any,
    );
    (uc as any).affiliateCommission = {
      applyForTransaction,
      reverseForTransaction,
    };

    return { uc, applyForTransaction, reverseForTransaction };
  }

  it('chama applyForTransaction quando o status vira paid/COMPLETED', async () => {
    const existingTx = {
      id: 'tx1',
      userId: 'user1',
      status: TransactionStatus.PENDING,
      platformFee: '5.00',
      description: null,
    };
    const { uc, applyForTransaction } = buildUseCase(existingTx);

    await uc.execute({
      payload: {
        event: 'charge',
        signature: 'sig-1',
        data: { paymentId: 'pay-1', status: 'paid', amountWithoutAllFee: 50 },
      },
    });

    expect(applyForTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transactionId: 'tx1',
        referredUserId: 'user1',
        platformFee: '5.00',
      }),
    );
  });

  it('chama reverseForTransaction quando o status vira refunded', async () => {
    const existingTx = {
      id: 'tx2',
      userId: 'user1',
      status: TransactionStatus.COMPLETED,
      platformFee: '5.00',
      description: null,
    };
    const { uc, reverseForTransaction } = buildUseCase(existingTx);

    await uc.execute({
      payload: {
        event: 'charge',
        signature: 'sig-2',
        data: {
          paymentId: 'pay-2',
          status: 'refunded',
          amountWithoutAllFee: 50,
        },
      },
    });

    expect(reverseForTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'tx2',
    );
  });
});
