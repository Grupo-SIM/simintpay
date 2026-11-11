import type { OfferCheckoutPricing } from './offer-checkout-model';

/** Resposta de `POST /ofertas/public/:code/validate-voucher` (valores em centavos). */
export type VoucherQuote = {
  valid: boolean;
  code: string;
  originalAmountCents: number;
  discountAmountCents: number;
  finalAmountCents: number;
  /** Preços do checkout já calculados sobre o valor com desconto. */
  pricing: OfferCheckoutPricing;
};

/** Cupom aplicado no checkout: o código normalizado e a cotação devolvida pela API. */
export type AppliedVoucher = { code: string; quote: VoucherQuote };

export const normalizeVoucherCode = (value: string) => value.trim();

/** Corpo de `POST .../validate-voucher`. */
export function validateVoucherBody(code: string) {
  return { voucherCode: normalizeVoucherCode(code) };
}

/** Lê a resposta da API; devolve null se não trouxer um cupom válido com preços. */
export function mapVoucherQuote(data: unknown): VoucherQuote | null {
  const d = data as Partial<VoucherQuote> | null;
  if (
    !d ||
    d.valid !== true ||
    typeof d.finalAmountCents !== 'number' ||
    typeof d.discountAmountCents !== 'number' ||
    !d.pricing
  )
    return null;
  return d as VoucherQuote;
}

/** Mensagem da recusa do cupom (a API já devolve texto em português). */
export function voucherErrorMessage(data?: { message?: unknown }): string {
  return typeof data?.message === 'string' && data.message
    ? data.message
    : 'Cupom inválido ou expirado';
}

/** Campo extra dos corpos de cobrança/assinatura: só vai quando há cupom aplicado. */
export function voucherField(applied: AppliedVoucher | null) {
  return applied ? { voucherCode: applied.code } : {};
}
