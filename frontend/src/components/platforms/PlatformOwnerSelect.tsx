'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/Command';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';

type Accounts = {
  data: { id: string; name: string; email: string; isAdmin?: boolean }[];
  total: number;
  page: number;
  pageSize: number;
};

export function PlatformOwnerSelect({
  owner,
  disabled,
  onChange,
  required = true,
}: {
  owner: Accounts['data'][number] | null;
  disabled: boolean;
  required?: boolean;
  onChange: (account: Accounts['data'][number]) => void;
}) {
  const { user } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [local, setLocal] = useDebouncedInput(search, (value) => {
    setSearch(value);
    setPage(1);
  });
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token'),
      }),
    [],
  );
  const query = useQuery({
    queryKey: ['platform-owner-accounts', user?.id, search.trim(), page],
    queryFn: ({ signal }) =>
      api.get<Accounts>(endpoints.admin.users.list, {
        query: { search: search.trim(), page, pageSize: 20 },
        cache: 'no-store',
        signal,
      }),
    enabled: open && Boolean(user?.id),
    retry: false,
    gcTime: 0,
  });
  return (
    <CustomSelect
      label="Proprietário"
      required={required}
      search={{
        open,
        onOpenChange: setOpen,
        disabled,
        placeholder: 'Selecione uma conta',
        selection: owner ? (
          <>
            <span className="block truncate font-medium leading-tight">
              {owner.name || owner.email}
            </span>
            {owner.name && (
              <span className="block truncate text-xs leading-tight text-zinc-500 dark:text-zinc-400">
                {owner.email}
              </span>
            )}
          </>
        ) : undefined,
        content: (
          <Command shouldFilter={false}>
            <CommandInput
              name="platform-owner-search"
              aria-label="Pesquisar contas por nome ou e-mail"
              placeholder="Ex: Ana ou ana@empresa.com.br"
              value={local}
              onValueChange={setLocal}
              maxLength={100}
            />
            <CommandList className="scrollbar-themed">
              {query.isPending || local !== search ? (
                <div
                  role="status"
                  aria-label="Carregando contas"
                  className="space-y-2 p-3"
                >
                  {[1, 2, 3].map((key) => (
                    <div
                      key={key}
                      className="h-12 animate-pulse rounded bg-zinc-100 dark:bg-white/10"
                    />
                  ))}
                </div>
              ) : query.isError ? (
                <div className="space-y-2 p-3">
                  <p
                    role="alert"
                    className="text-sm text-red-600 dark:text-red-400"
                  >
                    Não foi possível pesquisar contas.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => void query.refetch()}
                  >
                    Tentar novamente
                  </Button>
                </div>
              ) : query.data?.data.length ? (
                query.data.data
                  .filter(
                    (account) => account.id !== user?.id && !account.isAdmin,
                  )
                  .map((account) => (
                    <CommandItem
                      key={account.id}
                      value={account.id}
                      className="cursor-pointer gap-2"
                      onSelect={() => {
                        onChange(account);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={`h-4 w-4 shrink-0 ${owner?.id === account.id ? 'opacity-100' : 'opacity-0'}`}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{account.name}</p>
                        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {account.email}
                        </p>
                      </div>
                    </CommandItem>
                  ))
              ) : (
                <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
                  Nenhuma conta cliente encontrada.
                </p>
              )}
            </CommandList>
            {local === search &&
              query.isSuccess &&
              query.data.total > query.data.pageSize && (
                <div className="flex items-center justify-between gap-2 border-t p-3 text-sm">
                  <Button
                    type="button"
                    variant="outline"
                    className="cursor-pointer disabled:cursor-not-allowed"
                    disabled={page === 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Anterior
                  </Button>
                  <span>Página {page}</span>
                  <Button
                    type="button"
                    variant="outline"
                    className="cursor-pointer disabled:cursor-not-allowed"
                    disabled={page * query.data.pageSize >= query.data.total}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Próxima
                  </Button>
                </div>
              )}
          </Command>
        ),
      }}
    />
  );
}
