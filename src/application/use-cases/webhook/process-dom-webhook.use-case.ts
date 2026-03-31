import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, PaymentMethod, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RenovadaEventsService } from '../../../modules/renovada/events/renovada-events.service';
import { CommunityManagementService } from '../../services/community-management.service';
import { EmailService } from '../../../infrastructure/email/email.service';
import {
  appendInternalTags,
  ORIGEM_MAQUINETA_TAG,
  TENANT_BOSQUE_TAG,
  TENANT_RENOVADA_TAG,
} from '../../utils/internal-tags.util';

// ─── Constantes ──────────────────────────────────────────────────────────────

const RENOVADA_USER_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';
const BOSQUE_USER_ID = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';

const MACHINE_CONFIG: Record<string, string> = {
  '4AF61W62R': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  '4AF61V34L': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  '4AF61VY6G': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  '4AF61W759': '8b63ba8f-3622-4ecc-ad9a-35389eaeded6',
  'PB1S24C373609': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  'PB1S24C373623': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  'PB1S24C373616': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
  'PB1S24C373596': 'ba2b57d6-e3bf-4395-af31-58454f27207a',
};

// ─── Interfaces internas ──────────────────────────────────────────────────────

interface RawDomData {
  id: string;
  created_at?: string;
  amount: number;
  status: string;
  payment_method?: string;
  installments?: string | number;
  serial_number?: string | null;
  customer?: {
    name?: string;
    email?: string;
    mobile_phone?: string;
    document?: string;
  };
  liquid_amount?: number | null;
  dom_fee?: number;
  [k: string]: unknown;
}

interface RawDomWebhook {
  event: string;
  signature: string;
  data: RawDomData;
}

// ─── Use-case ────────────────────────────────────────────────────────────────

@Injectable()
export class ProcessDomWebhookUseCase {
  private readonly logger = new Logger(ProcessDomWebhookUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly renovadaEvents?: RenovadaEventsService,
    @Optional() private readonly communities?: CommunityManagementService,
    @Optional() private readonly emailService?: EmailService,
  ) { }

  async execute(payload: unknown): Promise<void> {
    const event = this.parsePayload(payload);
    if (!event) {
      this.logger.warn('[DomWebhook] Payload inválido – ignorando');
      return;
    }

    // Idempotência atômica via unique constraint em eventId
    let wh: { id: string };
    try {
      wh = await this.prisma.webhookEvent.create({
        data: {
          eventId: event.signature,
          source: 'dom-webhook-direct',
          eventType: event.event,
          payload: payload as never,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.log(`[DomWebhook] ${event.signature} já processado – ignorando`);
        return;
      }
      throw err;
    }

    try {
      const serial = this.detectSerial(event.data);

      if (serial) {
        await this.handleMachineSync(event, serial);
      } else {
        // Verificar se é uma SubscriptionLinkOrder
        const handled = await this.handleSubscriptionLinkPix(event.data.id, event.data.status, wh.id);
        if (!handled) {
          await this.handleTransaction(event);
        }
      }

      await this.prisma.webhookEvent.update({
        where: { id: wh.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`[DomWebhook] Erro ao processar ${event.signature}: ${msg}`);
      await this.prisma.webhookEvent.update({
        where: { id: wh.id },
        data: { status: 'FAILED', error: msg, retryCount: { increment: 1 } },
      });
    }
  }

  // ─── Parsing e helpers ────────────────────────────────────────────────────

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
    if (data.serial_number && MACHINE_CONFIG[data.serial_number]) {
      return data.serial_number;
    }
    const name = data.customer?.name ?? '';
    const m = name.match(/Terminal:\s*([A-Z0-9]+)/);
    if (m && MACHINE_CONFIG[m[1]]) return m[1];
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

  private calcNet(amountReais: number, liquidAmountReais?: number | null): Prisma.Decimal {
    const factor = parseFloat(process.env.RENOVADA_LIQUIDEZ ?? '0.91');
    const liq = liquidAmountReais != null ? liquidAmountReais : amountReais * factor;
    return new Prisma.Decimal(liq);
  }

  private calcPaymentMethod(method?: string): PaymentMethod {
    return method?.toLowerCase().includes('card')
      ? PaymentMethod.CREDIT_CARD
      : PaymentMethod.PIX;
  }

  private getLiquidezFactor(userId: string): Prisma.Decimal {
    if (userId === RENOVADA_USER_ID) {
      return new Prisma.Decimal(process.env.RENOVADA_LIQUIDEZ ?? '0.91');
    }
    return new Prisma.Decimal(1);
  }

  // ─── Transação regular ────────────────────────────────────────────────────

  private async handleTransaction(event: RawDomWebhook): Promise<void> {
    const { data } = event;
    const nextStatus = this.mapStatus(data.status);
    if (!nextStatus) {
      this.logger.warn(`[DomWebhook] Status desconhecido "${data.status}" – ignorando`);
      return;
    }

    // DOM Pagamentos envia amount e liquid_amount em CENTAVOS → dividir por 100
    const amountDec = new Prisma.Decimal(data.amount / 100);
    const netDec = this.calcNet(
      data.amount / 100,
      data.liquid_amount != null ? data.liquid_amount / 100 : null,
    );
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

      const isRenovada = existing.userId === RENOVADA_USER_ID;
      // Renovada: wallet.balance é gross → delta = amountDec (bruto)
      // Outros: wallet.balance = netBalance → delta = netDec
      const delta = isRenovada ? amountDec : amountDec.mul(this.getLiquidezFactor(existing.userId));

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
            metadata: { reason: `dom-webhook: ${event.event}` },
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

        for (let attempt = 0; attempt < 3; attempt++) {
          const wallet = await p.wallet.findUnique({ where: { userId: existing.userId } });
          if (!wallet) break;

          const newBalance = wallet.balance.add(balanceDelta);
          const newLocked = wallet.lockedBalance.add(lockedDelta);

          const result = await p.wallet.updateMany({
            where: { id: wallet.id, version: wallet.version },
            data: { balance: newBalance, lockedBalance: newLocked, version: { increment: 1 } },
          });

          if (result.count > 0) {
            await p.balanceLog.create({
              data: {
                userId: existing.userId,
                action: `DOM_WEBHOOK_${nextStatus}`,
                transactionId: existing.id,
                amount: balanceDelta.abs(),
                balanceBefore: wallet.balance,
                balanceAfter: newBalance,
                lockedBefore: wallet.lockedBalance,
                lockedAfter: newLocked,
                source: 'DOM_WEBHOOK',
              },
            });
            break;
          }

          if (attempt === 2) {
            throw new Error('Wallet version conflict after 3 retries');
          }
        }
      });

      if (existing.userId === RENOVADA_USER_ID && this.renovadaEvents) {
        this.renovadaEvents.emitTransaction({ ...existing, status: nextStatus });
      }
    } else {
      // Segurança anti-mistura:
      // Se não houver transação pré-existente para o domPaymentId, este webhook não tem
      // contexto confiável de tenant para criar uma nova transação sem risco de atribuir
      // ao tenant errado (ex.: Renovada x Bosque). Nesse caso, ignoramos a criação.
      this.logger.warn(
        `[DomWebhook] domPaymentId=${data.id} sem transação prévia. Ignorando criação para evitar mistura de tenant.`,
      );
      return;

    }
  }

  // ─── Máquinetas físicas ───────────────────────────────────────────────────

  private async handleMachineSync(event: RawDomWebhook, serial: string): Promise<void> {
    const { data } = event;

    if (data.status !== 'paid') {
      this.logger.log(`[DomWebhook] Máquineta ${serial} status=${data.status} – sem sincronização`);
      return;
    }

    const userId = MACHINE_CONFIG[serial];

    const alreadySynced = await this.prisma.transaction.findFirst({
      where: { domPaymentId: data.id, userId },
    });
    if (alreadySynced) {
      this.logger.log(`[DomWebhook] Máquineta ${serial} tx ${data.id} já sincronizada`);
      return;
    }

    const amountDec = new Prisma.Decimal(data.amount / 100);
    const netDec = this.calcNet(
      data.amount / 100,
      data.liquid_amount != null ? data.liquid_amount / 100 : null,
    );

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
          description: appendInternalTags(
            `Sincronização Automática - Terminal: ${serial}`,
            [
              ...(userId === RENOVADA_USER_ID ? [TENANT_RENOVADA_TAG] : []),
              ...(userId === BOSQUE_USER_ID ? [TENANT_BOSQUE_TAG] : []),
              ORIGEM_MAQUINETA_TAG,
            ],
          ),
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

      for (let attempt = 0; attempt < 3; attempt++) {
        const wallet = await p.wallet.findUnique({ where: { userId } });
        if (!wallet) break;

        const newBalance = wallet.balance.add(amountDec);

        const result = await p.wallet.updateMany({
          where: { id: wallet.id, version: wallet.version },
          data: { balance: newBalance, version: { increment: 1 } },
        });

        if (result.count > 0) {
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
          break;
        }

        if (attempt === 2) {
          throw new Error('Wallet version conflict after 3 retries');
        }
      }

      return newTx;
    });

    if (userId === RENOVADA_USER_ID && this.renovadaEvents) {
      this.renovadaEvents.emitTransaction(tx);
    }
    this.logger.log(`[DomWebhook] Máquineta sincronizada: ${serial} → tx ${tx.id}`);
  }

  // ─── SubscriptionLinkOrder ────────────────────────────────────────────────

  private async handleSubscriptionLinkPix(
    domPixPaymentId: string,
    domStatus: string,
    webhookEventDbId: string,
  ): Promise<boolean> {
    const order = await this.prisma.subscriptionLinkOrder.findFirst({
      where: { domPixPaymentId },
      include: { subscriptionLink: true },
    });

    if (!order) return false;

    this.logger.log(
      `[DomWebhook] SubscriptionLinkOrder ${order.id} encontrada para domPixPaymentId=${domPixPaymentId}, status=${domStatus}`,
    );

    if (domStatus !== 'paid') {
      const statusMap: Record<string, string> = {
        expired: 'expired',
        failed: 'failed',
        refunded: 'refunded',
      };
      const newStatus = statusMap[domStatus];
      if (newStatus && order.status === 'pending') {
        await this.prisma.subscriptionLinkOrder.update({
          where: { id: order.id },
          data: { status: newStatus },
        });
      }
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventDbId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return true;
    }

    // Já processado
    if (order.status === 'paid') {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventDbId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return true;
    }

    // Marcar como pago
    await this.prisma.subscriptionLinkOrder.update({
      where: { id: order.id },
      data: { status: 'paid' },
    });

    // Ativar acesso à comunidade
    if (this.communities) {
      try {
        const binding = await this.prisma.communityLinkBinding.findFirst({
          where: { subscriptionLinkId: order.subscriptionLinkId },
        });

        if (binding) {
          await this.communities.activateOrRenewCommunityAccess({
            communityId: binding.communityId,
            userId: order.userId,
            frequencyType: order.subscriptionLink.frequencyType,
            paymentMethod: 'PIX',
            amountCharged: Number(order.amountCharged),
            subscriptionLinkOrderId: order.id,
          });
          this.logger.log(`[DomWebhook] Acesso à comunidade ativado para order ${order.id}`);
        }
      } catch (err: unknown) {
        this.logger.error(
          `[DomWebhook] Erro ao ativar comunidade para order ${order.id}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }

    // Enviar email de acesso
    if (this.emailService) {
      try {
        await this.emailService.sendSubscriptionAccess({
          to: order.customerEmail,
          customerName: order.customerName,
          linkName: order.subscriptionLink.name,
          redirectUrl: order.subscriptionLink.redirectUrl ?? null,
          orderId: order.id,
        });
        this.logger.log(`[DomWebhook] Email de acesso enviado para ${order.customerEmail}`);
      } catch (err: unknown) {
        this.logger.error(
          `[DomWebhook] Erro ao enviar email para order ${order.id}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }

    // Não atualizar webhookEventDbId aqui — o chamador (execute) fará isso
    return true;
  }
}
