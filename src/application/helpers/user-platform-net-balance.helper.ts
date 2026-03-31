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
  const useRenovadaWalletLedger = slug === 'renovada' || userId === renovadaId;

  if (useRenovadaWalletLedger) {
    const fatorRenovada =
      getModuleConfig('renovada')?.saque?.fatorLiquidez ??
      Number(process.env.RENOVADA_LIQUIDEZ || 0.91);
    const storedGross = Number(wallet.balance);
    const debitedAggr = await prisma.withdrawRequest.aggregate({
      where: {
        userId,
        status: { in: [WithdrawStatus.APPROVED, WithdrawStatus.COMPLETED] },
      },
      _sum: { grossAmount: true },
    });
    const debitedBruto = Number(debitedAggr._sum.grossAmount || 0);
    const pendingAggr = await prisma.withdrawRequest.aggregate({
      where: { userId, status: WithdrawStatus.PENDING },
      _sum: { grossAmount: true },
    });
    const pendingBruto = Number(pendingAggr._sum.grossAmount || 0);
    const rawDisplayTotalNet =
      storedGross * fatorRenovada + debitedBruto * (fatorRenovada - 1);
    const displayTotalNet = Math.max(0, rawDisplayTotalNet);
    const availableNet = Math.max(0, displayTotalNet - pendingBruto);
    return Number(availableNet.toFixed(2));
  }

  const txRows = await prisma.transaction.findMany({
    where: { userId, status: 'COMPLETED', amount: { gt: 0 } },
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
