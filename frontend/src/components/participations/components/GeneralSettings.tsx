'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { formatPercentage } from '@/features/coproduction/coproduction';
import type {
  Agreements,
  ParticipationsContext,
  SettingsDraft,
} from '@/features/participations/types';
import { InheritanceField } from './InheritanceField';
import { LinkBaseField } from './LinkBaseField';
import { PercentageField } from './PercentageField';
import { RenewalsField } from './RenewalsField';

const renewalsText = (value: SettingsDraft['renewals']) =>
  value === 'platform'
    ? 'renovações da plataforma'
    : value === 'first'
      ? 'só a primeira compra'
      : 'todas as renovações';

/** Seção recolhível com os campos do acordo inteiro (não de uma pessoa). */
export function GeneralSettings({
  settings,
  agreements,
  context,
  disabled,
  onChange,
}: {
  settings: SettingsDraft;
  agreements: Agreements;
  context: ParticipationsContext;
  disabled: boolean;
  onChange: (patch: Partial<SettingsDraft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const { platform, admin, allowInheritance } = context;
  const inheritedAff = agreements.aff.inherited;
  const inheritedMargin = agreements.margin?.inherited;
  const summary = [
    allowInheritance &&
      (settings.mode === 'INHERIT'
        ? 'Co-produção da plataforma'
        : 'Co-produção própria'),
    `Afiliados: ${settings.defaultPercentage ? `${settings.defaultPercentage}%` : 'sem padrão'}, ${renewalsText(settings.renewals)}`,
    admin &&
      `Margem: ${settings.marginDefaultPercentage ? `${settings.marginDefaultPercentage}%` : 'sem padrão'}, ${renewalsText(settings.marginRenewals)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const inheritedHint = (bps?: number | null) =>
    !platform && bps ? `${formatPercentage(bps)}% (plataforma)` : 'Ex: 10';
  return (
    <section
      aria-label="Configurações gerais"
      className="rounded-xl border border-zinc-200 dark:border-white/10"
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Configurações gerais</h3>
          {!open && (
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {summary}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
          />
          {open ? 'Minimizar' : 'Expandir'}
        </Button>
      </div>
      {open && (
        <div className="space-y-4 border-t border-zinc-200 p-4 dark:border-white/10">
          {allowInheritance && (
            <InheritanceField
              mode={settings.mode}
              initial={agreements.co}
              disabled={disabled}
              onChange={(mode) => onChange({ mode })}
            />
          )}
          {platform && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              No Delivery, a divisão é sobre os itens, sem frete nem taxas.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <PercentageField
              label="Percentual global dos afiliados"
              name="affiliate-default-percentage"
              value={settings.defaultPercentage}
              placeholder={inheritedHint(inheritedAff?.defaultPercentageBps)}
              disabled={disabled}
              hint="Vale para quem não tem percentual próprio."
              onChange={(defaultPercentage) => onChange({ defaultPercentage })}
            />
            {platform && (
              <LinkBaseField
                value={settings.linkBaseUrl}
                disabled={disabled}
                onChange={(linkBaseUrl) => onChange({ linkBaseUrl })}
              />
            )}
          </div>
          <RenewalsField
            label="Comissão nas renovações"
            platform={platform}
            value={settings.renewals}
            inheritedLabel={
              inheritedAff
                ? inheritedAff.commissionOnRenewals
                  ? 'todas'
                  : 'só a primeira compra'
                : undefined
            }
            disabled={disabled}
            onChange={(renewals) => onChange({ renewals })}
          />
          {admin && (
            <>
              <PercentageField
                label="Percentual global dos afiliados da margem"
                name="margin-default-percentage"
                value={settings.marginDefaultPercentage}
                placeholder={inheritedHint(
                  inheritedMargin?.defaultPercentageBps,
                )}
                disabled={disabled}
                hint="Vale para quem não tem percentual próprio na margem."
                onChange={(marginDefaultPercentage) =>
                  onChange({ marginDefaultPercentage })
                }
              />
              <RenewalsField
                label="Comissão da margem nas renovações"
                platform={platform}
                value={settings.marginRenewals}
                inheritedLabel={
                  inheritedMargin
                    ? inheritedMargin.commissionOnRenewals
                      ? 'todas'
                      : 'só a primeira compra'
                    : undefined
                }
                disabled={disabled}
                onChange={(marginRenewals) => onChange({ marginRenewals })}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
