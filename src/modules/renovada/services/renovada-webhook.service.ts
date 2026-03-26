import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PaymentMethod, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RenovadaEventsService } from '../events/renovada-events.service';
import { RenovadaConfig } from '../renovada.config';

interface RawDomData {
  id: string;
  created_at?: string;
  amount: number;
  status: string;
  payment_method?: string;
  installments?: string | number;
  serial_number?: string;
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

/**
 * Processa webhooks recebidos diretamente do gateway DOM para o módulo Renovada.
 * Substitui a dependência do api-dom como intermediário.
 */
@Injectable()
export class RenovadaWebhookService {
  private readonly logger = new Logger(RenovadaWebhookService.name);
  private readonly RENOVADA_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';

  /** Serial da máquineta → userId de destino */
  private readonly MACHINE_CONFIG: Record<string, string> = {
    '4AF61W62R':     'ba2b57d6-e3bf-4395-af31-58454f27207a',
    '4AF61V34L':     'ba2b57d6-e3bf-4395-af31-58454f27207a',
    '4AF61VY6G':     'ba2b57d6-e3bf-4395-af31-58454f27207a',
    '4AF61W759':     '8b63ba8f-3622-4ecc-ad9a-35389eaeded6',
    'PB1S24C373609': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
    'PB1S24C373623': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
    'PB1S24C373616': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
    'PB1S24C373596': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly renovadaEvents: RenovadaEventsService,
  ) {}

  async process(payload: unknown): Promise<void> {
    const event = this.parsePayload(payload);
    if (!event) {
      this.logger.warn('[RenovadaWebhook] Payload inválido – ignorando');
      return;
    }

    // Idempotência atômica: tenta inserir e captura P2002 (unique violation)
    let wh: any;
    try {
      wh = await this.prisma.webhookEvent.create({
        data: {
          eventId: event.signature,
          source: 'renovada-dom-direct',
          eventType: event.event,
          payload: payload as never,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.log(`[RenovadaWebhook] ${event.signature} já processado`);
        return;
      }
      throw err;
    }

    try {
      const serial = this.detectSerial(event.data);
      if (serial) {
        await this.handleMachineSync(event, serial);
      } else {
        await this.handleTransaction(event);
      }
      await this.prisma.webhookEvent.update({
        where: { id: wh.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`[RenovadaWebhook] Erro: ${msg}`);
      await this.prisma.webhookEvent.update({
        where: { id: wh.id },
        data: { status: 'FAILED', error: msg, retryCount: { increment: 1 } },
      });
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private parsePayload(payload: unknown): RawDomWebhook | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.event !== 'string' || typeof p.signature !== 'string') return null;
    const d = p.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    if (typeof (d as Record<string, unknown>).id !== 'string') return null;
    return payload as RawDomWebhook;
  }

  private detectSerial(data: RawDomData): string | null {
    if (data.serial_number && this.MACHINE_CONFIG[data.serial_number]) {
      return data.serial_number;
    }
    const name = data.customer?.name ?? '';
    const m = name.match(/Terminal:\s*([A-Z0-9]+)/);
    if (m && this.MACHINE_CONFIG[m[1]]) return m[1];
    return null;
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
    const factor = RenovadaConfig.saque.fatorLiquidez ?? 0.91;
    const liq = liquidAmount ?? amount * factor;
    return new Prisma.Decimal(liq);
  }

  private calcPaymentMethod(method?: string): PaymentMethod {
    return method?.toLowerCase().includes('card')
      ? PaymentMethod.CREDIT_CARD
      : PaymentMethod.PIX;
  }

  // ─── Transação regular ───────────────────────────────────────────────────────

  private async handleTransaction(event: RawDomWebhook): Promise<void> {
    const { data } = event;
    const nextStatus = this.mapStatus(data.status);
    if (!nextStatus) {
      this.logger.warn(`[RenovadaWebhook] Status desconhecido "${data.status}" – ignorando`);
      return;
    }

    // DOM Pagamentos envia amount e liquid_amount em CENTAVOS → dividir por 100
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

      // wallet.balance é gross; netBalance = balance * fatorLiquidez
      // Para que netBalance += amount * fator, adicionamos amountDec (bruto) ao balance
      // NÃO usar netDec/fatorLiquidez pois liquid_amount do DOM reflete taxas DOM, não o fatorLiquidez

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
            metadata: { reason: `renovada-webhook: ${event.event}` },
          },
        });

        // Mutação do saldo — usar amountDec (bruto) para wallet gross
        let balanceDelta = new Prisma.Decimal(0);
        let lockedDelta = new Prisma.Decimal(0);

        if (
          nextStatus === TransactionStatus.COMPLETED &&
          existing.status !== TransactionStatus.COMPLETED
        ) {
          balanceDelta = amountDec;
        } else if (
          (nextStatus === TransactionStatus.REFUNDED ||
            nextStatus === TransactionStatus.CHARGEBACK) &&
          existing.status === TransactionStatus.COMPLETED
        ) {
          balanceDelta = amountDec.neg();
        } else if (
          nextStatus === TransactionStatus.IN_MEDIATION &&
          existing.status === TransactionStatus.COMPLETED
        ) {
          balanceDelta = amountDec.neg();
          lockedDelta = amountDec;
        }

        if (balanceDelta.isZero() && lockedDelta.isZero()) return;

        const wallet = await p.wallet.findUnique({ where: { userId: existing.userId } });
        if (!wallet) return;

        const newBalance = wallet.balance.add(balanceDelta);
        const newLocked = wallet.lockedBalance.add(lockedDelta);

        this.logger.log(`[RenovadaWebhook] 💰 Creditando wallet: balanceDelta=${balanceDelta}, amountDec=${amountDec}, netDec=${netDec}, balanceBefore=${wallet.balance}, balanceAfter=${newBalance}`);

        await p.wallet.updateMany({
          where: { id: wallet.id, version: wallet.version },
          data: { balance: newBalance, lockedBalance: newLocked, version: { increment: 1 } },
        });

        await p.balanceLog.create({
          data: {
            userId: existing.userId,
            action: `RENOVADA_WEBHOOK_${nextStatus}`,
            transactionId: existing.id,
            amount: balanceDelta.abs(),
            balanceBefore: wallet.balance,
            balanceAfter: newBalance,
            lockedBefore: wallet.lockedBalance,
            lockedAfter: newLocked,
            source: 'RENOVADA_WEBHOOK',
          },
        });
      });

      this.renovadaEvents.emitTransaction({ ...existing, status: nextStatus });
    } else {
      // Nova transação para o usuário Renovada
      const tx = await this.prisma.$transaction(async (p) => {
        const newTx = await p.transaction.create({
          data: {
            userId: this.RENOVADA_ID,
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
            metadata: { reason: `renovada-webhook-create: ${event.event}` },
          },
        });

        if (nextStatus === TransactionStatus.COMPLETED) {
          const wallet = await p.wallet.findUnique({ where: { userId: this.RENOVADA_ID } });
          if (wallet) {
            // wallet.balance é gross; netBalance = balance * fatorLiquidez
            // Usar amountDec (bruto) diretamente, não netDec/fator
            const grossIncrement = amountDec;
            const newBalance = wallet.balance.add(grossIncrement);
            this.logger.log(`[RenovadaWebhook] 💰 Nova tx COMPLETED: grossIncrement=${grossIncrement}, amountDec=${amountDec}, netDec=${netDec}, balanceBefore=${wallet.balance}, balanceAfter=${newBalance}`);
            await p.wallet.updateMany({
              where: { id: wallet.id, version: wallet.version },
              data: { balance: newBalance, version: { increment: 1 } },
            });
            await p.balanceLog.create({
              data: {
                userId: this.RENOVADA_ID,
                action: 'RENOVADA_WEBHOOK_COMPLETED',
                transactionId: newTx.id,
                amount: grossIncrement,
                balanceBefore: wallet.balance,
                balanceAfter: newBalance,
                lockedBefore: wallet.lockedBalance,
                lockedAfter: wallet.lockedBalance,
                source: 'RENOVADA_WEBHOOK',
              },
            });
          }
        }

        return newTx;
      });

      this.renovadaEvents.emitTransaction(tx);
      this.logger.log(`[RenovadaWebhook] Tx criada ${tx.id} para domPaymentId=${data.id}`);
    }
  }

  // ─── Sincronização de máquinetas físicas ─────────────────────────────────────

  private async handleMachineSync(event: RawDomWebhook, serial: string): Promise<void> {
    const { data } = event;

    if (data.status !== 'paid') {
      this.logger.log(
        `[RenovadaWebhook] Máquineta ${serial} status=${data.status} – sem sincronização`,
      );
      return;
    }

    const userId = this.MACHINE_CONFIG[serial];

    const alreadySynced = await this.prisma.transaction.findFirst({
      where: { domPaymentId: data.id, userId },
    });
    if (alreadySynced) {
      this.logger.log(`[RenovadaWebhook] Máquineta ${serial} tx ${data.id} já sincronizada`);
      return;
    }

    // DOM Pagamentos envia amount e liquid_amount em CENTAVOS → dividir por 100
    const amountDec = new Prisma.Decimal(data.amount / 100);
    const netDec = this.calcNet(data.amount / 100, data.liquid_amount != null ? data.liquid_amount / 100 : undefined);

    const tx = await this.prisma.$transaction(async (p) => {
      const newTx = await p.transaction.create({
        data: {
          userId,
          domPaymentId: data.id,
          amount: amountDec,
          netAmount: netDec,
          totalFee: amountDec.sub(netDec),
          status: TransactionStatus.COMPLETED,
          paymentMethod: this.calcPaymentMethod(data.payment_method),
          description: `Sincronização Automática - Terminal: ${serial}`,
          installments: Number(data.installments ?? 1),
          customerName: data.customer?.name ?? 'Cliente POS',
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
          toStatus: TransactionStatus.COMPLETED,
          metadata: { reason: 'machine-sync-webhook', serial },
        },
      });

      const wallet = await p.wallet.findUnique({ where: { userId } });
      if (wallet) {
        const newBalance = wallet.balance.add(amountDec);
        await p.wallet.updateMany({
          where: { id: wallet.id, version: wallet.version },
          data: { balance: newBalance, version: { increment: 1 } },
        });
        await p.balanceLog.create({
          data: {
            userId,
            action: 'MACHINE_SYNC',
            transactionId: newTx.id,
            amount: amountDec,
            balanceBefore: wallet.balance,
            balanceAfter: newBalance,
            lockedBefore: wallet.lockedBalance,
            lockedAfter: wallet.lockedBalance,
            source: 'MACHINE_SYNC',
            description: `Terminal: ${serial}`,
          },
        });
      }

      return newTx;
    });

    if (userId === this.RENOVADA_ID) {
      this.renovadaEvents.emitTransaction(tx);
    }
    this.logger.log(
      `[RenovadaWebhook] Sincronização de máquineta concluída: ${serial} → tx ${tx.id}`,
    );
  }
}
