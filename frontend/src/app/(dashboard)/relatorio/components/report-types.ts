export type ReportPlatform = {
  id: string;
  tag: string;
  name: string;
  isActive: boolean;
};
export type ReportPage<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type ReportSummary = {
  unit: 'cents';
  participationOnly?: boolean;
  coproducao?: {
    count: number;
    creditedCents: number;
    lockedCents: number;
    reversedCents: number;
  };
  platformsCount: number;
  summary: {
    salesCount: number;
    grossCents: number;
    feesCents: number;
    netCents: number;
    refundsCents: number;
    refundsCount: number;
    withdrawalsCents: number;
    pendingWithdrawalsCents: number;
    withdrawalFeesCents?: number;
    customersCount?: number;
    interestCents?: number | null;
    missingInterestSnapshots?: number;
    refundedCents?: number;
    refundedCount?: number;
    chargebacksCents?: number;
    chargebacksCount?: number;
    pendingSalesCents?: number;
    pendingSalesCount?: number;
    failedSalesCents?: number;
    failedSalesCount?: number;
    missingNetSnapshots: number;
    historicalAttributionComplete: boolean;
  };
};
export type ReportSeries = {
  unit: 'cents';
  data: {
    key: string;
    count: number;
    grossCents: number;
    netCents: number;
    feesCents?: number;
    interestCents?: number | null;
  }[];
};
export type ReportTransaction = {
  id: string;
  platformTag: string;
  createdAt: string;
  description?: string | null;
  customerName?: string | null;
  status: string;
  paymentMethod: string;
  grossCents: number;
  feesCents: number;
  netCents: number | null;
};
export type PlatformBalance = ReportPlatform & {
  owner: { id: string; name: string; email: string };
  walletScope: 'owner' | 'shared-owner';
  balanceCents: number;
  availableBalanceCents: number;
  pendingWithdrawalsGrossCents: number;
  earnedCents: number;
  withdrawnGrossCents: number;
  ownerWalletBalanceCents: number;
  historicalAttributionComplete: boolean;
};
export const reportMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const reportStatus: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING: 'Pendente',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  REFUNDED: 'Estornada',
  EXPIRED: 'Expirada',
  IN_MEDIATION: 'Em mediação',
  CHARGEBACK: 'Contestada',
  PENDING_REFUND: 'Estorno pendente',
};
export const reportMethod: Record<string, string> = {
  PIX: 'PIX',
  CREDIT_CARD: 'Crédito',
  DEBIT_CARD: 'Débito',
  BOLETO: 'Boleto',
};
