/**
 * Custo da adquirente de uma Transaction, independente de qual adquirente cobrou.
 * O snapshot financeiro guarda o custo realizado na venda; linhas sem snapshot
 * (ou com custo desconhecido) usam o valor gravado em `domFee`.
 */
export function acquirerCostReais(tx: {
  domFee?: unknown;
  financialSnapshot?: unknown;
}): number {
  const snapshot = tx.financialSnapshot as
    | { acquirerCost?: { realizedCents?: number | null } }
    | null
    | undefined;
  const realized = snapshot?.acquirerCost?.realizedCents;
  if (typeof realized === 'number' && Number.isFinite(realized))
    return Number((realized / 100).toFixed(2));
  return Number(Number(tx.domFee ?? 0).toFixed(2));
}
