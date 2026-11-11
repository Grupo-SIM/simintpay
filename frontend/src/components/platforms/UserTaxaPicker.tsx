'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/Command';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useDebouncedInput } from '@/hooks/use-debounced-input';

type UserOption = { id: string; email: string; name: string | null };

/** Tag de política/taxas de um usuário: cobranças sem plataforma usam as taxas do dono. */
export const userTaxaTag = (id: string) => `USER:${id.toUpperCase()}`;

export function UserTaxaPicker({
  selectedTag,
  selectedLabel,
  onSelect,
}: {
  selectedTag: string;
  selectedLabel: string | null;
  onSelect: (tag: string, label: string) => void;
}) {
  const api = useClienteApi();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [local, setLocal] = useDebouncedInput(search, setSearch);
  const users = useQuery({
    queryKey: ['taxa-users', search.trim()],
    enabled: open,
    queryFn: () =>
      api.get<{ data: UserOption[] }>(
        `/admin/plataformas/simintpay-clientes?pageSize=20&search=${encodeURIComponent(search.trim())}`,
      ),
  });
  const isUser = selectedTag.startsWith('USER:');
  return (
    <div className="w-72">
      <CustomSelect
        label="Taxas por usuário"
        search={{
          open,
          onOpenChange: setOpen,
          placeholder: 'Selecionar usuário',
          selection: isUser ? (
            <span className="block truncate font-medium">
              {selectedLabel ?? selectedTag}
            </span>
          ) : undefined,
          content: (
            <Command shouldFilter={false}>
              <CommandInput
                name="taxa-user-search"
                aria-label="Buscar usuário"
                placeholder="E-mail, nome ou documento"
                value={local}
                onValueChange={setLocal}
                maxLength={100}
              />
              <CommandList className="scrollbar-themed">
                {users.isPending || local !== search ? (
                  <p role="status" className="p-4 text-sm opacity-70">
                    Carregando usuários...
                  </p>
                ) : users.isError ? (
                  <p role="alert" className="p-4 text-sm text-red-500">
                    Falha ao buscar usuários.
                  </p>
                ) : users.data.data.length === 0 ? (
                  <p className="p-4 text-sm opacity-70">
                    Nenhum usuário encontrado.
                  </p>
                ) : (
                  users.data.data.map((user) => {
                    const tag = userTaxaTag(user.id);
                    return (
                      <CommandItem
                        key={user.id}
                        value={user.id}
                        className="cursor-pointer gap-2"
                        onSelect={() => {
                          onSelect(tag, user.name ?? user.email);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={`h-4 w-4 shrink-0 ${selectedTag === tag ? 'opacity-100' : 'opacity-0'}`}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {user.name ?? user.email}
                          </p>
                          {user.name && (
                            <p className="truncate text-xs opacity-60">
                              {user.email}
                            </p>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })
                )}
              </CommandList>
            </Command>
          ),
        }}
      />
    </div>
  );
}
