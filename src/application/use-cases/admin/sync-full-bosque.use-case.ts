import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, WithdrawStatus, PaymentMethod, Prisma } from '@prisma/client';
import { HASH_SERVICE } from '../../../core/services/hash.interface';
import type { IHashService } from '../../../core/services/hash.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import dayjs from 'dayjs';

@Injectable()
export class SyncFullBosqueUseCase {
  private readonly logger = new Logger(SyncFullBosqueUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(HASH_SERVICE) private readonly hashService: IHashService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute() {
    const BOSQUE_ID    = process.env.BOSQUE_ID    || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const BOSQUE_EMAIL = process.env.BOSQUE_EMAIL  || 'contato@bosque.com.br';
    const BOSQUE_NAME  = 'Bosque';
    const DOM_TOKEN    = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;

    if (!DOM_TOKEN) {
      return { message: 'ERRO: DOM_TOKEN não configurado', totalTransactions: 0 };
    }

    this.logger.log('=== SINCRONIZAÇÃO COMPLETA BOSQUE ===');
    this.logger.log(`BOSQUE_ID: ${BOSQUE_ID}`);

    const hashedPassword = await this.hashService.hash('password-migrated');

    // 1. Upsert usuário Bosque
    await this.prisma.user.upsert({
      where: { id: BOSQUE_ID },
      update: { email: BOSQUE_EMAIL, name: BOSQUE_NAME, password: hashedPassword, domToken: null },
      create: {
        id: BOSQUE_ID,
        name: BOSQUE_NAME,
        email: BOSQUE_EMAIL,
        password: hashedPassword,
        role: 'USER',
        domToken: null,
      },
    });

    const bosqueModule = await this.prisma.tenantModule.findUnique({ where: { slug: 'bosque' } });
    if (bosqueModule) {
      await this.prisma.user.update({
        where: { id: BOSQUE_ID },
        data: { tenantModuleId: bosqueModule.id },
      });
    }

    await this.prisma.wallet.upsert({
      where: { userId: BOSQUE_ID },
      update: {},
      create: { userId: BOSQUE_ID, balance: 0, lockedBalance: 0 },
    });

    // 2. Testar conexão — 1 item nos últimos 90 dias
    this.logger.log('Testando conexão com DOM Pagamentos...');
    try {
      await this.gateway.listDomTransactions(DOM_TOKEN, {
        page: 1,
        limit: 1,
        begin_date: dayjs().subtract(90, 'day').format('YYYY-MM-DD'),
        end_date: dayjs().format('YYYY-MM-DD'),
      });
      this.logger.log('Conexão OK!');
    } catch (err: any) {
      return {
        message: `ERRO: Não foi possível conectar à DOM Pagamentos: ${err.message}`,
        totalTransactions: 0,
      };
    }

    // 3. Buscar IDs existentes do Bosque para filtrar
    const existingBosqueTxs = await this.prisma.transaction.findMany({
      where: { userId: BOSQUE_ID },
      select: { id: true, domPaymentId: true },
    });
    const existingIds = new Set<string>(
      existingBosqueTxs.flatMap(t => [t.id, t.domPaymentId].filter(Boolean) as string[]),
    );

    this.logger.log(`Transações existentes do Bosque no banco: ${existingBosqueTxs.length}`);

    // 4. Iterar em blocos de 3 meses desde 2023 até hoje
    let totalSynced  = 0;
    let totalSkipped = 0;
    let totalErrors  = 0;

    const startFrom = dayjs('2023-01-01');
    const today     = dayjs();
    let blockStart  = startFrom;

    while (blockStart.isBefore(today)) {
      const blockEnd = blockStart.add(3, 'month').subtract(1, 'day');
      const begin_date = blockStart.format('YYYY-MM-DD');
      const end_date   = (blockEnd.isAfter(today) ? today : blockEnd).format('YYYY-MM-DD');

      this.logger.log(`Bloco: ${begin_date} → ${end_date}`);

      let page = 1;
      let hasMore = true;

      while (hasMore) {
        try {
          const result = await this.gateway.listDomTransactions(DOM_TOKEN, {
            page,
            limit: 100,
            begin_date,
            end_date,
          });

          const txList = result.transactions ?? [];
          this.logger.log(`  Página ${page}: ${txList.length} transações`);

          if (txList.length === 0) { hasMore = false; break; }

          for (const tx of txList) {
            try {
              const domPaymentId = tx.id;
              const codExternal  = tx.externalRef ?? tx.id;

              // Filtra: só processa se pertence ao Bosque
              if (!existingIds.has(domPaymentId) && !existingIds.has(codExternal)) continue;

              const mappedStatus = this.mapStatus(tx.status);
              const amount    = new Prisma.Decimal(tx.amount ?? 0);
              const netAmount = new Prisma.Decimal(tx.liquidAmount ?? Number(tx.amount ?? 0) * 0.91);
              const domFee    = amount.sub(netAmount).lessThan(0) ? new Prisma.Decimal(0) : amount.sub(netAmount);

              const existing = await this.prisma.transaction.findFirst({
                where: { OR: [{ domPaymentId }, { id: codExternal }] },
              });

              if (existing) {
                await this.prisma.transaction.update({
                  where: { id: existing.id },
                  data: {
                    status: mappedStatus,
                    amount,
                    netAmount,
                    domFee,
                    totalFee: domFee,
                    customerName:     tx.customerName     || existing.customerName,
                    customerEmail:    tx.customerEmail    || existing.customerEmail,
                    customerDocument: tx.customerDocument || existing.customerDocument,
                    updatedAt: new Date(),
                  },
                });
                totalSkipped++;
                continue;
              }

              await this.prisma.transaction.create({
                data: {
                  userId:           BOSQUE_ID,
                  amount,
                  netAmount,
                  status:           mappedStatus,
                  paymentMethod:    this.mapPaymentMethod(tx.paymentMethod),
                  description:      tx.description || 'Migração Bosque',
                  domPaymentId,
                  customerName:     tx.customerName,
                  customerEmail:    tx.customerEmail,
                  customerDocument: tx.customerDocument,
                  customerPhone:    tx.customerPhone,
                  totalFee:         domFee,
                  domFee,
                  platformFee:      new Prisma.Decimal(0),
                  installments:     tx.installments ?? 1,
                  createdAt:        tx.createdAt ? new Date(tx.createdAt) : new Date(),
                  updatedAt:        tx.createdAt ? new Date(tx.createdAt) : new Date(),
                },
              });
              totalSynced++;
            } catch (err: any) {
              if (err.code === 'P2002') { totalSkipped++; }
              else {
                totalErrors++;
                if (totalErrors <= 5) this.logger.warn(`Erro tx: ${err.message}`);
              }
            }
          }

          if (txList.length < 100) { hasMore = false; } else { page++; }
          if (page > 100) hasMore = false;
        } catch (err: any) {
          this.logger.error(`Erro página ${page}: ${err.message}`);
          hasMore = false;
        }
      }

      blockStart = blockStart.add(3, 'month');
    }

    this.logger.log(`Transações: ${totalSynced} novas, ${totalSkipped} atualizadas, ${totalErrors} erros`);

    // 5. Recalcular saldo
    const completedTxs = await this.prisma.transaction.aggregate({
      where: { userId: BOSQUE_ID, status: TransactionStatus.COMPLETED },
      _sum: { netAmount: true },
    });

    const completedWithdraws = await this.prisma.withdrawRequest.aggregate({
      where: {
        userId: BOSQUE_ID,
        status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] },
      },
      _sum: { amount: true },
    });

    const totalReceived  = Number(completedTxs._sum.netAmount || 0);
    const totalWithdrawn = Number(completedWithdraws._sum.amount || 0);
    const calculatedBalance = Math.max(0, totalReceived - totalWithdrawn);

    await this.prisma.wallet.update({
      where: { userId: BOSQUE_ID },
      data: { balance: calculatedBalance },
    });

    const totalInDb = await this.prisma.transaction.count({ where: { userId: BOSQUE_ID } });

    this.logger.log('=== SINCRONIZAÇÃO BOSQUE CONCLUÍDA ===');
    this.logger.log(`  Total no banco: ${totalInDb}`);
    this.logger.log(`  Saldo: R$ ${calculatedBalance.toFixed(2)}`);

    return {
      message: 'Sincronização completa do Bosque realizada com sucesso',
      totalTransactions: totalSynced,
      totalSkipped,
      totalErrors,
      totalInDatabase: totalInDb,
      balance: calculatedBalance,
      totalReceived,
      totalWithdrawn,
    };
  }

  private mapStatus(domStatus: string): TransactionStatus {
    const s = (domStatus || '').toUpperCase();
    if (s === 'PAID' || s === 'APPROVED' || s === 'COMPLETED') return TransactionStatus.COMPLETED;
    if (s === 'PENDING' || s === 'WAITING' || s === 'AUTHORIZED') return TransactionStatus.PENDING;
    if (s === 'REFUSED' || s === 'CANCELED' || s === 'FAILED' || s === 'ERROR' || s === 'NOT_AUTHORIZED') return TransactionStatus.FAILED;
    if (s === 'REFUNDED') return TransactionStatus.REFUNDED;
    if (s === 'EXPIRED') return TransactionStatus.EXPIRED;
    if (s === 'CHARGEBACK') return TransactionStatus.CHARGEBACK;
    return TransactionStatus.DRAFT;
  }

  private mapPaymentMethod(domMethod: string): PaymentMethod {
    const m = (domMethod || '').toLowerCase();
    if (m.includes('pix')) return PaymentMethod.PIX;
    if (m.includes('card') || m.includes('credit')) return PaymentMethod.CREDIT_CARD;
    return PaymentMethod.PIX;
  }
}
