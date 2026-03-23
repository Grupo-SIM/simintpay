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
   * Calcula o resumo financeiro para o usuário.
   * 
   * LÓGICA DE NEGÓCIO (Migrada da API-DOM):
   * 1. Saldo Disponível (Available): Saldo Total - Saldo Bloqueado (Saques em processamento/reservados).
   * 2. Saldo Líquido (Net Balance): Saldo Disponível * Fator de Liquidez (default 0.91).
   *    - O fator de 0.91 (9% de spread/margem) é aplicado para mostrar ao usuário um valor conservador 
   *      pós-taxas de processamento e segurança (chargeback reserve).
   * 3. Saques Pendentes: Soma do valor BRUTO de todas as solicitações com status PENDING.
   * 4. Taxas de Saque: Aplicadas no momento da solicitação (RequestWithdrawUseCase).
   */
  async execute(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const wallet = await this.wallets.findByUserId(userId);
    if (!wallet) throw new NotFoundException('Carteira não encontrada');

    // Mapeamento das regras do módulo
    const config = getModuleConfig(user.tenantModule?.slug);
    const envFactor = process.env.DEFAULT_LIQUIDITY_FACTOR ? Number(process.env.DEFAULT_LIQUIDITY_FACTOR) : 0.91;
    const fatorLiquidez = config?.saque?.fatorLiquidez ?? envFactor;

    const balance = Number(wallet.balance);
    const lockedBalance = Number(wallet.lockedBalance);
    
    // Saldo Disponível (Bruto - Bloqueado)
    const availableBalance = balance - lockedBalance;
    
    // Saldo Líquido (Disponível * Fator de Liquidez)
    // Esse é o valor que o usuário "vê" como disponível para solicitar saques.
    const netBalance = availableBalance * fatorLiquidez;

    // Saldo Bloqueado Líquido
    const netLockedBalance = lockedBalance * fatorLiquidez;

    // Soma de todos os saques pendentes (grossAmount)
    const pendingWithdraws = await this.withdraws.sumPendingByUserId(userId);

    return {
      availableBalance,    // Saldo disponível para saque (Bruto)
      netBalance,          // Saldo disponível para saque (Líquido estimado)
      pendingWithdraws,    // Total em saques pendentes
      lockedBalance,       // Saldo total bloqueado (Bruto)
      netLockedBalance,    // Saldo total bloqueado (Líquido)
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
