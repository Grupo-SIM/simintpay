import { type ReactNode } from 'react';
import { cx } from '@/utils/cx';

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx('flex flex-col gap-2', className)}>
      <span className="text-sm text-[#b8b2c6]">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-[#ff9d9d]">{error}</span>
      ) : hint ? (
        <span className="text-xs text-[#7d778b]">{hint}</span>
      ) : null}
    </label>
  );
}
