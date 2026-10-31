import { unsupportedCapability } from './platform-adapters';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { ProcessWebhookUseCase } from '../../application/use-cases/webhook/process-webhook.use-case';
import type { PlatformContext } from './platform-context.service';
import { platformWebhookEvent } from './platform-webhook.adapter';
import { whereTransactionPlatform } from './transaction-platform';
import { PaymentAttemptsService } from '../unified-platform/payments/payment-attempts.service';

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
        ...whereTransactionPlatform(platform.tag),
        OR: [
          { acquirer: platform.acquirer, externalPaymentId: paymentId },
          { acquirer: platform.acquirer, domPaymentId: paymentId },
          ...(externalReference && /^[a-f0-9]{64}$/.test(externalReference)
            ? [{ acquirer: platform.acquirer, id: externalReference }]
            : []),
          ...(externalReference?.startsWith('pay_')
            ? [
                {
                  paymentAttempts: {
                    some: { provider: platform.acquirer, externalReference },
                  },
                },
              ]
            : []),
          {
            paymentAttempts: {
              some: {
                provider: platform.acquirer,
                providerPaymentId: paymentId,
              },
            },
          },
        ],
      },
    });
    if (!transaction) {
      if (requirePayment)
        throw new UnauthorizedException('Pagamento fora da plataforma');
      return;
    }
    // An attempt reference is authoritative only if it belongs to this provider and
    // transaction. If both identifiers are present, they must identify the same attempt.
    const attempts = new PaymentAttemptsService(this.prisma);
    const correlated = await this.prisma.paymentAttempt.findFirst({
      where: {
        transactionId: transaction.id,
        provider: platform.acquirer,
        // When an exact attempt reference is supplied it must identify this very
        // attempt; a matching payment ID on a *different* attempt cannot rescue it.
        ...(externalReference?.startsWith('pay_')
          ? { externalReference }
          : { providerPaymentId: paymentId }),
      },
    });
    // A transaction may still advertise the previous acquirer while a fallback
    // POST is in flight. The provider-scoped attempt, not that stale field, is
    // the authority for this webhook. Legacy payments still require an acquirer match.
    if (!correlated && transaction.acquirer !== platform.acquirer)
      throw new UnauthorizedException('Adquirente da transação divergente');
    if (
      externalReference?.startsWith('pay_') &&
      (!correlated || correlated.externalReference !== externalReference)
    )
      throw new UnauthorizedException('Referência de tentativa divergente');
    if (
      correlated?.providerPaymentId &&
      correlated.providerPaymentId !== paymentId
    )
      throw new UnauthorizedException('Pagamento de tentativa divergente');
    if (correlated) {
      const outcome =
        status === 'paid' ? 'SUCCEEDED' : status === 'failed' ? 'FAILED' : null;
      // A pending/refund notification cannot bind an in-flight charge. Wait for a
      // terminal, exactly correlated event or the dispatch response to establish ID.
      if (!correlated.providerPaymentId && !outcome)
        throw new ConflictException(
          'Pagamento ainda não vinculado à tentativa',
        );
      if (outcome) {
        const result = await attempts.resolveCorrelated({
          transactionId: transaction.id,
          provider: platform.acquirer,
          providerPaymentId: paymentId,
          externalReference: correlated.externalReference,
          outcome,
          evidence: {
            source: 'authenticated_webhook',
            providerStatus: status,
            paymentId,
          },
        });
        if (result.kind === 'incident')
          throw new ConflictException(
            'Pagamento tardio contradiz tentativa liberada para retry',
          );
        if (
          result.kind === 'not_found' ||
          (result.kind === 'blocked' &&
            !(
              outcome === 'SUCCEEDED' &&
              result.attempt.status === 'SUCCEEDED' &&
              result.attempt.providerPaymentId === paymentId
            ))
        )
          throw new ConflictException(
            'Tentativa não permite liquidação deste pagamento',
          );
        // A second charge might have settled while this older provider response
        // was delayed. Never credit a different attempt as an ordinary replay.
        if (outcome === 'SUCCEEDED') {
          const otherSuccess = await this.prisma.paymentAttempt.findFirst({
            where: {
              transactionId: transaction.id,
              status: 'SUCCEEDED',
              id: { not: correlated.id },
            },
          });
          if (otherSuccess)
            throw new ConflictException(
              'Pagamento duplicado entre tentativas requer investigação',
            );
        }
      }
    }
    if (!correlated && externalReference?.startsWith('pay_'))
      throw new UnauthorizedException('Tentativa desconhecida');
    if (
      correlated &&
      transaction.externalPaymentId !== paymentId &&
      transaction.domPaymentId !== paymentId
    ) {
      // The webhook may beat the provider POST response. Persist the correlated
      // terminal evidence on the attempt, but never settle the unbound parent:
      // dispatch still needs its DRAFT CAS to attach ID and payment metadata.
      // A paid attempt remains durable evidence for later reconciliation.
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

  /** Locally replay a paid webhook that beat the POST response's transaction binding. */
  async reconcileBoundAttempt(
    platform: PlatformContext,
    transactionId: string,
  ): Promise<boolean> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, ...whereTransactionPlatform(platform.tag) },
    });
    if (!transaction)
      throw new UnauthorizedException('Pagamento fora da plataforma');
    const paymentId = transaction.externalPaymentId ?? transaction.domPaymentId;
    if (!paymentId || transaction.acquirer !== platform.acquirer) return false;
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        transactionId,
        provider: platform.acquirer,
        providerPaymentId: paymentId,
        status: 'SUCCEEDED',
      },
    });
    if (!attempt) return false;
    const otherSuccess = await this.prisma.paymentAttempt.findFirst({
      where: { transactionId, status: 'SUCCEEDED', id: { not: attempt.id } },
    });
    if (otherSuccess)
      throw new ConflictException(
        'Pagamento duplicado entre tentativas requer investigação',
      );
    if (transaction.netAmount === null)
      unsupportedCapability('webhooks.net-snapshot');
    const eventId = createHash('sha256')
      .update(`${platform.id}:${platform.acquirer}:${paymentId}:paid`)
      .digest('hex');
    await this.processor.execute({
      transactionId,
      payload: {
        event: 'transaction',
        signature: eventId,
        data: {
          paymentId,
          status: 'paid',
          amountWithoutAllFee: transaction.netAmount.toNumber(),
          acquirer: platform.acquirer,
        },
      },
    });
    return true;
  }
}
