import type { PaymentLink } from '@prisma/client';

/**
 * Taxas da DOM por número de parcelas (cobradas do COMPRADOR sobre o valor com juros).
 */
const DOM_FEE_RATES: Record<number, number> = {
  1:  0.0000,  // 0,00%
  2:  0.0451,  // 4,51%
  3:  0.0604,  // 6,04%
  4:  0.0759,  // 7,59%
  5:  0.0915,  // 9,15%
  6:  0.1072,  // 10,72%
  7:  0.1231,  // 12,31%
  8:  0.1392,  // 13,92%
  9:  0.1554,  // 15,54%
  10: 0.1717,  // 17,17%
  11: 0.1882,  // 18,82%
  12: 0.2048,  // 20,48%
};

/**
 * Taxa fixa da DOM por parcela (R$1,00 para 2x+, R$0 para 1x).
 */
function getDomFixedFee(installments: number): number {
  return installments > 1 ? 1.0 : 0;
}

/**
 * Taxa do vendedor (Cliente A): sempre 6,99% + R$4,00, independente das parcelas.
 */
const SELLER_FEE_PERCENTAGE = 0.0699;
const SELLER_FEE_FIXED = 4.0;

/**
 * Retorna a taxa de juros da plataforma (platformFee) configurada no link para o
 * número de parcelas dado.
 *
 * Regra:
 * - isStandalone=true (Avulso): 1x sem juros, 2x+ com juros
 * - isStandalone=false (Plataforma): sempre com juros, incluindo 1x e PIX
 */
export function getPlatformFeeRate(link: PaymentLink, installments: number): number {
  const isStandalone = (link as any).isStandalone ?? true;
  const shouldApply = isStandalone ? installments > 1 : true;
  if (!shouldApply) return 0;

  const map: Record<number, string> = {
    1: 'platformFee1x',
    2: 'platformFee2x',
    3: 'platformFee3x',
    4: 'platformFee4x',
    5: 'platformFee5x',
    6: 'platformFee6x',
    7: 'platformFee7x',
    8: 'platformFee8x',
    9: 'platformFee9x',
    10: 'platformFee10x',
    11: 'platformFee11x',
    12: 'platformFee12x',
  };

  const field = map[Math.min(Math.max(installments, 1), 12)];
  return Number((link as any)[field] ?? 0);
}

/**
 * Calcula o breakdown completo de taxas para um link de pagamento, espelhando
 * exatamente o cálculo do api-dom / admin-master.
 *
 * Fluxo:
 * 1. Juros da plataforma (platformFee%) aplicados sobre o valor BASE
 * 2. Taxa DOM aplicada sobre (base + juros)
 * 3. Valor total que o COMPRADOR paga = base + juros + taxaDom + fixedDom
 * 4. Valor líquido que o VENDEDOR recebe = base - (6,99% + R$4) - cashbackFee
 */
export function calculatePaymentLinkFees(
  link: PaymentLink,
  installments: number,
): {
  baseAmount: number;
  platformFeeRate: number;
  interestAmount: number;
  valueWithInterest: number;
  domFeeRate: number;
  domFeeAmount: number;
  domFixedFee: number;
  totalAmount: number;
  installmentAmount: number;
  sellerFee: number;
  cashbackFee: number;
  netAmount: number;
} {
  const n = Math.min(Math.max(installments, 1), 12);
  const baseAmount = Number(link.amount);

  // 1. Juros da plataforma sobre o valor base
  const platformFeeRate = getPlatformFeeRate(link, n);
  const interestAmount = (baseAmount * platformFeeRate) / 100;
  const valueWithInterest = baseAmount + interestAmount;

  // 2. Taxa DOM sobre o valor com juros
  const domFeeRate = DOM_FEE_RATES[n] ?? 0;
  const domFixedFee = getDomFixedFee(n);
  const domFeeAmount = valueWithInterest * domFeeRate + domFixedFee;

  // 3. Total que o COMPRADOR paga
  const totalAmount = valueWithInterest + domFeeAmount;
  const installmentAmount = totalAmount / n;

  // 4. Líquido do VENDEDOR (calculado sobre o valor BASE, independente de parcelas)
  const cashbackFee = (link as any).cashbackFee ?? 3.0;
  const sellerFee = baseAmount * SELLER_FEE_PERCENTAGE + SELLER_FEE_FIXED;
  const netAmount = baseAmount - sellerFee - cashbackFee;

  return {
    baseAmount,
    platformFeeRate,
    interestAmount: round2(interestAmount),
    valueWithInterest: round2(valueWithInterest),
    domFeeRate,
    domFeeAmount: round2(domFeeAmount),
    domFixedFee,
    totalAmount: round2(totalAmount),
    installmentAmount: round2(installmentAmount),
    sellerFee: round2(sellerFee),
    cashbackFee,
    netAmount: round2(netAmount),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
