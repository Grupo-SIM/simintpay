import { Prisma } from '@prisma/client';
import {
  calculateFinancials,
  type Lane,
  type ResolvedPolicy,
  type ScheduledFee,
} from './financial-policy';

const D = Prisma.Decimal;
const round = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(0, D.ROUND_HALF_UP).toNumber();
const fraction = (cents: number, ppm: number) =>
  new D(cents).mul(ppm).div(1_000_000);

export const MAX_TARGET_FEE_PPM = 1_000_000;

/** Platform override that turns the target off, ignoring the global one. 0 is a real 0% target. */
export const TARGET_FEE_OFF = -1;

/**
 * A target fee is a share of the purchase total, in millionths; 0 is valid. Platform overrides may also be
 * `TARGET_FEE_OFF` ("off, ignore the global target"); `null` means "inherit the global target" (and "off" globally).
 */
export function validateTargetFeePpm(
  value: unknown,
  platform = false,
): number | null {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    (platform && value === TARGET_FEE_OFF)
  ) {
    if (platform && value === TARGET_FEE_OFF) return value;
    throw new Error('Taxa alvo inválida');
  }
  if (value < 0 || value >= MAX_TARGET_FEE_PPM)
    throw new Error('Taxa alvo inválida');
  return value;
}

/** Platform override wins (`TARGET_FEE_OFF` turns the target off); otherwise the global target applies. */
export function resolveTargetFee(
  globalPpm: number | null | undefined,
  platformPpm: number | null | undefined,
): number | null {
  const ppm = platformPpm ?? globalPpm ?? null;
  return ppm === null || ppm === TARGET_FEE_OFF ? null : ppm;
}

/**
 * Target fee: replaces only the normal SimIntPay processing fees charged to the seller. The seller pays
 * `targetFeePpm` of the original amount: the most expensive active acquirer's processing cost (MDR + fixed) plus a
 * SimIntPay addition that completes the target. Interest is unchanged: acquirer/SimIntPay interest and the
 * buyer's pass-through follow the normal calculation, and additive fees are applied by the caller, outside it.
 * When the most expensive acquirer costs more than the target the addition is negative: SimIntPay absorbs the
 * difference so the seller still pays exactly the target.
 */
export function calculateTargetFinancials(
  policy: ResolvedPolicy,
  key: string,
  originalCents: number,
  targetFeePpm: number,
  scheduled: { fees: ScheduledFee[]; routedAcquirer: string },
  buyerTotalAsInput = false,
) {
  // Manual SimIntPay fee (fixed and %) is not read; the lane may not even exist. Sim interest is kept.
  const stored = policy.document.lanes[key];
  const lane: Lane = {
    active: true,
    contract: stored?.contract ?? {
      fixedCents: 0,
      ratePpm: 0,
      cashbackCents: 0,
      interestPpm: 0,
      base: 'ORIGINAL',
      reference: '',
    },
    sim: {
      fixedCents: 0,
      ratePpm: 0,
      interestPpm: stored?.sim.interestPpm ?? 0,
    },
  };
  const credit = key.includes('/CREDIT_CARD/');
  const base = calculateFinancials(
    {
      ...policy,
      document: {
        ...policy.document,
        lanes: { ...policy.document.lanes, [key]: lane },
        owner: {
          ...policy.document.owner,
          [key]: policy.document.owner[key] ?? {
            fixedCents: 0,
            ratePpm: 0,
            passInterestPpm: credit ? 1_000_000 : 0,
          },
        },
      },
    },
    key,
    originalCents,
    undefined,
    scheduled,
    buyerTotalAsInput,
  );
  const targetCents = round(fraction(originalCents, targetFeePpm));
  const addition = targetCents - base.processingCostCents;
  base.contractedCostCents += addition;
  base.processingCostCents += addition;
  base.netCents -= addition;
  base.differenceCents -= addition;
  base.simAdditionCents += addition;
  base.simMarginCents += addition;
  base.effectiveFees.sim.ratePpm = round(
    new D(addition).mul(1_000_000).div(originalCents),
  );
  return {
    ...base,
    targetFeePpm,
  };
}
