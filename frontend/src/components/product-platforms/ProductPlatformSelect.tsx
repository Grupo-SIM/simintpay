'use client';

import { Dropdown } from '@/components/ui/Dropdown';
import { useProductPlatforms } from '@/hooks/use-product-platforms';

type Props = {
  catalog: ReturnType<typeof useProductPlatforms>;
  value: string | null;
  onChange: (value: string) => void;
  theme: 'light' | 'dark';
  disabled?: boolean;
};

export function ProductPlatformSelect({
  catalog,
  value,
  onChange,
  theme,
  disabled,
}: Props) {
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
  return (
    <div className="space-y-2">
      <Dropdown
        label="Plataforma"
        theme={theme}
        variant="navbar"
        portal
        searchable
        searchPlaceholder="Buscar plataforma..."
        value={value ?? ''}
        onChange={onChange}
        options={[
          {
            value: '',
            label: catalog.user?.isAdmin
              ? 'Selecionar titular sem plataforma'
              : 'Venda pessoal (sem plataforma)',
          },
          ...catalog.options,
        ]}
        placeholder="Selecione uma plataforma"
        disabled={disabled}
      />
      {disabled && (
        <p className="text-xs text-zinc-500">
          A plataforma vinculada será preservada.
        </p>
      )}
    </div>
  );
}
