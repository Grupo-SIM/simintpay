'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CoproductionDialogContent } from '@/components/coproduction/components';
import { CoproductionForm } from '@/components/coproduction/components/CoproductionForm';
import { AffiliatesForm } from '@/components/affiliates/components/AffiliatesForm';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import {
  AffiliateConfirmationError,
  saveAffiliates,
} from '@/features/affiliates/affiliates.service';
import type {
  AffiliateAgreement,
  AffiliateSaveInput,
} from '@/features/affiliates/types';
import { useAffiliatesDraft } from '@/features/affiliates/use-affiliates-draft';
import {
  CoproductionConfirmationError,
  saveCoproduction,
} from '@/features/coproduction/coproduction.service';
import type { Coproducer, Coproduction } from '@/features/coproduction/types';
import { useCoproductionRows } from '@/features/coproduction/use-coproduction-rows';
import {
  affiliatesFromDraft,
  coproducersFromRows,
  jointMessage,
  jointTotal,
} from '@/features/participations/joint';
import type { ApiClient } from '@/services/api/api.client';
import { ApiError } from '@/services/api/types';
import { ParticipationTotals } from './ParticipationTotals';
import type { ParticipationsProduct } from './ParticipationsDialog';

type Tab = 'coproduction' | 'affiliates';
const TABS: { id: Tab; label: string }[] = [
  { id: 'coproduction', label: 'Co-produção' },
  { id: 'affiliates', label: 'Afiliados' },
];

const isConflict = (
  error: unknown,
  confirmation: abstract new (...args: never[]) => Error,
) =>
  (error instanceof ApiError && error.status === 409) ||
  error instanceof confirmation;

const serverMessage = (message: string, platform: boolean) => {
  const text = /[.!?]$/.test(message) ? message : `${message}.`;
  return platform && /100%/.test(message)
    ? `${text} Na plataforma, a soma também vale para as ofertas que já têm co-produção ou afiliados.`
    : text;
};

export function ParticipationsEditor({
  api,
  product,
  productId,
  userId,
  ownerEmail,
  coproduction,
  affiliates,
  description,
  refetchCoproduction,
  refetchAffiliates,
  onClose,
}: {
  api: ApiClient;
  product: ParticipationsProduct;
  productId: string;
  userId: string;
  ownerEmail?: string;
  coproduction: Coproduction;
  affiliates: AffiliateAgreement;
  description: string;
  refetchCoproduction: () => Promise<{ data?: Coproduction }>;
  refetchAffiliates: () => Promise<{ data?: AffiliateAgreement }>;
  onClose: () => void;
}) {
  const platform = product === 'plataformas';
  const allowInheritance = !platform && coproduction.mode !== undefined;
  const [tab, setTab] = useState<Tab>('coproduction');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const coRows = useCoproductionRows(coproduction, allowInheritance);
  const affDraft = useAffiliatesDraft(affiliates, platform);

  const inheritsCo = allowInheritance && coRows.mode === 'INHERIT';
  const joint = jointTotal({
    coproducers: inheritsCo
      ? (coproduction.effective?.source
          ? coproduction.effective.participants
          : []
        ).map((row) => ({
          email: row.email,
          name: row.name,
          bps: row.percentageBps,
        }))
      : coproducersFromRows(coRows.rows),
    coproducerLevel: platform || inheritsCo ? 'platform' : 'offer',
    affiliates: affiliatesFromDraft(
      affDraft.draft,
      affiliates.inherited,
      platform,
    ),
  });
  const jointError = jointMessage(joint);

  const coSave = useMutation({
    mutationFn: ({
      participants,
      mode,
    }: {
      participants: Coproducer[];
      mode?: 'OWN' | 'INHERIT';
    }) =>
      saveCoproduction(
        api,
        product,
        productId,
        coproduction.version,
        participants,
        mode,
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(
        ['coproduction', userId, product, productId],
        saved,
      );
      coRows.reset(saved);
      toast({ type: 'success', title: 'Co-produção salva' });
    },
  });
  const affSave = useMutation({
    mutationFn: (input: AffiliateSaveInput) =>
      saveAffiliates(api, product, productId, affiliates.version, input),
    onSuccess: (saved) => {
      queryClient.setQueryData(
        ['affiliates', userId, product, productId],
        saved,
      );
      affDraft.reset(saved);
      toast({ type: 'success', title: 'Afiliados salvos' });
    },
  });
  const pending = coSave.isPending || affSave.isPending;
  const coConflict = isConflict(coSave.error, CoproductionConfirmationError);
  const affConflict = isConflict(affSave.error, AffiliateConfirmationError);

  const status = (
    mutation: { isError: boolean; error: Error | null },
    reload: () => Promise<void>,
    conflict: boolean,
  ) => (
    <>
      {mutation.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {serverMessage(mutation.error?.message ?? '', platform)}
        </p>
      )}
      {conflict && (
        <Button
          variant="outline"
          className="cursor-pointer"
          onClick={() => void reload()}
        >
          Recarregar configuração
        </Button>
      )}
    </>
  );
  const reloaded = (description: string) =>
    toast({ type: 'info', title: 'Configuração recarregada', description });

  return (
    <CoproductionDialogContent
      title="Participações"
      description={description}
      onClose={onClose}
      pending={pending}
      onEscapeKeyDown={(event) => {
        if (pending) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (pending) event.preventDefault();
      }}
      toolbar={
        <>
          <div
            role="tablist"
            aria-label="Tipo de participação"
            className="grid shrink-0 grid-cols-2 gap-1 border-b border-zinc-200 px-6 pt-3 dark:border-white/10"
          >
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                id={`participations-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls={`participations-panel-${id}`}
                className={`-mb-px cursor-pointer rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold ${
                  tab === id
                    ? 'border-[#7c3aed] text-[#7c3aed] dark:text-[#a78bfa]'
                    : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <ParticipationTotals result={joint} />
        </>
      }
    >
      <div
        role="tabpanel"
        id="participations-panel-coproduction"
        aria-labelledby="participations-tab-coproduction"
        hidden={tab !== 'coproduction'}
        className="space-y-5"
      >
        <CoproductionForm
          initial={coproduction}
          draft={coRows}
          extraError={jointError}
          closeLabel="Fechar"
          platform={platform}
          allowInheritance={allowInheritance}
          ownerEmail={ownerEmail}
          pending={coSave.isPending}
          blocked={coConflict}
          onSave={(participants, mode) => coSave.mutate({ participants, mode })}
          onClose={onClose}
          notice={status(
            coSave,
            async () => {
              const result = await refetchCoproduction();
              if (result.data) {
                coRows.reset(result.data);
                coSave.reset();
                reloaded('Revise as participações antes de salvar.');
              }
            },
            coConflict,
          )}
        />
      </div>
      <div
        role="tabpanel"
        id="participations-panel-affiliates"
        aria-labelledby="participations-tab-affiliates"
        hidden={tab !== 'affiliates'}
        className="space-y-5"
      >
        <AffiliatesForm
          initial={affiliates}
          draftState={affDraft}
          extraError={jointError}
          closeLabel="Fechar"
          platform={platform}
          ownerEmail={ownerEmail}
          pending={affSave.isPending}
          blocked={affConflict}
          onSave={(input) => affSave.mutate(input)}
          onClose={onClose}
          notice={status(
            affSave,
            async () => {
              const result = await refetchAffiliates();
              if (result.data) {
                affDraft.reset(result.data);
                affSave.reset();
                reloaded(
                  'O rascunho foi substituído pela versão do servidor. Revise antes de salvar.',
                );
              }
            },
            affConflict,
          )}
        />
      </div>
    </CoproductionDialogContent>
  );
}
