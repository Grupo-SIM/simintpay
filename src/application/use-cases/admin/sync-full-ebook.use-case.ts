import { getPlatformOwnerId } from '../../../modules/module.registry';
import { getPlatformIntegrationValue } from '../../../modules/platform-integrations/platform-integrations.store';
import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, WithdrawStatus, PaymentMethod, Prisma } from '@prisma/client';
import { HASH_SERVICE } from '../../../core/services/hash.interface';
import type { IHashService } from '../../../core/services/hash.interface';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { appendInternalTags, TENANT_EBOOK_TAG } from '../../utils/internal-tags.util';
import { calculateSellerNetValue } from '../../helpers/transaction-fee.helper';

@Injectable()
export class SyncFullEbookUseCase {
  private readonly logger = new Logger(SyncFullEbookUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    @Inject(HASH_SERVICE) private readonly hashService: IHashService,
  ) {}

  async execute() {
    const EBOOK_ID = (getPlatformOwnerId('EBOOK') ?? '');
    const API_DOM_URL = getPlatformIntegrationValue('EBOOK', 'DOM_BACKEND_URL');
    const tokensRaw = (getPlatformIntegrationValue('EBOOK', 'API_DOM_XTOKEN') ?? undefined) || (getPlatformIntegrationValue('EBOOK', 'API_DOM_XTOKEN') ?? undefined) || '';
    const tokens = [...new Set(tokensRaw.split(',').map((t) => t.trim()).filter(Boolean))];
    if (tokens.length === 0) {
      return {
        message: 'EBOOK_APIDOM_XTOKENS/EBOOK_APIDOM_XTOKEN não configurado. Defina os tokens para sincronizar histórico legado do EBOOK.',
        totalTransactions: 0,
      };
    }


    const assignedOwner = await this.prisma.platform.findUnique({ where: { tag: 'EBOOK' }, include: { owner: true } });
    if (!assignedOwner?.isActive || !assignedOwner.owner.isActive || assignedOwner.owner.isPurged) throw new Error('Plataforma sem dono ativo cadastrado');

    await this.prisma.wallet.upsert({
      where: { userId: EBOOK_ID },
      update: {},
      create: { userId: EBOOK_ID, balance: 0, lockedBalance: 0 },
    });

    let totalSynced = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    let totalWithdrawals = 0;

    for (const ebookToken of tokens) {
      let page = 1;
      let hasMore = true;
      const LIMIT = 100;
      while (hasMore) {
        try {
          const res = await firstValueFrom(this.http.get<any>(`${API_DOM_URL}/payments/history`, {
            headers: { 'x-access-token': ebookToken, Accept: 'application/json' },
            params: { page, limit: LIMIT },
            timeout: 30000,
          }));

          const data = res.data;
          const txList: any[] = data?.transactions ?? [];
          const totalPages = data?.meta?.totalPages ?? 1;
          if (txList.length === 0) break;

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
              const amount = new Prisma.Decimal(tx.amount || 0);
              const netAmount = calculateSellerNetValue(Number(tx.amount || 0), Number(tx.installments || 1), 'EBOOK', 'pix');
              const totalFee = new Prisma.Decimal(tx.fee || Number(amount) - Number(netAmount));
              const domFee = new Prisma.Decimal(tx.dom_fee || 0);
              const platformFee = totalFee.sub(domFee).lessThan(0) ? new Prisma.Decimal(0) : totalFee.sub(domFee);
              const internalDescription = appendInternalTags(
                tx.description || existing?.description || 'Migração API-DOM',
                [TENANT_EBOOK_TAG],
              );

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
                    description: internalDescription,
                    customerName: tx.name || existing.customerName,
                    customerEmail: tx.email || existing.customerEmail,
                    customerDocument: tx.document || existing.customerDocument,
                    customerPhone: tx.mobile_phone || existing.customerPhone,
                    updatedAt: new Date(),
                  },
                });
                totalUpdated++;
              } else {
                await this.prisma.transaction.create({
                  data: {
                    userId: EBOOK_ID,
                    amount,
                    netAmount,
                    status: mappedStatus,
                    paymentMethod: this.mapPaymentMethod(tx.payment_method),
                    description: internalDescription,
                    domTransactionId: txId,
                    domPaymentId: paymentId,
                    customerName: tx.name,
                    customerEmail: tx.email,
                    customerDocument: tx.document,
                    customerPhone: tx.mobile_phone,
                    totalFee,
                    domFee,
                    platformFee,
                    installments: tx.installments || 1,
                    createdAt: new Date(tx.createdAt || new Date()),
                    updatedAt: tx.updatedAt ? new Date(tx.updatedAt) : new Date(tx.createdAt || new Date()),
                  },
                });
                totalSynced++;
              }
            } catch (err: any) {
              if (err?.code !== 'P2002') totalErrors++;
            }
          }

          if (page >= totalPages) hasMore = false;
          page++;
          if (page > 500) hasMore = false;
        } catch (err: any) {
          this.logger.error(`Erro ao sincronizar página ${page}: ${err.message}`);
          hasMore = false;
        }
      }

      // Saques (legado do api-dom)
      try {
        let wdPage = 1;
        let wdHasMore = true;
        while (wdHasMore) {
          const res = await firstValueFrom(this.http.get<any>(`${API_DOM_URL}/payments/withdrawals`, {
            headers: { 'x-access-token': ebookToken, Accept: 'application/json' },
            params: { page: wdPage, limit: 100 },
            timeout: 30000,
          }));
          const wdData = res.data;
          const withdrawals: any[] = wdData?.withdrawals ?? wdData?.data ?? [];
          if (withdrawals.length === 0) break;
          for (const w of withdrawals) {
            const exists = await this.prisma.withdrawRequest.findFirst({
              where: { OR: [...(w.id ? [{ domWithdrawId: w.id }, { id: w.id }] : [])] },
            });
            if (exists) continue;
            await this.prisma.withdrawRequest.create({
              data: {
                userId: EBOOK_ID,
                amount: Number(w.amount),
                grossAmount: Number(w.amount) + Number(w.fee || 2),
                fee: Number(w.fee || 2),
                status: this.mapWithdrawStatus(w.status),
                pixKey: w.pixKey || w.pix_key || 'migracao@ebook.com',
                receiptImage: w.receiptImage ?? null,
                domWithdrawId: w.id,
                createdAt: new Date(w.createdAt || w.created_at || new Date()),
              },
            });
            totalWithdrawals++;
          }
          const totalPages = wdData?.meta?.totalPages ?? 1;
          if (wdPage >= totalPages) wdHasMore = false;
          wdPage++;
          if (wdPage > 100) wdHasMore = false;
        }
      } catch (err: any) {
        this.logger.warn(`Falha ao sincronizar saques EBOOK: ${err.message}`);
      }
    }

    return {
      message: `Sincronização completa do EBOOK concluída (legado api-dom) para ${tokens.length} token(s).`,
      totalTransactions: totalSynced,
      totalUpdated,
      totalErrors,
      totalWithdrawals,
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
