export type RefundReportTransaction = {
  amount: unknown;
  createdAt?: Date;
  updatedAt: Date;
  statusHistory: Array<{ createdAt: Date }>;
};

type RefundReportRange = {
  start?: Date;
  end?: Date;
  dateBasis?: 'refund' | 'transaction';
};

export function summarizeRefunds(
  transactions: RefundReportTransaction[],
  range: RefundReportRange = {},
): { quantidade: number; valor: number } {
  const refundsInRange = transactions.filter((transaction) => {
    const referenceDate = range.dateBasis === 'transaction'
      ? transaction.createdAt
      : transaction.statusHistory[0]?.createdAt ?? transaction.updatedAt;
    if (!referenceDate) return false;
    if (range.start && referenceDate < range.start) return false;
    if (range.end && referenceDate > range.end) return false;
    return true;
  });

  return {
    quantidade: refundsInRange.length,
    valor: Number(
      refundsInRange
        .reduce((total, transaction) => total + Number(transaction.amount ?? 0), 0)
        .toFixed(2),
    ),
  };
}
