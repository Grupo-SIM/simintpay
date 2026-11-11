/** Port of sim-delivery `platformFees/calculateFees.ts` + `feeCoverage.ts`; keep rounding identical. */

export const FEE_SCOPES = ['order', 'product'] as const;
export type FeeScope = (typeof FEE_SCOPES)[number];
export type FeeMode = 'SIMINTPAY_ONLY' | 'ADDITIVE_ONLY' | 'BOTH';

/** Sum of the additive fees per scope; percentage in basis points, fixed in cents. */
export type AdditiveTotals = Record<
  FeeScope,
  { percentageValue: number; fixedValue: number }
>;

/** A synthetic fee derived from a scope total; percentage in basis points, fixed in cents. */
export type EffectiveFee = {
  id: string;
  name: string;
  applicationScope: FeeScope;
  percentageValue: number;
  fixedValue: number;
};

export const SCOPE_NAMES: Record<FeeScope, string> = {
  order: 'Taxas aditivas por pedido',
  product: 'Taxas aditivas por produto',
};

/** Effective totals as two synthetic fees (order, product), so the calculation matches Delivery's per-scope rounding. */
export const totalsToFees = (totals: AdditiveTotals): EffectiveFee[] =>
  FEE_SCOPES.map((scope) => ({
    id: `additive-${scope}`,
    name: SCOPE_NAMES[scope],
    applicationScope: scope,
    percentageValue: totals[scope].percentageValue,
    fixedValue: totals[scope].fixedValue,
  }));

/** Coverage components of the totals: % and fixed of both scopes are summed. */
export const totalsComponents = (totals: AdditiveTotals): FeeComponents =>
  surchargeComponents(totalsToFees(totals));

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
 * Fees charged on top of the acquirer cost for each lane. The acquirer cost is always charged to the seller in
 * addition to the SimIntPay excess and the additive fees, so a lane is never under-covered: the shortfall only
 * appears if a charged component is negative. `cost` is kept for consumers that show it next to the excess.
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
        fixedShortfallCents: Math.max(0, -covered.fixedCents),
        installments: cost.installments,
        method: cost.method,
        rateShortfallPpm: Math.max(0, -covered.ratePpm),
      };
    });
}

export const hasShortfall = (lanes: CoverageLane[]) =>
  lanes.some(
    (lane) => lane.rateShortfallPpm > 0 || lane.fixedShortfallCents > 0,
  );
