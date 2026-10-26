import { type ReactNode } from 'react';
import { cx } from '@/utils/cx';
import { GLASS } from './styles';
import { ProductImage } from './ProductImage';
import { TrustFooter } from './TrustFooter';

/** Coluna "Resumo do pedido" fixa à direita no desktop (400px). Oculta no mobile. */
export function SummaryAside({
  productTitle,
  productImage,
  itemsLabel,
  rows,
  total,
  dimTotal,
  action,
}: {
  productTitle: string;
  productImage?: string | null;
  itemsLabel: string;
  rows: ReactNode;
  total: string;
  dimTotal?: boolean;
  action: ReactNode;
}) {
  return (
    <aside
      className={cx(
        'hidden flex-col gap-[18px] rounded-[28px] p-6 lg:sticky lg:top-5 lg:flex',
        GLASS,
      )}
    >
      <div className="text-[19px] font-medium">Resumo do pedido</div>
      <div className="flex items-center gap-3.5 rounded-[20px] bg-white/[0.07] p-3">
        <ProductImage src={productImage} className="h-14 w-14 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium">{productTitle}</div>
          <div className="mt-0.5 text-[13px] text-[#a9a3b8]">{itemsLabel}</div>
        </div>
      </div>
      <div className="flex flex-col">{rows}</div>
      <div className="flex items-end justify-between">
        <div className="text-sm text-[#a9a3b8]">Total</div>
        <div
          className={cx(
            'text-[32px] font-semibold tabular-nums transition-opacity',
            dimTotal && 'opacity-50',
          )}
        >
          {total}
        </div>
      </div>
      {action}
      <TrustFooter />
    </aside>
  );
}
