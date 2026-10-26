import { getPlatformOwnerId } from '../../modules/module.registry';
import { WithdrawStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { getModuleConfig } from '../../modules/module.registry';
import { getPlatformTaxaEffective, canonicalPlatformTaxaTag } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';
import { platformTaxaTagFromText } from './dom-fee-estimate.helper';

const TAGS_SEM_TAXA_SERVICO = new Set<string>();
const TAXA_SERVICO_EFFECTIVE_DATE = new Date('2026-05-18T03:00:00.000Z');

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
    getPlatformTaxaEffective('GLOBAL', 'LIQUIDEZ', 0.91);

  const renovadaId = (getPlatformOwnerId('RENOVADA') ?? '');
  const slug = (tenantSlug || '').toLowerCase();
  const useRenovadaWalletLedger = slug === 'renovada' || slug === 'bosque';

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
  const fallbackTag = canonicalPlatformTaxaTag(slug.toUpperCase() || 'GLOBAL');
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
    select: { amount: true, description: true, createdAt: true },
  });

  const totalLiquidProfit = txRows.reduce((s, t) => {
    const rowTag = platformTaxaTagFromText(t.description ?? undefined);
    const effectiveTag = rowTag !== 'GLOBAL' ? rowTag : fallbackTag;
    const liqRate = getPlatformTaxaEffective(effectiveTag, 'LIQUIDEZ', PLATFORM_TAXA_DEFAULTS.LIQUIDEZ);
    const svcRate = TAGS_SEM_TAXA_SERVICO.has(effectiveTag)
      ? 0
      : getPlatformTaxaEffective(effectiveTag, 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);
    const svcFee = svcRate > 0 && t.createdAt >= TAXA_SERVICO_EFFECTIVE_DATE ? svcRate : 0;
    return s + Number(t.amount) * liqRate - svcFee;
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
  const availableBalance = currentNetProfit - lockedBalanceGross;

  return Number(availableBalance.toFixed(2));
}
