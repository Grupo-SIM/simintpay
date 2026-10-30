'use client';

import { Trash2 } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/Button';
import { PortalTooltip } from '@/components/ui/PortalTooltip';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import { maskPercentage } from '@/features/coproduction/coproduction';
import type { CoproducerDraft } from '@/features/coproduction/types';
import { CoproducerAccountSelect } from './CoproducerAccountSelect';

export function CoproducerRow({
  row,
  disabled,
  onChange,
  onRemove,
}: {
  row: CoproducerDraft;
  disabled: boolean;
  onChange: (row: CoproducerDraft) => void;
  onRemove: () => void;
}) {
  const percentageId = useId();
  const [percentage, setPercentage, flushPercentage] = useDebouncedInput(
    row.percentage,
    (value) => onChange({ ...row, percentage: value }),
  );
  return (
    <li className="grid grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-end gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="space-y-1.5">
        <label htmlFor={percentageId} className="text-sm font-medium">
          Participação <span className="text-red-500">*</span>
        </label>
        <div className="flex h-11 items-center rounded-md border border-zinc-200 bg-white focus-within:border-[#7c3aed] focus-within:ring-2 focus-within:ring-[#7c3aed]/20 dark:border-white/10 dark:bg-black/30">
          <input
            id={percentageId}
            type="text"
            name={`coproducer-percentage-${row.id}`}
            inputMode="decimal"
            required
            disabled={disabled}
            placeholder="25,50"
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
        onChange={(account) => {
          flushPercentage();
          onChange({
            ...row,
            percentage,
            email: account.email,
            name: account.name,
          });
        }}
      />
      <PortalTooltip
        content={
          <span className="rounded-md border bg-background px-2 py-1 text-xs shadow">
            Remover participação
          </span>
        }
      >
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 cursor-pointer disabled:cursor-not-allowed"
          aria-label={`Remover participação de ${row.email || 'coprodutor'}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </PortalTooltip>
    </li>
  );
}
