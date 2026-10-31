// Total SimIntPay cost, independent of buyer interest (stored as percentages).
export const FALLBACK_SIMINTPAY_COSTS: Record<number, number> =
  Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, 9]));

export type CalcRates = {
  domFees: Record<number, number>;
  sellerFees: Record<number, number>;
  sellerFeeFixed: number;
  cashbackFee: number;
};

export function calcularParcela(
  baseValue: number,
  n: number,
  platformFeeRate: number,
  isStandalone: boolean,
  rates: CalcRates,
) {
  const applyInterest = isStandalone ? n > 1 : true;
  const juros = applyInterest ? platformFeeRate : 0;
  const interestAmt = (baseValue * juros) / 100;
  const withInterest = baseValue + interestAmt;
  const domRate = rates.domFees[n] ?? 0;
  const domFixed = n > 1 ? 1.0 : 0;
  const domFeeAmt = withInterest * domRate + domFixed;
  // Processing costs are absorbed; they never increase the buyer total.
  const total = withInterest;
  const sellerFee =
    baseValue * (rates.sellerFees[n] ?? 0) + rates.sellerFeeFixed;
  const liquido = total - sellerFee - rates.cashbackFee;
  return {
    total: Math.round(total * 100) / 100,
    juros: Math.round(interestAmt * 100) / 100,
    parcela: Math.round((total / n) * 100) / 100,
    domFee: Math.round(domFeeAmt * 100) / 100,
    liquido: Math.round(liquido * 100) / 100,
  };
}
