'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { useDebouncedInput } from '@/hooks/use-debounced-input';

type UserOption = { id: string; email: string; name: string | null };

/** Tag de política/taxas de um usuário: cobranças sem plataforma usam as taxas do dono. */
export const userTaxaTag = (id: string) => `USER:${id.toUpperCase()}`;

export function UserTaxaList({
  selectedTag,
  onSelect,
  onSelectGlobal,
}: {
  selectedTag?: string;
  onSelect: (tag: string, label: string) => void;
  onSelectGlobal?: () => void;
}) {
  const api = useClienteApi();
  const [search, setSearch] = useState('');
  const [local, update, flush] = useDebouncedInput(search, setSearch);
  const users = useQuery({
    queryKey: ['taxa-users', search.trim()],
    queryFn: () =>
      api.get<{ data: UserOption[] }>(
        `/admin/plataformas/simintpay-clientes?pageSize=20&search=${encodeURIComponent(search.trim())}`,
      ),
  });
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="taxa-user-search" className="text-sm font-medium">
          Pesquisar usuários
        </label>
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 focus-within:border-violet-400/40 focus-within:ring-4 focus-within:ring-violet-500/10 dark:border-white/10 dark:bg-white/5">
          <Search size={18} className="shrink-0 text-zinc-400" />
          <input
            id="taxa-user-search"
            name="taxa-user-search"
            type="text"
            maxLength={100}
            placeholder="E-mail, nome ou documento"
            value={local}
            onChange={(event) => update(event.currentTarget.value)}
            onBlur={flush}
            className="h-11 min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          />
        </div>
      </div>
      <ScrollArea
        className="max-h-64 space-y-2 pr-1"
        aria-label="Usuários disponíveis"
      >
        {onSelectGlobal && (
          <button
            type="button"
            onClick={onSelectGlobal}
            aria-pressed={selectedTag === 'GLOBAL'}
            className="flex w-full cursor-pointer items-center justify-between rounded-xl border p-4 text-left"
          >
            Padrão global{selectedTag === 'GLOBAL' && <Check size={18} />}
          </button>
        )}
        {users.isPending || local !== search ? (
          <p role="status" className="py-4 text-sm text-zinc-500">
            Carregando usuários...
          </p>
        ) : users.isError ? (
          <p role="alert" className="py-4 text-sm text-red-500">
            Falha ao buscar usuários.
          </p>
        ) : users.data.data.length === 0 ? (
          <p className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
            Nenhum usuário encontrado.
          </p>
        ) : (
          [...users.data.data]
            .sort((a, b) =>
              (a.name ?? a.email).localeCompare(b.name ?? b.email, 'pt-BR', {
                sensitivity: 'base',
              }),
            )
            .map((user) => {
              const tag = userTaxaTag(user.id);
              const active = selectedTag === tag;
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => onSelect(tag, user.name ?? user.email)}
                  aria-pressed={active}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:border-violet-400/40 hover:bg-violet-500/5 ${active ? 'border-violet-500/40 bg-violet-500/10' : 'border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-white/5'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {user.name ?? user.email}
                    </span>
                    {user.name && (
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {user.email}
                      </span>
                    )}
                  </span>
                  {active && (
                    <Check size={18} className="shrink-0 text-violet-500" />
                  )}
                </button>
              );
            })
        )}
      </ScrollArea>
    </div>
  );
}
