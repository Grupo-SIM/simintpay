import { unsupportedCapability } from './platform-adapters';
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { ProcessWebhookUseCase } from '../../application/use-cases/webhook/process-webhook.use-case';
import type { PlatformContext } from './platform-context.service';
import { platformWebhookEvent } from './platform-webhook.adapter';
import { whereTransactionPlatform } from './transaction-platform';

/** Authentication belongs to entry points; scoped settlement is identical for all contracts. */
export class PlatformWebhookSettlement {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: ProcessWebhookUseCase,
  ) {}
  async apply(platform: PlatformContext, body: unknown, requirePayment = true) {
    const { paymentId, status, externalReference } = platformWebhookEvent(
      platform.acquirer,
      body,
    );
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        acquirer: platform.acquirer,
        ...whereTransactionPlatform(platform.tag),
        OR: [
          { externalPaymentId: paymentId },
          { domPaymentId: paymentId },
          ...(externalReference ? [{ id: externalReference }] : []),
        ],
      },
    });
    if (!transaction) {
      if (requirePayment)
        throw new UnauthorizedException('Pagamento fora da plataforma');
      return;
    }
    if (requirePayment && transaction.netAmount === null)
      unsupportedCapability('webhooks.net-snapshot');
    const eventId = createHash('sha256')
      .update(`${platform.id}:${platform.acquirer}:${paymentId}:${status}`)
      .digest('hex');
    await this.processor.execute({
      transactionId: transaction.id,
      payload: {
        event: 'transaction',
        signature: eventId,
        data: {
          paymentId,
          status,
          amountWithoutAllFee:
            transaction.netAmount?.toNumber() ?? transaction.amount.toNumber(),
          acquirer: platform.acquirer,
        },
      },
    });
  }
}
