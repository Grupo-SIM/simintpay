'use client';

import { CustomSelect } from '@/components/ui/CustomSelect';
import type { FeeMode } from './financial-types';

const MODES: { value: FeeMode; label: string; hint: string }[] = [
  {
    value: 'ADDITIVE_ONLY',
    label: 'Somente taxas aditivas',
    hint: 'Somadas ao preço do comprador. A SimIntPay não desconta suas taxas do lojista.',
  },
  {
    value: 'SIMINTPAY_ONLY',
    label: 'Somente taxas SimIntPay',
    hint: 'Descontadas do valor do lojista. Nenhuma taxa é somada ao comprador.',
  },
  {
    value: 'BOTH',
    label: 'Taxas aditivas e SimIntPay',
    hint: 'Taxas aditivas somam ao comprador e as taxas SimIntPay são descontadas do lojista.',
  },
];

export function FeeModeField({
  value,
  onChange,
}: {
  value: FeeMode;
  onChange: (value: FeeMode) => void;
}) {
  const current = MODES.find((mode) => mode.value === value) ?? MODES[0]!;
  return (
    <fieldset className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <legend className="px-1 text-sm font-semibold">
        Taxas aplicadas aos pagamentos
      </legend>
      <div className="max-w-md">
        <CustomSelect
          label="Modo de taxas"
          value={value}
          onChange={(next) => onChange(next as FeeMode)}
          options={MODES.map(({ value, label }) => ({ value, label }))}
        />
      </div>
      <p className="text-sm text-zinc-500">{current.hint}</p>
    </fieldset>
  );
}
