'use client';

import { useState } from 'react';
import { PlatformField } from './PlatformField';

export function FinancialBulkInterestField({
  value,
  onChange,
  onValidityChange,
}: {
  value?: number;
  onChange: (value: number) => void;
  onValidityChange: (name: string, valid: boolean) => void;
}) {
  const [invalid, setInvalid] = useState<string | null>(null);
  return (
    <PlatformField
      label="Repassar juros em todas as parcelas (%)"
      name="all-installments-passInterestPpm"
      numeric
      placeholder="Ex: 25,00"
      value={
        invalid ??
        (value === undefined
          ? ''
          : (value / 10_000).toLocaleString('pt-BR', {
              maximumFractionDigits: 4,
            }))
      }
      onChange={(text) => {
        const percentage = Number(text.replace(',', '.'));
        const valid =
          text.trim() !== '' &&
          Number.isFinite(percentage) &&
          percentage >= 0 &&
          percentage <= 100;
        onValidityChange('all-installments-passInterestPpm', valid);
        setInvalid(valid ? null : text);
        if (valid) onChange(Math.round(percentage * 10_000));
      }}
    />
  );
}
