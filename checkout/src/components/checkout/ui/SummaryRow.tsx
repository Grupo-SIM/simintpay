import { type ReactNode } from 'react';
import { cx } from '@/utils/cx';

/** Linha "rótulo ........ valor" com divisor tracejado (resumos). */
export function SummaryRow({
  label,
  value,
  accent,
  muted,
  last,
  size = 'md',
}: {
  label: ReactNode;
  value?: ReactNode;
  accent?: boolean;
  muted?: boolean;
  last?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      className={cx(
        'flex justify-between gap-4 py-[13px]',
        size === 'sm' ? 'text-sm' : 'text-sm lg:text-[15px]',
        !last && 'border-b border-dashed border-white/[0.12]',
      )}
    >
      <span
        className={cx(
          'min-w-0',
          accent
            ? 'text-[#ffc48f]'
            : muted
              ? 'text-[#a9a3b8]'
              : 'text-[#c8c2d4]',
        )}
      >
        {label}
      </span>
      {value != null && (
        <span className="shrink-0 text-right tabular-nums">{value}</span>
      )}
    </div>
  );
}
