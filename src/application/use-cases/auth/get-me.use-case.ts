import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { WALLET_REPOSITORY } from '../../../core/repositories/wallet.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { getModuleConfig } from '../../../modules/module.registry';

import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { Prisma, WithdrawStatus } from '@prisma/client';

@Injectable()
export class GetMeUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: { userId: string }): Promise<{
    id: string;
    name: string;
    email: string;
    role: string;
    isAdmin: boolean;
    tenantModule: { slug: string; name: string } | null;
    wallet: {
      balance: number;
      lockedBalance: number;
      availableBalance: number;
      netBalance: number;
    };
    createdAt: string;
  }> {
    const user = await this.users.findById(input.userId);
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: user.id },
    });
    
    if (!wallet) {
      throw new UnauthorizedException('Wallet não encontrada');
    }

    const config = getModuleConfig(user.tenantModule?.slug);
    const fatorLiquidez = config?.saque?.fatorLiquidez ?? Number(process.env.DEFAULT_LIQUIDITY_FACTOR || 0.91);

    const renovadaId = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    const slug = (user.tenantModule?.slug || '').toLowerCase();
    const useRenovadaWalletLedger =
      slug === 'renovada' || user.id === renovadaId;

    let walletResp: {
      balance: number;
      lockedBalance: number;
      availableBalance: number;
      netBalance: number;
    };

    if (useRenovadaWalletLedger) {
      // Wallet em bruto * fator = "líquido bruto"; ao aprovar saque debita gross na wallet (−100 bruto ⇒ só −91 no B*fator).
      // Exibição: saldo líquido total = B*fator + saques já debitados_bruto*(fator−1) = B0*fator − soma(brutos sacados).
      // Bloqueado só PENDING (ainda não aprovado); APPROVED já debitou e não entra em locked.
      const fatorRenovada =
        getModuleConfig('renovada')?.saque?.fatorLiquidez ??
        Number(process.env.RENOVADA_LIQUIDEZ || 0.91);
      const storedGross = Number(wallet.balance);
      const debitedAggr = await this.prisma.withdrawRequest.aggregate({
        where: {
          userId: user.id,
          status: { in: [WithdrawStatus.APPROVED, WithdrawStatus.COMPLETED] },
        },
        _sum: { grossAmount: true },
      });
      const debitedBruto = Number(debitedAggr._sum.grossAmount || 0);
      const pendingAggr = await this.prisma.withdrawRequest.aggregate({
        where: { userId: user.id, status: WithdrawStatus.PENDING },
        _sum: { grossAmount: true },
      });
      const pendingBruto = Number(pendingAggr._sum.grossAmount || 0);
      const rawDisplayTotalNet =
        storedGross * fatorRenovada + debitedBruto * (fatorRenovada - 1);
      const displayTotalNet = Math.max(0, rawDisplayTotalNet);
      const availableNet = Math.max(0, displayTotalNet - pendingBruto);
      const r2 = (n: number) => Number(n.toFixed(2));
      walletResp = {
        balance: r2(displayTotalNet),
        lockedBalance: r2(pendingBruto),
        availableBalance: r2(availableNet),
        netBalance: r2(availableNet),
      };
    } else {
      // 1. Busca Transações (Lucro Líquido Real)
      const txRows = await this.prisma.transaction.findMany({
        where: { userId: user.id, status: 'COMPLETED', amount: { gt: 0 } },
        select: { amount: true, netAmount: true },
      });

      const totalLiquidProfit = txRows.reduce((s: number, t: { amount: Prisma.Decimal; netAmount: Prisma.Decimal | null }) => {
        const net = t.netAmount != null ? Number(t.netAmount) : Number(t.amount) * fatorLiquidez;
        return s + net;
      }, 0);

      // 2. Busca Saques (Finalizados)
      const completedAggr = await this.prisma.withdrawRequest.aggregate({
        where: { userId: user.id, status: 'COMPLETED' },
        _sum: { grossAmount: true }
      });
      const totalCompletedGross = Number(completedAggr._sum.grossAmount || 0);

      // 3. Saques em Processamento (Bloqueados)
      const activeAggr = await this.prisma.withdrawRequest.aggregate({
        where: { userId: user.id, status: { in: ['PENDING', 'APPROVED'] } },
        _sum: { grossAmount: true }
      });
      const lockedBalanceGross = Number(activeAggr._sum.grossAmount || 0);

      // 4. Balanço Final (Modelo Mental do Usuário: Lucro Líquido - Saques Brutos)
      const currentNetProfit = totalLiquidProfit - totalCompletedGross;
      const availableBalance = Math.max(0, currentNetProfit - lockedBalanceGross);

      walletResp = {
        balance: Number(currentNetProfit.toFixed(2)),
        lockedBalance: Number(lockedBalanceGross.toFixed(2)),
        availableBalance: Number(availableBalance.toFixed(2)),
        netBalance: Number(availableBalance.toFixed(2)),
      };
    }

    const tenant =
      user.tenantModule != null
        ? { slug: user.tenantModule.slug, name: user.tenantModule.name }
        : null;

    if (user.domToken) {
      try {
        const domMe = await this.gateway.me(user.domToken);
        if (domMe.name || domMe.email) {
          return {
            id: user.id,
            name: domMe.name ?? user.name,
            email: domMe.email ?? user.email,
            role: user.role,
            isAdmin: user.role === 'ADMIN',
            tenantModule: tenant,
            wallet: walletResp,
            createdAt: user.createdAt.toISOString(),
          };
        }
      } catch {
        // ignore enrichment failure
      }
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isAdmin: user.role === 'ADMIN',
      tenantModule: tenant,
      wallet: walletResp,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
