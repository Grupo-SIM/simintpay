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
export type AdditiveFeeDisplayMode =
  'product_explicit' | 'embedded' | 'checkout_only';
/** percentageValue in basis points (100 = 1%), fixedValue in cents. */
export type AdditiveFee = {
  id: string;
  name: string;
  applicationScope: AdditiveFeeScope;
  displayMode: AdditiveFeeDisplayMode;
  percentageValue: number;
  fixedValue: number;
  active: boolean;
};
export type CompanyAdditiveFee = AdditiveFee & {
  associated: boolean;
  percentageOverride: number | null;
  fixedOverride: number | null;
  effectivePercentageValue: number;
  effectiveFixedValue: number;
};
/** Draft edit of one fee association, sent as-is in the PATCH body. */
export type AdditiveFeeEdit = {
  feeId: string;
  associated?: boolean;
  percentageOverride?: number | null;
  fixedOverride?: number | null;
  reset?: boolean;
};
export type FinancialConfiguration = {
  /** Catalog with this platform's associations/overrides (GLOBAL: the catalog itself). */
  additiveFees?: CompanyAdditiveFee[];
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

/** What a fee charges after the draft edit: reset drops overrides, otherwise overrides win over the catalog. */
export const applyAdditiveEdit = (
  fee: CompanyAdditiveFee,
  edit?: AdditiveFeeEdit,
): CompanyAdditiveFee => {
  if (!edit) return fee;
  const percentageOverride = edit.reset
    ? null
    : edit.percentageOverride !== undefined
      ? edit.percentageOverride
      : fee.percentageOverride;
  const fixedOverride = edit.reset
    ? null
    : edit.fixedOverride !== undefined
      ? edit.fixedOverride
      : fee.fixedOverride;
  return {
    ...fee,
    associated: edit.associated ?? fee.associated,
    percentageOverride,
    fixedOverride,
    effectivePercentageValue: percentageOverride ?? fee.percentageValue,
    effectiveFixedValue: fixedOverride ?? fee.fixedValue,
  };
};
/**
 * Merchant's effective fee for a lane: active associated additive fees (unless SIMINTPAY_ONLY) plus the
 * SimIntPay lane fee (unless ADDITIVE_ONLY), percentage and fixed summed separately.
 * `lane.total`, when set, is the all-in SimIntPay charge (it already includes the acquirer cost), so it is the
 * SimIntPay part; otherwise `lane.sim` is used, matching the "SimIntPay" column of the simulation card.
 */
export const effectiveFee = (
  lane: Lane | undefined,
  feeMode: FeeMode | null | undefined,
  additiveFees: CompanyAdditiveFee[] = [],
): Addition => {
  const mode = feeMode ?? 'SIMINTPAY_ONLY';
  const sim = lane ? (lane.total ?? lane.sim) : undefined;
  const additive =
    mode === 'SIMINTPAY_ONLY'
      ? []
      : additiveFees.filter((fee) => fee.associated && fee.active);
  return {
    ratePpm:
      (mode === 'ADDITIVE_ONLY' ? 0 : (sim?.ratePpm ?? 0)) +
      additive.reduce(
        (sum, fee) => sum + fee.effectivePercentageValue * 100,
        0,
      ),
    fixedCents:
      (mode === 'ADDITIVE_ONLY' ? 0 : (sim?.fixedCents ?? 0)) +
      additive.reduce((sum, fee) => sum + fee.effectiveFixedValue, 0),
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
export const DISPLAY_MODE_LABELS: Record<AdditiveFeeDisplayMode, string> = {
  product_explicit: 'Explícita no produto',
  embedded: 'Embutida no preço',
  checkout_only: 'Somente no checkout',
};
