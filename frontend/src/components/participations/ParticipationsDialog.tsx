'use client';

import { useModalHistory } from '@/hooks/use-modal-history';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { CoproductionDialogContent } from '@/components/coproduction/components';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { getAffiliates } from '@/features/affiliates/affiliates.service';
import { getMarginAffiliates } from '@/features/margin-affiliates/margin-affiliates.service';
import { getCoproduction } from '@/features/coproduction/coproduction.service';
import type { CoproductionProduct } from '@/features/coproduction/types';
import { ParticipationsEditor } from './ParticipationsEditor';

export type ParticipationsProduct = Extract<
  CoproductionProduct,
  'plataformas' | 'ofertas'
>;

const queryOptions = {
  retry: false,
  gcTime: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: 'always',
} as const;

const DESCRIPTION = {
  plataformas: 'Defina quem recebe parte das vendas de toda a plataforma.',
  ofertas: 'Defina quem recebe parte das vendas desta oferta.',
} as const;

/** Um só diálogo de pessoas: coprodutores e afiliados (produto e margem) num único rascunho. */
export function ParticipationsDialog({
  product,
  productId,
  onClose,
}: {
  product: ParticipationsProduct;
  productId: string;
  onClose: () => void;
}) {
  const close = useModalHistory({
    isOpen: true,
    onClose,
    urlKey: 'participations',
    urlState: `${product}:${productId}`,
  });
  const { user, loading: userLoading } = useCurrentUser();
  const api = createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
  const coproduction = useQuery({
    queryKey: ['coproduction', user?.id, product, productId],
    queryFn: () => getCoproduction(api, product, productId),
    enabled: Boolean(user?.id),
    ...queryOptions,
  });
  const affiliates = useQuery({
    queryKey: ['affiliates', user?.id, product, productId],
    queryFn: () => getAffiliates(api, product, productId),
    enabled: Boolean(user?.id),
    ...queryOptions,
  });
  const isAdmin = Boolean(user?.isAdmin);
  const margin = useQuery({
    queryKey: ['margin-affiliates', user?.id, product, productId],
    queryFn: () => getMarginAffiliates(api, product, productId),
    enabled: Boolean(user?.id) && isAdmin,
    ...queryOptions,
  });
  const failed = coproduction.isError
    ? `Não foi possível carregar a co-produção. ${coproduction.error.message}`
    : affiliates.isError
      ? `Não foi possível carregar os afiliados. ${affiliates.error.message}`
      : margin.isError
        ? `Não foi possível carregar a margem. ${margin.error.message}`
        : null;
  const ready = coproduction.data && affiliates.data;
  const shell = (children: ReactNode) => (
    <CoproductionDialogContent
      title="Participações"
      description={DESCRIPTION[product]}
      onClose={close}
    >
      {children}
    </CoproductionDialogContent>
  );
  let content: ReactNode;
  if (!userLoading && !user)
    content = shell(
      <>
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Não foi possível identificar sua sessão. Entre novamente para
          configurar as participações.
        </p>
        <Button variant="outline" className="cursor-pointer" onClick={close}>
          Fechar
        </Button>
      </>,
    );
  else if (failed)
    content = shell(
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {failed}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => {
              if (coproduction.isError) void coproduction.refetch();
              if (affiliates.isError) void affiliates.refetch();
              if (margin.isError) void margin.refetch();
            }}
          >
            Tentar novamente
          </Button>
          <Button variant="outline" className="cursor-pointer" onClick={close}>
            Fechar
          </Button>
        </div>
      </div>,
    );
  else if (
    !coproduction.data ||
    !affiliates.data ||
    !user ||
    (isAdmin && !margin.data)
  )
    content = shell(
      <div
        aria-label="Carregando participações"
        role="status"
        className="animate-pulse space-y-4"
      >
        <div className="h-12 rounded-lg bg-zinc-200 dark:bg-white/10" />
        <div className="h-20 rounded-lg bg-zinc-200 dark:bg-white/10" />
        <div className="h-20 rounded-lg bg-zinc-200 dark:bg-white/10" />
        <div className="h-10 rounded-lg bg-zinc-200 dark:bg-white/10" />
      </div>,
    );
  else
    content = (
      <ParticipationsEditor
        api={api}
        product={product}
        productId={productId}
        userId={user.id}
        ownerEmail={!user.isAdmin ? user.email : undefined}
        coproduction={coproduction.data}
        affiliates={affiliates.data}
        margin={isAdmin ? margin.data : undefined}
        description={DESCRIPTION[product]}
        refetchCoproduction={() => coproduction.refetch()}
        refetchAffiliates={() => affiliates.refetch()}
        refetchMargin={isAdmin ? () => margin.refetch() : undefined}
        onClose={close}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {content}
    </Dialog>
  );
}
