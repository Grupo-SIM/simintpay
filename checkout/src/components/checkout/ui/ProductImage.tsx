import { ShoppingBag } from 'lucide-react';
import { cx } from '@/utils/cx';

/** Imagem de produto/oferta. Sem URL → bloco neutro com ícone (o design só tem placeholder). */
export function ProductImage({
  src,
  className,
  iconClassName,
}: {
  src?: string | null;
  className?: string;
  iconClassName?: string;
}) {
  if (!src) {
    return (
      <div
        className={cx(
          'flex shrink-0 items-center justify-center bg-white/[0.08] text-[#8a8498]',
          className,
        )}
      >
        <ShoppingBag
          className={cx('h-1/3 w-1/3', iconClassName)}
          strokeWidth={1.6}
        />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img src={src} alt="" className={cx('shrink-0 object-cover', className)} />
  );
}
