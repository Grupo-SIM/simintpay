/** Port of sim-delivery `platformFees/calculateFees.ts` + `feeCoverage.ts`; keep rounding identical. */

export const FEE_SCOPES = ['order', 'product'] as const;
export const FEE_DISPLAY_MODES = [
  'product_explicit',
  'embedded',
  'checkout_only',
] as const;
export type FeeScope = (typeof FEE_SCOPES)[number];
export type FeeDisplayMode = (typeof FEE_DISPLAY_MODES)[number];
export type FeeMode = 'SIMINTPAY_ONLY' | 'ADDITIVE_ONLY' | 'BOTH';

/** A fee after platform overrides; percentage in basis points, fixed in cents. */
export type EffectiveFee = {
  id: string;
  name: string;
  applicationScope: FeeScope;
  displayMode: FeeDisplayMode;
  percentageValue: number;
  fixedValue: number;
};

export type FeeItemInput = { key: string; quantity: number; unitPrice: number };

export type CalculatedFee = EffectiveFee & {
  amountCents: number;
  items: { amountCents: number; itemKey: string; unitAmountCents: number }[];
};

function feeAmount(cents: number, fee: EffectiveFee) {
  return (
    Math.floor((cents * fee.percentageValue + 5_000) / 10_000) + fee.fixedValue
  );
}

export function calculatePlatformFees(
  fees: EffectiveFee[],
  items: FeeItemInput[],
): { feeTotalCents: number; fees: CalculatedFee[] } {
  const subtotal = items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  const calculated = fees.map((fee): CalculatedFee => {
    if (fee.applicationScope === 'order')
      return { ...fee, amountCents: feeAmount(subtotal, fee), items: [] };
    const feeItems = items.map((item) => {
      const unitAmountCents = feeAmount(item.unitPrice, fee);
      return {
        amountCents: unitAmountCents * item.quantity,
        itemKey: item.key,
        unitAmountCents,
      };
    });
    return {
      ...fee,
      amountCents: feeItems.reduce((sum, item) => sum + item.amountCents, 0),
      items: feeItems,
    };
  });
  return {
    fees: calculated,
    feeTotalCents: calculated.reduce((sum, fee) => sum + fee.amountCents, 0),
  };
}

export type FeeComponents = { fixedCents: number; ratePpm: number };
export type LaneId = { installments: number; method: string };
export const laneKey = (lane: LaneId) => `${lane.method}/${lane.installments}`;

export type CoverageLane = LaneId & {
  /** What SimIntPay pays the acquirer. */
  cost: FeeComponents;
  /** What the company is charged to cover it, after applying the fee mode. */
  covered: FeeComponents;
  fixedShortfallCents: number;
  rateShortfallPpm: number;
};

/** Surcharges stack without compounding, so components simply add up (basis points -> ppm). */
export function surchargeComponents(
  fees: Pick<EffectiveFee, 'fixedValue' | 'percentageValue'>[],
): FeeComponents {
  return {
    fixedCents: fees.reduce((sum, fee) => sum + fee.fixedValue, 0),
    ratePpm: fees.reduce((sum, fee) => sum + fee.percentageValue * 100, 0),
  };
}

/**
 * Compares fees charged for each lane against the global acquirer cost. Percentage and fixed parts are checked
 * independently, which is conservative: a higher fixed part never hides a lower percentage.
 */
export function evaluateCoverage(input: {
  costs: (FeeComponents & LaneId)[];
  disabledLanes?: string[];
  mode: FeeMode;
  simintpay: (FeeComponents & LaneId)[];
  surcharges: FeeComponents;
}): CoverageLane[] {
  const disabled = new Set(input.disabledLanes);
  const none = { fixedCents: 0, ratePpm: 0 };
  return input.costs
    .filter((cost) => !disabled.has(laneKey(cost)))
    .map((cost) => {
      const sim = input.simintpay.find(
        (lane) =>
          lane.method === cost.method &&
          lane.installments === cost.installments,
      );
      const simPart = input.mode === 'ADDITIVE_ONLY' ? none : (sim ?? none);
      const extraPart =
        input.mode === 'SIMINTPAY_ONLY' ? none : input.surcharges;
      const covered = {
        fixedCents: simPart.fixedCents + extraPart.fixedCents,
        ratePpm: simPart.ratePpm + extraPart.ratePpm,
      };
      return {
        cost: { fixedCents: cost.fixedCents, ratePpm: cost.ratePpm },
        covered,
        fixedShortfallCents: Math.max(0, cost.fixedCents - covered.fixedCents),
        installments: cost.installments,
        method: cost.method,
        rateShortfallPpm: Math.max(0, cost.ratePpm - covered.ratePpm),
      };
    });
}

export const hasShortfall = (lanes: CoverageLane[]) =>
  lanes.some(
    (lane) => lane.rateShortfallPpm > 0 || lane.fixedShortfallCents > 0,
  );
