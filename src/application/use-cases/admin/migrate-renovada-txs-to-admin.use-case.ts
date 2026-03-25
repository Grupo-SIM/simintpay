import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { TransactionStatus, Prisma } from '@prisma/client';

const RENOVADA_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';

@Injectable()
export class MigrateRenovadaTxsToAdminUseCase {
  private readonly logger = new Logger(MigrateRenovadaTxsToAdminUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<{
    migratedCount: number;
    balanceMovedFromRenovada: string;
    balanceMovedToAdmin: string;
  }> {
    const adminUserId = process.env.ADMIN_USER_ID;
    if (!adminUserId) {
      throw new Error('ADMIN_USER_ID não configurado no .env');
    }

    this.logger.log('[MigrateRenovada] Buscando transações para migrar...');

    // Busca todas as transações atualmente na conta da Renovada
    // que NÃO vieram do webhook da Renovada (source = 'RENOVADA_WEBHOOK')
    // i.e., foram criadas pelo CRON ou pelo RenovadaSyncService com o token errado
    const txsToMigrate = await this.prisma.transaction.findMany({
      where: {
        userId: RENOVADA_ID,
        NOT: {
          domPaymentId: {
            in: await this.getRenovadaWebhookPaymentIds(),
          },
        },
      },
      select: {
        id: true,
        status: true,
        netAmount: true,
      },
    });

    if (txsToMigrate.length === 0) {
      this.logger.log('[MigrateRenovada] Nenhuma transação para migrar.');
      return {
        migratedCount: 0,
        balanceMovedFromRenovada: '0.00',
        balanceMovedToAdmin: '0.00',
      };
    }

    this.logger.log(`[MigrateRenovada] ${txsToMigrate.length} transações para migrar.`);

    // Calcula o saldo líquido das transações COMPLETED que serão movidas
    const completedNetSum = txsToMigrate
      .filter((t) => t.status === TransactionStatus.COMPLETED)
      .reduce((acc, t) => acc.add(t.netAmount ?? 0), new Prisma.Decimal(0));

    const txIds = txsToMigrate.map((t) => t.id);

    await this.prisma.$transaction(async (p) => {
      // 1. Reatribui todas as transações para o admin
      await p.transaction.updateMany({
        where: { id: { in: txIds } },
        data: { userId: adminUserId },
      });

      // 2. Atualiza os balanceLogs órfãos (muda userId)
      await p.balanceLog.updateMany({
        where: {
          userId: RENOVADA_ID,
          transactionId: { in: txIds },
        },
        data: { userId: adminUserId },
      });

      // 3. Corrige o saldo da Renovada (subtrai o que foi movido)
      if (completedNetSum.greaterThan(0)) {
        const renovadaWallet = await p.wallet.findUnique({
          where: { userId: RENOVADA_ID },
        });

        if (renovadaWallet) {
          const newRenovadaBalance = renovadaWallet.balance.sub(completedNetSum);
          await p.wallet.update({
            where: { userId: RENOVADA_ID },
            data: {
              balance: newRenovadaBalance.lessThan(0)
                ? new Prisma.Decimal(0)
                : newRenovadaBalance,
              version: { increment: 1 },
            },
          });
        }

        // 4. Corrige o saldo do admin (soma o que foi migrado)
        const adminWallet = await p.wallet.findUnique({
          where: { userId: adminUserId },
        });

        if (adminWallet) {
          await p.wallet.update({
            where: { userId: adminUserId },
            data: {
              balance: { increment: completedNetSum },
              version: { increment: 1 },
            },
          });
        }

        // 5. Registra log da migração
        await p.balanceLog.create({
          data: {
            userId: adminUserId,
            action: 'MIGRATION_FROM_RENOVADA',
            amount: completedNetSum,
            balanceBefore: adminWallet?.balance ?? new Prisma.Decimal(0),
            balanceAfter: (adminWallet?.balance ?? new Prisma.Decimal(0)).add(
              completedNetSum,
            ),
            lockedBefore: adminWallet?.lockedBalance ?? new Prisma.Decimal(0),
            lockedAfter: adminWallet?.lockedBalance ?? new Prisma.Decimal(0),
            source: 'ADMIN_MIGRATION',
            description: `Migração de ${txsToMigrate.length} transações da conta Renovada para Admin`,
          },
        });
      }
    });

    this.logger.log(
      `[MigrateRenovada] Migração concluída: ${txsToMigrate.length} transações, saldo movido: R$ ${completedNetSum.toFixed(2)}`,
    );

    return {
      migratedCount: txsToMigrate.length,
      balanceMovedFromRenovada: completedNetSum.toFixed(2),
      balanceMovedToAdmin: completedNetSum.toFixed(2),
    };
  }

  /** Retorna os domPaymentIds que vieram LEGITIMAMENTE do webhook da Renovada */
  private async getRenovadaWebhookPaymentIds(): Promise<string[]> {
    const webhookEvents = await this.prisma.webhookEvent.findMany({
      where: { source: 'renovada-dom-direct' },
      select: { payload: true },
    });

    const ids: string[] = [];
    for (const we of webhookEvents) {
      const payload = we.payload as Record<string, unknown> | null;
      const data = payload?.data as Record<string, unknown> | undefined;
      if (typeof data?.id === 'string') {
        ids.push(data.id);
      }
    }
    return ids;
  }
}
