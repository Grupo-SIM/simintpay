'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PortalTooltip } from '@/components/ui/PortalTooltip';

const tip = (text: string) => (
  <span className="rounded-md border bg-background px-2 py-1 text-xs shadow">
    {text}
  </span>
);

/** Linha somente leitura: pessoa, resumo das participações e ações em ícone. */
export function PersonRow({
  name,
  email,
  chips,
  disabled,
  onEdit,
  onRemove,
}: {
  name?: string;
  email: string;
  chips: string[];
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const who = name || email;
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{who}</p>
          {name && (
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {email}
            </p>
          )}
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-[#7c3aed]/20 bg-[#7c3aed]/10 px-2 py-0.5 text-xs text-[#6d28d9] dark:text-[#c4b5fd]"
            >
              {chip}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <PortalTooltip content={tip('Editar')}>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="cursor-pointer disabled:cursor-not-allowed"
            aria-label={`Editar ${who}`}
            disabled={disabled}
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </PortalTooltip>
        <PortalTooltip content={tip('Remover')}>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="cursor-pointer disabled:cursor-not-allowed"
            aria-label={`Remover ${who}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </PortalTooltip>
      </div>
    </li>
  );
}
