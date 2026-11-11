import { Transaction, TransactionStatus, PaymentMethod } from '@prisma/client';

export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY');

export type CreateTransactionData = {
  userId: string;
  amount: number;
  netAmount?: number;
  status: TransactionStatus;
  paymentMethod: PaymentMethod;
  description?: string | null;
  installments?: number;
  totalFee?: number;
  acquirerFee?: number;
  platformFee?: number;
  domPaymentId?: string | null;
  domTransactionId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerDocument?: string | null;
  customerPhone?: string | null;
  paymentLinkId?: string | null;
};

export interface ITransactionRepository {
  create(data: CreateTransactionData): Promise<Transaction>;
  findByDomPaymentId(domPaymentId: string): Promise<Transaction | null>;
  updateStatus(
    id: string,
    data: {
      status: TransactionStatus;
      previousStatus?: TransactionStatus | null;
    },
  ): Promise<Transaction>;
}
