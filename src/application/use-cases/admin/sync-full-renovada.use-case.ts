import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { TransactionStatus, WithdrawStatus, PaymentMethod } from '@prisma/client';
import { HASH_SERVICE } from '../../../core/services/hash.interface';
import type { IHashService } from '../../../core/services/hash.interface';
import type { JwtPayload } from '../../../infrastructure/security/strategies/jwt.strategy';

@Injectable()
export class SyncFullRenovadaUseCase {
  private readonly logger = new Logger(SyncFullRenovadaUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    @Inject(HASH_SERVICE) private readonly hashService: IHashService,
  ) {}

  async execute() {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    const RENOVADA_TOKEN = process.env.RENOVADA_DOM_TOKEN || '4a29df01-a980-45e3-b3c7-1a8b8eb7850f';
    const RENOVADA_EMAIL = process.env.RENOVADA_EMAIL || 'contato@renovada12.com.br';
    const RENOVADA_NAME = 'Renovada 12';

    this.logger.log(`LIMPEZA: Apagando dados antigos da Renovada (${RENOVADA_ID}) para sincronização limpa...`);
    
    // Apaga transações e saques para evitar lixo de sincronizações parciais
    await this.prisma.transaction.deleteMany({ where: { userId: RENOVADA_ID } });
    await this.prisma.withdrawRequest.deleteMany({ where: { userId: RENOVADA_ID } });

    this.logger.log(`INICIANDO SINCRONIZAÇÃO COMPLETA (3.600+ registros)...`);

    const hashedPassword = await this.hashService.hash('password-migrated');

    // 1. Upsert Usuário & Carteira
    await this.prisma.user.upsert({
      where: { id: RENOVADA_ID },
      update: {
        domToken: RENOVADA_TOKEN,
        email: RENOVADA_EMAIL,
        name: RENOVADA_NAME,
        password: hashedPassword,
      },
      create: {
        id: RENOVADA_ID,
        name: RENOVADA_NAME,
        email: RENOVADA_EMAIL,
        password: hashedPassword,
        domToken: RENOVADA_TOKEN,
        role: 'USER',
      },
    });

    // 2. Sincronizar Saldo Atual (Summary)
    const MASTER_TOKEN = process.env.API_DOM_MASTER_KEY || process.env.DOM_TOKEN || RENOVADA_TOKEN;
    console.log(`[SyncFullRenovada] Sincronizando saldo com token ${MASTER_TOKEN.substring(0, 5)}...`);
    let balance = 0;
    let lockedBalance = 0;
    try {
      const summary = await this.gateway.getDomSummary(MASTER_TOKEN);
      balance = Number(summary?.netBalance || summary?.balance || 0);
      lockedBalance = Number(summary?.lockedBalance || 0);
    } catch (err) {
      console.error(`[SyncFullRenovada] Erro ao buscar summary (continuando sem saldo): ${err.message}`);
    }

    await this.prisma.wallet.upsert({
      where: { userId: RENOVADA_ID },
      update: { balance, lockedBalance },
      create: { userId: RENOVADA_ID, balance, lockedBalance },
    });

    // 3. Sincronizar Histórico de Transações (Paginado)
    this.logger.log('Sincronizando transações (Histórico total)...');
    let page = 1;
    let totalSynced = 0;
    let hasMore = true;

    while (hasMore) {
      this.logger.log(`Buscando página ${page} de transações...`);
      const transResult = await this.gateway.listAllTransactionsDirectlyFromDom({
        page,
        limit: 100,
        begin_date: '2023-01-01',
        end_date: '2026-12-31'
      });
      
      const txList = Array.isArray(transResult?.transactions) ? transResult.transactions
        : Array.isArray(transResult?.data) ? transResult.data
        : Array.isArray(transResult) ? transResult
        : [];

      if (txList.length === 0) {
        hasMore = false;
        break;
      }

      const transactionsToCreate = txList.map((tx: any) => ({
        id: tx.id.length === 36 ? tx.id : undefined,
        userId: RENOVADA_ID,
        amount: tx.amount,
        netAmount: tx.liquid_amount,
        status: this.mapTransactionStatus(tx.status),
        paymentMethod: this.mapPaymentMethod(tx.payment_method),
        description: tx.product_first || 'Migração Histórica',
        domTransactionId: tx.id,
        domPaymentId: tx.order_id,
        customerName: tx.customer_name,
        customerEmail: tx.customer_email,
        customerDocument: tx.customer_document,
        customerPhone: tx.customer_phone,
        totalFee: tx.fee_total || 0,
        domFee: tx.dom_fee || 0,
        createdAt: new Date(tx.created_at),
        updatedAt: tx.updated_at ? new Date(tx.updated_at) : new Date(tx.created_at),
      }));

      // Inserção em massa ou um a um para garantir consistência
      for (const txData of transactionsToCreate) {
        try {
          await this.prisma.transaction.create({ data: txData });
          totalSynced++;
        } catch (err) {
          this.logger.warn(`Erro ao inserir transação ${txData.domTransactionId}: ${err.message}`);
        }
      }

      this.logger.log(`Página ${page} processada. Total até agora: ${totalSynced}`);
      
      // Se pegamos menos que o limite, chegamos ao fim
      if (txList.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
      
      // Limite de segurança para testes (37 páginas para cobrir os 3601 registros)
      if (page > 500) hasMore = false;
    }

    // 4. Sincronizar Saques (Paginado)
    this.logger.log('Sincronizando saques (Histórico total)...');
    page = 1;
    let totalWithdrawalsSynced = 0;
    hasMore = true;

    while (hasMore) {
      const withdrawResult = await this.gateway.listDomWithdraws(RENOVADA_TOKEN, { page, limit: 100 });
      
      if (!withdrawResult.withdraws || withdrawResult.withdraws.length === 0) {
        hasMore = false;
        break;
      }

      for (const w of withdrawResult.withdraws) {
        try {
          await this.prisma.withdrawRequest.create({
            data: {
              id: w.id_transfer.length === 36 ? w.id_transfer : undefined,
              userId: RENOVADA_ID,
              amount: Number(w.value),
              grossAmount: Number(w.value) + 2,
              fee: 2.0,
              status: this.mapWithdrawStatus(w.status),
              pixKey: w.pix_key || 'migracao@simpay.com',
              receiptImage: w.receivers?.[0]?.receipt_url ?? null,
              domWithdrawId: w.id_transfer,
              createdAt: new Date(w.create_date),
            },
          });
          totalWithdrawalsSynced++;
        } catch (err) {
          // Já existe ou erro de ID
        }
      }

      if (withdrawResult.withdraws.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
      if (page > 100) hasMore = false;
    }

    this.logger.log(`Sincronização concluída. Transações: ${totalSynced}, Saques: ${totalWithdrawalsSynced}`);
    return {
      message: 'Sincronização completa realizada com sucesso',
      totalTransactions: totalSynced,
      totalWithdrawals: totalWithdrawalsSynced,
      balance,
    };
  }

  private mapTransactionStatus(domStatus: string): TransactionStatus {
    const s = domStatus.toUpperCase();
    if (s === 'PAID' || s === 'APPROVED' || s === 'COMPLETED') return TransactionStatus.COMPLETED;
    if (s === 'PENDING' || s === 'WAITING' || s === 'AUTHORIZED') return TransactionStatus.PENDING;
    if (s === 'REFUSED' || s === 'CANCELED' || s === 'FAILED' || s === 'ERROR') return TransactionStatus.FAILED;
    return TransactionStatus.DRAFT;
  }

  private mapPaymentMethod(domMethod: string): PaymentMethod {
    const m = domMethod.toLowerCase();
    if (m.includes('pix')) return PaymentMethod.PIX;
    if (m.includes('card') || m.includes('credit')) return PaymentMethod.CREDIT_CARD;
    return PaymentMethod.PIX;
  }

  private mapWithdrawStatus(domStatus: string): WithdrawStatus {
    const s = domStatus.toLowerCase();
    if (s.includes('paid') || s.includes('completed')) return WithdrawStatus.COMPLETED;
    if (s.includes('rejected') || s.includes('canceled') || s.includes('failed')) return WithdrawStatus.REJECTED;
    return WithdrawStatus.PENDING;
  }
}
