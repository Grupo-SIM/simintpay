'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CoproductionDialogContent } from '@/components/coproduction/components';
import { Button } from '@/components/ui/Button';
import { DialogFooter } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import {
  AffiliateConfirmationError,
  saveAffiliates,
} from '@/features/affiliates/affiliates.service';
import type { AffiliateAgreement } from '@/features/affiliates/types';
import {
  CoproductionConfirmationError,
  saveCoproduction,
} from '@/features/coproduction/coproduction.service';
import type { Coproduction } from '@/features/coproduction/types';
import { saveMarginAffiliates } from '@/features/margin-affiliates/margin-affiliates.service';
import type { MarginAgreement } from '@/features/margin-affiliates/types';
import {
  buildDraft,
  changedParts,
  newPerson,
  splitDraft,
  visiblePeople,
} from '@/features/participations/people';
import type {
  Agreements,
  ParticipationsContext,
  PersonDraft,
} from '@/features/participations/types';
import { useParticipationsDraft } from '@/features/participations/use-participations-draft';
import {
  computeTotals,
  validateDraft,
} from '@/features/participations/validate';
import type { ApiClient } from '@/services/api/api.client';
import { ApiError } from '@/services/api/types';
import { GeneralSettings } from './components/GeneralSettings';
import { InheritedList } from './components/InheritedList';
import { PeopleList } from './components/PeopleList';
import { PersonEditorDialog } from './components/PersonEditorDialog';
import { MarginAffiliateIndicator } from './MarginAffiliateIndicator';
import { ParticipationTotals } from './ParticipationTotals';
import type { ParticipationsProduct } from './ParticipationsDialog';

const LABELS = {
  co: 'Co-produção',
  aff: 'Afiliados',
  margin: 'SimIntPay',
} as const;

/** Falha numa das gravações sequenciais; guarda o que já foi salvo. */
class PartialSaveError extends Error {
  constructor(
    readonly failed: keyof typeof LABELS,
    readonly done: (keyof typeof LABELS)[],
    readonly original: unknown,
  ) {
    super(original instanceof Error ? original.message : 'Erro ao salvar.');
  }
}

const isConflict = (error: unknown) => {
  const original = error instanceof PartialSaveError ? error.original : error;
  return (
    (original instanceof ApiError && original.status === 409) ||
    original instanceof CoproductionConfirmationError ||
    original instanceof AffiliateConfirmationError
  );
};

const serverMessage = (error: Error, platform: boolean) => {
  const base = error.message;
  const text = /[.!?]$/.test(base) ? base : `${base}.`;
  const hint =
    platform && /100%/.test(base)
      ? ' Na plataforma, a soma também vale para as ofertas que já têm co-produção ou afiliados.'
      : '';
  return error instanceof PartialSaveError
    ? `${error.done.length ? `Já salvo: ${error.done.map((key) => LABELS[key]).join(', ')}. ` : ''}Falhou em ${LABELS[error.failed]}: ${text}${hint}`
    : `${text}${hint}`;
};

export function ParticipationsEditor({
  api,
  product,
  productId,
  userId,
  ownerEmail,
  coproduction,
  affiliates,
  margin,
  description,
  refetchCoproduction,
  refetchAffiliates,
  refetchMargin,
  onClose,
}: {
  api: ApiClient;
  product: ParticipationsProduct;
  productId: string;
  userId: string;
  ownerEmail?: string;
  coproduction: Coproduction;
  affiliates: AffiliateAgreement;
  /** Só para admin: coprodutores e afiliados SimIntPay. */
  margin?: MarginAgreement;
  description: string;
  refetchCoproduction: () => Promise<{ data?: Coproduction }>;
  refetchAffiliates: () => Promise<{ data?: AffiliateAgreement }>;
  refetchMargin?: () => Promise<{ data?: MarginAgreement }>;
  onClose: () => void;
}) {
  const platform = product === 'plataformas';
  const admin = Boolean(margin);
  const context = useMemo<ParticipationsContext>(
    () => ({
      platform,
      admin,
      allowInheritance: !platform && coproduction.mode !== undefined,
      ownerEmail,
    }),
    [platform, admin, coproduction.mode, ownerEmail],
  );
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [agreements, setAgreements] = useState<Agreements>({
    co: coproduction,
    aff: affiliates,
    margin,
  });
  const state = useParticipationsDraft(agreements, context);
  const { draft } = state;
  const [editing, setEditing] = useState<PersonDraft | null>(null);

  const totals = computeTotals(draft, agreements, context);
  const error = validateDraft(draft, agreements, context);
  const changed = useMemo(() => {
    if (error) return true;
    return (
      changedParts(
        splitDraft(draft, context),
        splitDraft(buildDraft(agreements, context), context),
      ).length > 0
    );
  }, [draft, agreements, context, error]);

  const save = useMutation({
    mutationFn: async () => {
      const plan = splitDraft(draft, context);
      const parts = changedParts(
        plan,
        splitDraft(buildDraft(agreements, context), context),
      );
      let current = agreements;
      const done: (keyof typeof LABELS)[] = [];
      for (const part of parts) {
        try {
          if (part === 'co') {
            const saved = await saveCoproduction(
              api,
              product,
              productId,
              current.co.version,
              plan.co.participants,
              plan.co.mode,
            );
            current = { ...current, co: saved };
            queryClient.setQueryData(
              ['coproduction', userId, product, productId],
              saved,
            );
          } else if (part === 'aff') {
            const saved = await saveAffiliates(
              api,
              product,
              productId,
              current.aff.version,
              plan.aff,
            );
            current = { ...current, aff: saved };
            queryClient.setQueryData(
              ['affiliates', userId, product, productId],
              saved,
            );
          } else if (plan.margin && current.margin) {
            const saved = await saveMarginAffiliates(
              api,
              product,
              productId,
              current.margin.version,
              plan.margin,
            );
            current = { ...current, margin: saved };
            queryClient.setQueryData(
              ['margin-affiliates', userId, product, productId],
              saved,
            );
          }
        } catch (failure) {
          setAgreements(current);
          throw new PartialSaveError(part, done, failure);
        }
        done.push(part);
      }
      setAgreements(current);
      return current;
    },
    onSuccess: (saved) => {
      state.reset(saved);
      toast({ type: 'success', title: 'Participações salvas' });
    },
  });
  const pending = save.isPending;
  const conflict = save.isError && isConflict(save.error);

  const reload = async () => {
    const [co, aff, marginResult] = await Promise.all([
      refetchCoproduction(),
      refetchAffiliates(),
      refetchMargin?.(),
    ]);
    if (!co.data || !aff.data || (refetchMargin && !marginResult?.data)) return;
    const next = { co: co.data, aff: aff.data, margin: marginResult?.data };
    setAgreements(next);
    state.reset(next);
    save.reset();
    toast({
      type: 'info',
      title: 'Configuração recarregada',
      description:
        'O rascunho foi substituído pela versão do servidor. Revise antes de salvar.',
    });
  };

  const people = visiblePeople(draft, admin);
  const inheritsWithShares =
    context.allowInheritance &&
    draft.settings.mode === 'INHERIT' &&
    people.some((person) => person.coProduct.on);
  return (
    <CoproductionDialogContent
      title="Participações"
      description={description}
      onClose={onClose}
      pending={pending}
      onEscapeKeyDown={(event) => {
        if (pending || editing) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (pending) event.preventDefault();
      }}
      toolbar={
        <>
          <ParticipationTotals result={totals.joint} />
          {totals.margin && <MarginAffiliateIndicator result={totals.margin} />}
        </>
      }
    >
      <PeopleList
        people={people}
        admin={admin}
        disabled={pending}
        defaults={{
          affiliate: draft.settings.defaultPercentage,
          margin: draft.settings.marginDefaultPercentage,
        }}
        onAdd={() => setEditing(newPerson())}
        onEdit={setEditing}
        onRemove={(person) => {
          state.removePerson(person.id);
          toast({
            type: 'info',
            title: 'Pessoa removida do rascunho',
            description: 'Salve as participações para aplicar.',
          });
        }}
      />
      {inheritsWithShares && (
        <p role="note" className="text-xs text-amber-700 dark:text-amber-400">
          Co-produção herdada da plataforma: os percentuais de coprodutor do
          rascunho não serão aplicados.
        </p>
      )}
      <InheritedList
        agreements={agreements}
        admin={admin}
        platform={platform}
      />
      <GeneralSettings
        settings={draft.settings}
        agreements={agreements}
        context={context}
        disabled={pending || conflict}
        onChange={state.patchSettings}
      />
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {save.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {serverMessage(save.error, platform)}
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
      <DialogFooter className="border-t border-zinc-200 pt-5 dark:border-white/10">
        <Button
          type="button"
          variant="outline"
          className="h-11 cursor-pointer rounded-xl border-zinc-200 disabled:cursor-not-allowed dark:border-white/10"
          disabled={pending}
          onClick={onClose}
        >
          Fechar
        </Button>
        <Button
          type="button"
          className="h-11 cursor-pointer rounded-xl border border-[#7c3aed] bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:cursor-not-allowed"
          disabled={pending || conflict || Boolean(error) || !changed}
          onClick={() => save.mutate()}
        >
          {pending ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
      {editing && (
        <PersonEditorDialog
          key={editing.id}
          initial={editing}
          draft={draft}
          agreements={agreements}
          context={context}
          linkBaseUrl={agreements.aff.linkBaseUrl}
          onSave={(person) => {
            state.savePerson(person);
            toast({
              type: 'success',
              title: 'Pessoa atualizada no rascunho',
              description: 'Salve as participações para aplicar.',
            });
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </CoproductionDialogContent>
  );
}
