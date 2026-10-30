'use client';

import { useId } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { fieldShellClassNames } from '@/lib/fieldShell';

type MaskType = 'cnpj' | 'phone' | 'cpf' | 'currency' | 'cpf-cnpj';

type Props = {
  label?: string;
  error?: string;
  mask?: MaskType;
  theme?: 'light' | 'dark';
  variant?: 'default' | 'navbar';
  /** Conteúdo antes do campo (ex.: R$) — usa o mesmo shell do variant (ex.: navbar). */
  prefix?: ReactNode;
  /** Conteúdo depois do campo */
  suffix?: ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    onChange?: (value: string) => void;
  };

function onlyDigits(s: string) {
  return s.replace(/\D+/g, '');
}

function formatCnpj(value: string) {
  const d = onlyDigits(value).slice(0, 14);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);

  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `/${p4}`;
  if (p5) out += `-${p5}`;
  return out;
}

function formatPhone(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  const a = d.slice(0, 2);
  const b = d.slice(2, 7);
  const c = d.slice(7, 11);

  if (!a) return '';
  if (d.length <= 2) return `(${a}`;
  if (d.length <= 7) return `(${a}) ${d.slice(2)}`;
  return `(${a}) ${b}-${c}`;
}

function formatCpf(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);

  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `-${p4}`;
  return out;
}

function formatCurrencyBrl(value: string) {
  const d = onlyDigits(value);
  if (!d) return '';
  const n = parseInt(d, 10);
  const brl = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
  return brl;
}

function formatCpfCnpj(value: string) {
  const d = onlyDigits(value).slice(0, 14);
  return d.length <= 11 ? formatCpf(d) : formatCnpj(d);
}

function applyMask(mask: MaskType | undefined, value: string) {
  if (!mask) return value;
  if (mask === 'cnpj') return formatCnpj(value);
  if (mask === 'phone') return formatPhone(value);
  if (mask === 'cpf') return formatCpf(value);
  if (mask === 'currency') return formatCurrencyBrl(value);
  if (mask === 'cpf-cnpj') return formatCpfCnpj(value);
  return value;
}

function inputTextClasses(
  theme: 'light' | 'dark',
  variant: 'default' | 'navbar',
) {
  if (theme === 'dark' && variant === 'navbar') {
    return 'text-gray-800 dark:text-white/75 placeholder:text-gray-400 dark:placeholder:text-white/28 selection:bg-violet-500/30 autofill:bg-white/[0.03] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_rgba(255,255,255,0.03)] autofill:[-webkit-text-fill-color:#ffffff]';
  }
  if (theme === 'dark') {
    return 'text-white placeholder:text-white/35 selection:bg-violet-500/30 autofill:bg-white/[0.03] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_rgba(255,255,255,0.03)] autofill:[-webkit-text-fill-color:#ffffff]';
  }
  return 'text-zinc-900 placeholder:text-zinc-400';
}

export function Input({
  label,
  error,
  mask,
  onChange,
  className,
  value,
  theme = 'light',
  variant = 'default',
  prefix,
  suffix,
  required,
  ...props
}: Props) {
  const id = useId();
  const hasError = Boolean(error);
  const hasAffix = prefix != null || suffix != null;

  const labelClassName =
    theme === 'dark' || true
      ? 'text-zinc-900 dark:text-zinc-100'
      : 'text-zinc-700';
  const inputBase =
    theme === 'dark' && variant === 'navbar'
      ? [
          'appearance-none border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.05] text-gray-800 dark:text-white/75 placeholder:text-gray-400 dark:placeholder:text-white/28',
          'hover:bg-gray-50 dark:hover:bg-white/[0.07] hover:border-gray-300 dark:hover:border-white/15',
          'focus:border-violet-400/40 ring-violet-500/20',
          'selection:bg-violet-500/30',
          'autofill:bg-white/[0.03] autofill:text-white',
          'autofill:shadow-[inset_0_0_0px_1000px_rgba(255,255,255,0.03)]',
          'autofill:[-webkit-text-fill-color:#ffffff]',
        ].join(' ')
      : theme === 'dark'
        ? [
            'appearance-none border-white/10 bg-black/60 text-white placeholder:text-white/35',
            'hover:border-white/15',
            'focus:border-violet-400/40 ring-violet-500/20',
            'selection:bg-violet-500/30',
            'autofill:bg-white/[0.03] autofill:text-white',
            'autofill:shadow-[inset_0_0_0px_1000px_rgba(255,255,255,0.03)]',
            'autofill:[-webkit-text-fill-color:#ffffff]',
          ].join(' ')
        : 'border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 ring-zinc-900/10';

  const innerInputClass = cn(
    'min-w-0 flex-1 appearance-none border-0 bg-transparent px-3 outline-none focus:ring-0',
    inputTextClasses(theme, variant),
    theme === 'dark' ? 'acm-input-dark' : undefined,
  );

  const control = hasAffix ? (
    <div className={fieldShellClassNames(theme, variant, { hasError })}>
      {prefix ? (
        <span
          className={cn(
            'flex shrink-0 items-center pl-3 text-sm',
            theme === 'dark' ? 'text-white/45' : 'text-zinc-500',
          )}
        >
          {prefix}
        </span>
      ) : null}
      <input
        {...props}
        required={required}
        id={props.id ?? id}
        value={typeof value === 'string' ? applyMask(mask, value) : value}
        onChange={(e) => {
          const raw = e.target.value;
          onChange?.(applyMask(mask, raw));
        }}
        className={cn(
          innerInputClass,
          prefix ? 'pl-1' : undefined,
          suffix ? 'pr-1' : undefined,
          className,
        )}
      />
      {suffix ? (
        <span className="flex shrink-0 items-center pr-3 text-sm text-zinc-500 dark:text-white/45">
          {suffix}
        </span>
      ) : null}
    </div>
  ) : (
    <input
      {...props}
      required={required}
      id={props.id ?? id}
      value={typeof value === 'string' ? applyMask(mask, value) : value}
      onChange={(e) => {
        const raw = e.target.value;
        onChange?.(applyMask(mask, raw));
      }}
      className={cn(
        'h-11 rounded-md border px-3 outline-none focus:ring-4',
        inputBase,
        theme === 'dark' ? 'acm-input-dark' : undefined,
        hasError ? 'border-red-300' : undefined,
        className,
      )}
    />
  );

  const Wrapper: 'label' | 'div' = label || error ? 'label' : 'div';

  return (
    <Wrapper
      className={cn(
        'flex flex-col gap-1 text-sm',
        label || error ? labelClassName : undefined,
      )}
    >
      {label ? (
        <span>
          {label}
          {required ? <span className="text-red-500"> *</span> : null}
        </span>
      ) : null}
      {control}
      {hasError ? <span className="text-xs text-red-600">{error}</span> : null}
    </Wrapper>
  );
}
