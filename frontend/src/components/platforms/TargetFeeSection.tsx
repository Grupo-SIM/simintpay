import { CustomSelect } from '@/components/ui/CustomSelect';
import { FinancialNumberField } from './FinancialNumberField';
import { formatPpm } from './financial-types';

type Mode = 'inherit' | 'off' | 'custom';

const DEFAULT_TARGET_PPM = 100_000;
/** Platform override that disables the target (mirrors the backend `TARGET_FEE_OFF`). */
export const TARGET_FEE_OFF = -1;

/**
 * Target fee: the total share of the purchase charged to the seller, interest-free. The global default applies to
 * every platform; a platform may override it (`TARGET_FEE_OFF` turns it off, `null` inherits the global one).
 */
export function TargetFeeSection({
  global,
  value,
  globalValue,
  onChange,
  onValidityChange,
}: {
  global: boolean;
  value: number | null;
  /** Global default, shown on platforms. */
  globalValue: number | null;
  onChange: (value: number | null) => void;
  onValidityChange: (name: string, valid: boolean) => void;
}) {
  const mode: Mode = global
    ? value !== null
      ? 'custom'
      : 'off'
    : value === null
      ? 'inherit'
      : value === TARGET_FEE_OFF
        ? 'off'
        : 'custom';
  const change = (next: Mode) => {
    if (next !== 'custom') onValidityChange('target-fee', true);
    onChange(
      next === 'inherit'
        ? null
        : next === 'off'
          ? global
            ? null
            : TARGET_FEE_OFF
          : (globalValue ?? DEFAULT_TARGET_PPM),
    );
  };
  const effective = global || value !== null ? value : globalValue;
  return (
    <div className="space-y-3">
      <div className="max-w-md">
        <CustomSelect
          label={global ? 'Taxa alvo padrão' : 'Taxa alvo da plataforma'}
          value={mode}
          onChange={(next) => change(next as Mode)}
          options={[
            ...(global
              ? []
              : [
                  {
                    value: 'inherit',
                    label:
                      globalValue !== null
                        ? `Usar padrão global (${formatPpm(globalValue)})`
                        : 'Usar padrão global (desativada)',
                  },
                ]),
            { value: 'off', label: 'Desativada' },
            { value: 'custom', label: global ? 'Ativada' : 'Personalizada' },
          ]}
        />
      </div>
      {mode === 'custom' && value !== null && (
        <div className="max-w-xs">
          <FinancialNumberField
            label="Taxa cobrada do vendedor (%)"
            name="target-fee"
            rate
            value={value}
            onChange={(ppm) =>
              onChange(ppm >= 0 && ppm < 1_000_000 ? ppm : value)
            }
            onValidityChange={(name, valid) =>
              onValidityChange(name, valid && value >= 0)
            }
          />
        </div>
      )}
      {!effective && (
        <p className="text-sm text-zinc-500">
          Sem taxa alvo: valem as taxas SimIntPay manuais.
        </p>
      )}
    </div>
  );
}
