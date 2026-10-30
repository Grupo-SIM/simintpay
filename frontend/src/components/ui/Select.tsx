'use client';

import { useId } from 'react';

type Option = {
  label: string;
  value: string;
};

type Props = {
  label?: string;
  error?: string;
  options: Option[];
  placeholder?: string;
  theme?: 'dark';
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
    onChange?: (value: string) => void;
  };

export function Select({
  label,
  error,
  options,
  placeholder,
  onChange,
  className,
  theme,
  ...props
}: Props) {
  const id = useId();
  const hasError = Boolean(error);
  const isDark = theme === 'dark';

  return (
    <label
      className={[
        'flex flex-col gap-1 text-sm',
        isDark ? 'text-white/70' : 'text-zinc-700',
      ].join(' ')}
    >
      {label ? <span>{label}</span> : null}
      <select
        {...props}
        id={props.id ?? id}
        onChange={(e) => onChange?.(e.target.value)}
        className={[
          'h-11 rounded-md border px-3 outline-none ring-zinc-900/10 focus:ring-4',
          isDark
            ? 'bg-[#070712] text-white border-white/10 focus:ring-violet-300/20'
            : 'bg-white text-zinc-900',
          hasError
            ? 'border-red-300'
            : isDark
              ? 'border-white/10'
              : 'border-zinc-200',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {placeholder ? (
          <option value="" disabled={props.required}>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hasError ? <span className="text-xs text-red-600">{error}</span> : null}
    </label>
  );
}
