import { AdditiveTotalsRow } from './AdditiveTotalsRow';
import type { AdditiveTotals } from './financial-types';

/** Editable additive totals; actual platform totals. */
export function AdditiveFeesSection({
  value,
  onChange,
  onValidityChange,
}: {
  value: AdditiveTotals;
  onChange: (totals: AdditiveTotals) => void;
  onValidityChange: (name: string, valid: boolean) => void;
}) {
  const current = value;
  return (
    <fieldset className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <legend className="px-1 text-sm font-semibold">Taxas adicionais</legend>
      {(['order', 'product'] as const).map((scope) => (
        <AdditiveTotalsRow
          key={scope}
          scope={scope}
          value={current[scope]}
          onChange={(value) => onChange({ ...current, [scope]: value })}
          onValidityChange={onValidityChange}
        />
      ))}
    </fieldset>
  );
}
