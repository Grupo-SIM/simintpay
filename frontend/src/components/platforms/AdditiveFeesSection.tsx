import { Button } from '@/components/ui/Button';
import { AdditiveTotalsRow } from './AdditiveTotalsRow';
import type { AdditiveFeesView, AdditiveTotals } from './financial-types';

/** Editable additive totals; an edit becomes an override of the Delivery total. */
export function AdditiveFeesSection({
  view,
  override,
  onChange,
  onValidityChange,
}: {
  view: AdditiveFeesView;
  /** Draft override (null = follow the Delivery total). */
  override: AdditiveTotals | null;
  onChange: (override: AdditiveTotals | null) => void;
  onValidityChange: (name: string, valid: boolean) => void;
}) {
  const current = override ?? view.delivery;
  return (
    <fieldset className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <legend className="px-1 text-sm font-semibold">Taxas adicionais</legend>
      {(['order', 'product'] as const).map((scope) => (
        <AdditiveTotalsRow
          key={scope}
          scope={scope}
          value={current[scope]}
          delivery={view.delivery[scope]}
          onChange={(value) => onChange({ ...current, [scope]: value })}
          onValidityChange={onValidityChange}
        />
      ))}
      {override && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onChange(null);
            for (const scope of ['order', 'product'])
              for (const field of ['percentage', 'fixed'])
                onValidityChange(`additive-${scope}-${field}`, true);
          }}
        >
          Restaurar total do Delivery
        </Button>
      )}
    </fieldset>
  );
}
