import { type ReactNode } from 'react';
import { cx } from '@/utils/cx';

/** Caixa de erro genérica (mensagens da API / validação). */
export function ErrorBox({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cx(
        'rounded-[18px] border border-[rgba(255,160,160,.3)] bg-[rgba(255,140,140,.1)] px-4 py-3 text-sm leading-relaxed text-[#ffd0d0]',
        className,
      )}
    >
      {children}
    </div>
  );
}
