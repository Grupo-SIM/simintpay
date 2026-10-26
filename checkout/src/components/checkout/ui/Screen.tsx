import { type ReactNode } from 'react';
import { cx } from '@/utils/cx';

type ScreenVariant =
  'default' | 'downsell' | 'processing' | 'success' | 'error';

const bgClass: Record<ScreenVariant, string> = {
  default: 'sp2-bg',
  downsell: 'sp2-bg-downsell',
  processing: 'sp2-bg-processing',
  success: 'sp2-bg-success',
  error: 'sp2-bg-error',
};

/** Tela inteira: fundo com gradientes + coluna (mobile 480px máx. / desktop 1280px máx.). */
export function Screen({
  variant = 'default',
  children,
}: {
  variant?: ScreenVariant;
  children: ReactNode;
}) {
  return (
    <div className={cx('sp2 min-h-screen', bgClass[variant])}>
      <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col gap-4 px-5 pb-5 pt-4 lg:max-w-[1280px] lg:gap-7 lg:px-12 lg:pb-10 lg:pt-7">
        {children}
      </div>
    </div>
  );
}
