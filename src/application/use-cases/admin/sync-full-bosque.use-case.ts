import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, WithdrawStatus, PaymentMethod, Prisma } from '@prisma/client';
import { HASH_SERVICE } from '../../../core/services/hash.interface';
import type { IHashService } from '../../../core/services/hash.interface';

/**
 * SyncFullBosqueUseCase
 *
 * Sincroniza TODAS as transações históricas do Bosque diretamente da DOM Pagamentos.
 * Não usa a api-dom (descontinuada).
 *
 * A DOM Pagamentos retorna transações de TODAS as plataformas com o token master.
 * Para filtrar apenas as do Bosque, buscamos transações cujo cod_external existe
 * no nosso banco com userId = BOSQUE_ID.
 *
 * Endpoint: POST /admin/sync/full-bosque
 */
@Injectable()
export class SyncFullBosqueUseCase {
  private readonly logger = new Logger(SyncFullBosqueUseCase.name);
  private readonly DOM_API = 'https://apiv3.dompagamentos.com.br/checkout/production';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(HASH_SERVICE) private readonly hashService: IHashService,
  ) {}

  async execute() {
    const BOSQUE_ID = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const BOSQUE_EMAIL = process.env.BOSQUE_EMAIL || 'contato@bosque.com.br';
    const BOSQUE_NAME = 'Bosque';
    const DOM_TOKEN = process.env.DOM_TOKEN;

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

    // Vincular ao TenantModule bosque
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

    // 2. Testar conexão com DOM Pagamentos
    this.logger.log('Testando conexão com DOM Pagamentos...');
    try {
      const testRes = await fetch(`${this.DOM_API}/transactions?page=1&limit=1`, {
        headers: { Authorization: `Bearer ${DOM_TOKEN}`, accept: 'application/json' },
      });

      if (!testRes.ok) {
        const err = await testRes.text();
        return {
          message: `ERRO: DOM Pagamentos retornou ${testRes.status}. Verifique DOM_TOKEN.`,
          error: err,
          totalTransactions: 0,
        };
      }

      const testData = await testRes.json() as any;
      this.logger.log(`Conexão OK! Total DOM: ${testData?.meta?.total ?? 'desconhecido'}`);
    } catch (err: any) {
      return { message: `ERRO: Não foi possível conectar à DOM Pagamentos: ${err.message}`, totalTransactions: 0 };
    }

    // 3. Buscar transações existentes do Bosque no banco (por cod_external)
    //    A DOM retorna transações de TODOS os clientes — filtramos pelo userId
    const existingBosqueTxIds = new Set(
      (await this.prisma.transaction.findMany({
        where: { userId: BOSQUE_ID },
        select: { id: true, domPaymentId: true },
      })).flatMap(t => [t.id, t.domPaymentId].filter(Boolean) as string[]),
    );

    this.logger.log(`Transações existentes no banco do Bosque: ${existingBosqueTxIds.size / 2}`);

    // 4. Sincronizar transações da DOM
    let totalSynced = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let page = 1;
    let hasMore = true;
    const LIMIT = 100;

    while (hasMore) {
      try {
        this.logger.log(`Buscando página ${page} na DOM...`);

        const res = await fetch(`${this.DOM_API}/transactions?page=${page}&limit=${LIMIT}`, {
          headers: { Authorization: `Bearer ${DOM_TOKEN}`, accept: 'application/json' },
        });

        if (!res.ok) {
          this.logger.error(`Erro DOM página ${page}: ${res.status}`);
          hasMore = false;
          break;
        }

        const data = await res.json() as any;
        const txList: any[] = data?.data ?? data?.transactions ?? [];
        const totalPages: number = data?.meta?.last_page ?? data?.meta?.totalPages ?? 1;

        if (txList.length === 0) {
          hasMore = false;
          break;
        }

        this.logger.log(`Página ${page}/${totalPages}: ${txList.length} transações`);

        for (const tx of txList) {
          try {
            const codExternal = tx.cod_external as string | undefined;
            const domPaymentId = tx.id as string;

            // Filtramos: só processar se o cod_external existe no banco do Bosque
            // OU se o domPaymentId já está vinculado ao Bosque
            const belongsToBosque =
              (codExternal && existingBosqueTxIds.has(codExternal)) ||
              existingBosqueTxIds.has(domPaymentId);

            if (!belongsToBosque) continue;

            const mappedStatus = this.mapStatus(tx.status);
            const amount = new Prisma.Decimal(tx.amount || 0);
            const netAmount = new Prisma.Decimal(Number(tx.amount || 0) * 0.91);
            const domFee = new Prisma.Decimal(Number(tx.amount || 0) * 0.09);

            // Verificar se já existe pelo domPaymentId
            const existing = await this.prisma.transaction.findFirst({
              where: {
                OR: [
                  ...(domPaymentId ? [{ domPaymentId }] : []),
                  ...(codExternal ? [{ id: codExternal }] : []),
                ],
              },
            });

            if (existing) {
              await this.prisma.transaction.update({
                where: { id: existing.id },
                data: {
                  status: mappedStatus,
                  amount,
                  netAmount,
                  domPaymentId: existing.domPaymentId ?? domPaymentId,
                  customerName: tx.customer?.name || existing.customerName,
                  customerEmail: tx.customer?.email || existing.customerEmail,
                  customerDocument: tx.customer?.document || existing.customerDocument,
                  updatedAt: new Date(),
                },
              });
              totalSkipped++;
              continue;
            }

            // Criar nova
            await this.prisma.transaction.create({
              data: {
                ...(codExternal ? { id: codExternal } : {}),
                userId: BOSQUE_ID,
                amount,
                netAmount,
                status: mappedStatus,
                paymentMethod: this.mapPaymentMethod(tx.payment_method),
                description: tx.items?.[0]?.description || 'Migração Bosque',
                domPaymentId,
                customerName: tx.customer?.name,
                customerEmail: tx.customer?.email,
                customerDocument: tx.customer?.document,
                customerPhone: tx.customer?.mobile_phone,
                totalFee: domFee,
                domFee,
                platformFee: new Prisma.Decimal(0),
                installments: Number(tx.installments) || 1,
                createdAt: new Date(tx.created_at || new Date()),
                updatedAt: new Date(tx.updated_at || new Date()),
              },
            });
            totalSynced++;
          } catch (err: any) {
            if (err.code === 'P2002') {
              totalSkipped++;
            } else {
              totalErrors++;
              if (totalErrors <= 5) this.logger.warn(`Erro ao processar tx: ${err.message}`);
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
        hasMore = false;
      }
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

    const totalReceived = Number(completedTxs._sum.netAmount || 0);
    const totalWithdrawn = Number(completedWithdraws._sum.amount || 0);
    const calculatedBalance = Math.max(0, totalReceived - totalWithdrawn);

    await this.prisma.wallet.update({
      where: { userId: BOSQUE_ID },
      data: { balance: calculatedBalance },
    });

    const totalBosqueTxs = await this.prisma.transaction.count({ where: { userId: BOSQUE_ID } });

    this.logger.log('=== SINCRONIZAÇÃO BOSQUE CONCLUÍDA ===');
    this.logger.log(`  Total no banco: ${totalBosqueTxs}`);
    this.logger.log(`  Saldo: R$ ${calculatedBalance.toFixed(2)}`);

    return {
      message: 'Sincronização completa do Bosque realizada com sucesso',
      totalTransactions: totalSynced,
      totalSkipped,
      totalErrors,
      totalInDatabase: totalBosqueTxs,
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
