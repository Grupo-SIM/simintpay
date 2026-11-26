'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Dialog, DialogFooter } from '@/components/ui/Dialog';
import { CoproducerAccountSelect } from '@/components/coproduction/components/CoproducerAccountSelect';
import { CoproductionDialogContent } from '@/components/coproduction/components';
import { affiliateLink } from '@/features/affiliates/affiliates';
import { formatPercentage } from '@/features/coproduction/coproduction';
import {
  emailKey,
  hasShare,
  upsertPerson,
} from '@/features/participations/people';
import type {
  Agreements,
  ParticipationsContext,
  ParticipationsDraft,
  PersonDraft,
  ShareKey,
} from '@/features/participations/types';
import { validateDraft } from '@/features/participations/validate';
import { useModalHistory } from '@/hooks/use-modal-history';
import { PersonShareSection } from './PersonShareSection';

/**
 * Submodal de uma pessoa: qualquer combinação das quatro participações, cada uma com liga/desliga
 * e percentual próprio. Descartar fecha sem alterar o rascunho; Salvar aplica à lista.
 */
export function PersonEditorDialog({
  initial,
  draft,
  agreements,
  context,
  linkBaseUrl,
  onSave,
  onClose,
}: {
  initial: PersonDraft;
  draft: ParticipationsDraft;
  agreements: Agreements;
  context: ParticipationsContext;
  /** Link base já salvo na plataforma; o link só aparece para afiliado persistido. */
  linkBaseUrl?: string | null;
  onSave: (person: PersonDraft) => void;
  onClose: () => void;
}) {
  const isNew = !initial.email;
  const close = useModalHistory({
    isOpen: true,
    onClose,
    urlKey: 'participations-person',
    urlState: initial.id,
  });
  const [person, setPerson] = useState(initial);
  const { admin, platform } = context;
  const inheritsCo =
    context.allowInheritance && draft.settings.mode === 'INHERIT';
  const set = (key: ShareKey) => (share: PersonDraft[ShareKey]) =>
    setPerson((previous) => ({ ...previous, [key]: share }));
  const duplicate =
    isNew &&
    Boolean(person.email) &&
    draft.people.some(
      (item) => emailKey(item.email) === emailKey(person.email),
    );
  const error = !person.email
    ? null
    : duplicate
      ? 'Esta pessoa já está na lista. Edite a entrada existente.'
      : !hasShare(person, admin)
        ? 'Ative ao menos uma participação.'
        : validateDraft(upsertPerson(draft, person), agreements, context);
  const canSave = Boolean(person.email) && !error;
  const defaultAff = draft.settings.defaultPercentage;
  const inheritedAff = agreements.aff.inherited?.defaultPercentageBps;
  const marginDefault = draft.settings.marginDefaultPercentage;
  const inheritedMargin = agreements.margin?.inherited?.defaultPercentageBps;
  const fallback = (own: string, inherited?: number | null) =>
    own
      ? `Padrão global: ${own}%`
      : !platform && inherited
        ? `Padrão da plataforma: ${formatPercentage(inherited)}%`
        : 'Sem padrão global: informe o percentual';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <CoproductionDialogContent
        title={isNew ? 'Adicionar pessoa' : 'Editar pessoa'}
        description={
          isNew
            ? 'Escolha a conta e ligue as participações que ela recebe.'
            : (person.name ?? person.email)
        }
        onClose={close}
      >
        {isNew ? (
          <CoproducerAccountSelect
            label="Pessoa"
            email={person.email}
            name={person.name}
            disabled={false}
            onChange={(account) =>
              setPerson((previous) => ({
                ...previous,
                email: account.email,
                name: account.name,
              }))
            }
          />
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {person.email}
          </p>
        )}
        <PersonShareSection
          title="Coprodutor · Produto"
          description="Parte do líquido da venda."
          name="person-co-product"
          share={person.coProduct}
          placeholder="Ex: 25,50"
          disabled={inheritsCo}
          onChange={set('coProduct')}
        />
        {inheritsCo && (
          <p role="note" className="text-xs text-zinc-500 dark:text-zinc-400">
            Co-produção herdada da plataforma: troque para configuração própria
            nas configurações gerais para editar.
          </p>
        )}
        <PersonShareSection
          title="Afiliado · Produto"
          description="Comissão sobre o líquido das vendas indicadas."
          name="person-aff-product"
          share={person.affProduct}
          placeholder="Usar padrão global"
          hint={fallback(defaultAff, inheritedAff)}
          onChange={set('affProduct')}
        >
          {person.code ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <span>
                Código: <strong className="font-mono">{person.code}</strong>
              </span>
              <CopyButton
                value={person.code}
                label="Copiar código"
                className="px-2 py-1 text-xs"
              />
              {linkBaseUrl && (
                <CopyButton
                  value={affiliateLink(linkBaseUrl, person.code)}
                  label="Copiar link"
                  className="px-2 py-1 text-xs"
                />
              )}
            </div>
          ) : (
            person.email && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                O código é gerado ao salvar.
              </p>
            )
          )}
        </PersonShareSection>
        {admin && (
          <>
            <PersonShareSection
              title="Coprodutor · SimIntPay"
              description="Parte da margem (taxas menos custo do adquirente)."
              name="person-co-margin"
              share={person.coMargin}
              placeholder="Ex: 20"
              note={
                person.affMargin.on ? (
                  <p
                    role="note"
                    className="text-xs text-amber-700 dark:text-amber-400"
                  >
                    Coprodutor e afiliado SimIntPay: a pessoa recebe uma vez só
                    por venda, como coprodutora.
                  </p>
                ) : undefined
              }
              onChange={set('coMargin')}
            />
            <PersonShareSection
              title="Afiliado · SimIntPay"
              description="Comissão paga da margem, fora da divisão do líquido."
              name="person-aff-margin"
              share={person.affMargin}
              placeholder="Usar padrão global"
              hint={fallback(marginDefault, inheritedMargin)}
              onChange={set('affMargin')}
            />
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <DialogFooter className="border-t border-zinc-200 pt-5 dark:border-white/10">
          <Button
            type="button"
            variant="outline"
            className="h-11 cursor-pointer rounded-xl border-zinc-200 dark:border-white/10"
            onClick={close}
          >
            Descartar
          </Button>
          <Button
            type="button"
            className="h-11 cursor-pointer rounded-xl border border-[#7c3aed] bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:cursor-not-allowed"
            disabled={!canSave}
            onClick={() => {
              onSave(person);
              close();
            }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </CoproductionDialogContent>
    </Dialog>
  );
}
