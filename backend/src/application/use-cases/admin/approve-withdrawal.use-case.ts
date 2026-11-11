import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { WithdrawStatus, Prisma } from '@prisma/client';
import {
  applyWalletEntry,
  assertWalletLedgerConsistency,
} from '../../../modules/wallet-ledger/wallet-ledger';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { ModuleRealtimeNotifyService } from '../../../infrastructure/realtime/module-realtime-notify.service';
import { isMasterAdminUser } from '../../../shared/utils/is-master-admin.util';

/**
 * Marca os lucros de saque aprovados com a regra "toda a taxa do cliente é
 * lucro". Logs sem a marca usam a regra antiga (taxa fixa − R$ 1), mantendo o
 * histórico dos relatórios.
 */
export const WITHDRAWAL_PROFIT_FULL_FEE_VERSION = 'full_fee_v2';

@Injectable()
export class ApproveWithdrawalUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: ModuleRealtimeNotifyService,
  ) {}

  async execute(
    withdrawId: string,
    receiptImage?: string,
    adminUserId?: string,
  ): Promise<{ message: string }> {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id: withdrawId },
      include: { user: { include: { wallet: true } } },
    });

    if (!withdraw) {
      throw new NotFoundException('Saque não encontrado');
    }

    if (
      withdraw.status === WithdrawStatus.APPROVED ||
      withdraw.status === WithdrawStatus.COMPLETED
    ) {
      return { message: 'Saque já aprovado' };
    }

    if (withdraw.status !== WithdrawStatus.PENDING) {
      throw new BadRequestException(
        `Não é possível aprovar um saque com status ${withdraw.status}`,
      );
    }

    const wallet = withdraw.user.wallet;
    if (!wallet) {
      throw new NotFoundException(
        'Carteira (Wallet) não encontrada para este usuário',
      );
    }

    // Identifica se o admin é do módulo master
    let isMasterAdmin = false;
    if (adminUserId) {
      const admin = await this.prisma.user.findUnique({
        where: { id: adminUserId },
        include: { platform: true },
      });
      if (admin && isMasterAdminUser(admin)) {
        isMasterAdmin = true;
      }
    }

    // Executa tudo dentro de uma transação do Prisma
    await this.prisma.$transaction(async (tx) => {
      // 1. Atualiza o status da solicitação
      const claimed = await tx.withdrawRequest.updateMany({
        where: { id: withdrawId, status: WithdrawStatus.PENDING },
        data: {
          status: WithdrawStatus.APPROVED,
          receiptImage: receiptImage ?? undefined,
          reviewedAt: new Date(),
          reviewSource: 'SIMPAY_ADMIN',
          reviewedByReference: adminUserId ?? null,
          updatedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Saque alterado por outro administrador.');
      }

      if (withdraw.platform?.toLowerCase() !== 'atlas') {
        await assertWalletLedgerConsistency(tx, withdraw.userId);
      }

      // 2. Deduz os valores da wallet (Total e Bloqueado) - Pula se for Atlas
      if (withdraw.platform?.toLowerCase() !== 'atlas') {
        // The BalanceLog insert (trigger) debits the wallet; the returned wallet already reflects it.
        const updatedWallet = await applyWalletEntry(tx, {
          userId: withdraw.userId,
          action: 'WITHDRAW_APPROVED',
          balanceDelta: new Prisma.Decimal(withdraw.grossAmount).neg(),
          lockedDelta: new Prisma.Decimal(withdraw.grossAmount).neg(),
          source: 'WITHDRAW',
          description: `Saque aprovado: R$ ${withdraw.grossAmount.toFixed(2)}`,
        });
        // Freeze the available balance returned by this debit, including concurrent wallet changes.
        await tx.withdrawRequest.update({
          where: { id: withdrawId },
          data: {
            remainingBalanceAfterWithdrawal: updatedWallet.balance.minus(
              updatedWallet.lockedBalance,
            ),
          },
        });
      }

      // Ordinary Wallet is authoritative for this withdrawal. Preserve external
      // balances as reconciliation evidence; never debit a second ledger.

      // 4. Sempre incrementa taxa e lucro no log administrativo (independente de quem aprova)
      const logUserId = adminUserId ?? withdraw.userId;

      // Resolve a tag da plataforma do usuário que fez o saque para resolver a taxa de saque correta
      const beneficiary = await tx.user.findUnique({
        where: { id: withdraw.userId },
        include: { platform: true },
      });
      const platformTag = (
        beneficiary?.platform?.tag ?? 'GLOBAL'
      ).toUpperCase();

      // Toda a taxa cobrada do cliente é lucro; o custo da adquirente entra à
      // parte, no registro de saque da adquirente (ADMIN_WITHDRAW_FEE_INC).
      const lucroSimpay = Number(new Prisma.Decimal(withdraw.fee).toFixed(2));
      await tx.balanceLog.create({
        data: {
          userId: logUserId,
          action: 'ADMIN_WITHDRAW_PROFIT_INC',
          bookkeepingAmount: lucroSimpay,

          balanceDelta: 0,

          lockedDelta: 0,

          source: 'MASTER_ADMIN_CONTROL',
          description: `Taxa de saque Simintpay${isMasterAdmin ? ' (Master)' : ''} — plataforma: ${platformTag} (${lucroSimpay.toFixed(2)})`,
          metadata: {
            withdrawId,
            platformTag,
            lucroSimpay,
            accountingVersion: WITHDRAWAL_PROFIT_FULL_FEE_VERSION,
          },
        },
      });
    });

    await this.realtime.notifyWithdrawal(withdraw.userId, {
      withdrawId,
      action: 'approved',
    });

    return { message: 'Saque aprovado com sucesso e saldo debitado' };
  }
}
