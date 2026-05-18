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
import { getPlatformTaxaEffective, canonicalPlatformTaxaTag } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

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
    const isRenovadaWallet = moduleSlug === 'renovada' || moduleSlug === 'bosque' || userId === renovadaId;

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

    // 1. Saques ativos (ledger geral); Renovada usa só PENDING em "bloqueado"
    const activeWithdraws = await this.prisma.withdrawRequest.findMany({
      where: { userId, status: { in: [WithdrawStatus.PENDING, WithdrawStatus.APPROVED] } },
    });

    const lockedBalanceGross = activeWithdraws.reduce((s, r) => s + Number(r.grossAmount), 0);
    const lockedBalanceNet = activeWithdraws.reduce((s, r) => s + Number(r.amount), 0);

    if (isRenovadaWallet) {
      // wallet.balance armazena o valor líquido diretamente (netAmount já descontado das taxas)
      const storedNet = Number(wallet.balance);
      const pendingOnly = activeWithdraws.filter((w) => w.status === WithdrawStatus.PENDING);
      const pendingBruto = pendingOnly.reduce((s, r) => s + Number(r.grossAmount), 0);
      const pendingNetSum = pendingOnly.reduce((s, r) => s + Number(r.amount), 0);
      const availableNet = Math.max(0, storedNet - pendingBruto);
      const r2 = (n: number) => Number(n.toFixed(2));

      return {
        availableBalance: r2(availableNet),
        netBalance: String(r2(availableNet)),
        pendingWithdraws: r2(pendingBruto),
        lockedBalance: r2(pendingBruto),
        netLockedBalance: String(r2(pendingNetSum)),
        config: {
          minValor: configResp.minValor,
          taxaFixa: configResp.taxaFixa,
          taxaPercentual: configResp.taxaPercentual,
        },
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
    const isBosqueWallet = moduleSlug === 'bosque';
    const txRows = await this.prisma.transaction.findMany({
      where: {
        userId,
        status: TransactionStatus.COMPLETED,
        amount: { gt: 0 },
        ...(isBosqueWallet ? {
          NOT: {
            OR: [
              { description: { contains: 'Sincronização Bosque', mode: 'insensitive' } },
              { description: { contains: 'Sincronizacao Bosque', mode: 'insensitive' } },
              { description: { contains: 'Ajuste Administrativo', mode: 'insensitive' } },
              { description: { contains: 'balance sync', mode: 'insensitive' } },
            ],
          },
        } : {}),
      },
      select: { amount: true, netAmount: true },
    });

    if (txRows.length > 0) {
      // Cálculo baseado no Ledger (Lucro Líquido - Saques Brutos).
      // Net = amount × LIQUIDEZ - taxasFixas (R$4 para não-isentos, R$0 para Renovada/Bosque).
      const platformTag = canonicalPlatformTaxaTag(moduleSlug.toUpperCase() || 'GLOBAL');
      const liquidezRate = getPlatformTaxaEffective(platformTag, 'LIQUIDEZ', PLATFORM_TAXA_DEFAULTS.LIQUIDEZ);
      const fixedTxFee = getPlatformTaxaEffective(platformTag, 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
      const fixedCashbackFee = getPlatformTaxaEffective(platformTag, 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
      const fixedFeesPerTx = fixedTxFee + fixedCashbackFee;

      const totalLiquidProfit = txRows.reduce((s, t) => {
        const gross = Number(t.amount);
        const net = gross * liquidezRate - fixedFeesPerTx;
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
