import { TransactionStatus } from '@prisma/client';
import { SyncDomTransactionsUseCase } from './sync-dom-transactions.use-case';

describe('SyncDomTransactionsUseCase.repairHistoricalStatuses', () => {
  it('updates a local replica and records the historical refund transition', async () => {
    const transaction = {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'local-1',
          status: TransactionStatus.COMPLETED,
          description: 'Assinatura mensal',
          domPaymentId: 'dom-1',
          domTransactionId: null,
        },
      ]),
      update: jest.fn(),
    };
    const transactionStatusHistory = { create: jest.fn() };
    const prisma = {
      transaction,
      $transaction: jest.fn(async (callback) =>
        callback({ transaction, transactionStatusHistory }),
      ),
    };
    const gateway = {
      listDomTransactions: jest.fn().mockResolvedValue({
        total: 1,
        transactions: [
          {
            id: 'dom-1',
            created_at: '2026-05-10T12:00:00.000Z',
            updated_at: '2026-06-15T12:00:00.000Z',
            amount: 1,
            liquid_amount: 1,
            status: 'refunded',
            payment_method: 'pix',
            product_first: 'Controle Patrimonial',
          },
        ],
      }),
    };
    const previousToken = process.env.DOM_TOKEN;
    process.env.DOM_TOKEN = 'test-token';

    try {
      const useCase = new SyncDomTransactionsUseCase(
        gateway as never,
        {} as never,
        prisma as never,
      );
      const result = await useCase.repairHistoricalStatuses({
        beginDate: '2026-05-01',
        endDate: '2026-06-30',
      });

      expect(result).toEqual({
        scanned: 1,
        matched: 1,
        updated: 1,
        tagged: 1,
        unchanged: 0,
      });
      expect(transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TransactionStatus.REFUNDED,
            description: '[TENANT:CONTROLE-PATRIMONIAL] Controle Patrimonial',
          }),
        }),
      );
      expect(transactionStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromStatus: TransactionStatus.COMPLETED,
            toStatus: TransactionStatus.REFUNDED,
          }),
        }),
      );
    } finally {
      if (previousToken === undefined) delete process.env.DOM_TOKEN;
      else process.env.DOM_TOKEN = previousToken;
    }
  });

  it('tags an already refunded local replica without duplicating status history', async () => {
    const transaction = {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'local-1',
          status: TransactionStatus.REFUNDED,
          description: 'Assinatura mensal',
          domPaymentId: 'dom-1',
          domTransactionId: null,
        },
      ]),
      update: jest.fn(),
    };
    const transactionStatusHistory = { create: jest.fn() };
    const prisma = {
      transaction,
      $transaction: jest.fn(async (callback) =>
        callback({ transaction, transactionStatusHistory }),
      ),
    };
    const gateway = {
      listDomTransactions: jest.fn().mockResolvedValue({
        total: 1,
        transactions: [
          {
            id: 'dom-1',
            created_at: '2026-05-10T12:00:00.000Z',
            amount: 1,
            liquid_amount: 1,
            status: 'refunded',
            payment_method: 'pix',
            product_first: 'Controle Patrimonial',
          },
        ],
      }),
    };
    const previousToken = process.env.DOM_TOKEN;
    process.env.DOM_TOKEN = 'test-token';

    try {
      const useCase = new SyncDomTransactionsUseCase(
        gateway as never,
        {} as never,
        prisma as never,
      );
      const result = await useCase.repairHistoricalStatuses({
        beginDate: '2026-05-01',
        endDate: '2026-06-30',
      });

      expect(result).toEqual({
        scanned: 1,
        matched: 1,
        updated: 0,
        tagged: 1,
        unchanged: 0,
      });
      expect(transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            description: '[TENANT:CONTROLE-PATRIMONIAL] Controle Patrimonial',
            platformTag: 'CONTROLE-PATRIMONIAL',
          },
        }),
      );
      expect(transactionStatusHistory.create).not.toHaveBeenCalled();
    } finally {
      if (previousToken === undefined) delete process.env.DOM_TOKEN;
      else process.env.DOM_TOKEN = previousToken;
    }
  });
});
