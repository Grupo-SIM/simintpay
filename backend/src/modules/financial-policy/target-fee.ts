import { Prisma } from '@prisma/client';
import { estimatedCost } from './acquirer-fees';
import type { ScheduledFee } from './financial-policy';

const D = Prisma.Decimal;
const round = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(0, D.ROUND_HALF_UP).toNumber();
const fraction = (cents: number, ppm: number) =>
  new D(cents).mul(ppm).div(1_000_000);

export const MAX_TARGET_FEE_PPM = 1_000_000;

/** A target fee is a whole-percentage-or-finer share of the purchase total, in millionths. */
export function validateTargetFeePpm(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value >= MAX_TARGET_FEE_PPM
  )
    throw new Error('Taxa alvo inválida');
  return value;
}

/**
 * Target fee: the seller is charged `targetFeePpm` of the purchase total, interest-free. The price is the most
 * expensive active acquirer cost plus a SimIntPay addition that completes the target. Manual fees are not read.
 * When the most expensive acquirer already costs more than the target the addition is zero and the target is
 * unreachable (`targetUnreachable`); the seller is never charged below the acquirer's price.
 */
export function calculateTargetFinancials(
  version: string,
  key: string,
  totalCents: number,
  targetFeePpm: number,
  scheduled: { fees: ScheduledFee[]; routedAcquirer: string },
) {
  if (
    !Number.isSafeInteger(totalCents) ||
    totalCents <= 0 ||
    totalCents > 1_000_000_000
  )
    throw new Error('Valor inválido');
  const costOf = (fee: ScheduledFee) =>
    estimatedCost(
      { ...fee, createdAt: new Date(fee.createdAt) },
      totalCents,
      totalCents,
    );
  const routed = scheduled.fees.find(
    (fee) => fee.acquirer === scheduled.routedAcquirer,
  );
  if (!routed)
    throw new Error(
      'Adquirente sem tabela ativa para esta modalidade, canal e parcela',
    );
  const winner = [...scheduled.fees].sort(
    (a, b) => costOf(b) - costOf(a) || a.acquirer.localeCompare(b.acquirer),
  )[0]!;
  const winnerCostCents = costOf(winner);
  const targetCents = round(fraction(totalCents, targetFeePpm));
  const contractedCostCents = Math.max(targetCents, winnerCostCents);
  const simAdditionCents = contractedCostCents - winnerCostCents;
  const acquirerCostCents = costOf(routed);
  const acquirerInterestCents = round(fraction(totalCents, routed.interestPpm));
  const n = Number(key.split('/')[3]);
  const installmentCents = Math.floor(totalCents / n);
  const netCents = totalCents - contractedCostCents;
  return {
    version,
    key,
    installments: n,
    originalCents: totalCents,
    buyerAdditionCents: 0,
    buyerInterestCents: 0,
    buyerTotalCents: totalCents,
    pricingAcquirer: winner.acquirer,
    realizedAcquirer: scheduled.routedAcquirer,
    fallbackPricing: winner.acquirer !== scheduled.routedAcquirer,
    interestPassThroughCents: 0,
    installmentCents,
    lastInstallmentCents: totalCents - installmentCents * (n - 1),
    contractedCostCents,
    processingCostCents: contractedCostCents,
    interestCostCents: 0,
    interestRatePpm: 0,
    buyerInterestRatePpm: 0,
    netCents,
    differenceCents: netCents - totalCents,
    acquirerCostCents,
    acquirerProcessingCents: acquirerCostCents - acquirerInterestCents,
    acquirerInterestCents,
    simAdditionCents,
    simInterestCents: 0,
    simMarginCents: contractedCostCents - acquirerCostCents,
    targetFeePpm,
    targetUnreachable: winnerCostCents > targetCents,
    effectiveFees: {
      acquirer: { ...routed },
      sim: {
        fixedCents: 0,
        ratePpm: round(new D(simAdditionCents).mul(1_000_000).div(totalCents)),
        interestPpm: 0,
      },
    },
  };
}
