import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, WithdrawStatus, PaymentMethod, Prisma } from '@prisma/client';
import { HASH_SERVICE } from '../../../core/services/hash.interface';
import type { IHashService } from '../../../core/services/hash.interface';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class SyncFullBosqueUseCase {
  private readonly logger = new Logger(SyncFullBosqueUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    @Inject(HASH_SERVICE) private readonly hashService: IHashService,
  ) {}

  async execute() {
    const BOSQUE_ID    = process.env.BOSQUE_ID    || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const BOSQUE_EMAIL = process.env.BOSQUE_EMAIL  || 'contato@bosque.com.br';
    const BOSQUE_NAME  = 'Igreja Batista do Bosque';
    const API_DOM_URL  = process.env.DOM_BACKEND_URL || 'https://api-dom.jbmidia.com';
    const BOSQUE_APIDOM_XTOKEN = process.env.BOSQUE_APIDOM_XTOKEN || '0ba3f139-b1ff-4ded-a5ef-71ccb1c9482f';

    this.logger.log('=== SINCRONIZAÇÃO COMPLETA BOSQUE ===');
    this.logger.log(`BOSQUE_ID: ${BOSQUE_ID}`);
    this.logger.log(`API_DOM_URL: ${API_DOM_URL}`);
    this.logger.log(`Token: ${BOSQUE_APIDOM_XTOKEN.substring(0, 8)}...`);

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

    // 2. Testar conexão com api-dom
    this.logger.log('Testando conexão com api-dom...');
    try {
      const testRes = await firstValueFrom(this.http.get<any>(`${API_DOM_URL}/payments/history`, {
        headers: { 'x-access-token': BOSQUE_APIDOM_XTOKEN, 'Accept': 'application/json' },
        params: { page: 1, limit: 1 },
        timeout: 10000,
      }));
      this.logger.log(`Conexão OK! Total: ${testRes.data?.meta?.totalItems ?? 'desconhecido'}`);
    } catch (err: any) {
      this.logger.error(`FALHA na conexão com api-dom: ${err.message}`);
      return {
        message: `ERRO: Não foi possível conectar ao api-dom. ${err.message}`,
        totalTransactions: 0,
      };
    }

    // 3. Sincronizar Transações
    this.logger.log('Iniciando sincronização de transações...');
    let totalSynced  = 0;
    let totalSkipped = 0;
    let totalErrors  = 0;
    let page = 1;
    let hasMore = true;
    const LIMIT = 100;

    while (hasMore) {
      try {
        this.logger.log(`Buscando página ${page}...`);
        const res = await firstValueFrom(this.http.get<any>(`${API_DOM_URL}/payments/history`, {
          headers: { 'x-access-token': BOSQUE_APIDOM_XTOKEN, 'Accept': 'application/json' },
          params: { page, limit: LIMIT },
          timeout: 30000,
        }));

        const data = res.data;
        const txList: any[] = data?.transactions ?? [];
        const totalPages = data?.meta?.totalPages ?? 1;
        const totalItems = data?.meta?.totalItems ?? 0;

        if (txList.length === 0) { hasMore = false; break; }

        this.logger.log(`Página ${page}/${totalPages}: ${txList.length} transações (total: ${totalItems})`);

        for (const tx of txList) {
          try {
            const paymentId = tx.paymentId || tx.id;
            const txId = tx.id;

            const existing = await this.prisma.transaction.findFirst({
              where: {
                OR: [
                  ...(paymentId ? [{ domPaymentId: paymentId }] : []),
                  ...(txId ? [{ domTransactionId: txId }] : []),
                ],
              },
            });

            const mappedStatus = this.mapStatus(tx.status);
            const amount      = new Prisma.Decimal(tx.amount || 0);
            const netAmount   = new Prisma.Decimal(tx.amountWithoutAllFee ?? Number(tx.amount || 0) * 0.91);
            const totalFee    = new Prisma.Decimal(tx.fee || 0);
            const domFee      = new Prisma.Decimal(tx.dom_fee || 0);
            const platformFee = totalFee.sub(domFee).lessThan(0) ? new Prisma.Decimal(0) : totalFee.sub(domFee);

            if (existing) {
              await this.prisma.transaction.update({
                where: { id: existing.id },
                data: {
                  status: mappedStatus,
                  amount,
                  netAmount,
                  totalFee,
                  domFee,
                  platformFee,
                  description:      tx.description || existing.description,
                  customerName:     tx.name        || existing.customerName,
                  customerEmail:    tx.email       || existing.customerEmail,
                  customerDocument: tx.document    || existing.customerDocument,
                  customerPhone:    tx.mobile_phone || existing.customerPhone,
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
                paymentMethod:    this.mapPaymentMethod(tx.payment_method),
                description:      tx.description || 'Migração Bosque',
                domTransactionId: txId,
                domPaymentId:     paymentId,
                customerName:     tx.name,
                customerEmail:    tx.email,
                customerDocument: tx.document,
                customerPhone:    tx.mobile_phone,
                totalFee,
                domFee,
                platformFee,
                installments:     tx.installments || 1,
                createdAt:        new Date(tx.createdAt),
                updatedAt:        tx.updatedAt ? new Date(tx.updatedAt) : new Date(tx.createdAt),
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

        if (page >= totalPages) { hasMore = false; } else { page++; }
        if (page > 500) hasMore = false;
      } catch (err: any) {
        this.logger.error(`Erro página ${page}: ${err.message}`);
        hasMore = false;
      }
    }

    this.logger.log(`Transações: ${totalSynced} novas, ${totalSkipped} atualizadas, ${totalErrors} erros`);

    // 4. Sincronizar Saques
    this.logger.log('Sincronizando saques...');
    let totalWithdrawalsSynced = 0;
    try {
      let wdPage = 1;
      let wdHasMore = true;

      while (wdHasMore) {
        const res = await firstValueFrom(this.http.get<any>(`${API_DOM_URL}/payments/withdrawals`, {
          headers: { 'x-access-token': BOSQUE_APIDOM_XTOKEN, 'Accept': 'application/json' },
          params: { page: wdPage, limit: 100 },
          timeout: 30000,
        }));

        const wdData = res.data;
        const withdrawals: any[] = wdData?.withdrawals ?? wdData?.data ?? [];

        if (withdrawals.length === 0) { wdHasMore = false; break; }

        for (const w of withdrawals) {
          try {
            const existing = await this.prisma.withdrawRequest.findFirst({
              where: { OR: [...(w.id ? [{ domWithdrawId: w.id }, { id: w.id }] : [])] },
            });
            if (existing) continue;

            await this.prisma.withdrawRequest.create({
              data: {
                userId:       BOSQUE_ID,
                amount:       Number(w.amount),
                grossAmount:  Number(w.amount) + Number(w.fee || 2),
                fee:          Number(w.fee || 2),
                status:       this.mapWithdrawStatus(w.status),
                pixKey:       w.pixKey || w.pix_key || 'migracao@simpay.com',
                receiptImage: w.receiptImage ?? null,
                domWithdrawId: w.id,
                createdAt:    new Date(w.createdAt || w.created_at || new Date()),
              },
            });
            totalWithdrawalsSynced++;
          } catch (err: any) {
            if (err.code !== 'P2002') this.logger.warn(`Erro saque: ${err.message}`);
          }
        }

        const wdTotalPages = wdData?.meta?.totalPages ?? 1;
        if (wdPage >= wdTotalPages) { wdHasMore = false; } else { wdPage++; }
        if (wdPage > 100) wdHasMore = false;
      }
    } catch (err: any) {
      this.logger.error(`Erro saques: ${err.message}`);
    }

    // 5. Saldo — não recalcula automaticamente; use POST /admin/sync/sync-wallet-bosque?balance=X para definir o saldo correto
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: BOSQUE_ID } });
    const currentBalance = Number(wallet?.balance ?? 0);

    const totalInDb = await this.prisma.transaction.count({ where: { userId: BOSQUE_ID } });

    this.logger.log('=== SINCRONIZAÇÃO BOSQUE CONCLUÍDA ===');
    this.logger.log(`  Transações: ${totalSynced} novas, ${totalSkipped} atualizadas`);
    this.logger.log(`  Total no banco: ${totalInDb}`);
    this.logger.log(`  Saques: ${totalWithdrawalsSynced}`);
    this.logger.log(`  Saldo atual: R$ ${currentBalance.toFixed(2)}`);

    return {
      message: 'Sincronização completa do Bosque realizada com sucesso. Use POST /admin/sync/sync-wallet-bosque?balance=X para definir o saldo correto.',
      totalTransactions: totalSynced,
      totalSkipped,
      totalErrors,
      totalInDatabase: totalInDb,
      totalWithdrawals: totalWithdrawalsSynced,
      currentBalance,
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

  private mapWithdrawStatus(domStatus: string): WithdrawStatus {
    const s = (domStatus || '').toLowerCase();
    if (s.includes('paid') || s.includes('completed') || s.includes('approved')) return WithdrawStatus.APPROVED;
    if (s.includes('rejected') || s.includes('canceled') || s.includes('failed')) return WithdrawStatus.REJECTED;
    return WithdrawStatus.PENDING;
  }
}
