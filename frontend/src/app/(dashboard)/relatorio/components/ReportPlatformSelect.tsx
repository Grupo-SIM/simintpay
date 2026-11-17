'use client';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { adminPlatformLabel } from '@/lib/product-platforms';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Check } from 'lucide-react';
import { useReportApi } from '@/hooks/use-report-api';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import { CustomSelect } from '@/components/ui/CustomSelect';
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/Command';
import { ReportError } from './ReportError';
import type { ReportPage, ReportPlatform } from './report-types';

const PAGE_SIZE = 10;

export function ReportPlatformSelect({
  value,
  onChange,
  allowAll = false,
}: {
  value: ReportPlatform[];
  onChange: (platforms: ReportPlatform[]) => void;
  allowAll?: boolean;
}) {
  const catalog = useProductPlatforms();
  const { user } = useCurrentUser();
  const label = (platform: ReportPlatform) =>
    adminPlatformLabel(
      {
        ...platform,
        ...catalog.platforms.find((row) => row.tag === platform.tag),
      },
      catalog.user,
    );
  const api = useReportApi();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [local, setLocal] = useDebouncedInput(search, setSearch);
  const query = useInfiniteQuery({
    queryKey: [
      'reports',
      user?.id,
      user?.isAdmin ? 'admin' : 'owner',
      'catalog',
      search,
    ],
    enabled: !!user && open,
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) =>
      api.get<ReportPage<ReportPlatform>>('/relatorios/plataformas', {
        query: { search, page: pageParam, pageSize: PAGE_SIZE },
        signal,
      }),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  const platforms = query.data?.pages.flatMap((page) => page.data) ?? [];
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage)
        void fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, platforms.length]);
  const toggle = (platform: ReportPlatform) =>
    onChange(
      value.some((item) => item.id === platform.id)
        ? value.filter((item) => item.id !== platform.id)
        : [...value, platform],
    );
  const allLabel = catalog.user?.isAdmin
    ? 'Todas as plataformas'
    : 'Todas as minhas plataformas';
  const selection = value.length
    ? value.length <= 2
      ? value
          .map((item) => `${item.name}${item.isActive ? '' : ' (Inativa)'}`)
          .join(', ')
      : `${value.length} plataformas selecionadas`
    : allowAll
      ? allLabel
      : undefined;
  return (
    <CustomSelect
      label="Plataforma"
      search={{
        open,
        onOpenChange: setOpen,
        selection,
        placeholder: 'Selecione uma plataforma',
        content: (
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
                  onSelect={() => {
                    onChange([]);
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <Check
                    className={`h-4 w-4 ${value.length === 0 ? 'opacity-100' : 'opacity-0'}`}
                  />
                  {allLabel}
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
              ) : platforms.length === 0 ? (
                <p className="p-4 text-sm text-zinc-500">
                  Nenhuma plataforma encontrada.
                </p>
              ) : (
                <>
                  {platforms.map((platform) => (
                    <CommandItem
                      className="cursor-pointer"
                      key={platform.id}
                      value={platform.id}
                      onSelect={() => toggle(platform)}
                    >
                      <Check
                        className={`h-4 w-4 ${value.some((item) => item.id === platform.id) ? 'opacity-100' : 'opacity-0'}`}
                      />
                      {label(platform)}
                    </CommandItem>
                  ))}
                  {hasNextPage && (
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
