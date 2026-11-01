import { FinancialNumberField } from './FinancialNumberField';
import {
  SCOPE_LABELS,
  type AdditiveFeeScope,
  type AdditiveScopeTotal,
} from './financial-types';

/** Editable percentage and fixed total of one application scope. */
export function AdditiveTotalsRow({
  scope,
  value,
  onChange,
  onValidityChange,
}: {
  scope: AdditiveFeeScope;
  value: AdditiveScopeTotal;
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
    </div>
  );
}
