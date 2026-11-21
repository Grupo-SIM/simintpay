'use client';

import { Trash2 } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { PortalTooltip } from '@/components/ui/PortalTooltip';
import { CoproducerAccountSelect } from '@/components/coproduction/components/CoproducerAccountSelect';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import {
  affiliateLink,
  maskPercentage,
} from '@/features/affiliates/affiliates';
import type { AffiliateDraftRow } from '@/features/affiliates/types';
import { endpoints } from '@/services/api/endpoints';

export function AffiliateRow({
  row,
  disabled,
  linkBaseUrl,
  onChange,
  onRemove,
}: {
  row: AffiliateDraftRow;
  disabled: boolean;
  /** Link base já salvo; o link só aparece para afiliado persistido. */
  linkBaseUrl?: string | null;
  onChange: (row: AffiliateDraftRow) => void;
  onRemove: () => void;
}) {
  const percentageId = useId();
  const [percentage, setPercentage, flushPercentage] = useDebouncedInput(
    row.percentage,
    (value) => onChange({ ...row, percentage: value }),
  );
  return (
    <li className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-end gap-2">
        <div className="space-y-1.5">
          <label htmlFor={percentageId} className="text-sm font-medium">
            Percentual
          </label>
          <div className="flex h-11 items-center rounded-md border border-zinc-200 bg-white focus-within:border-[#7c3aed] focus-within:ring-2 focus-within:ring-[#7c3aed]/20 dark:border-white/10 dark:bg-white/5">
            <input
              id={percentageId}
              type="text"
              name={`affiliate-percentage-${row.id}`}
              inputMode="decimal"
              disabled={disabled}
              placeholder="Global"
              value={percentage}
              onChange={(event) =>
                setPercentage(maskPercentage(event.currentTarget.value))
              }
              onBlur={flushPercentage}
              className="min-w-0 w-full bg-transparent py-2 pl-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <span className="pr-3 text-sm text-zinc-500 dark:text-zinc-400">
              %
            </span>
          </div>
        </div>
        <CoproducerAccountSelect
          email={row.email}
          name={row.name}
          disabled={disabled}
          label="Afiliado"
          endpoint={endpoints.affiliates.accounts}
          queryScope="affiliate-accounts"
          onChange={(account) => {
            flushPercentage();
            onChange({
              ...row,
              percentage,
              email: account.email,
              name: account.name,
              // Outro afiliado: o código é gerado pelo servidor ao salvar.
              code: account.email === row.email ? row.code : undefined,
            });
          }}
        />
        <PortalTooltip
          content={
            <span className="rounded-md border bg-background px-2 py-1 text-xs shadow">
              Remover afiliado
            </span>
          }
        >
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 cursor-pointer disabled:cursor-not-allowed"
            aria-label={`Remover afiliado ${row.email || 'sem conta'}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </PortalTooltip>
      </div>
      {row.code ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span>
            Código: <strong className="font-mono">{row.code}</strong>
          </span>
          <CopyButton
            value={row.code}
            label="Copiar código"
            className="px-2 py-1 text-xs"
          />
          {linkBaseUrl && (
            <CopyButton
              value={affiliateLink(linkBaseUrl, row.code)}
              label="Copiar link"
              className="px-2 py-1 text-xs"
            />
          )}
        </div>
      ) : (
        row.email && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            O código é gerado ao salvar.
          </p>
        )
      )}
    </li>
  );
}
