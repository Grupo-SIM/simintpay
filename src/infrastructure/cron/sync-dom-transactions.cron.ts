import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { PAYMENT_GATEWAY } from '../../core/services/payment-gateway.interface';
import { PrismaService } from '../database/prisma/prisma.service';
import { TransactionStatus, Prisma } from '@prisma/client';
import dayjs from 'dayjs';

/**
 * SyncDomTransactionsCron - Atualiza STATUS de transações existentes.
 * 
 * NÃO cria transações novas. Transações novas vêm dos webhooks.
 * O master token retorna transações de TODAS as plataformas,
 * então não podemos criar transações a partir dele sem saber
 * a qual usuário pertencem.
 */
@Injectable()
export class SyncDomTransactionsCron implements OnModuleInit {
  private readonly logger = new Logger(SyncDomTransactionsCron.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.logger.log('SyncDomTransactionsCron initialized (status-update only mode)');
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleSync() {
    if (process.env.DISABLE_DOM_SYNC === 'true') {
      return;
    }

    this.logger.log('🔄 [CRON] Checking for transaction status updates...');

    try {
      const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
      if (!domToken) {
        this.logger.warn('[CRON] DOM_TOKEN not configured, skipping');
        return;
      }

      // IDs de usuários com serviços de sync dedicados — não processar aqui
      const revalidaUser = await this.prisma.user.findFirst({ where: { email: 'revalida@jbmidia.com.br' }, select: { id: true } });
      const DEDICATED_SYNC_USER_IDS = [
        'ba2b57d6-e3bf-4395-af31-58454f27207a', // Renovada
        process.env.BOSQUE_ID,                   // Bosque
        revalidaUser?.id,                        // Revalida
      ].filter(Boolean) as string[];

      // Buscar transações PENDENTES que precisam de atualização de status
      const pendingTxs = await this.prisma.transaction.findMany({
        where: {
          status: TransactionStatus.PENDING,
          domPaymentId: { not: null },
          // Excluir usuários com sync dedicado — eles gerenciam o próprio saldo
          userId: { notIn: DEDICATED_SYNC_USER_IDS },
          // Só transações recentes (últimas 48h)
          createdAt: { gte: dayjs().subtract(48, 'hour').toDate() },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      if (pendingTxs.length === 0) {
        this.logger.debug('[CRON] No pending transactions to check');
        return;
      }

      this.logger.log(`[CRON] Found ${pendingTxs.length} pending transactions to check`);

      const beginDate = dayjs().subtract(3, 'day').format('YYYY-MM-DD');
      const endDate = dayjs().format('YYYY-MM-DD');

      const response = await this.gateway.listDomTransactions(domToken, {
        page: 1,
        limit: 100,
        begin_date: beginDate,
        end_date: endDate,
      });

      if (!response?.transactions?.length) {
        this.logger.debug('[CRON] No transactions from DOM API');
        return;
      }

      // Criar mapa de status por DOM ID
      const domStatusMap = new Map<string, { status: string; liquid_amount?: number }>();
      for (const domTx of response.transactions) {
        const key = String(domTx.id);
        domStatusMap.set(key, { status: domTx.status, liquid_amount: domTx.liquid_amount });
        if (domTx.order_id) {
          domStatusMap.set(domTx.order_id, { status: domTx.status, liquid_amount: domTx.liquid_amount });
        }
      }

      let updatedCount = 0;

      for (const tx of pendingTxs) {
        const domInfo = domStatusMap.get(tx.domPaymentId!) || 
                        (tx.domTransactionId ? domStatusMap.get(tx.domTransactionId) : null);
        if (!domInfo) continue;

        const newStatus = this.mapStatus(domInfo.status);
        if (newStatus === tx.status) continue;

        await this.prisma.$transaction(async (p) => {
          await p.transaction.update({
            where: { id: tx.id },
            data: {
              status: newStatus,
              previousStatus: tx.status,
              updatedAt: new Date(),
            },
          });

          // Se completou, atualizar saldo
          if (newStatus === TransactionStatus.COMPLETED) {
            const netAmount = tx.netAmount || new Prisma.Decimal(Number(tx.amount) * 0.91);
            await p.wallet.update({
              where: { userId: tx.userId },
              data: {
                balance: { increment: netAmount },
                version: { increment: 1 },
              },
            });
          }
        });

        updatedCount++;
      }

      if (updatedCount > 0) {
        this.logger.log(`[CRON] Updated ${updatedCount} transaction statuses`);
      }
    } catch (error: any) {
      this.logger.error(`[CRON] Error: ${error.message}`);
    }
  }

  private mapStatus(domStatus: string): TransactionStatus {
    const s = (domStatus || '').toLowerCase();
    if (s === 'paid' || s === 'approved' || s === 'completed') return TransactionStatus.COMPLETED;
    if (s === 'refunded') return TransactionStatus.REFUNDED;
    if (s === 'chargeback') return TransactionStatus.CHARGEBACK;
    if (s === 'failed' || s === 'not_authorized' || s === 'refused') return TransactionStatus.FAILED;
    if (s === 'expired') return TransactionStatus.EXPIRED;
    return TransactionStatus.PENDING;
  }
}
