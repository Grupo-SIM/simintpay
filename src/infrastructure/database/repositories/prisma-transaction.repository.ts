import { Injectable } from '@nestjs/common';
import { Transaction, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ITransactionRepository } from '../../../core/repositories/transaction.repository.interface';

@Injectable()
export class PrismaTransactionRepository implements ITransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByDomPaymentId(domPaymentId: string): Promise<Transaction | null> {
    return this.prisma.transaction.findFirst({ where: { domPaymentId } });
  }

  async updateStatus(
    id: string,
    data: {
      status: TransactionStatus;
      previousStatus?: TransactionStatus | null;
    },
  ): Promise<Transaction> {
    return this.prisma.transaction.update({
      where: { id },
      data: {
        previousStatus: data.previousStatus ?? undefined,
        status: data.status,
      },
    });
  }
}
