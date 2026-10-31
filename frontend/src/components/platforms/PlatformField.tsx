'use client';

import { useId } from 'react';
import { useDebouncedInput } from '@/hooks/use-debounced-input';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  name: string;
  numeric?: boolean;
  currency?: boolean;
  required?: boolean;
  disabled?: boolean;
};

export function PlatformField({
  label,
  value,
  onChange,
  placeholder,
  name,
  numeric,
  currency,
  required,
  disabled,
}: Props) {
  const id = useId();
  const [local, update, flush] = useDebouncedInput(value, onChange);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 dark:border-white/20">
        {currency && <span className="text-sm text-zinc-500">R$</span>}
        <input
          id={id}
          name={name}
          type="text"
          disabled={disabled}
          inputMode={numeric || currency ? 'decimal' : undefined}
          required={required}
          placeholder={placeholder}
          value={local}
          onKeyDown={(event) => {
            if (event.key === 'Enter') flush();
          }}
          onBlur={flush}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (currency)
              update(
                (Number(next.replace(/\D/g, '')) / 100).toLocaleString(
                  'pt-BR',
                  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                ),
              );
            else if (numeric) {
              if (/^\d{0,3}(?:,\d{0,4})?$/.test(next)) update(next);
            } else update(next);
          }}
          className="min-w-0 w-full bg-transparent py-2 text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
        />
        {numeric && <span className="text-sm text-zinc-500">%</span>}
      </div>
    </div>
  );
}
