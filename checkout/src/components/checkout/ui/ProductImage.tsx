import { cx } from '@/utils/cx';

/** Imagem de produto/oferta. Sem URL → não renderiza nada (ainda não há capa cadastrada). */
export function ProductImage({
  src,
  className,
}: {
  src?: string | null;
  className?: string;
}) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img src={src} alt="" className={cx('shrink-0 object-cover', className)} />
  );
}
