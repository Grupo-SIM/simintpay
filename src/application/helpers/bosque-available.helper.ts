import { WithdrawStatus, TransactionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

/** BOSQUE passou a cobrar TAXA_SERVICO (R$4 Sim Int Pay) a partir de 2026-05-29 — mesma data da Renovada. */
const BOSQUE_TAXA_SERVICO_DATE = new Date('2026-05-29T20:40:00.000Z');

/**
 * Saldo disponível canônico do Bosque (IBB): soma do LÍQUIDO (netAmount) das
 * transações COMPLETED recebidas DEPOIS do último saque não recusado, MENOS a
 * TAXA_SERVICO (R$4 por transação, a partir de 2026-05-29). Cada saque "zera" o
 * disponível; conta apenas o que entrou desde então — igual ao "Valor Recebido"
 * da listagem (netAmount − taxa_servico). Independe do wallet.balance.
 */
export async function computeBosqueAvailableSinceLastWithdrawal(
  prisma: PrismaService,
  userIds: string[],
): Promise<number> {
  if (userIds.length === 0) return 0;

  const lastWithdrawal = await prisma.withdrawRequest.findFirst({
    where: { userId: { in: userIds }, status: { not: WithdrawStatus.REJECTED } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const baseWhere: Prisma.TransactionWhereInput = {
    userId: { in: userIds },
    status: TransactionStatus.COMPLETED,
    description: { contains: '[TENANT:BOSQUE]', mode: 'insensitive' },
    ...(lastWithdrawal ? { createdAt: { gt: lastWithdrawal.createdAt } } : {}),
  };

  const svcRate = getPlatformTaxaEffective('BOSQUE', 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);

  // TAXA_SERVICO só incide em transações da janela criadas a partir de 2026-05-29.
  const svcCreatedAt: Prisma.DateTimeFilter = { gte: BOSQUE_TAXA_SERVICO_DATE };
  if (lastWithdrawal) svcCreatedAt.gt = lastWithdrawal.createdAt;

  const [creditsSince, svcCount] = await Promise.all([
    prisma.transaction.aggregate({ where: baseWhere, _sum: { netAmount: true } }),
    svcRate > 0
      ? prisma.transaction.count({
          where: {
            userId: { in: userIds },
            status: TransactionStatus.COMPLETED,
            description: { contains: '[TENANT:BOSQUE]', mode: 'insensitive' },
            createdAt: svcCreatedAt,
          },
        })
      : Promise.resolve(0),
  ]);

  const net = Number(creditsSince._sum.netAmount ?? 0);
  const servico = svcRate > 0 ? svcCount * svcRate : 0;
  return Math.max(0, Number((net - servico).toFixed(2)));
}
