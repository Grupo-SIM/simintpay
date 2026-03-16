import { Inject, Injectable } from '@nestjs/common';
import { Prisma, TransactionStatus } from '@prisma/client';
import { TRANSACTION_REPOSITORY } from '../../../core/repositories/transaction.repository.interface';
import { WEBHOOK_EVENT_REPOSITORY } from '../../../core/repositories/webhook-event.repository.interface';
import { BALANCE_LOG_REPOSITORY } from '../../../core/repositories/balance-log.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

import type { ITransactionRepository } from '../../../core/repositories/transaction.repository.interface';
import type { IWebhookEventRepository } from '../../../core/repositories/webhook-event.repository.interface';
import type { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';

type WebhookPayload = Record<string, unknown>;

type DomWebhookPayload = {
  event: string;
  signature: string;
  data: {
    paymentId: string;
    status: string;
    amountWithoutAllFee: number;
    [k: string]: unknown;
  };
};

@Injectable()
export class ProcessWebhookUseCase {
  constructor(
    @Inject(WEBHOOK_EVENT_REPOSITORY)
    private readonly events: IWebhookEventRepository,
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactions: ITransactionRepository,
    @Inject(BALANCE_LOG_REPOSITORY)
    private readonly balanceLogs: IBalanceLogRepository,
    private readonly prisma: PrismaService,
  ) {}

  private getObject(v: unknown): Record<string, unknown> | null {
    if (v && typeof v === 'object' && !Array.isArray(v))
      return v as Record<string, unknown>;
    return null;
  }

  private getString(v: unknown): string | null {
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return null;
  }

  private toDecimal(value: unknown): Prisma.Decimal {
    if (value instanceof Prisma.Decimal) return value;
    if (typeof value === 'number') return new Prisma.Decimal(value);
    if (typeof value === 'string') return new Prisma.Decimal(value);
    return new Prisma.Decimal(0);
  }

  private parseDomPayload(payload: WebhookPayload): DomWebhookPayload | null {
    const root = this.getObject(payload);
    if (!root) return null;

    const event = this.getString(root.event);
    const signature = this.getString(root.signature);
    const data = this.getObject(root.data);
    if (!event || !signature || !data) return null;

    const paymentId = this.getString(data.paymentId);
    const status = this.getString(data.status);
    const amountWithoutAllFeeRaw = data.amountWithoutAllFee;

    if (!paymentId || !status) return null;

    const amountWithoutAllFee =
      typeof amountWithoutAllFeeRaw === 'number'
        ? amountWithoutAllFeeRaw
        : typeof amountWithoutAllFeeRaw === 'string'
          ? Number(amountWithoutAllFeeRaw)
          : NaN;

    if (!Number.isFinite(amountWithoutAllFee)) return null;

    return {
      event,
      signature,
      data: {
        paymentId,
        status,
        amountWithoutAllFee,
        ...data,
      },
    };
  }

  private mapDomStatusToTransactionStatus(
    status: string,
  ): TransactionStatus | null {
    switch (status) {
      case 'paid':
        return TransactionStatus.COMPLETED;
      case 'refunded':
        return TransactionStatus.REFUNDED;
      case 'chargeback':
        return TransactionStatus.CHARGEBACK;
      case 'failed':
        return TransactionStatus.FAILED;
      case 'expired':
        return TransactionStatus.EXPIRED;
      case 'in_mediation':
        return TransactionStatus.IN_MEDIATION;
      case 'pending_refund':
        return TransactionStatus.PENDING_REFUND;
      default:
        return null;
    }
  }

  private isValidTransition(
    from: TransactionStatus,
    to: TransactionStatus,
  ): boolean {
    const allowed: Record<TransactionStatus, TransactionStatus[]> = {
      [TransactionStatus.DRAFT]: [TransactionStatus.PENDING],
      [TransactionStatus.PENDING]: [
        TransactionStatus.COMPLETED,
        TransactionStatus.FAILED,
        TransactionStatus.EXPIRED,
      ],
      [TransactionStatus.COMPLETED]: [
        TransactionStatus.REFUNDED,
        TransactionStatus.CHARGEBACK,
        TransactionStatus.IN_MEDIATION,
      ],
      [TransactionStatus.IN_MEDIATION]: [
        TransactionStatus.COMPLETED,
        TransactionStatus.REFUNDED,
      ],
      [TransactionStatus.FAILED]: [],
      [TransactionStatus.EXPIRED]: [],
      [TransactionStatus.REFUNDED]: [],
      [TransactionStatus.CHARGEBACK]: [],
      [TransactionStatus.PENDING_REFUND]: [],
    };

    return allowed[from]?.includes(to) ?? false;
  }

  async execute(input: { payload: WebhookPayload }): Promise<void> {
    const parsed = this.parseDomPayload(input.payload);
    if (!parsed) {
      return;
    }

    const eventId = parsed.signature;

    const exists = await this.events.findByEventId(eventId);
    if (exists) {
      return;
    }

    const eventType = parsed.event;

    const event = await this.events.create({
      eventId,
      source: 'api-dom',
      eventType,
      payload: input.payload,
    });

    try {
      const domPaymentId = parsed.data.paymentId;

      const trx = await this.transactions.findByDomPaymentId(domPaymentId);
      if (!trx) {
        await this.events.markFailed(
          event.id,
          `transaction not found for domPaymentId=${domPaymentId}`,
        );
        return;
      }

      const nextStatus = this.mapDomStatusToTransactionStatus(
        parsed.data.status,
      );
      if (!nextStatus) {
        await this.events.markFailed(
          event.id,
          `unsupported status=${parsed.data.status}`,
        );
        return;
      }

      if (!this.isValidTransition(trx.status, nextStatus)) {
        await this.events.markFailed(
          event.id,
          `invalid status transition ${trx.status} -> ${nextStatus}`,
        );
        return;
      }

      const amountWithoutAllFee = this.toDecimal(
        parsed.data.amountWithoutAllFee,
      );

      const status = parsed.data.status;

      await this.prisma.$transaction(async (p) => {
        const walletUpdates: {
          balance?: Prisma.Decimal;
          lockedBalance?: Prisma.Decimal;
        } = {};

        let walletBeforeBalance: Prisma.Decimal | null = null;
        let walletBeforeLocked: Prisma.Decimal | null = null;
        let walletAfterBalance: Prisma.Decimal | null = null;
        let walletAfterLocked: Prisma.Decimal | null = null;

        const shouldMutateWallet = [
          'paid',
          'refunded',
          'chargeback',
          'in_mediation',
        ].includes(status);

        if (shouldMutateWallet) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const wallet = await p.wallet.findUnique({
              where: { userId: trx.userId },
            });
            if (!wallet) throw new Error('wallet not found');

            const balanceBefore = wallet.balance;
            const lockedBefore = wallet.lockedBalance;

            walletBeforeBalance ??= balanceBefore;
            walletBeforeLocked ??= lockedBefore;

            let balanceAfter = balanceBefore;
            let lockedAfter = lockedBefore;

            if (status === 'paid') {
              balanceAfter = balanceBefore.add(amountWithoutAllFee);
            } else if (status === 'refunded' || status === 'chargeback') {
              balanceAfter = balanceBefore.sub(amountWithoutAllFee);
            } else if (status === 'in_mediation') {
              balanceAfter = balanceBefore.sub(amountWithoutAllFee);
              lockedAfter = lockedBefore.add(amountWithoutAllFee);
            }

            walletUpdates.balance = balanceAfter;
            walletUpdates.lockedBalance = lockedAfter;

            const result = await p.wallet.updateMany({
              where: { id: wallet.id, version: wallet.version },
              data: {
                balance: balanceAfter,
                lockedBalance: lockedAfter,
                version: { increment: 1 },
              },
            });

            if (result.count > 0) {
              walletAfterBalance = balanceAfter;
              walletAfterLocked = lockedAfter;
              break;
            }

            if (attempt === 2) {
              throw new Error('Wallet version conflict after 3 retries');
            }
          }
        }

        await p.transaction.update({
          where: { id: trx.id },
          data: { previousStatus: trx.status, status: nextStatus },
        });

        await p.transactionStatusHistory.create({
          data: {
            transactionId: trx.id,
            fromStatus: trx.status,
            toStatus: nextStatus,
            metadata: { reason: `webhook: ${eventType}` },
          },
        });

        if (
          shouldMutateWallet &&
          walletBeforeBalance &&
          walletBeforeLocked &&
          walletAfterBalance &&
          walletAfterLocked
        ) {
          await p.balanceLog.create({
            data: {
              userId: trx.userId,
              action: `WEBHOOK_${eventType}`,
              transactionId: trx.id,
              amount: amountWithoutAllFee,
              balanceBefore: walletBeforeBalance,
              balanceAfter: walletAfterBalance,
              lockedBefore: walletBeforeLocked,
              lockedAfter: walletAfterLocked,
              source: 'WEBHOOK',
              metadata: input.payload as never,
            },
          });
        }
      });

      await this.events.markProcessed(event.id);
    } catch (e: unknown) {
      await this.events.markFailed(
        event.id,
        e instanceof Error ? e.message : 'unknown error',
      );
    }
  }
}
