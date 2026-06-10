import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { WALLET_REPOSITORY } from '../../../core/repositories/wallet.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { computeUserNetBalance } from '../../helpers/user-platform-net-balance.helper';
import { isMasterAdminUser } from '../../../shared/utils/is-master-admin.util';
import { getPlatformTaxaEffective, canonicalPlatformTaxaTag } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { platformTaxaTagFromText } from '../../helpers/dom-fee-estimate.helper';

const TAGS_SEM_TAXA_SERVICO = new Set(['BOSQUE']);
const TAXA_SERVICO_EFFECTIVE_DATE = new Date('2026-05-18T03:00:00.000Z');
const RENOVADA_TAXA_SERVICO_DATE = new Date('2026-05-29T20:40:00.000Z');

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
    cpf: string | null;
    cnpj: string | null;
    role: string;
    isAdmin: boolean;
    /** Admin master (taxas globais, etc.) — derivado de role + tenant slug/nome. */
    isMasterAdmin: boolean;
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

    const slug = (user.tenantModule?.slug || '').toLowerCase();
    const renovadaId = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    const useRenovadaWalletLedger =
      slug === 'renovada' || slug === 'bosque' || user.id === renovadaId;

    const netBalance = await computeUserNetBalance(
      this.prisma,
      user.id,
      user.tenantModule?.slug,
    );

    let walletResp: {
      balance: number;
      lockedBalance: number;
      availableBalance: number;
      netBalance: number;
    };

    if (useRenovadaWalletLedger) {
      // wallet.balance armazena o valor líquido diretamente (netAmount já descontado das taxas)
      const storedNet = Number(wallet.balance);
      const pendingAggr = await this.prisma.withdrawRequest.aggregate({
        where: { userId: user.id, status: 'PENDING' },
        _sum: { grossAmount: true },
      });
      const pendingBruto = Number(pendingAggr._sum.grossAmount || 0);
      const r2 = (n: number) => Number(n.toFixed(2));
      walletResp = {
        balance: r2(storedNet),
        lockedBalance: r2(pendingBruto),
        availableBalance: r2(netBalance),
        netBalance: r2(netBalance),
      };
    } else {
      const isBosqueWallet = slug === 'bosque';
      const fallbackTag = canonicalPlatformTaxaTag(slug.toUpperCase() || 'GLOBAL');
      const txRows = await this.prisma.transaction.findMany({
        where: {
          userId: user.id,
          status: 'COMPLETED',
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
        select: { amount: true, description: true, createdAt: true },
      });
      const totalLiquidProfit = txRows.reduce((s, t) => {
        const rowTag = platformTaxaTagFromText(t.description ?? undefined);
        const effectiveTag = rowTag !== 'GLOBAL' ? rowTag : fallbackTag;
        const liqRate = getPlatformTaxaEffective(effectiveTag, 'LIQUIDEZ', PLATFORM_TAXA_DEFAULTS.LIQUIDEZ);
        const svcRate = TAGS_SEM_TAXA_SERVICO.has(effectiveTag)
          ? 0
          : getPlatformTaxaEffective(effectiveTag, 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);
        const svcEffDate = effectiveTag === 'RENOVADA' ? RENOVADA_TAXA_SERVICO_DATE : TAXA_SERVICO_EFFECTIVE_DATE;
        const svcFee = svcRate > 0 && t.createdAt >= svcEffDate ? svcRate : 0;
        return s + Number(t.amount) * liqRate - svcFee;
      }, 0);
      const completedAggr = await this.prisma.withdrawRequest.aggregate({
        where: { userId: user.id, status: 'COMPLETED' },
        _sum: { grossAmount: true },
      });
      const totalCompletedGross = Number(completedAggr._sum.grossAmount || 0);
      const activeAggr = await this.prisma.withdrawRequest.aggregate({
        where: { userId: user.id, status: { in: ['PENDING', 'APPROVED'] } },
        _sum: { grossAmount: true },
      });
      const lockedBalanceGross = Number(activeAggr._sum.grossAmount || 0);
      const currentNetProfit = totalLiquidProfit - totalCompletedGross;
      walletResp = {
        balance: Number(currentNetProfit.toFixed(2)),
        lockedBalance: Number(lockedBalanceGross.toFixed(2)),
        availableBalance: netBalance,
        netBalance,
      };
    }

    const tenant =
      user.tenantModule != null
        ? { slug: user.tenantModule.slug, name: user.tenantModule.name }
        : null;

    const master = isMasterAdminUser({
      role: user.role,
      email: user.email,
      tenantModule: user.tenantModule,
    });

    if (user.domToken) {
      try {
        const domMe = await this.gateway.me(user.domToken);
        if (domMe.name || domMe.email) {
          return {
            id: user.id,
            name: domMe.name ?? user.name,
            email: domMe.email ?? user.email,
            cpf: user.cpf ?? null,
            cnpj: user.cnpj ?? null,
            role: user.role,
            isAdmin: user.role === 'ADMIN',
            isMasterAdmin: master,
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
      cpf: user.cpf ?? null,
      cnpj: user.cnpj ?? null,
      role: user.role,
      isAdmin: user.role === 'ADMIN',
      isMasterAdmin: master,
      tenantModule: tenant,
      wallet: walletResp,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
