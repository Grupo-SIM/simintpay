import { BadGatewayException } from '@nestjs/common';
import { Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

/** Shared financial execution for canonical operations and legacy contract adapters. */
export class PlatformPaymentExecution {
  constructor(private readonly prisma: PrismaService) {}

  reserve(data: Prisma.TransactionUncheckedCreateInput) {
    return this.prisma.transaction.create({ data: { ...data, status: TransactionStatus.DRAFT } });
  }

  async charge<T extends { id: string; status: string }>(input: {
    transactionId: string;
    charge: () => Promise<T>;
    references: (payment: T) => Prisma.TransactionUncheckedUpdateInput;
    rejection?: (payment: T) => boolean;
  }) {
    // No automatic retries after an uncertain charge. Its draft remains available
    // to reconciliation/idempotent replay rather than issuing a second charge.
    const payment = await input.charge();
    if (!payment?.id) throw new BadGatewayException({ code: 'ACQUIRER_INVALID_RESPONSE' });
    await this.prisma.transaction.updateMany({ where: { id: input.transactionId, status: TransactionStatus.DRAFT },
      data: { status: input.rejection?.(payment) ? TransactionStatus.FAILED : TransactionStatus.PENDING } });
    // Reference attachment cannot overwrite a status settled by an early webhook.
    const transaction = await this.prisma.transaction.update({ where: { id: input.transactionId }, data: input.references(payment) });
    return { payment, transaction };
  }
}
