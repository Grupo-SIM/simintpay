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
import { Prisma, TransactionStatus, WithdrawStatus } from '@prisma/client';

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
    wallet: { id: string; userId: string; balance: any; lockedBalance: any; version: number; updatedAt: Date },
    fatorLiquidez: number,
    config: ModuleConfig | null,
  ) {
    const pendingRequests = await this.prisma.withdrawRequest.findMany({
      where: { userId, status: WithdrawStatus.PENDING },
      select: { amount: true, grossAmount: true }
    });
    const lockedBalanceGross = pendingRequests.reduce((s, r) => s + Number(r.grossAmount), 0);
    const lockedBalanceNet = pendingRequests.reduce((s, r) => s + Number(r.amount), 0);

    const storedBalance = Number(wallet.balance);

    if (storedBalance > 0) {
      const availableBalance = Math.max(0, storedBalance - lockedBalanceGross);
      const taxaFixa = config?.saque?.taxaFixa ?? 2;
      const netBalance = Math.max(0, availableBalance - taxaFixa);
      return {
        availableBalance,
        netBalance,
        pendingWithdraws: lockedBalanceGross,
        lockedBalance: lockedBalanceGross,
        netLockedBalance: lockedBalanceNet,
        config: this.summaryConfigBlock(config, fatorLiquidez),
        wallet: {
          id: wallet.id,
          userId: wallet.userId,
          version: wallet.version,
          updatedAt: wallet.updatedAt.toISOString(),
        },
      };
    }

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

    const availableBalance = Math.max(0, grossFromTx - lockedBalanceGross);
    const taxaFixa = config?.saque?.taxaFixa ?? 2;
    const netBalance = Math.max(0, netFromTx - lockedBalanceNet); // Simplificado para manter coerência

    return {
      availableBalance,
      netBalance,
      pendingWithdraws: lockedBalanceGross,
      lockedBalance: lockedBalanceGross,
      netLockedBalance: lockedBalanceNet,
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
   * Resumo para a Renovada: netBalance calculado a partir do ledger de transações (sum netAmount).
   * Garante que transações de maquineta registradas via webhook apareçam imediatamente no saldo.
   * lockedBalance (bruto) é convertido para líquido antes de subtrair.
   */
  private async executeRenovadaSummary(
    userId: string,
    wallet: { id: string; userId: string; balance: any; lockedBalance: any; version: number; updatedAt: Date },
    fatorLiquidez: number,
    config: ModuleConfig | null,
  ) {
    const { net: sumNetValue } = await this.sumsCompletedTransactionsDomStyle(userId, fatorLiquidez, undefined);
    const sumNet = new Prisma.Decimal(sumNetValue.toString());

    const completedWithdraws = await this.prisma.withdrawRequest.aggregate({
      where: {
        userId,
        status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] },
      },
      _sum: { grossAmount: true },
    });

    const totalWithdrawn = new Prisma.Decimal(completedWithdraws._sum.grossAmount?.toString() ?? '0').mul(new Prisma.Decimal(fatorLiquidez.toString()));
    const pendingRequests = await this.prisma.withdrawRequest.findMany({
      where: { userId, status: WithdrawStatus.PENDING },
      select: { amount: true, grossAmount: true }
    });
    const lockedBalanceGross = pendingRequests.reduce((s, r) => s.add(new Prisma.Decimal(r.grossAmount.toString())), new Prisma.Decimal(0));
    const lockedBalanceNet = pendingRequests.reduce((s, r) => s.add(new Prisma.Decimal(r.amount.toString())), new Prisma.Decimal(0));

    // Para Renovada, sumNet é o ledger líquido total (incluindo o que já foi sacado).
    // netBalanceAvailable = sumNet - totalWithdrawn(liquidly) - currentLocked(liquidly).
    const netBalanceCalculation = sumNet.sub(totalWithdrawn).sub(lockedBalanceNet);
    const netBalance = netBalanceCalculation.lt(0) ? new Prisma.Decimal(0) : netBalanceCalculation;
    
    // O que o usuário vê como disponível BRUTO é o equivalente bruto do lucro líquido disponível
    const availableBalanceGross = netBalance.gt(0) 
      ? netBalance.div(new Prisma.Decimal(fatorLiquidez.toString()))
      : new Prisma.Decimal(0);

    return {
      availableBalance: Number(availableBalanceGross.toFixed(2)),
      netBalance: Number(netBalance.toFixed(2)),
      pendingWithdraws: Number(lockedBalanceGross.toFixed(2)),
      lockedBalance: Number(lockedBalanceGross.toFixed(2)),
      netLockedBalance: Number(lockedBalanceNet.toFixed(2)),
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

    // Renovada: netBalance sempre calculado a partir do ledger de transações (sum netAmount).
    // Isso garante que transações de maquineta registradas via webhook apareçam imediatamente no saldo,
    // sem precisar chamar o sync manualmente.
    if (moduleSlug === 'renovada') {
      return this.executeRenovadaSummary(userId, wallet, fatorLiquidez, config);
    }

    // wallet.balance é a fonte da verdade (gerenciado incrementalmente) — valor em reais "bruto" de carteira
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

    const pendingList = await this.prisma.withdrawRequest.findMany({
      where: { userId, status: WithdrawStatus.PENDING },
      select: { amount: true, fee: true, grossAmount: true },
    });

    const pendingWithdrawsGross = pendingList.reduce((s, w) => s.add(new Prisma.Decimal(w.grossAmount.toString())), new Prisma.Decimal(0));
    const pendingWithdrawsNet = pendingList.reduce((s, w) => s.add(new Prisma.Decimal(w.amount.toString())), new Prisma.Decimal(0));

    // Saldo disponível bruto = saldo total - bloqueado por saques pendentes
    const availableBalanceGross = Math.max(0, balance - lockedBalance);

    // Saldo líquido disponível: Para o usuário, é o que ele receberia se sacasse tudo agora.
    // Regra do usuário: Receber = Bruto - Taxa Fixa.
    const taxaFixa = new Prisma.Decimal(config?.saque?.taxaFixa ?? 2);
    const netBalance = availableBalanceGross > 0
      ? new Prisma.Decimal(availableBalanceGross.toString()).sub(taxaFixa)
      : new Prisma.Decimal(0);

    const finalNetBalance = netBalance.lt(0) ? new Prisma.Decimal(0) : netBalance;

    // Saldo bloqueado líquido: Soma exata dos valores 'amount' (o que será pago) dos saques pendentes.
    const netLockedBalance = pendingWithdrawsNet;

    return {
      availableBalance: availableBalanceGross,
      netBalance: finalNetBalance.toNumber().toString(),
      pendingWithdraws: pendingWithdrawsGross.toNumber(),
      lockedBalance,
      netLockedBalance: netLockedBalance.toNumber().toString(),
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
