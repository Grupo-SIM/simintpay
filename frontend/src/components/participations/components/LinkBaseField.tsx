'use client';

import { useId } from 'react';
import { useDebouncedInput } from '@/hooks/use-debounced-input';

export function LinkBaseField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [local, setLocal, flush] = useDebouncedInput(value, onChange);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Link base
      </label>
      <input
        id={id}
        type="text"
        inputMode="url"
        name="affiliate-link-base"
        autoComplete="url"
        disabled={disabled}
        placeholder="https://sualoja.com.br"
        value={local}
        onChange={(event) => setLocal(event.currentTarget.value)}
        onBlur={flush}
        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:cursor-not-allowed dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:placeholder:text-zinc-500"
      />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Gera o link pronto com <code>?aff=CÓDIGO</code>.
      </p>
    </div>
  );
}
