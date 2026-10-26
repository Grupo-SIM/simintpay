import { type ButtonHTMLAttributes } from 'react';
import { cx } from '@/utils/cx';

export function CtaButton({
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={cx('sp2-cta w-full', className)}>
      {children}
    </button>
  );
}
