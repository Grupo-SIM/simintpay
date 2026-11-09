import { FinancialNumberField } from './FinancialNumberField';

/** Target fee: total share of the purchase charged to the seller; replaces the manual fees while set. */
export function TargetFeeSection({
  value,
  onChange,
  onValidityChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  onValidityChange: (name: string, valid: boolean) => void;
}) {
  const active = value !== null;
  return (
    <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <legend className="px-1 text-sm font-semibold">Taxa alvo</legend>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="target-fee-enabled"
          checked={active}
          onChange={(event) => {
            onChange(event.currentTarget.checked ? 100_000 : null);
            if (!event.currentTarget.checked)
              onValidityChange('target-fee', true);
          }}
        />
        Usar taxa alvo
      </label>
      {active && (
        <div className="max-w-xs">
          <FinancialNumberField
            label="Taxa alvo (%)"
            name="target-fee"
            rate
            value={value}
            onChange={(ppm) =>
              onChange(ppm > 0 && ppm < 1_000_000 ? ppm : value)
            }
            onValidityChange={(name, valid) =>
              onValidityChange(name, valid && value > 0)
            }
          />
        </div>
      )}
      <p className="text-sm text-zinc-500">
        {active
          ? 'Cada transação aplica a maior taxa entre as adquirentes ativas mais um adicional SimIntPay, de modo que o total descontado do vendedor seja a taxa alvo, sem juros. Taxas manuais e modo de taxas ficam preservados, mas são desconsiderados. Se a adquirente mais cara custar mais que a taxa alvo, vale o custo dela.'
          : 'Desativada: valem as taxas manuais e o modo de taxas.'}
      </p>
    </fieldset>
  );
}
