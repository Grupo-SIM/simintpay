import { Injectable } from '@nestjs/common';
import { Transaction, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ITransactionRepository,
  CreateTransactionData,
} from '../../../core/repositories/transaction.repository.interface';

@Injectable()
export class PrismaTransactionRepository implements ITransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateTransactionData): Promise<Transaction> {
    return this.prisma.transaction.create({
      data: {
        userId: data.userId,
        amount: data.amount,
        netAmount: data.netAmount ?? data.amount,
        status: data.status,
        paymentMethod: data.paymentMethod,
        description: data.description ?? undefined,
        installments: data.installments ?? 1,
        totalFee: data.totalFee ?? 0,
        acquirerFee: data.acquirerFee ?? 0,
        platformFee: data.platformFee ?? 0,
        domPaymentId: data.domPaymentId ?? undefined,
        domTransactionId: data.domTransactionId ?? undefined,
        customerName: data.customerName ?? undefined,
        customerEmail: data.customerEmail ?? undefined,
        customerDocument: data.customerDocument ?? undefined,
        customerPhone: data.customerPhone ?? undefined,
        paymentLinkId: data.paymentLinkId ?? undefined,
      },
    });
  }

  async findByDomPaymentId(domPaymentId: string): Promise<Transaction | null> {
    // Busca pelo id de pagamento da DOM (campo histórico). Como fallback,
    // procura também por `externalPaymentId` — campo neutro preenchido por
    // adquirentes novas (ex.: Frendz, que guarda aí o hash da transação).
    // Mantém o webhook DOM funcionando idêntico e permite o webhook Frendz
    // reusar o mesmo ProcessWebhookUseCase.
    return this.prisma.transaction.findFirst({
      where: { OR: [{ domPaymentId }, { externalPaymentId: domPaymentId }] },
    });
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
