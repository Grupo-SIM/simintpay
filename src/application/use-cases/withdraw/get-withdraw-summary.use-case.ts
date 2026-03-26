import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WITHDRAW_REPOSITORY } from '../../../core/repositories/withdraw.repository.interface';
import { WALLET_REPOSITORY } from '../../../core/repositories/wallet.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { getModuleConfig } from '../../../modules/module.registry';
import type { IWithdrawRepository } from '../../../core/repositories/withdraw.repository.interface';
import type { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';

@Injectable()
export class GetWithdrawSummaryUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(WITHDRAW_REPOSITORY) private readonly withdraws: IWithdrawRepository,
  ) {}

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

    // wallet.balance é a fonte da verdade (gerenciado incrementalmente)
    const balance = Number(wallet.balance);
    const lockedBalance = Number(wallet.lockedBalance);

    // Saldo disponível = saldo total - bloqueado por saques pendentes
    const availableBalance = Math.max(0, balance - lockedBalance);

    // Saldo líquido = (saldo bruto * fator) - bloqueado
    // O fator de liquidez reduz o saldo bruto, mas saques bloqueados deduzem 1:1
    // Ex: balance=3840.70, fator=0.91, locked=100 → netBalance = 3495.04 - 100 = 3395.04
    const netBalance = Math.max(0, balance * fatorLiquidez - lockedBalance);

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
      config: {
        minValor: config?.saque.minValor ?? Number(process.env.DEFAULT_WITHDRAW_MIN_VALUE || 100),
        taxaFixa: config?.saque.taxaFixa ?? Number(process.env.DEFAULT_WITHDRAW_FIXED_FEE || 2),
        taxaPercentual: config?.saque.taxaPercentual ?? Number(process.env.DEFAULT_WITHDRAW_PERCENT_FEE || 0),
        fatorLiquidez,
      },
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        version: wallet.version,
        updatedAt: wallet.updatedAt.toISOString(),
      },
    };
  }
}
