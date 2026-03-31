import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WITHDRAW_REPOSITORY } from '../../../core/repositories/withdraw.repository.interface';
import { WALLET_REPOSITORY } from '../../../core/repositories/wallet.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { getModuleConfig } from '../../../modules/module.registry';
import type { IWithdrawRepository } from '../../../core/repositories/withdraw.repository.interface';
import type { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, WithdrawStatus } from '@prisma/client';

@Injectable()
export class GetWithdrawSummaryUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(WITHDRAW_REPOSITORY) private readonly withdraws: IWithdrawRepository,
    private readonly prisma: PrismaService,
  ) { }

  async execute(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const wallet = await this.wallets.findByUserId(userId);
    if (!wallet) throw new NotFoundException('Carteira não encontrada');

    const moduleSlug = (user.tenantModule?.slug || '').toLowerCase();
    const renovadaId = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    const isRenovadaWallet = moduleSlug === 'renovada' || userId === renovadaId;

    const defaultSaque = {
      minValor: Number(process.env.SAQUE_MIN_VALOR || 100),
      taxaFixa: Number(process.env.SAQUE_TAXA_FIXA || 2),
      taxaPercentual: 0,
      fatorLiquidez: Number(process.env.DEFAULT_LIQUIDITY_FACTOR || 0.91),
    };

    const config = isRenovadaWallet
      ? getModuleConfig('renovada')
      : getModuleConfig(user.tenantModule?.slug);

    const resolvedConfig = config || {
      saque: defaultSaque,
    };

    const configResp = {
      minValor: resolvedConfig.saque.minValor,
      taxaFixa: resolvedConfig.saque.taxaFixa,
      taxaPercentual: resolvedConfig.saque.taxaPercentual,
      fatorLiquidez: resolvedConfig.saque.fatorLiquidez ?? 0.91,
    };

    // 1. Saques Ativos (Pendente ou Aprovado - ainda bloqueiam a conta)
    const activeWithdraws = await this.prisma.withdrawRequest.findMany({
      where: { userId, status: { in: [WithdrawStatus.PENDING, WithdrawStatus.APPROVED] } },
    });

    const lockedBalanceGross = activeWithdraws.reduce((s, r) => s + Number(r.grossAmount), 0);
    const lockedBalanceNet = activeWithdraws.reduce((s, r) => s + Number(r.amount), 0);

    if (isRenovadaWallet) {
      const fatorRenovada = configResp.fatorLiquidez;
      const storedGross = Number(wallet.balance);
      const lockedGross = Number(wallet.lockedBalance);
      const availableNet = Math.max(0, storedGross - lockedGross) * fatorRenovada;
      const lockedNetDisplay = lockedGross * fatorRenovada;

      return {
        availableBalance: availableNet,
        netBalance: String(availableNet),
        pendingWithdraws: lockedNetDisplay,
        lockedBalance: lockedNetDisplay,
        netLockedBalance: String(lockedBalanceNet),
        config: configResp,
        wallet: {
          id: wallet.id,
          userId: wallet.userId,
          version: wallet.version,
          updatedAt: wallet.updatedAt,
        },
      };
    }

    let availableBalanceGross = 0;

    // 2. Busca transações para ver se calculamos via Ledger ou via Wallet Fixa
    const txRows = await this.prisma.transaction.findMany({
      where: { userId, status: TransactionStatus.COMPLETED, amount: { gt: 0 } },
      select: { amount: true, netAmount: true },
    });

    if (txRows.length > 0) {
      // Cálculo baseado no Ledger (Lucro Líquido - Saques Brutos)
      // O usuário quer tratar esse lucro líquido (118.20) como o "Bolo" de onde ele tira o saque bruto.
      const totalLiquidProfit = txRows.reduce((s, t) => {
        const net = t.netAmount != null ? Number(t.netAmount) : Number(t.amount) * configResp.fatorLiquidez;
        return s + net;
      }, 0);
      
      const completedAggr = await this.prisma.withdrawRequest.aggregate({
        where: { userId, status: WithdrawStatus.COMPLETED },
        _sum: { grossAmount: true }
      });
      const totalCompletedGross = Number(completedAggr._sum.grossAmount || 0);

      availableBalanceGross = totalLiquidProfit - totalCompletedGross - lockedBalanceGross;
    } else {
      // Fallback para wallet.balance (Sobe 100, desce 100) — Tipicamente contas manuais sem transações DOM
      const storedBalance = Number(wallet.balance); 
      availableBalanceGross = Math.max(0, storedBalance - lockedBalanceGross);
    }

    // Regra do Usuário: netBalance = availableBalance - taxaFixa
    const netBalance = Math.max(0, availableBalanceGross - configResp.taxaFixa);

    return {
      availableBalance: availableBalanceGross,
      netBalance: String(netBalance),
      pendingWithdraws: lockedBalanceGross,
      lockedBalance: lockedBalanceGross,
      netLockedBalance: String(lockedBalanceNet),
      config: configResp,
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        version: wallet.version,
        updatedAt: wallet.updatedAt,
      },
    };
  }
}
