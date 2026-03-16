import { Transaction, TransactionStatus } from '@prisma/client';

export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY');

export interface ITransactionRepository {
  findByDomPaymentId(domPaymentId: string): Promise<Transaction | null>;
  updateStatus(
    id: string,
    data: {
      status: TransactionStatus;
      previousStatus?: TransactionStatus | null;
    },
  ): Promise<Transaction>;
}
