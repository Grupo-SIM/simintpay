'use client';

import { useId, type ReactNode } from 'react';
import { maskPercentage } from '@/features/coproduction/coproduction';
import { useDebouncedInput } from '@/hooks/use-debounced-input';

/** Percentual mascarado com debounce; o foco perdido envia a última digitação. */
export function PercentageField({
  label,
  name,
  value,
  placeholder = 'Ex: 10',
  disabled = false,
  hint,
  required = false,
  onChange,
}: {
  label: ReactNode;
  name: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  hint?: ReactNode;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [local, setLocal, flush] = useDebouncedInput(value, onChange);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <div className="flex h-11 items-center rounded-md border border-zinc-200 bg-white focus-within:border-[#7c3aed] focus-within:ring-2 focus-within:ring-[#7c3aed]/20 dark:border-white/10 dark:bg-white/5">
        <input
          id={id}
          type="text"
          name={name}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={local}
          onChange={(event) =>
            setLocal(maskPercentage(event.currentTarget.value))
          }
          onBlur={flush}
          className="min-w-0 w-full bg-transparent py-2 pl-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <span className="pr-3 text-sm text-zinc-500 dark:text-zinc-400">%</span>
      </div>
      {hint && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      )}
    </div>
  );
}
