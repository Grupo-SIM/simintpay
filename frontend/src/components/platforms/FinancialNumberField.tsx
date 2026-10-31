'use client';

import { useState } from 'react';
import { PlatformField } from './PlatformField';

/** Preserve invalid drafts locally; never turn an empty/invalid field into a saved zero. */
export function FinancialNumberField({
  value,
  onChange,
  label,
  name,
  rate,
  disabled,
  onValidityChange,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  name: string;
  rate?: boolean;
  disabled?: boolean;
  onValidityChange: (name: string, valid: boolean) => void;
}) {
  const [invalid, setInvalid] = useState<string | null>(null);
  const display = rate
    ? (value / 10_000).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
    : (value / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  return (
    <PlatformField
      disabled={disabled}
      label={label}
      name={name}
      numeric={rate}
      currency={!rate}
      placeholder={rate ? 'Ex: 2,50' : '100,00'}
      value={invalid ?? display}
      onChange={(text) => {
        const number = Number(text.replaceAll('.', '').replace(',', '.'));
        const valid =
          text.trim() !== '' &&
          Number.isFinite(number) &&
          number >= 0 &&
          number <= (rate ? 100 : 10_000_000);
        onValidityChange(name, valid);
        setInvalid(valid ? null : text);
        if (valid) onChange(Math.round(number * (rate ? 10_000 : 100)));
      }}
    />
  );
}
