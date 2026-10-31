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
export type FinancialConfiguration = {
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
