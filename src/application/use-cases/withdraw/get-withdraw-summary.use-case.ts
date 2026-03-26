import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WITHDRAW_REPOSITORY } from '../../../core/repositories/withdraw.repository.interface';
import { WALLET_REPOSITORY } from '../../../core/repositories/wallet.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { getModuleConfig } from '../../../modules/module.registry';
import type { IWithdrawRepository } from '../../../core/repositories/withdraw.repository.interface';
import type { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { ModuleConfig } from '../../../modules/module-config.interface';
import type { Prisma } from '@prisma/client';
import { TransactionStatus, WithdrawStatus } from '@prisma/client';

@Injectable()
export class GetWithdrawSummaryUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(WITHDRAW_REPOSITORY) private readonly withdraws: IWithdrawRepository,
    private readonly prisma: PrismaService,
  ) { }

  /**
   * Espelha `PaymentService.getFinancialSummary` (api-dom /payments/summary):
   * saldo a partir das transações COMPLETED (bruto + líquido), não de wallet.balance,
   * com recorte após o último saque COMPLETED (lastWithDrawDate equivalente).
   * Saques pendentes reduzem pelo total amount + fee (travado).
   */
  private async sumsCompletedTransactionsDomStyle(
    userId: string,
    fatorLiquidez: number,
    createdAfter?: Date | null,
  ): Promise<{ gross: number; net: number }> {
    const where: Prisma.TransactionWhereInput = {
      userId,
      status: TransactionStatus.COMPLETED,
      amount: { gt: 0 },
    };
    if (createdAfter) {
      where.createdAt = { gt: createdAfter };
    }
    const txs = await this.prisma.transaction.findMany({
      where,
      select: { amount: true, netAmount: true },
    });
    let gross = 0;
    let net = 0;
    for (const t of txs) {
      const a = Number(t.amount);
      gross += a;
      const n = t.netAmount != null ? Number(t.netAmount) : a * fatorLiquidez;
      net += n;
    }
    return { gross, net };
  }

  private summaryConfigBlock(config: ModuleConfig | null, fatorLiquidez: number) {
    return {
      minValor: config?.saque.minValor ?? Number(process.env.DEFAULT_WITHDRAW_MIN_VALUE || 100),
      taxaFixa: config?.saque.taxaFixa ?? Number(process.env.DEFAULT_WITHDRAW_FIXED_FEE || 2),
      taxaPercentual: config?.saque.taxaPercentual ?? Number(process.env.DEFAULT_WITHDRAW_PERCENT_FEE || 0),
      fatorLiquidez,
    };
  }

  /** Resumo igual à plataforma antiga (api-dom) — usado no módulo Bosque no admin máquina. */
  private async executeBosqueLikeDomSummary(
    userId: string,
    wallet: { id: string; userId: string; version: number; updatedAt: Date },
    fatorLiquidez: number,
    config: ModuleConfig | null,
  ) {
    const pendingList = await this.prisma.withdrawRequest.findMany({
      where: { userId, status: WithdrawStatus.PENDING },
      select: { amount: true, fee: true },
    });

    const pendingWithdraws = pendingList.reduce((s, w) => s + Number(w.amount), 0);
    const pendingWithdrawFees = pendingList.reduce((s, w) => s + Number(w.fee ?? 0), 0);
    const pendingWithdrawsTotal = pendingWithdraws + pendingWithdrawFees;
    const netLockedBalance = pendingWithdraws - pendingWithdrawFees;

    const lastCompletedWithdraw = await this.prisma.withdrawRequest.findFirst({
      where: { userId, status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    let { gross: grossFromTx, net: netFromTx } = await this.sumsCompletedTransactionsDomStyle(
      userId,
      fatorLiquidez,
      lastCompletedWithdraw?.createdAt,
    );

    // Migração: se o último saque importado ficou “depois” das transações no tempo, o recorte zera tudo.
    if (netFromTx <= 0 && grossFromTx <= 0 && lastCompletedWithdraw?.createdAt) {
      const noCutoff = await this.sumsCompletedTransactionsDomStyle(userId, fatorLiquidez, undefined);
      if (noCutoff.net > 0 || noCutoff.gross > 0) {
        grossFromTx = noCutoff.gross;
        netFromTx = noCutoff.net;
      }
    }

    const availableBalance = Math.max(0, grossFromTx - pendingWithdrawsTotal);
    const netBalance = Math.max(0, netFromTx - pendingWithdrawsTotal);

    return {
      availableBalance,
      netBalance,
      pendingWithdraws,
      lockedBalance: netLockedBalance,
      netLockedBalance,
      config: this.summaryConfigBlock(config, fatorLiquidez),
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        version: wallet.version,
        updatedAt: wallet.updatedAt.toISOString(),
      },
    };
  }

  /**
   * Retorna o resumo financeiro para o usuário.
   *
   * wallet.balance é a fonte da verdade, gerenciado incrementalmente:
   *   - Inicializado via POST /admin/sync/sync-wallet-renovada (admin define o saldo base)
   *   - +netAmount quando o cron detecta nova transação COMPLETED
   *   - -grossAmount quando ApproveWithdrawalUseCase aprova um saque
   */
  async execute(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const wallet = await this.wallets.findByUserId(userId);
    if (!wallet) throw new NotFoundException('Carteira não encontrada');

    const config = getModuleConfig(user.tenantModule?.slug);
    const envFactor = process.env.DEFAULT_LIQUIDITY_FACTOR
      ? Number(process.env.DEFAULT_LIQUIDITY_FACTOR)
      : 0.91;
    const fatorLiquidez = config?.saque?.fatorLiquidez ?? envFactor;

    const moduleSlug = user.tenantModule?.slug?.toLowerCase();
    if (moduleSlug === 'bosque') {
      return this.executeBosqueLikeDomSummary(userId, wallet, fatorLiquidez, config);
    }

    // wallet.balance é a fonte da verdade (gerenciado incrementalmente) — valor em reais “bruto” de carteira
    let balance = Number(wallet.balance);
    const lockedBalance = Number(wallet.lockedBalance);
    let balanceFromTxLedger = false;

    /**
     * Fallback de migração (demais módulos):
     * Se a carteira ainda está zerada, recalcula a partir das transações COMPLETED:
     * usa netAmount quando existir; senão aplica fator sobre amount (como amountWithoutAllFee na dom).
     */
    if (balance <= 0) {
      const { net: sumNet } = await this.sumsCompletedTransactionsDomStyle(userId, fatorLiquidez, undefined);

      const completedWithdraws = await this.prisma.withdrawRequest.aggregate({
        where: {
          userId,
          status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] },
        },
        _sum: { amount: true },
      });

      const totalWithdrawn = Number(completedWithdraws._sum.amount || 0);
      const calculated = Math.max(0, sumNet - totalWithdrawn);

      if (calculated > 0) {
        balance = calculated;
        balanceFromTxLedger = true;
      }
    }

    // Saldo disponível = saldo total - bloqueado por saques pendentes
    const availableBalance = Math.max(0, balance - lockedBalance);

    // Saldo líquido: com saldo vindo da carteira, aplica fator sobre o bruto.
    // Com fallback por ledger, `balance` já é líquido (soma tipo amountWithoutAllFee) — não multiplicar de novo.
    const netBalance = balanceFromTxLedger
      ? Math.max(0, balance - lockedBalance)
      : Math.max(0, balance * fatorLiquidez - lockedBalance);

    // Saldo bloqueado líquido (valor bruto do bloqueio)
    const netLockedBalance = lockedBalance;

    // Soma de saques pendentes
    const pendingWithdraws = await this.withdraws.sumPendingByUserId(userId);

    return {
      availableBalance,
      netBalance,
      pendingWithdraws,
      lockedBalance,
      netLockedBalance,
      config: this.summaryConfigBlock(config, fatorLiquidez),
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        version: wallet.version,
        updatedAt: wallet.updatedAt.toISOString(),
      },
    };
  }
}
