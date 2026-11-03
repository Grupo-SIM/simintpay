/**
 * Helpers de rótulo de parcelamento.
 *
 * "(com juros)" só aparece quando a opção tem juros de parcelamento de fato
 * (`interestAmount > 0`). Taxas aditivas, DOM e demais acréscimos elevam o
 * total, mas não são juros: parcelado também pode ser sem juros.
 */

/**
 * Monta o rótulo de uma opção de parcela para o <select> do checkout.
 *
 * - 1x sem juros                → "À vista — R$ X"
 * - 1x com juros                → "1x de R$ X (com juros)"
 * - Nx (qualquer acréscimo)     → "Nx de R$ Y" + " (com juros)" só se houver juros
 */
export function buildInstallmentLabel(params: {
  installments: number;
  perInstallment: number;
  total: number;
  /** Valor de juros de parcelamento da opção (0/ausente = sem juros). */
  interestAmount?: number;
  formatCurrency: (value: number) => string;
}): string {
  const {
    installments,
    perInstallment,
    total,
    interestAmount,
    formatCurrency,
  } = params;
  const comJuros = (interestAmount ?? 0) > 0;

  if (installments === 1 && !comJuros) {
    return `À vista — ${formatCurrency(total)}`;
  }

  return `${installments}x de ${formatCurrency(perInstallment)}${comJuros ? ' (com juros)' : ''}`;
}
