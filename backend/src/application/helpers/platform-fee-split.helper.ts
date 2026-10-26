/**
 * Quando a DOM devolve um líquido "otimista" (taxa implícita &lt; fixas + MDR),
 * o split por payload zera a taxa vendedor. Nestes casos usamos a decomposição
 * nominal: taxa % plataforma ≈ bruto × (1 − LIQUIDEZ) − taxa_dom (PIX).
 */
export function isPixLikePayment(paymentMethod: string | null | undefined): boolean {
  const p = String(paymentMethod ?? '').toLowerCase();
  if (p.includes('debit')) return false;
  if (p.includes('card') || p.includes('credit')) return false;
  return true;
}

export function shouldUseLiquidezNominalSplitForPix(
  amountReais: number,
  liquidPayloadReais: number | undefined | null,
  mdrReais: number,
  fixedFeesReais: number,
): boolean {
  if (!Number.isFinite(amountReais) || amountReais <= 0) return false;
  const liq = Number(liquidPayloadReais);
  if (!Number.isFinite(liq)) return true;
  const impliedFee = amountReais - liq;
  const minExpected = fixedFeesReais + mdrReais - 0.005;
  return impliedFee < minExpected;
}
