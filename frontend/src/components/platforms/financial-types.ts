export type Addition = { fixedCents: number; ratePpm: number };
export type OwnerRule = Addition & { passInterestPpm: number };
export type Lane = {
  total?: Addition;
  active: boolean;
  contract: Addition & {
    cashbackCents: number;
    interestPpm: number;
    base: 'ORIGINAL' | 'BUYER_TOTAL';
    reference: string;
  };
  sim: Addition & { interestPpm: number };
};
export type FeeMode = 'SIMINTPAY_ONLY' | 'ADDITIVE_ONLY' | 'BOTH';
export type AdditiveFeeScope = 'order' | 'product';
export type AdditiveScopeTotal = {
  percentageValue: number;
  fixedValue: number;
};
/** Sums of the active additive fees per scope; percentageValue in basis points, fixedValue in cents. */
export type AdditiveTotals = Record<AdditiveFeeScope, AdditiveScopeTotal>;
export type AdditiveFeesView = {
  revision: string;
  effective: AdditiveTotals;
};
export const ZERO_ADDITIVE_TOTALS: AdditiveTotals = {
  order: { percentageValue: 0, fixedValue: 0 },
  product: { percentageValue: 0, fixedValue: 0 },
};
export type FinancialConfiguration = {
  /** Additive totals for this platform (admin only; GLOBAL has none). */
  additiveFees?: AdditiveFeesView;
  /** Null for GLOBAL, which has no platform row. */
  feeMode?: FeeMode | null;
  /** `METHOD/installments` lanes the platform does not accept; null for GLOBAL. */
  disabledLanes?: string[] | null;
  interestFreeOverride?: boolean | null;
  globalInterestFree?: boolean;
  ownerOverrides: Record<string, OwnerRule>;
  globalOwner: Record<string, OwnerRule>;
  laneOverrides?: Record<string, Lane>;
  globalLanes?: Record<string, Lane>;
  version: string;
  keys: string[];
  owner: Record<string, OwnerRule>;
  interestFree: boolean;
  lanes?: Record<string, Lane>;
  sources: Record<
    string,
    { lane: 'global' | 'override'; owner: 'global' | 'override' | 'default' }
  >;
};
export type FinancialResult = {
  effectiveFees?: {
    acquirer:
      | (Addition & { interestPpm: number; base: 'ORIGINAL' | 'BUYER_TOTAL' })
      | null;
    sim: Addition & { interestPpm: number };
    priceFloorApplied: boolean;
  };
  installments: number;
  originalCents: number;
  buyerAdditionCents: number;
  buyerInterestCents: number;
  buyerTotalCents: number;
  contractedCostCents: number;
  netCents: number;
  differenceCents: number;
  processingCostCents?: number;
  interestCostCents?: number;
  interestRatePpm?: number;
  buyerInterestRatePpm?: number;
  acquirerCostCents?: number;
  acquirerProcessingCents?: number;
  acquirerInterestCents?: number;
  simAdditionCents?: number;
  simInterestCents?: number;
  simMarginCents?: number;
};
export type SimulationRow = {
  installments: number;
  result?: FinancialResult;
  error?: string;
};
export type RowState = SimulationRow & { pending: boolean };
/** Payment methods in display order: cash-like first, credit (1-12x) last. */
export const PAYMENT_METHODS = [
  { method: 'PIX', label: 'Pix', installments: 1 },
  { method: 'DEBIT_CARD', label: 'Débito', installments: 1 },
  { method: 'BOLETO', label: 'Boleto', installments: 1 },
  { method: 'CREDIT_CARD', label: 'Crédito', installments: 12 },
] as const;
/** `METHOD/installments`, the id used by `disabledLanes`. */
export const laneId = (key: string) => {
  const [, method, , installments] = key.split('/');
  return `${method}/${installments}`;
};
export const defaultOwner = (): OwnerRule => ({
  fixedCents: 0,
  ratePpm: 0,
  passInterestPpm: 0,
});
export const defaultLane = (): Lane => ({
  active: true,
  contract: {
    fixedCents: 0,
    ratePpm: 0,
    cashbackCents: 0,
    interestPpm: 0,
    base: 'ORIGINAL',
    reference: '',
  },
  sim: { fixedCents: 0, ratePpm: 0, interestPpm: 0 },
});
export const formatCents = (value: number) =>
  (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Merchant's effective fee for a lane: additive values (unless SIMINTPAY_ONLY) plus the
 * SimIntPay lane fee (unless ADDITIVE_ONLY), percentage and fixed summed separately.
 * The SimIntPay part is always `lane.sim`, same as backend `evaluateCoverage` (`lane.total` is ignored).
 */
export const effectiveFee = (
  lane: Lane | undefined,
  feeMode: FeeMode | null | undefined,
  additiveTotals: AdditiveTotals = ZERO_ADDITIVE_TOTALS,
): Addition => {
  const mode = feeMode ?? 'SIMINTPAY_ONLY';
  const sim = lane?.sim;
  const additive =
    mode === 'SIMINTPAY_ONLY'
      ? []
      : [additiveTotals.order, additiveTotals.product];
  return {
    ratePpm:
      (mode === 'ADDITIVE_ONLY' ? 0 : (sim?.ratePpm ?? 0)) +
      additive.reduce((sum, fee) => sum + fee.percentageValue * 100, 0),
    fixedCents:
      (mode === 'ADDITIVE_ONLY' ? 0 : (sim?.fixedCents ?? 0)) +
      additive.reduce((sum, fee) => sum + fee.fixedValue, 0),
  };
};
/** Short when the effective fee is below the acquirer cost on either component. */
export const feeShortfall = (effective: Addition, cost: Addition) => ({
  rateShortfallPpm: Math.max(0, cost.ratePpm - effective.ratePpm),
  fixedShortfallCents: Math.max(0, cost.fixedCents - effective.fixedCents),
});
export const formatPpm = (ppm: number) =>
  `${(ppm / 10_000).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
export const formatFeeValue = (percentageBp: number, fixedCents: number) =>
  `${formatPpm(percentageBp * 100)} + ${formatCents(fixedCents)}`;
export const SCOPE_LABELS: Record<AdditiveFeeScope, string> = {
  order: 'Por pedido',
  product: 'Por produto',
};
