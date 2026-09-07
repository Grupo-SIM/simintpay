export type RefundReportTransaction = {
  amount: unknown;
  updatedAt: Date;
  statusHistory: Array<{ createdAt: Date }>;
};

type RefundReportRange = {
  start?: Date;
  end?: Date;
};

export function summarizeRefunds(
  transactions: RefundReportTransaction[],
  range: RefundReportRange = {},
): { quantidade: number; valor: number } {
  const refundsInRange = transactions.filter((transaction) => {
    const refundedAt = transaction.statusHistory[0]?.createdAt ?? transaction.updatedAt;
    if (range.start && refundedAt < range.start) return false;
    if (range.end && refundedAt > range.end) return false;
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
