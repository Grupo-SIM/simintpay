'use client';

import { useModalHistory } from '@/hooks/use-modal-history';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { ApiError } from '@/services/api/types';
import {
  AffiliateConfirmationError,
  getAffiliates,
  saveAffiliates,
} from '@/features/affiliates/affiliates.service';
import type {
  AffiliateProduct,
  AffiliateSaveInput,
} from '@/features/affiliates/types';
import { CoproductionDialogContent } from '@/components/coproduction/components';
import { AffiliatesForm } from './components/AffiliatesForm';

export function AffiliatesDialog({
  product,
  productId,
  onClose,
}: {
  product: AffiliateProduct;
  productId: string;
  onClose: () => void;
}) {
  const close = useModalHistory({
    isOpen: true,
    onClose,
    urlKey: 'affiliates',
    urlState: `${product}:${productId}`,
  });
  const [reloadCount, setReloadCount] = useState(0);
  const { user, loading: userLoading } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const api = createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
  const platform = product === 'plataformas';
  const queryKey = ['affiliates', user?.id, product, productId];
  const query = useQuery({
    queryKey,
    queryFn: () => getAffiliates(api, product, productId),
    enabled: Boolean(user?.id),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
  });
  const save = useMutation({
    mutationFn: (input: AffiliateSaveInput) => {
      if (!query.data)
        throw new Error('Carregue a configuração antes de salvar.');
      return saveAffiliates(api, product, productId, query.data.version, input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      toast({ type: 'success', title: 'Afiliados salvos' });
      close();
    },
    onError: (error: Error) =>
      toast({
        type: 'error',
        title: 'Não foi possível salvar',
        description: error.message,
      }),
  });
  const conflict =
    (save.error instanceof ApiError && save.error.status === 409) ||
    save.error instanceof AffiliateConfirmationError;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <CoproductionDialogContent
        title="Afiliados"
        description={
          platform
            ? 'Defina quem recebe comissão pelas vendas de toda a plataforma.'
            : 'Defina afiliados desta oferta, somados aos da plataforma.'
        }
        onClose={close}
        pending={save.isPending}
        onEscapeKeyDown={(event) => {
          if (save.isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (save.isPending) event.preventDefault();
        }}
      >
        {!userLoading && !user ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Não foi possível identificar sua sessão. Entre novamente para
            configurar os afiliados.
          </p>
        ) : query.isPending ? (
          <div
            aria-label="Carregando afiliados"
            role="status"
            className="animate-pulse space-y-4"
          >
            <div className="h-12 rounded-lg bg-zinc-200 dark:bg-white/10" />
            <div className="h-20 rounded-lg bg-zinc-200 dark:bg-white/10" />
            <div className="h-20 rounded-lg bg-zinc-200 dark:bg-white/10" />
            <div className="h-10 rounded-lg bg-zinc-200 dark:bg-white/10" />
          </div>
        ) : query.isError ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              Não foi possível carregar os afiliados. {query.error.message}
            </p>
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={() => void query.refetch()}
            >
              Tentar novamente
            </Button>
          </div>
        ) : query.data ? (
          <AffiliatesForm
            key={`${user?.id}:${product}:${productId}:${query.data.version}:${reloadCount}`}
            initial={query.data}
            platform={platform}
            ownerEmail={!user?.isAdmin ? user?.email : undefined}
            pending={save.isPending}
            blocked={conflict}
            onSave={(input) => save.mutate(input)}
            onClose={close}
          />
        ) : null}
        {save.isError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {save.error.message}
          </p>
        )}
        {conflict && (
          <Button
            variant="outline"
            className="cursor-pointer"
            disabled={query.isFetching}
            onClick={async () => {
              const result = await query.refetch();
              if (result.isSuccess) {
                setReloadCount((count) => count + 1);
                save.reset();
                toast({
                  type: 'info',
                  title: 'Configuração recarregada',
                  description:
                    'O rascunho foi substituído pela versão do servidor. Revise antes de salvar.',
                });
              }
            }}
          >
            Recarregar configuração
          </Button>
        )}
        {(query.isPending || query.isError || !user) && (
          <Button variant="outline" className="cursor-pointer" onClick={close}>
            Fechar
          </Button>
        )}
      </CoproductionDialogContent>
    </Dialog>
  );
}
