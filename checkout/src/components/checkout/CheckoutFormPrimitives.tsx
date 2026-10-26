'use client';

import type { HTMLAttributes, ReactNode } from 'react';

export function CheckoutGlassField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm text-[#b8b2c6]">
        {label}
        {required && <span className="ml-0.5 text-[#f6b67a]">*</span>}
      </label>
      {children}
    </div>
  );
}

type InputProps = {
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  type?: string;
  prefix?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
  autoComplete?: string;
  name?: string;
  className?: string;
};

/** Campo do "Checkout Novo": 52px, raio 16, foco laranja (classes .sp2-input em globals.css). */
export function CheckoutGlassInput({
  placeholder,
  value,
  onChange,
  onFocus,
  type = 'text',
  prefix,
  inputMode,
  maxLength,
  autoComplete,
  name,
  className = '',
}: InputProps) {
  return (
    <div className={`sp2-input sp2-input-wrap ${className}`}>
      {prefix && (
        <span className="flex h-full items-center border-r border-white/10 px-3.5 text-[15px] text-[#a9a3b8]">
          {prefix}
        </span>
      )}
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete={autoComplete}
        className={`min-w-0 w-full flex-1 ${prefix ? '' : '!px-[18px]'}`}
      />
    </div>
  );
}
