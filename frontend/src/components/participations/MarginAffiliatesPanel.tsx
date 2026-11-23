'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AffiliatesForm } from '@/components/affiliates/components/AffiliatesForm';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { AffiliateConfirmationError } from '@/features/affiliates/affiliates.service';
import type {
  AffiliateAgreement,
  AffiliateSaveInput,
} from '@/features/affiliates/types';
import { useAffiliatesDraft } from '@/features/affiliates/use-affiliates-draft';
import { marginWorstBps } from '@/features/margin-affiliates/margin-affiliates';
import { saveMarginAffiliates } from '@/features/margin-affiliates/margin-affiliates.service';
import type { ApiClient } from '@/services/api/api.client';
import { ApiError } from '@/services/api/types';
import { MarginAffiliateIndicator } from './MarginAffiliateIndicator';
import type { ParticipationsProduct } from './ParticipationsDialog';

/** Aba admin: afiliados pagos da margem SimIntPay, com limite próprio de 100% da margem. */
export function MarginAffiliatesPanel({
  api,
  product,
  productId,
  userId,
  margin,
  refetch,
  onPendingChange,
  onClose,
}: {
  api: ApiClient;
  product: ParticipationsProduct;
  productId: string;
  userId: string;
  margin: AffiliateAgreement;
  refetch: () => Promise<{ data?: AffiliateAgreement }>;
  onPendingChange?: (pending: boolean) => void;
  onClose: () => void;
}) {
  const platform = product === 'plataformas';
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const draftState = useAffiliatesDraft(margin, platform);
  const save = useMutation({
    mutationFn: (input: AffiliateSaveInput) =>
      saveMarginAffiliates(api, product, productId, margin.version, input),
    onMutate: () => onPendingChange?.(true),
    onSettled: () => onPendingChange?.(false),
    onSuccess: (saved) => {
      queryClient.setQueryData(
        ['margin-affiliates', userId, product, productId],
        saved,
      );
      draftState.reset(saved);
      toast({ type: 'success', title: 'Afiliados da margem salvos' });
    },
  });
  const conflict =
    (save.error instanceof ApiError && save.error.status === 409) ||
    save.error instanceof AffiliateConfirmationError;
  const worst = marginWorstBps(
    draftState.draft,
    margin.inherited?.defaultPercentageBps,
  );
  return (
    <>
      <div className="-mx-6 -mt-1">
        <MarginAffiliateIndicator bps={worst} />
      </div>
      <AffiliatesForm
        initial={margin}
        draftState={draftState}
        closeLabel="Fechar"
        platform={platform}
        margin
        pending={save.isPending}
        blocked={conflict}
        onSave={(input) => save.mutate(input)}
        onClose={onClose}
        notice={
          <>
            {save.isError && (
              <p
                role="alert"
                className="text-sm text-red-600 dark:text-red-400"
              >
                {save.error.message}
              </p>
            )}
            {conflict && (
              <Button
                variant="outline"
                className="cursor-pointer"
                onClick={async () => {
                  const result = await refetch();
                  if (result.data) {
                    draftState.reset(result.data);
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
          </>
        }
      />
    </>
  );
}
