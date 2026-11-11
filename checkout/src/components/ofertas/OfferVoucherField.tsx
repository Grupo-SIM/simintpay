'use client';

/**
 * Campo de cupom do checkout de oferta. Valida em `POST /ofertas/public/:code/validate-voucher`
 * (sem consumir o uso: ele só conta quando o pagamento é aprovado) e devolve a cotação, com os
 * preços já calculados sobre o valor com desconto.
 */
import { useState } from 'react';
import { SIM_API_URL } from '@/lib/api-config';
import { CheckoutGlassInput } from '@/components/checkout/CheckoutFormPrimitives';
import {
  mapVoucherQuote,
  validateVoucherBody,
  voucherErrorMessage,
  type AppliedVoucher,
} from '@/lib/offer-voucher-model';

export function OfferVoucherField({
  offerCode,
  applied,
  onChange,
  disabled,
}: {
  offerCode: string;
  applied: AppliedVoucher | null;
  onChange: (voucher: AppliedVoucher | null) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function apply() {
    const body = validateVoucherBody(value);
    if (!body.voucherCode) return;
    setChecking(true);
    setError('');
    try {
      const res = await fetch(
        `${SIM_API_URL}/ofertas/public/${encodeURIComponent(offerCode)}/validate-voucher`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      const quote = res.ok ? mapVoucherQuote(data) : null;
      if (!quote) {
        setError(voucherErrorMessage(data));
        onChange(null);
        return;
      }
      onChange({ code: quote.code, quote });
    } catch {
      setError('Erro ao validar cupom');
    } finally {
      setChecking(false);
    }
  }

  function remove() {
    setValue('');
    setError('');
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="voucher-field">
      <span className="px-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
        Cupom de desconto
      </span>
      <div className="flex gap-2">
        <div className="flex-1">
          <CheckoutGlassInput
            placeholder="Tem um cupom?"
            value={applied ? applied.code : value}
            onChange={setValue}
            className={
              error
                ? 'border-red-500/50'
                : applied
                  ? 'border-emerald-500/50'
                  : ''
            }
          />
        </div>
        {applied ? (
          <button
            type="button"
            onClick={remove}
            disabled={disabled}
            className="flex h-[42px] items-center justify-center rounded-lg bg-white/5 px-4 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-50"
          >
            Remover
          </button>
        ) : (
          <button
            type="button"
            onClick={apply}
            disabled={disabled || checking || !value.trim()}
            className="flex h-[42px] items-center justify-center rounded-lg bg-white/5 px-4 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-50"
          >
            {checking ? '...' : 'Aplicar'}
          </button>
        )}
      </div>
      {error && (
        <p className="px-1 text-[10px] font-semibold text-red-400">{error}</p>
      )}
      {applied && (
        <p className="px-1 text-[10px] font-semibold text-emerald-400">
          Cupom aplicado com sucesso!
        </p>
      )}
    </div>
  );
}
