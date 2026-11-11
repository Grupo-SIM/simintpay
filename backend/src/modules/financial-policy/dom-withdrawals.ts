export type DomWithdrawal = {
  externalId: string;
  /** Plain YYYY-MM-DD in the DOM account's calendar. */
  date: string;
  amountCents: number;
};

export type DomWithdrawalsPage = {
  totalPages: number;
  withdrawals: DomWithdrawal[];
};

/**
 * Parses /front-store/withdraws. Only PAID transfers are withdrawals made; anything else
 * (pending, cancelled, failed) is ignored. The response also carries identity and permission
 * data, so nothing beyond the fields below is read or kept.
 */
export function parseDomWithdrawals(body: unknown): DomWithdrawalsPage {
  const root = body as {
    status?: unknown;
    total_pages?: unknown;
    withdraws?: unknown;
  } | null;
  if (!root || typeof root !== 'object' || !Array.isArray(root.withdraws))
    throw new Error('Resposta de saques DOM inválida');
  const withdrawals: DomWithdrawal[] = [];
  for (const raw of root.withdraws as Record<string, unknown>[]) {
    if (raw?.status !== 'PAID') continue;
    const id = String(raw.id_transfer ?? '');
    const date = String(raw.date_transfer ?? '').slice(0, 10);
    const value = Number(raw.value);
    if (
      !id ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(value) ||
      value <= 0
    )
      continue;
    withdrawals.push({
      externalId: id,
      date,
      amountCents: Math.round(value * 100),
    });
  }
  return {
    totalPages: Math.max(1, Number(root.total_pages) || 1),
    withdrawals,
  };
}
