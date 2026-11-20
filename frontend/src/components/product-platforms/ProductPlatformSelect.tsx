'use client';

import { useState } from 'react';
import { PlatformOwnerSelect } from '@/components/platforms/PlatformOwnerSelect';
import { PlatformSelect } from './PlatformSelect';
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
        <PlatformSelect
          value={value ?? ''}
          onChange={onChange}
          disabled={disabled}
          required={isAdmin}
          emptyLabel={
            !isAdmin && value ? 'Venda pessoal (sem plataforma)' : undefined
          }
          isDisabled={(platform) => !platform.isActive}
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
