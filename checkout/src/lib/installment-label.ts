/**
 * Helpers de rótulo de parcelamento.
 *
 * Regra garantida: TODA opção de parcela cujo valor total difere do valor
 * original do produto/link deve ser exibida com o sufixo "(com juros)".
 *
 * Por que não confiar nas flags do backend (`temJuros` / `hasInterest`):
 * elas historicamente consideram apenas a taxa da PLATAFORMA (masterRate /
 * platformFeeRate) e ignoram a taxa DOM. Em 2x+ a DOM sozinha já faz o total
 * superar o valor original, então a flag retornava `false` mesmo havendo
 * acréscimo. Aqui comparamos o total efetivo contra o original — fonte única
 * de verdade — para nunca deixar uma parcela com acréscimo sem o aviso.
 */

/** Arredonda para centavos para comparar valores monetários sem erro de float. */
function toCents(value: number): number {
  return Math.round(value * 100);
}

/**
 * Retorna `true` quando o total pago numa opção de parcela difere do valor
 * original (ou seja, há juros/acréscimo). Qualquer diferença ao centavo conta.
 */
export function hasInstallmentInterest(
  total: number,
  original: number,
): boolean {
  if (!Number.isFinite(total) || !Number.isFinite(original)) return false;
  return toCents(total) !== toCents(original);
}

/**
 * Monta o rótulo de uma opção de parcela para o <select> do checkout.
 *
 * - 1x sem acréscimo            → "À vista — R$ X"
 * - 1x com acréscimo            → "1x de R$ X (com juros)"
 * - Nx (qualquer acréscimo)     → "Nx de R$ Y" + " (com juros)" se total ≠ original
 */
export function buildInstallmentLabel(params: {
  installments: number;
  perInstallment: number;
  total: number;
  original: number;
  formatCurrency: (value: number) => string;
}): string {
  const { installments, perInstallment, total, original, formatCurrency } =
    params;
  const comJuros = hasInstallmentInterest(total, original);

  if (installments === 1 && !comJuros) {
    return `À vista — ${formatCurrency(total)}`;
  }

  return `${installments}x de ${formatCurrency(perInstallment)}${comJuros ? ' (com juros)' : ''}`;
}
