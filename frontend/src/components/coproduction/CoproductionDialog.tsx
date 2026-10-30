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
  CoproductionConfirmationError,
  getCoproduction,
  saveCoproduction,
} from '@/features/coproduction/coproduction.service';
import type {
  Coproducer,
  CoproductionProduct,
} from '@/features/coproduction/types';
import { CoproductionDialogContent, CoproductionForm } from './components';

export function CoproductionDialog({
  product,
  productId,
  onClose,
}: {
  product: CoproductionProduct;
  productId: string;
  onClose: () => void;
}) {
  const close = useModalHistory({
    isOpen: true,
    onClose,
    urlKey: 'coproduction',
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
  const queryKey = ['coproduction', user?.id, product, productId];
  const query = useQuery({
    queryKey,
    queryFn: () => getCoproduction(api, product, productId),
    enabled: Boolean(user?.id),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
  });
  const save = useMutation({
    mutationFn: ({
      participants,
      mode,
    }: {
      participants: Coproducer[];
      mode?: 'OWN' | 'INHERIT';
    }) => {
      if (!query.data)
        throw new Error('Carregue a configuração antes de salvar.');
      return saveCoproduction(
        api,
        product,
        productId,
        query.data.version,
        participants,
        mode,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      toast({ type: 'success', title: 'Co-produção salva' });
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
    save.error instanceof CoproductionConfirmationError;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <CoproductionDialogContent
        description={
          product === 'plataformas'
            ? 'Defina padrão de participação das vendas desta plataforma.'
            : 'Gerencie divisão própria ou padrão da plataforma.'
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
            configurar a co-produção.
          </p>
        ) : query.isPending ? (
          <div
            aria-label="Carregando co-produção"
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
              Não foi possível carregar a co-produção. {query.error.message}
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
          <CoproductionForm
            key={`${user?.id}:${product}:${productId}:${query.data.version}:${reloadCount}`}
            initial={query.data}
            platform={product === 'plataformas'}
            allowInheritance={
              product !== 'plataformas' && query.data.mode !== undefined
            }
            ownerEmail={!user?.isAdmin ? user?.email : undefined}
            pending={save.isPending}
            blocked={conflict}
            onSave={(participants, mode) => save.mutate({ participants, mode })}
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
                  description: 'Revise as participações antes de salvar.',
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
