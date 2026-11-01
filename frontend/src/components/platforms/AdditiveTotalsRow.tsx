import { FinancialNumberField } from './FinancialNumberField';
import {
  formatFeeValue,
  SCOPE_LABELS,
  type AdditiveFeeScope,
  type AdditiveScopeTotal,
} from './financial-types';

/** Editable percentage + fixed total of one application scope, with the Delivery total as hint. */
export function AdditiveTotalsRow({
  scope,
  value,
  delivery,
  onChange,
  onValidityChange,
}: {
  scope: AdditiveFeeScope;
  value: AdditiveScopeTotal;
  delivery: AdditiveScopeTotal;
  onChange: (value: AdditiveScopeTotal) => void;
  onValidityChange: (name: string, valid: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{SCOPE_LABELS[scope]}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FinancialNumberField
          label="Percentual (%)"
          name={`additive-${scope}-percentage`}
          rate
          value={value.percentageValue * 100}
          onChange={(ppm) =>
            onChange({ ...value, percentageValue: Math.round(ppm / 100) })
          }
          onValidityChange={onValidityChange}
        />
        <FinancialNumberField
          label="Valor fixo (R$)"
          name={`additive-${scope}-fixed`}
          value={value.fixedValue}
          onChange={(fixedValue) => onChange({ ...value, fixedValue })}
          onValidityChange={onValidityChange}
        />
      </div>
      <p className="text-xs text-zinc-500">
        Total do Delivery:{' '}
        {formatFeeValue(delivery.percentageValue, delivery.fixedValue)}
      </p>
    </div>
  );
}
