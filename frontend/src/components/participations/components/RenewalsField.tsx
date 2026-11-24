'use client';

import { Button } from '@/components/ui/Button';
import { FormSwitch } from '@/components/ui/FormSwitch';
import type { RenewalsChoice } from '@/features/participations/types';

/** Comissão nas renovações: interruptor na plataforma; na oferta, três opções (herdar, todas, só a primeira). */
export function RenewalsField({
  label,
  platform,
  value,
  inheritedLabel,
  disabled,
  onChange,
}: {
  label: string;
  platform: boolean;
  value: RenewalsChoice;
  /** Texto da opção herdada, ex.: "todas". */
  inheritedLabel?: string;
  disabled: boolean;
  onChange: (value: RenewalsChoice) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-violet-500/20 p-4">
      <p className="text-sm font-medium">{label}</p>
      {platform ? (
        <div className="flex items-center gap-3 text-sm">
          <FormSwitch
            aria-label={label}
            checked={value !== 'first'}
            onChange={(on) => onChange(on ? 'all' : 'first')}
          />
          <span>
            {value !== 'first'
              ? 'Todas as renovações geram comissão.'
              : 'Só a primeira compra gera comissão.'}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(
            [
              [
                'platform',
                `Usar a da plataforma${inheritedLabel ? ` (${inheritedLabel})` : ''}`,
              ],
              ['all', 'Todas as renovações'],
              ['first', 'Só a primeira compra'],
            ] as const
          ).map(([option, text]) => (
            <Button
              key={option}
              type="button"
              variant="outline"
              className="h-auto min-h-9 max-w-full cursor-pointer whitespace-normal text-left disabled:cursor-not-allowed"
              aria-pressed={value === option}
              disabled={disabled}
              onClick={() => onChange(option)}
            >
              {text}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
