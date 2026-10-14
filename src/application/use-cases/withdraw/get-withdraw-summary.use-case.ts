import { assertExplicitPlatform } from '../../helpers/explicit-platform.helper';
import { getPlatformOwnerId } from '../../../modules/module.registry';
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
import { platformTaxaTagFromText } from '../../helpers/dom-fee-estimate.helper';

const TAGS_SEM_TAXA_SERVICO_SUMMARY = new Set(['RENOVADA', 'BOSQUE']);
const TAXA_SERVICO_EFFECTIVE_DATE = new Date('2026-05-18T03:00:00.000Z');

@Injectable()
export class GetWithdrawSummaryUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(WITHDRAW_REPOSITORY) private readonly withdraws: IWithdrawRepository,
    private readonly prisma: PrismaService,
  ) { }

  async execute(userId: string, platformTag?: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const wallet = await this.wallets.findByUserId(userId);
    if (!wallet) throw new NotFoundException('Carteira não encontrada');

    const selected = platformTag ? [platformTag] : user.platform?.tag ? [user.platform.tag] : undefined;
    const moduleSlug = assertExplicitPlatform(user, selected)?.toLowerCase() ?? '';
    const renovadaId = (getPlatformOwnerId('RENOVADA') ?? '');
    const isRenovadaWallet = moduleSlug === 'renovada' || moduleSlug === 'bosque';

    const defaultSaque = {
      minValor: getPlatformTaxaEffective('GLOBAL', 'SAQUE_MIN', 100),
      taxaFixa: getPlatformTaxaEffective('GLOBAL', 'TAXA_SAQUE_FIXA', 2),
      taxaPercentual: 0,
      fatorLiquidez: getPlatformTaxaEffective('GLOBAL', 'LIQUIDEZ', 0.91),
    };

    const config = isRenovadaWallet
      ? getModuleConfig('renovada')
      : getModuleConfig(moduleSlug);

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

    // Fonte única de saldo: a mesma que a validação do saque (request-withdraw) usa.
    // Antes o resumo recalculava por ledger (amount × liquidez − serviço) e divergia da wallet.
    const availableBalanceGross = Math.max(0, Number(wallet.balance) - Number(wallet.lockedBalance));

    const netBalance = availableBalanceGross - configResp.taxaFixa;

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
