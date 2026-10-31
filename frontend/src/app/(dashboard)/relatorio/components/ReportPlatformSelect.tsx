'use client';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { adminPlatformLabel } from '@/lib/product-platforms';
import { useId, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useReportApi, useReportQuery } from '@/hooks/use-report-api';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/Popover';
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/Command';
import { ReportError } from './ReportError';
import { ReportPagination } from './ReportPagination';
import type { ReportPage, ReportPlatform } from './report-types';

export function ReportPlatformSelect({
  value,
  onChange,
  allowAll = false,
}: {
  value: ReportPlatform | null;
  onChange: (platform: ReportPlatform | null) => void;
  allowAll?: boolean;
}) {
  const catalog = useProductPlatforms();
  const label = (platform: ReportPlatform) =>
    adminPlatformLabel(
      {
        ...platform,
        ...catalog.platforms.find((row) => row.tag === platform.tag),
      },
      catalog.user,
    );
  const labelId = useId();
  const api = useReportApi();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [local, setLocal] = useDebouncedInput(search, (next) => {
    setSearch(next);
    setPage(1);
  });
  const query = useReportQuery({
    queryKey: ['catalog', search, page],
    queryFn: ({ signal }) =>
      api.get<ReportPage<ReportPlatform>>('/relatorios/plataformas', {
        query: { search, page, pageSize: 20 },
        signal,
      }),
  });
  const select = (platform: ReportPlatform | null) => {
    onChange(platform);
    setOpen(false);
  };
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium" id={labelId}>
        Plataforma
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-labelledby={labelId}
            aria-expanded={open}
            className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm sm:max-w-md"
          >
            {value
              ? `${value.name}${value.isActive ? '' : ' (Inativa)'}`
              : allowAll
                ? catalog.user?.isAdmin
                  ? 'Todas as plataformas'
                  : 'Todas as minhas plataformas'
                : 'Selecione uma plataforma'}
            <ChevronsUpDown className="h-4 w-4 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(28rem,calc(100vw-2rem))] p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              name="report-platform-search"
              aria-label="Pesquisar plataforma"
              placeholder="Buscar: Minha Loja"
              value={local}
              onValueChange={setLocal}
            />
            <CommandList className="scrollbar-themed">
              {allowAll && (
                <CommandItem
                  value="all"
                  onSelect={() => select(null)}
                  className="cursor-pointer"
                >
                  {catalog.user?.isAdmin
                    ? 'Todas as plataformas'
                    : 'Todas as minhas plataformas'}
                </CommandItem>
              )}
              {query.isPending || catalog.isLoading || local !== search ? (
                <div
                  role="status"
                  className="h-32 animate-pulse bg-zinc-100 dark:bg-zinc-800"
                  aria-label="Carregando plataformas"
                />
              ) : query.isError ||
                (catalog.user?.isAdmin && catalog.isError) ? (
                <ReportError
                  retry={() => {
                    void query.refetch();
                    catalog.retry();
                  }}
                />
              ) : query.data.data.length === 0 ? (
                <p className="p-4 text-sm text-zinc-500">
                  Nenhuma plataforma encontrada.
                </p>
              ) : (
                query.data.data.map((platform) => (
                  <CommandItem
                    className="cursor-pointer"
                    key={platform.id}
                    value={platform.id}
                    onSelect={() => select(platform)}
                  >
                    <Check
                      className={`h-4 w-4 ${value?.id === platform.id ? 'opacity-100' : 'opacity-0'}`}
                    />
                    {label(platform)}
                  </CommandItem>
                ))
              )}
            </CommandList>
            {query.data && (
              <div className="border-t p-3">
                <ReportPagination
                  page={page}
                  total={query.data.total}
                  pageSize={20}
                  onChange={setPage}
                />
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
