import { getPlatformOwnerId } from '../../module.registry';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PaymentMethod, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { getPlatformTaxaEffective } from '../../platform-taxas/platform-taxas.store';

interface RawDomData {
  id: string;
  created_at?: string;
  amount: number;
  status: string;
  payment_method?: string;
  installments?: string | number;
  customer?: {
    name?: string;
    email?: string;
    mobile_phone?: string;
    document?: string;
  };
  liquid_amount?: number;
  dom_fee?: number;
}

interface RawDomWebhook {
  event: string;
  signature: string;
  data: RawDomData;
}

@Injectable()
export class MasterWebhookService {
  private readonly logger = new Logger(MasterWebhookService.name);
  private readonly ADMIN_USER_ID = process.env.ADMIN_USER_ID!;

  constructor(private readonly prisma: PrismaService) {}

  async process(payload: unknown): Promise<void> {
    const event = this.parsePayload(payload);
    if (!event) {
      this.logger.warn('[MasterWebhook] Payload inválido – ignorando');
      return;
    }

    let wh: any;
    try {
      wh = await this.prisma.webhookEvent.create({
        data: {
          eventId: event.signature,
          source: 'master-dom-direct',
          eventType: event.event,
          payload: payload as never,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.log(`[MasterWebhook] ${event.signature} já processado`);
        return;
      }
      throw err;
    }

    try {
      await this.handleTransaction(event);
      await this.prisma.webhookEvent.update({
        where: { id: wh.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`[MasterWebhook] Erro: ${msg}`);
      await this.prisma.webhookEvent.update({
        where: { id: wh.id },
        data: { status: 'FAILED', error: msg, retryCount: { increment: 1 } },
      });
    }
  }

  private parsePayload(payload: unknown): RawDomWebhook | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.event !== 'string' || typeof p.signature !== 'string') return null;
    const d = p.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    if (typeof (d as Record<string, unknown>).id !== 'string') return null;
    return payload as RawDomWebhook;
  }

  private mapStatus(s: string): TransactionStatus | null {
    switch (s) {
      case 'paid':
      case 'approved':
      case 'completed':
      case 'revision_paid':
      case 'capture':
        return TransactionStatus.COMPLETED;
      case 'refunded':
      case 'pending_refund':
        return TransactionStatus.REFUNDED;
      case 'chargeback':
        return TransactionStatus.CHARGEBACK;
      case 'failed':
      case 'not_authorized':
        return TransactionStatus.FAILED;
      case 'expired':
        return TransactionStatus.EXPIRED;
      case 'in_mediation':
      case 'dispute_pending':
        return TransactionStatus.IN_MEDIATION;
      case 'pending':
      case 'pending_capture':
        return TransactionStatus.PENDING;
      default:
        return null;
    }
  }

  private calcNet(amount: number, liquidAmount?: number): Prisma.Decimal {
    const factor = getPlatformTaxaEffective('GLOBAL', 'LIQUIDEZ', 0.91);
    const liq = liquidAmount ?? amount * factor;
    return new Prisma.Decimal(liq);
  }

  private calcPaymentMethod(method?: string): PaymentMethod {
    return method?.toLowerCase().includes('card')
      ? PaymentMethod.CREDIT_CARD
      : PaymentMethod.PIX;
  }

  private get RENOVADA_USER_ID(): string | null { return getPlatformOwnerId('RENOVADA'); }

  private getLiquidezFactor(userId: string): Prisma.Decimal {
    if (userId === this.RENOVADA_USER_ID) {
      return new Prisma.Decimal(
        getPlatformTaxaEffective('RENOVADA', 'LIQUIDEZ', 0.91),
      );
    }
    return new Prisma.Decimal(1);
  }

  private async handleTransaction(event: RawDomWebhook): Promise<void> {
    const { data } = event;
    const nextStatus = this.mapStatus(data.status);
    if (!nextStatus) {
      this.logger.warn(`[MasterWebhook] Status desconhecido "${data.status}" – ignorando`);
      return;
    }

    const amountDec = new Prisma.Decimal(data.amount / 100);
    const netDec = this.calcNet(data.amount / 100, data.liquid_amount != null ? data.liquid_amount / 100 : undefined);
    const totalFee = amountDec.sub(netDec);
    const domFee = new Prisma.Decimal(data.dom_fee ?? 0);
    const platformFee = totalFee.greaterThan(domFee)
      ? totalFee.sub(domFee)
      : new Prisma.Decimal(0);

    const existing = await this.prisma.transaction.findFirst({
      where: { domPaymentId: data.id },
    });

    if (existing) {
      if (existing.status === nextStatus) return;

      const isRenovada = existing.userId === this.RENOVADA_USER_ID;
      const delta = isRenovada ? amountDec : netDec;

      await this.prisma.$transaction(async (p) => {
        await p.transaction.update({
          where: { id: existing.id },
          data: { previousStatus: existing.status, status: nextStatus, updatedAt: new Date() },
        });

        await p.transactionStatusHistory.create({
          data: {
            transactionId: existing.id,
            fromStatus: existing.status,
            toStatus: nextStatus,
            metadata: { reason: `master-webhook: ${event.event}` },
          },
        });

        let balanceDelta = new Prisma.Decimal(0);
        let lockedDelta = new Prisma.Decimal(0);

        if (
          nextStatus === TransactionStatus.COMPLETED &&
          existing.status !== TransactionStatus.COMPLETED
        ) {
          balanceDelta = delta;
        } else if (
          (nextStatus === TransactionStatus.REFUNDED ||
            nextStatus === TransactionStatus.CHARGEBACK) &&
          existing.status === TransactionStatus.COMPLETED
        ) {
          balanceDelta = delta.neg();
        } else if (
          nextStatus === TransactionStatus.IN_MEDIATION &&
          existing.status === TransactionStatus.COMPLETED
        ) {
          balanceDelta = delta.neg();
          lockedDelta = delta;
        }

        if (balanceDelta.isZero() && lockedDelta.isZero()) return;

        const wallet = await p.wallet.findUnique({ where: { userId: existing.userId } });
        if (!wallet) return;

        const newBalance = wallet.balance.add(balanceDelta);
        const newLocked = wallet.lockedBalance.add(lockedDelta);

        await p.wallet.updateMany({
          where: { id: wallet.id, version: wallet.version },
          data: { balance: newBalance, lockedBalance: newLocked, version: { increment: 1 } },
        });

        await p.balanceLog.create({
          data: {
            userId: existing.userId,
            action: `MASTER_WEBHOOK_${nextStatus}`,
            transactionId: existing.id,
            amount: balanceDelta.abs(),
            balanceBefore: wallet.balance,
            balanceAfter: newBalance,
            lockedBefore: wallet.lockedBalance,
            lockedAfter: newLocked,
            source: 'MASTER_WEBHOOK',
          },
        });
      });

      this.logger.log(`[MasterWebhook] Tx ${existing.id} atualizada → ${nextStatus}`);
    } else {
      const tx = await this.prisma.$transaction(async (p) => {
        const newTx = await p.transaction.create({
          data: {
            userId: this.ADMIN_USER_ID,
            domPaymentId: data.id,
            amount: amountDec,
            netAmount: netDec,
            totalFee,
            domFee,
            platformFee,
            status: nextStatus,
            paymentMethod: this.calcPaymentMethod(data.payment_method),
            description: 'DOM Transação',
            installments: Number(data.installments ?? 1),
            customerName: data.customer?.name ?? '',
            customerEmail: data.customer?.email ?? '',
            customerDocument: data.customer?.document ?? '',
            customerPhone: data.customer?.mobile_phone ?? '',
            createdAt: data.created_at ? new Date(data.created_at) : new Date(),
          },
        });

        await p.transactionStatusHistory.create({
          data: {
            transactionId: newTx.id,
            fromStatus: TransactionStatus.DRAFT,
            toStatus: nextStatus,
            metadata: { reason: `master-webhook-create: ${event.event}` },
          },
        });

        if (nextStatus === TransactionStatus.COMPLETED) {
          const wallet = await p.wallet.findUnique({ where: { userId: this.ADMIN_USER_ID } });
          if (wallet) {
            const newBalance = wallet.balance.add(amountDec);
            await p.wallet.updateMany({
              where: { id: wallet.id, version: wallet.version },
              data: { balance: newBalance, version: { increment: 1 } },
            });
            await p.balanceLog.create({
              data: {
                userId: this.ADMIN_USER_ID,
                action: 'MASTER_WEBHOOK_COMPLETED',
                transactionId: newTx.id,
                amount: amountDec,
                balanceBefore: wallet.balance,
                balanceAfter: newBalance,
                lockedBefore: wallet.lockedBalance,
                lockedAfter: wallet.lockedBalance,
                source: 'MASTER_WEBHOOK',
              },
            });
          }
        }

        return newTx;
      });

      this.logger.log(`[MasterWebhook] Tx criada ${tx.id} para domPaymentId=${data.id}`);
    }
  }
}
