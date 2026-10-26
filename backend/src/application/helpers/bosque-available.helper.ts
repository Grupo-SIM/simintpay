import { WithdrawStatus, TransactionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

/** BOSQUE passou a cobrar TAXA_SERVICO (R$4 Sim Int Pay) a partir de 2026-05-29 — mesma data da Renovada. */
const BOSQUE_TAXA_SERVICO_DATE = new Date('2026-05-29T20:40:00.000Z');

/**
 * Saldo disponível canônico do Bosque (IBB), na mesma lógica contábil da Renovada
 * (crédito − saques), porém calculado a partir das transações (o wallet.balance do
 * Bosque é creditado BRUTO no sync/webhook, então não serve de base):
 *
 *   disponível = Σ(netAmount − TAXA_SERVICO) das transações BOSQUE concluídas
 *                − Σ(bruto dos saques NÃO recusados: PENDING + APPROVED + COMPLETED)
 *
 * Cada saque desconta EXATAMENTE o seu valor bruto — saques parciais deixam o troco
 * disponível (ex.: 280 disponível, saca 180 → sobra 100). Antes o modelo "zerava" o
 * disponível a cada saque (contava só o que entrava depois do último), o que fazia o
 * troco de saques parciais sumir. Independe do wallet.balance.
 */
export async function computeBosqueAvailableSinceLastWithdrawal(
  prisma: PrismaService,
  userIds: string[],
): Promise<number> {
  if (userIds.length === 0) return 0;

  const svcRate = getPlatformTaxaEffective('BOSQUE', 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);

  const baseWhere: Prisma.TransactionWhereInput = {
    userId: { in: userIds },
    status: TransactionStatus.COMPLETED,
    description: { contains: '[TENANT:BOSQUE]', mode: 'insensitive' },
  };

  const [creditsAgg, svcCount, withdrawals] = await Promise.all([
    // Crédito líquido de TODAS as transações concluídas (não só desde o último saque).
    prisma.transaction.aggregate({ where: baseWhere, _sum: { netAmount: true } }),
    // TAXA_SERVICO incide nas transações criadas a partir de 2026-05-29.
    svcRate > 0
      ? prisma.transaction.count({
          where: { ...baseWhere, createdAt: { gte: BOSQUE_TAXA_SERVICO_DATE } },
        })
      : Promise.resolve(0),
    // Saques que reservam/consomem saldo (tudo menos recusado). grossAmount é o que sai
    // do disponível; para registros antigos sem grossAmount, cai no amount (líquido).
    prisma.withdrawRequest.findMany({
      where: {
        userId: { in: userIds },
        status: { in: [WithdrawStatus.PENDING, WithdrawStatus.APPROVED, WithdrawStatus.COMPLETED] },
      },
      select: { grossAmount: true, amount: true },
    }),
  ]);

  const net = Number(creditsAgg._sum.netAmount ?? 0);
  const servico = svcRate > 0 ? svcCount * svcRate : 0;
  const withdrawn = withdrawals.reduce(
    (sum, w) => sum + Number(w.grossAmount ?? w.amount ?? 0),
    0,
  );

  return Math.max(0, Number((net - servico - withdrawn).toFixed(2)));
}
