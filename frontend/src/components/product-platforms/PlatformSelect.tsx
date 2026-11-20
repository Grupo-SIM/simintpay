'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/Command';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import { usePlatformSearch } from '@/hooks/use-platform-search';
import { adminPlatformLabel } from '@/lib/product-platforms';
import { cn } from '@/lib/utils';
import { ReportError } from '@/app/(dashboard)/relatorio/components/ReportError';
import type { ReportPlatform } from '@/app/(dashboard)/relatorio/components/report-types';

type Common = {
  label?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Adds an entry that clears the selection (e.g. "Todas as plataformas"). */
  emptyLabel?: string;
  /** Marks platforms that can be displayed but not picked. */
  isDisabled?: (platform: ReportPlatform) => boolean;
};

type Props = Common &
  (
    | {
        multiple?: false;
        /** Platform tag, or '' for none. */
        value: string;
        onChange: (tag: string, platform?: ReportPlatform) => void;
      }
    | {
        multiple: true;
        value: ReportPlatform[];
        onChange: (platforms: ReportPlatform[]) => void;
      }
  );

const platformText = (platform: { name: string; isActive: boolean }) =>
  adminPlatformLabel(platform, null);

export function PlatformSelect(props: Props) {
  const {
    label = 'Plataforma',
    required,
    disabled,
    placeholder = 'Selecione uma plataforma',
    emptyLabel,
    isDisabled,
  } = props;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [local, setLocal] = useDebouncedInput(search, setSearch);
  const single = props.multiple ? undefined : props.value;
  const { query, platforms, sentinel, selected } = usePlatformSearch({
    search,
    enabled: open,
    selectedTag: single || undefined,
  });
  const isSelected = (platform: ReportPlatform) =>
    props.multiple
      ? props.value.some((item) => item.id === platform.id)
      : props.value.toUpperCase() === platform.tag.toUpperCase();
  const pick = (platform: ReportPlatform) => {
    if (props.multiple) {
      props.onChange(
        isSelected(platform)
          ? props.value.filter((item) => item.id !== platform.id)
          : [...props.value, platform],
      );
      return;
    }
    props.onChange(platform.tag, platform);
    setOpen(false);
  };
  const clear = () => {
    if (props.multiple) props.onChange([]);
    else props.onChange('');
    setOpen(false);
  };
  const empty = props.multiple ? props.value.length === 0 : !props.value;
  let selection: string | undefined;
  if (props.multiple) {
    selection = props.value.length
      ? props.value.length <= 2
        ? props.value.map(platformText).join(', ')
        : `${props.value.length} plataformas selecionadas`
      : emptyLabel;
  } else if (props.value) {
    selection = selected ? platformText(selected) : props.value.toUpperCase();
  } else {
    selection = emptyLabel;
  }
  return (
    <CustomSelect
      label={label}
      required={required}
      search={{
        open,
        onOpenChange: setOpen,
        disabled,
        placeholder,
        selection: selection ? (
          <span className="block truncate font-medium leading-tight">
            {selection}
          </span>
        ) : undefined,
        content: (
          <Command shouldFilter={false}>
            <CommandInput
              name="platform-search"
              aria-label="Pesquisar plataforma"
              placeholder="Buscar plataforma..."
              value={local}
              onValueChange={setLocal}
              maxLength={100}
            />
            <CommandList className="scrollbar-themed">
              {emptyLabel && (
                <CommandItem
                  value="__none__"
                  onSelect={clear}
                  className="cursor-pointer gap-2"
                >
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0',
                      empty ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="truncate">{emptyLabel}</span>
                </CommandItem>
              )}
              {query.isPending || local !== search ? (
                <div
                  role="status"
                  className="h-32 animate-pulse bg-zinc-100 dark:bg-zinc-800"
                  aria-label="Carregando plataformas"
                />
              ) : query.isError ? (
                <ReportError retry={() => void query.refetch()} />
              ) : platforms.length === 0 ? (
                <p className="p-4 text-sm text-zinc-500">
                  Nenhuma plataforma encontrada.
                </p>
              ) : (
                <>
                  {platforms.map((platform) => (
                    <CommandItem
                      key={platform.id}
                      value={platform.id}
                      disabled={isDisabled?.(platform)}
                      className="cursor-pointer gap-2"
                      onSelect={() => pick(platform)}
                    >
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0',
                          isSelected(platform) ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="truncate font-medium">
                        {platformText(platform)}
                      </span>
                    </CommandItem>
                  ))}
                  {query.hasNextPage && (
                    <div
                      ref={sentinel}
                      role="status"
                      aria-label="Carregando mais plataformas"
                      className="p-3 text-center text-xs text-zinc-500"
                    >
                      Carregando…
                    </div>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        ),
      }}
    />
  );
}
