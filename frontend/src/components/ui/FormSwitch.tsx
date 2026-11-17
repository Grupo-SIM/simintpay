'use client';

import type { AriaAttributes } from 'react';
import { cn } from '@/lib/utils';

export function FormSwitch({
  checked,
  onChange,
  ...ariaProps
}: AriaAttributes & {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      {...ariaProps}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full cursor-pointer border-2 border-zinc-400/40 transition-colors',
        checked ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-600',
      )}
    >
      <span
        className={cn(
          'inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
