import { WithdrawStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { getModuleConfig } from '../../modules/module.registry';

/**
 * Replica a lógica de `wallet.netBalance` do GetMeUseCase para uma conta plataforma.
 */
export async function computeUserNetBalance(
  prisma: PrismaService,
  userId: string,
  tenantSlug: string | null | undefined,
): Promise<number> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return 0;

  const fatorLiquidez =
    getModuleConfig(tenantSlug)?.saque?.fatorLiquidez ??
    Number(process.env.DEFAULT_LIQUIDITY_FACTOR || 0.91);

  const renovadaId = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
  const slug = (tenantSlug || '').toLowerCase();
  const useRenovadaWalletLedger = slug === 'renovada' || slug === 'bosque' || userId === renovadaId;

  if (useRenovadaWalletLedger) {
    // wallet.balance armazena o valor líquido diretamente (netAmount já descontado das taxas)
    const storedNet = Number(wallet.balance);
    const pendingAggr = await prisma.withdrawRequest.aggregate({
      where: { userId, status: WithdrawStatus.PENDING },
      _sum: { grossAmount: true },
    });
    const pendingBruto = Number(pendingAggr._sum.grossAmount || 0);
    const availableNet = Math.max(0, storedNet - pendingBruto);
    return Number(availableNet.toFixed(2));
  }

  const isBosqueWallet = slug === 'bosque';
  const txRows = await prisma.transaction.findMany({
    where: {
      userId,
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
    select: { amount: true, netAmount: true },
  });

  const totalLiquidProfit = txRows.reduce((s, t) => {
    const net =
      t.netAmount != null ? Number(t.netAmount) : Number(t.amount) * fatorLiquidez;
    return s + net;
  }, 0);

  const completedAggr = await prisma.withdrawRequest.aggregate({
    where: { userId, status: WithdrawStatus.COMPLETED },
    _sum: { grossAmount: true },
  });
  const totalCompletedGross = Number(completedAggr._sum.grossAmount || 0);

  const activeAggr = await prisma.withdrawRequest.aggregate({
    where: {
      userId,
      status: { in: [WithdrawStatus.PENDING, WithdrawStatus.APPROVED] },
    },
    _sum: { grossAmount: true },
  });
  const lockedBalanceGross = Number(activeAggr._sum.grossAmount || 0);

  const currentNetProfit = totalLiquidProfit - totalCompletedGross;
  const availableBalance = Math.max(0, currentNetProfit - lockedBalanceGross);

  return Number(availableBalance.toFixed(2));
}
