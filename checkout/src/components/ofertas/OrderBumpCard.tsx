'use client';
import { Tag } from 'lucide-react';
import { cx } from '@/utils/cx';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import { ProductImage, formatCurrency } from '@/components/checkout/ui';

export type OrderBumpOffer = {
  id: string;
  tipo: 'ORDER_BUMP';
  chamada: string | null;
  titulo: string;
  descricao: string | null;
  imagemUrl: string | null;
  valor: number;
  valorOriginal: number | null;
};

/** "−67%" quando há preço original maior que o atual; senão null. */
export function discountLabel(
  price: number,
  original: number | null,
): string | null {
  if (original == null || !(original > price)) return null;
  return `−${Math.round((1 - price / original) * 100)}%`;
}

/**
 * Order bump (telas 4a mobile / 5a desktop): moldura em gradiente, selo "Oferta especial",
 * preço riscado e botão "+ Adicionar" / "✓ Adicionado".
 */
export function OrderBumpCard({
  offer,
  checked,
  disabled,
  onToggle,
}: {
  offer: OrderBumpOffer;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const off = discountLabel(offer.valor, offer.valorOriginal);
  const hasDiscount = off != null;

  const button = (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={checked}
      className={cx(
        'h-11 shrink-0 whitespace-nowrap rounded-full border px-[18px] text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 lg:h-[46px] lg:px-5 lg:text-[15px]',
        checked
          ? 'border-[rgba(246,182,122,.5)] bg-white/10 text-[#ffc48f]'
          : 'border-white/30 bg-[#f4f2f7] text-[#17131f]',
      )}
    >
      {checked ? '✓ Adicionado' : '+ Adicionar'}
    </button>
  );

  const prices = (
    <>
      {hasDiscount && (
        <div className="text-xs text-[#8d879a] line-through lg:text-[13px]">
          {formatCurrency(offer.valorOriginal!)}
        </div>
      )}
      <div className="text-xl font-semibold tabular-nums text-[#ffc48f] lg:text-[19px]">
        + {formatCurrency(offer.valor)}
      </div>
    </>
  );

  return (
    <div
      className={cx(
        'rounded-[24px] p-px transition-shadow lg:rounded-[22px]',
        checked
          ? 'bg-[#f6b67a] shadow-[0_0_0_4px_rgba(246,182,122,.16)]'
          : 'bg-white/[0.13]',
      )}
    >
      <div className="flex flex-col gap-3 rounded-[23px] bg-[linear-gradient(140deg,rgba(30,24,44,.95)_0%,rgba(52,34,30,.95)_100%)] p-3.5 lg:rounded-[21px] lg:bg-[linear-gradient(120deg,rgba(30,24,44,.95)_0%,rgba(52,34,30,.95)_100%)] lg:px-[18px]">
        <div className="flex items-center gap-1.5 lg:gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(246,182,122,.32)] bg-[rgba(245,138,42,.14)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.1em] text-[#ffc48f]">
            <Tag className="h-3 w-3" strokeWidth={2.2} />
            Oferta especial
          </span>
          {off && (
            <span className="rounded-full bg-[linear-gradient(90deg,#a99ef8,#f6b67a)] px-[9px] py-1 text-xs font-semibold text-[#17131f]">
              {off}
            </span>
          )}
          {offer.chamada && (
            <span className="ml-auto hidden min-w-0 truncate pl-2 text-xs text-[#b8b2c6] lg:block">
              {sanitizeCheckoutText(offer.chamada)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 lg:gap-4">
          <ProductImage
            src={offer.imagemUrl}
            className="h-[60px] w-[60px] rounded-2xl lg:h-16 lg:w-16"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium leading-[1.25] lg:text-base lg:leading-normal">
              {sanitizeCheckoutText(offer.titulo)}
            </div>
            {offer.descricao && (
              <div className="mt-[3px] text-xs leading-[1.35] text-[#b8b2c6] lg:text-[13px] lg:leading-normal">
                {sanitizeCheckoutText(offer.descricao)}
              </div>
            )}
          </div>
          <div className="hidden shrink-0 text-right lg:block">{prices}</div>
          <div className="hidden lg:block">{button}</div>
        </div>
        <div className="flex items-center justify-between gap-3 lg:hidden">
          <div>{prices}</div>
          {button}
        </div>
      </div>
    </div>
  );
}
