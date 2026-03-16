import { Transaction, TransactionStatus } from '@prisma/client';
export declare const TRANSACTION_REPOSITORY: unique symbol;
export interface ITransactionRepository {
    findByDomPaymentId(domPaymentId: string): Promise<Transaction | null>;
    updateStatus(id: string, data: {
        status: TransactionStatus;
        previousStatus?: TransactionStatus | null;
    }): Promise<Transaction>;
}
