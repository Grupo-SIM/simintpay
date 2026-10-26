import { requireExclusivePlatformWallet } from '../../helpers/exclusive-platform-wallet.helper';
import { getPlatformOwnerId } from '../../../modules/module.registry';
import { getPlatformIntegrationValue } from '../../../modules/platform-integrations/platform-integrations.store';
import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, WithdrawStatus, PaymentMethod, Prisma } from '@prisma/client';
import { HASH_SERVICE } from '../../../core/services/hash.interface';
import type { IHashService } from '../../../core/services/hash.interface';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import dayjs from 'dayjs';
import { appendInternalTags, TENANT_RENOVADA_TAG } from '../../utils/internal-tags.util';
import { RenovadaConfig } from '../../../modules/renovada/renovada.config';

@Injectable()
export class SyncFullRenovadaUseCase {
  private readonly logger = new Logger(SyncFullRenovadaUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    @Inject(HASH_SERVICE) private readonly hashService: IHashService,
  ) {}

  async execute() {
    const RENOVADA_ID = (getPlatformOwnerId('RENOVADA') ?? '');
    const RENOVADA_NAME = 'Renovada 12';

    /**
     * Usamos o api-dom para buscar transações da Renovada,
     * porque o token DOM (55ac4...) é da CONTA MASTER e retorna transações
     * de TODAS as plataformas.
     * 
     * O api-dom já tem a separação por userId correta no banco dele.
     * O x-access-token "4a29df01..." mapeia para o user da Renovada no api-dom.
     */
    const API_DOM_URL = getPlatformIntegrationValue('RENOVADA', 'DOM_BACKEND_URL');
    // x-access-token do api-dom para a Renovada (NÃO é o token da DOM Pagamentos!)
    // Usar RENOVADA_APIDOM_XTOKEN para não confundir com RENOVADA_DOM_TOKEN (que em prod é o master)
    const RENOVADA_API_DOM_TOKEN = (getPlatformIntegrationValue('RENOVADA', 'API_DOM_XTOKEN') ?? undefined);

    if (!API_DOM_URL || !RENOVADA_API_DOM_TOKEN) throw new Error('Integração da plataforma não configurada');

    this.logger.log(`=== SINCRONIZAÇÃO COMPLETA RENOVADA ===`);
    this.logger.log(`RENOVADA_ID: ${RENOVADA_ID}`);
    this.logger.log(`API_DOM_URL: ${API_DOM_URL}`);


    // 1. Upsert Usuário & Carteira (NÃO setar domToken — é master e traria tudo)
    const assignedOwner = await this.prisma.platform.findUnique({ where: { tag: 'RENOVADA' }, include: { owner: true } });
    if (!assignedOwner?.isActive || !assignedOwner.owner.isActive || assignedOwner.owner.isPurged) throw new Error('Plataforma sem dono ativo cadastrado');
    await requireExclusivePlatformWallet(this.prisma, assignedOwner.ownerUserId, 'RENOVADA');

    await this.prisma.wallet.upsert({
      where: { userId: RENOVADA_ID },
      update: {},
      create: { userId: RENOVADA_ID, balance: 0, lockedBalance: 0 },
    });

    // 2. Testar conexão com api-dom primeiro
    this.logger.log('Testando conexão com api-dom...');
    try {
      const testRes = await firstValueFrom(this.http.get<any>(`${API_DOM_URL}/payments/history`, {
        headers: {
          'x-access-token': RENOVADA_API_DOM_TOKEN,
          'Accept': 'application/json',
        },
        params: { page: 1, limit: 1 },
        timeout: 10000,
      }));
      
      this.logger.log(`Conexão OK! Total de transações no api-dom: ${testRes.data?.meta?.totalItems ?? 'desconhecido'}`);
      this.logger.log(`Resposta test: ${JSON.stringify(testRes.data?.meta)}`);
    } catch (testErr: any) {
      this.logger.error(`FALHA na conexão com api-dom: ${testErr.message}`);
      this.logger.error(`Status: ${testErr.response?.status}`);
      this.logger.error(`Data: ${JSON.stringify(testErr.response?.data)}`);
      return {
        message: `ERRO: Não foi possível conectar ao api-dom (${API_DOM_URL}). Verifique se está acessível.`,
        error: testErr.message,
        totalTransactions: 0,
      };
    }

    // 3. Sincronizar Transações
    this.logger.log('Iniciando sincronização de transações...');
    let totalSynced = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let page = 1;
    let hasMore = true;
    const LIMIT = 100;

    while (hasMore) {
      try {
        this.logger.log(`Buscando página ${page}...`);

        const res = await firstValueFrom(this.http.get<any>(`${API_DOM_URL}/payments/history`, {
          headers: {
            'x-access-token': RENOVADA_API_DOM_TOKEN,
            'Accept': 'application/json',
          },
          params: { page, limit: LIMIT },
          timeout: 30000,
        }));

        const data = res.data;
        const txList: any[] = data?.transactions ?? [];
        const totalPages = data?.meta?.totalPages ?? 1;
        const totalItems = data?.meta?.totalItems ?? 0;

        if (txList.length === 0) {
          this.logger.log(`Página ${page}: 0 transações (fim)`);
          hasMore = false;
          break;
        }

        this.logger.log(`Página ${page}/${totalPages}: ${txList.length} transações (total: ${totalItems})`);

        for (const tx of txList) {
          try {
            const paymentId = tx.paymentId || tx.id;
            const txId = tx.id;

            // Verificar se já existe
            const existing = await this.prisma.transaction.findFirst({
              where: {
                OR: [
                  ...(paymentId ? [{ domPaymentId: paymentId }] : []),
                  ...(txId ? [{ domTransactionId: txId }] : []),
                ],
              },
            });

            const mappedStatus = this.mapTransactionStatus(tx.status);
            const amount = new Prisma.Decimal(tx.amount || 0);
            
            const liquidez = RenovadaConfig.saque.fatorLiquidez;
            const netAmountVal = Number(tx.amount || 0) * liquidez;
            const netAmount = new Prisma.Decimal(netAmountVal);

            const totalFeeVal = Number(tx.amount || 0) - netAmountVal;
            const totalFee = new Prisma.Decimal(totalFeeVal);

            const domFeeVal = Math.min(totalFeeVal, Number(tx.dom_fee || totalFeeVal * 0.4));
            const domFee = new Prisma.Decimal(domFeeVal);
            const platformFee = new Prisma.Decimal(Math.max(0, totalFeeVal - domFeeVal));
            const internalDescription = appendInternalTags(
              tx.description || existing?.description || 'Migração API-DOM',
              [TENANT_RENOVADA_TAG],
            );

            if (existing) {
              // Atualizar
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
              totalSkipped++;
              continue;
            }

            // Criar nova
            await this.prisma.transaction.create({
              data: {
                userId: RENOVADA_ID,
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
                createdAt: new Date(tx.createdAt),
                updatedAt: tx.updatedAt ? new Date(tx.updatedAt) : new Date(tx.createdAt),
              },
            });
            totalSynced++;
          } catch (err: any) {
            if (err.code === 'P2002') {
              totalSkipped++;
            } else {
              totalErrors++;
              if (totalErrors <= 5) {
                this.logger.warn(`Erro ao processar transação: ${err.message}`);
              }
            }
          }
        }

        if (page >= totalPages) {
          hasMore = false;
        } else {
          page++;
        }

        if (page > 500) hasMore = false;
      } catch (err: any) {
        this.logger.error(`Erro ao buscar página ${page}: ${err.message}`);
        this.logger.error(`Response status: ${err.response?.status}`);
        this.logger.error(`Response data: ${JSON.stringify(err.response?.data)}`);
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
          headers: {
            'x-access-token': RENOVADA_API_DOM_TOKEN,
            'Accept': 'application/json',
          },
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
                userId: RENOVADA_ID,
                amount: Number(w.amount),
                grossAmount: Number(w.amount) + Number(w.fee || 2),
                fee: Number(w.fee || 2),
                status: this.mapWithdrawStatus(w.status),
                pixKey: w.pixKey || w.pix_key || 'migracao@simpay.com',
                receiptImage: w.receiptImage ?? null,
                domWithdrawId: w.id,
                createdAt: new Date(w.createdAt || w.created_at || new Date()),
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

    // 5. Recalcular saldo (apenas transações com dízimo/primícia/oferta)
    this.logger.log('Recalculando saldo...');
    const renovadaKeywords = [
      { description: { contains: 'dizimo', mode: 'insensitive' as const } },
      { description: { contains: 'dízimo', mode: 'insensitive' as const } },
      { description: { contains: 'primicia', mode: 'insensitive' as const } },
      { description: { contains: 'primícia', mode: 'insensitive' as const } },
      { description: { contains: 'oferta', mode: 'insensitive' as const } },
      { description: { contains: 'fundacao', mode: 'insensitive' as const } },
      { description: { contains: 'fundação', mode: 'insensitive' as const } },
      { description: { contains: TENANT_RENOVADA_TAG, mode: 'insensitive' as const } },
    ];
    const completedTxs = await this.prisma.transaction.aggregate({
      where: { userId: RENOVADA_ID, status: TransactionStatus.COMPLETED, OR: renovadaKeywords },
      _sum: { netAmount: true },
    });

    const completedWithdraws = await this.prisma.withdrawRequest.aggregate({
      where: {
        userId: RENOVADA_ID,
        status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] },
      },
      _sum: { amount: true },
    });

    const totalReceived = Number(completedTxs._sum.netAmount || 0);
    const totalWithdrawn = Number(completedWithdraws._sum.amount || 0);
    const calculatedBalance = Math.max(0, totalReceived - totalWithdrawn);

    await this.prisma.wallet.update({
      where: { userId: RENOVADA_ID },
      data: { balance: calculatedBalance },
    });

    const totalRenovadaTxs = await this.prisma.transaction.count({
      where: { userId: RENOVADA_ID },
    });

    this.logger.log(`=== SINCRONIZAÇÃO CONCLUÍDA ===`);
    this.logger.log(`  Transações: ${totalSynced} novas, ${totalSkipped} atualizadas`);
    this.logger.log(`  Total no banco: ${totalRenovadaTxs}`);
    this.logger.log(`  Saques: ${totalWithdrawalsSynced}`);
    this.logger.log(`  Saldo: R$ ${calculatedBalance.toFixed(2)}`);

    return {
      message: 'Sincronização completa realizada com sucesso',
      totalTransactions: totalSynced,
      totalSkipped,
      totalErrors,
      totalInDatabase: totalRenovadaTxs,
      totalWithdrawals: totalWithdrawalsSynced,
      balance: calculatedBalance,
      totalReceived,
      totalWithdrawn,
    };
  }

  private mapTransactionStatus(domStatus: string): TransactionStatus {
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
