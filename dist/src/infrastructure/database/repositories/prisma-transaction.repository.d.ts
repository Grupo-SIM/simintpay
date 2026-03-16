import { Transaction, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ITransactionRepository } from '../../../core/repositories/transaction.repository.interface';
export declare class PrismaTransactionRepository implements ITransactionRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findByDomPaymentId(domPaymentId: string): Promise<Transaction | null>;
    updateStatus(id: string, data: {
        status: TransactionStatus;
        previousStatus?: TransactionStatus | null;
    }): Promise<Transaction>;
}
