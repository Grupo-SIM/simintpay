import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { WithdrawStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { ModuleRealtimeNotifyService } from '../../../infrastructure/realtime/module-realtime-notify.service';
import { isMasterAdminUser } from '../../../shared/utils/is-master-admin.util';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

@Injectable()
export class ApproveWithdrawalUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: ModuleRealtimeNotifyService,
  ) {}

  async execute(withdrawId: string, receiptImage?: string, adminUserId?: string): Promise<{ message: string }> {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id: withdrawId },
      include: { user: { include: { wallet: true } } },
    });

    if (!withdraw) {
      throw new NotFoundException('Saque não encontrado');
    }

    if (withdraw.status === WithdrawStatus.APPROVED || withdraw.status === WithdrawStatus.COMPLETED) {
      return { message: 'Saque já aprovado' };
    }

    if (withdraw.status !== WithdrawStatus.PENDING) {
      throw new BadRequestException(
        `Não é possível aprovar um saque com status ${withdraw.status}`,
      );
    }

    const wallet = withdraw.user.wallet;
    if (!wallet) {
      throw new NotFoundException('Carteira (Wallet) não encontrada para este usuário');
    }

    // Identifica se o admin é do módulo master
    let isMasterAdmin = false;
    if (adminUserId) {
      const admin = await this.prisma.user.findUnique({
        where: { id: adminUserId },
        include: { tenantModule: true },
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

      // 2. Deduz os valores da wallet (Total e Bloqueado) - Pula se for Atlas
      if (withdraw.platform?.toLowerCase() !== 'atlas') {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { decrement: withdraw.grossAmount },
            lockedBalance: { decrement: withdraw.grossAmount },
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
      }
  
      // 3. Deduz também da carteira externa (se houver/vincular via tenant) - Pula se for Atlas
      const userWithExt = await tx.user.findUnique({
        where: { id: withdraw.userId },
        include: { 
          tenantModule: true,
          externalPlatformUsers: { include: { wallet: true } }
        }
      });
  
      if (withdraw.platform?.toLowerCase() !== 'atlas' && userWithExt?.externalPlatformUsers.length) {
        const slug = userWithExt.tenantModule?.slug?.toLowerCase();
        const extUser = slug 
          ? userWithExt.externalPlatformUsers.find(u => u.platform.toLowerCase() === slug)
          : userWithExt.externalPlatformUsers[0];
            
        if (extUser?.wallet) {
          await tx.externalPlatformWallet.update({
            where: { id: extUser.wallet.id },
            data: {
              balance: { decrement: withdraw.grossAmount },
              updatedAt: new Date(),
            }
          });
        }
      }
  
      // 4. Registra log financeiro da operação - Pula se for Atlas
      if (withdraw.platform?.toLowerCase() !== 'atlas') {
        await tx.balanceLog.create({
          data: {
            userId: withdraw.userId,
            action: 'WITHDRAW_APPROVED',
            amount: new Prisma.Decimal(-withdraw.grossAmount),
            balanceBefore: wallet.balance,
            balanceAfter: new Prisma.Decimal(Number(wallet.balance) - Number(withdraw.grossAmount)),
            lockedBefore: wallet.lockedBalance,
            lockedAfter: new Prisma.Decimal(Number(wallet.lockedBalance) - Number(withdraw.grossAmount)),
            source: 'WITHDRAW',
            description: `Saque aprovado: R$ ${withdraw.grossAmount.toFixed(2)}`,
          },
        });
      }

      // 4. Sempre incrementa taxa e lucro no log administrativo (independente de quem aprova)
      const logUserId = adminUserId ?? withdraw.userId;

      // Resolve a tag da plataforma do usuário que fez o saque para usar a TAXA_SAQUE_FIXA correta
      const platformTag = (
        userWithExt?.tenantModule?.slug ?? 'GLOBAL'
      ).toUpperCase();
      const taxaSaqueFixa = getPlatformTaxaEffective(
        platformTag,
        'TAXA_SAQUE_FIXA',
        PLATFORM_TAXA_DEFAULTS.TAXA_SAQUE_FIXA,
      );

      // Taxa de saque = integral - R$1 fixo DOM (DOM é acumulador independente, registrado manualmente)
      const lucroSimpay = Math.max(0, taxaSaqueFixa - 1);
      await tx.balanceLog.create({
        data: {
          userId: logUserId,
          action: 'ADMIN_WITHDRAW_PROFIT_INC',
          amount: new Prisma.Decimal(lucroSimpay),
          balanceBefore: 0,
          balanceAfter: 0,
          lockedBefore: 0,
          lockedAfter: 0,
          source: 'MASTER_ADMIN_CONTROL',
          description: `Taxa de saque Simintpay${isMasterAdmin ? ' (Master)' : ''} — plataforma: ${platformTag} (${taxaSaqueFixa} − 1 = ${lucroSimpay})`,
          metadata: { withdrawId, platformTag, taxaSaqueFixa, lucroSimpay },
        },
      });
    });

    await this.realtime.notifyWithdrawal(withdraw.userId, { withdrawId, action: 'approved' });

    return { message: 'Saque aprovado com sucesso e saldo debitado' };
  }
}
