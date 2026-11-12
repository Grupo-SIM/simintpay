'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { PlatformOwnerSelect } from '@/components/platforms/PlatformOwnerSelect';
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/Command';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { cn } from '@/lib/utils';
import type { useProductPlatforms } from '@/hooks/use-product-platforms';

type Owner = NonNullable<
  ReturnType<typeof useProductPlatforms>['financialOwner']
>;

type Props = {
  catalog: ReturnType<typeof useProductPlatforms>;
  value: string | null;
  onChange: (value: string) => void;
  theme?: 'light' | 'dark';
  disabled?: boolean;
  /** Admin-only: enables the owner/platform toggle for the financial destination. */
  owner?: Owner | null;
  onOwnerChange?: (owner: Owner | null) => void;
};

function DestinationToggle({
  useOwner,
  onChange,
}: {
  useOwner: boolean;
  onChange: (useOwner: boolean) => void;
}) {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
      <button
        type="button"
        role="switch"
        aria-checked={useOwner}
        onClick={() => onChange(!useOwner)}
        className={cn(
          'relative h-5 w-9 cursor-pointer rounded-full transition-colors',
          useOwner ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
            useOwner && 'translate-x-4',
          )}
        />
      </button>
      Usar proprietário em vez de plataforma
    </label>
  );
}

function PlatformSearchSelect({
  options,
  value,
  onChange,
  disabled,
  required,
}: {
  options: { value: string; label: string; disabled?: boolean }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const filtered = options.filter(
    (option) => option.value && option.label.toLowerCase().includes(term),
  );
  const selected = options.find((option) => option.value === value);
  return (
    <CustomSelect
      label="Plataforma"
      required={required}
      search={{
        open,
        onOpenChange: setOpen,
        disabled,
        placeholder: 'Selecione uma plataforma',
        selection: selected ? (
          <span className="block truncate font-medium leading-tight">
            {selected.label}
          </span>
        ) : undefined,
        content: (
          <Command shouldFilter={false}>
            <CommandInput
              name="product-platform-search"
              aria-label="Pesquisar plataformas"
              placeholder="Buscar plataforma..."
              value={search}
              onValueChange={setSearch}
              maxLength={100}
            />
            <CommandList className="scrollbar-themed">
              {!required && value && (
                <CommandItem
                  value="__none__"
                  className="cursor-pointer gap-2"
                  onSelect={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  <Check className="h-4 w-4 shrink-0 opacity-0" />
                  <span className="truncate text-zinc-500">
                    Venda pessoal (sem plataforma)
                  </span>
                </CommandItem>
              )}
              {filtered.length ? (
                filtered.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className="cursor-pointer gap-2"
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        value === option.value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="truncate font-medium">{option.label}</span>
                  </CommandItem>
                ))
              ) : (
                <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
                  Nenhuma plataforma encontrada.
                </p>
              )}
            </CommandList>
          </Command>
        ),
      }}
    />
  );
}

export function ProductPlatformSelect({
  catalog,
  value,
  onChange,
  disabled,
  owner = null,
  onOwnerChange,
}: Props) {
  const isAdmin = Boolean(catalog.user?.isAdmin);
  const canToggle = isAdmin && !disabled && Boolean(onOwnerChange);
  const [useOwner, setUseOwner] = useState(Boolean(owner) && !value);
  if (catalog.isLoading) {
    return (
      <div
        className="h-12 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-white/10 dark:bg-white/10"
        aria-label="Carregando plataformas"
      />
    );
  }
  if (catalog.isError) {
    return (
      <div role="alert" className="text-sm text-red-500">
        Não foi possível carregar as plataformas.
        <button
          type="button"
          onClick={catalog.retry}
          className="ml-2 cursor-pointer rounded border border-current px-2 py-1"
        >
          Tentar novamente
        </button>
      </div>
    );
  }
  const showOwner = canToggle && useOwner;
  return (
    <div className="space-y-3">
      {canToggle && (
        <DestinationToggle
          useOwner={useOwner}
          onChange={(next) => {
            setUseOwner(next);
            if (next) onChange('');
            else onOwnerChange?.(null);
          }}
        />
      )}
      {showOwner ? (
        <PlatformOwnerSelect
          owner={owner}
          disabled={false}
          onChange={(account) => onOwnerChange?.(account)}
        />
      ) : (
        <PlatformSearchSelect
          options={catalog.options}
          value={value ?? ''}
          onChange={onChange}
          disabled={disabled}
          required={isAdmin}
        />
      )}
      {disabled && (
        <p className="text-xs text-zinc-500">
          A plataforma vinculada será preservada.
        </p>
      )}
    </div>
  );
}
