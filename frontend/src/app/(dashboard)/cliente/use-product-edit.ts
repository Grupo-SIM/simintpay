'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useClienteApi } from './_shared';

export type ClientProduct = {
  nome?: string;
  titulo?: string;
  descricao?: string | null;
  description?: string | null;
  preco?: number;
  valor?: number;
  price?: number;
  tipo?: string;
  frequencia?: number | string;
  frequencyType?: string;
  frequency_type?: string;
  parcelasMax?: number;
  aceitaCartao?: boolean;
  aceitaDebito?: boolean;
  aceitaPix?: boolean;
  paymentMethods?: 'PIX' | 'CREDIT_CARD' | 'BOTH';
  vencimentoDias?: number;
  maxUsos?: number | null;
  maxUses?: number | null;
  redirectUrl?: string | null;
  webhookUrl?: string | null;
};

/** Hydrate once per record: background refetches must never erase unsaved edits. */
export function useProductEdit(
  product: string,
  detailPath: (id: string) => string,
  hydrate: (value: ClientProduct) => void,
) {
  const id = useSearchParams().get('id');
  const api = useClienteApi();
  const { user } = useCurrentUser();
  const editKey = `${user?.id ?? ''}:${id ?? ''}`;
  const hydrateRef = useRef(hydrate);
  useEffect(() => {
    hydrateRef.current = hydrate;
  }, [hydrate]);
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['cliente-product-edit', user?.id, product, id],
    enabled: Boolean(id && user?.id),
    retry: false,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await api.get<{ data: ClientProduct }>(detailPath(id!));
      if (!response?.data) throw new Error('Produto não encontrado.');
      if (hydratedId !== editKey) {
        hydrateRef.current(response.data);
        setHydratedId(editKey);
      }
      return response.data;
    },
  });
  return {
    id,
    query,
    ready: !id || (!query.isError && hydratedId === editKey),
    loading:
      Boolean(id) &&
      (query.isPending || (!query.isError && hydratedId !== editKey)),
  };
}
