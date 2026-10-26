import { CreditCard as CreditCardIcon } from 'lucide-react';
import { cx } from '@/utils/cx';
import type { PaymentMethod } from '../types';

export function MethodIcon({
  method,
  size,
}: {
  method: PaymentMethod;
  size: 'sm' | 'md' | 'lg';
}) {
  const dim =
    size === 'lg'
      ? 'h-[52px] w-[52px] text-[13px]'
      : size === 'md'
        ? 'h-11 w-11 text-[11px]'
        : 'h-10 w-10 text-[11px]';
  return (
    <span
      className={cx(
        'flex shrink-0 items-center justify-center rounded-full bg-white/[0.12] font-bold',
        dim,
      )}
    >
      {method === 'pix' ? (
        'PIX'
      ) : (
        <CreditCardIcon
          className={size === 'lg' ? 'h-[22px] w-[22px]' : 'h-[18px] w-[18px]'}
          strokeWidth={1.8}
        />
      )}
    </span>
  );
}
