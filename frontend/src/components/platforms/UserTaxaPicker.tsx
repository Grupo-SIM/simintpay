'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { panel } from './types';

type UserOption = { id: string; email: string; name: string | null };

/** Tag de política/taxas de um usuário: cobranças sem plataforma usam as taxas do dono. */
export const userTaxaTag = (id: string) => `USER:${id.toUpperCase()}`;

export function UserTaxaPicker({
  selectedTag,
  onSelect,
}: {
  selectedTag: string;
  onSelect: (tag: string, label: string) => void;
}) {
  const api = useClienteApi();
  const [search, setSearch] = useState('');
  const users = useQuery({
    queryKey: ['taxa-users', search],
    enabled: search.trim().length >= 2,
    queryFn: () =>
      api.get<{ data: UserOption[] }>(
        `/admin/plataformas/simintpay-clientes?pageSize=8&search=${encodeURIComponent(search.trim())}`,
      ),
  });
  return (
    <section className={panel} aria-label="Taxas por usuário">
      <h2 className="mb-1 font-semibold">Taxas por usuário</h2>
      <p className="mb-3 text-sm opacity-70">
        Vale para cobranças sem plataforma (links de pagamento avulsos). Sem
        configuração própria, o usuário herda o padrão global.
      </p>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar por e-mail, nome ou documento"
        aria-label="Buscar usuário"
        className="w-full max-w-md rounded border bg-transparent px-3 py-2 text-sm"
      />
      {users.isError && (
        <p role="alert" className="mt-2 text-sm text-red-500">
          Falha ao buscar usuários.
        </p>
      )}
      {users.data && (
        <ul className="mt-2 max-w-md divide-y rounded border text-sm">
          {users.data.data.length === 0 && (
            <li className="p-2 opacity-70">Nenhum usuário encontrado.</li>
          )}
          {users.data.data.map((user) => {
            const tag = userTaxaTag(user.id);
            return (
              <li key={user.id}>
                <button
                  type="button"
                  aria-pressed={selectedTag === tag}
                  className="w-full cursor-pointer p-2 text-left hover:bg-zinc-100 aria-pressed:font-semibold dark:hover:bg-white/10"
                  onClick={() => onSelect(tag, user.name ?? user.email)}
                >
                  {user.name ?? user.email}
                  {user.name && (
                    <span className="ml-2 opacity-60">{user.email}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
