import { CustomSelect } from '@/components/ui/CustomSelect';
import { FinancialNumberField } from './FinancialNumberField';
import { formatPpm } from './financial-types';

type Mode = 'inherit' | 'off' | 'custom';

const DEFAULT_TARGET_PPM = 100_000;

/**
 * Target fee: the total share of the purchase charged to the seller, interest-free. The global default applies to
 * every platform; a platform may override it (`value` 0 turns it off, `null` inherits the global one).
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
    ? value
      ? 'custom'
      : 'off'
    : value === null
      ? 'inherit'
      : value === 0
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
            : 0
          : globalValue || DEFAULT_TARGET_PPM,
    );
  };
  const effective = global ? value : (value ?? globalValue);
  return (
    <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <legend className="px-1 text-sm font-semibold">Taxa alvo</legend>
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
                    label: globalValue
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
              onChange(ppm > 0 && ppm < 1_000_000 ? ppm : value)
            }
            onValidityChange={(name, valid) =>
              onValidityChange(name, valid && value > 0)
            }
          />
        </div>
      )}
      <p className="text-sm text-zinc-500">
        {effective
          ? `Cada transação cobra do vendedor ${formatPpm(effective)} do valor da compra (sem juros): a maior taxa entre as adquirentes ativas mais um adicional SimIntPay calculado automaticamente. Substitui apenas as taxas SimIntPay manuais, que ficam preservadas. Taxas aditivas e juros do comprador não entram nesse cálculo e seguem normalmente. Se a adquirente mais cara custar mais que a taxa alvo, vale o custo dela.`
          : 'Sem taxa alvo: valem as taxas SimIntPay manuais.'}
      </p>
    </fieldset>
  );
}
