'use client';

import { Plus } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/Button';
import { DialogFooter } from '@/components/ui/Dialog';
import { FormSwitch } from '@/components/ui/FormSwitch';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { useToast } from '@/components/ui/Toast';
import {
  formatPercentage,
  maskPercentage,
  serializeAffiliates,
  validateAffiliates,
} from '@/features/affiliates/affiliates';
import type {
  AffiliateAgreement,
  AffiliateSaveInput,
} from '@/features/affiliates/types';
import type { AffiliatesDraftState } from '@/features/affiliates/use-affiliates-draft';
import { AffiliateRow } from './AffiliateRow';

const field =
  'h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:cursor-not-allowed dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:placeholder:text-zinc-500';

export function AffiliatesForm({
  initial,
  draftState,
  extraError = null,
  closeLabel = 'Descartar',
  platform,
  pending,
  blocked,
  ownerEmail,
  onSave,
  onClose,
}: {
  initial: AffiliateAgreement;
  draftState: AffiliatesDraftState;
  /** Erro da validação conjunta com a outra aba; bloqueia o salvar. */
  extraError?: string | null;
  closeLabel?: string;
  platform: boolean;
  pending: boolean;
  blocked: boolean;
  ownerEmail?: string;
  onSave: (input: AffiliateSaveInput) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const globalId = useId();
  const linkId = useId();
  const { draft, patch, addRow, updateRow, removeRow } = draftState;
  const inherited = initial.inherited;
  const error = validateAffiliates(draft, {
    ownerEmail,
    platform,
    inheritedDefaultBps: inherited?.defaultPercentageBps,
  });
  const disabled = pending || blocked;
  const overlapping = (inherited?.affiliates ?? []).filter((row) =>
    draft.rows.some(
      (own) => own.code === row.code || (own.name && own.name === row.name),
    ),
  );
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={globalId} className="text-sm font-medium">
            Percentual global
          </label>
          <div className="flex h-11 items-center rounded-md border border-zinc-200 bg-white focus-within:border-[#7c3aed] focus-within:ring-2 focus-within:ring-[#7c3aed]/20 dark:border-white/10 dark:bg-white/5">
            <input
              id={globalId}
              type="text"
              name="affiliate-default-percentage"
              inputMode="decimal"
              disabled={disabled}
              placeholder={
                !platform && inherited?.defaultPercentageBps
                  ? `${formatPercentage(inherited.defaultPercentageBps)} (plataforma)`
                  : 'Ex: 10'
              }
              value={draft.defaultPercentage}
              onChange={(event) =>
                patch({
                  defaultPercentage: maskPercentage(event.currentTarget.value),
                })
              }
              className="min-w-0 w-full bg-transparent py-2 pl-3 text-sm outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed dark:placeholder:text-zinc-500"
            />
            <span className="pr-3 text-sm text-zinc-500 dark:text-zinc-400">
              %
            </span>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Vale para quem não tem percentual próprio.
          </p>
        </div>
        {platform && (
          <div className="space-y-1.5">
            <label htmlFor={linkId} className="text-sm font-medium">
              Link base
            </label>
            <input
              id={linkId}
              type="url"
              name="affiliate-link-base"
              disabled={disabled}
              placeholder="https://sualoja.com.br"
              value={draft.linkBaseUrl}
              onChange={(event) =>
                patch({ linkBaseUrl: event.currentTarget.value })
              }
              className={field}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Gera o link pronto com <code>?aff=CÓDIGO</code>.
            </p>
          </div>
        )}
      </div>
      <div className="space-y-2 rounded-xl border border-violet-500/20 p-4">
        <p className="text-sm font-medium">Comissão nas renovações</p>
        {platform ? (
          <div className="flex items-center gap-3 text-sm">
            <FormSwitch
              aria-label="Comissão nas renovações"
              checked={draft.renewals !== 'first'}
              onChange={(on) => patch({ renewals: on ? 'all' : 'first' })}
            />
            <span>
              {draft.renewals !== 'first'
                ? 'Todas as renovações geram comissão.'
                : 'Só a primeira compra gera comissão.'}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(
              [
                [
                  'platform',
                  `Usar a da plataforma${inherited ? ` (${inherited.commissionOnRenewals ? 'todas' : 'só a primeira compra'})` : ''}`,
                ],
                ['all', 'Todas as renovações'],
                ['first', 'Só a primeira compra'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant="outline"
                className="h-auto min-h-9 max-w-full cursor-pointer whitespace-normal text-left"
                aria-pressed={draft.renewals === value}
                disabled={disabled}
                onClick={() => patch({ renewals: value })}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <ScrollArea className="max-h-[40vh]">
        {draft.rows.length ? (
          <ul className="space-y-2">
            {draft.rows.map((row) => (
              <AffiliateRow
                key={row.id}
                row={row}
                disabled={disabled}
                linkBaseUrl={initial.linkBaseUrl}
                onChange={updateRow}
                onRemove={() => {
                  removeRow(row.id);
                  toast({
                    type: 'info',
                    title: 'Afiliado removido do rascunho',
                    description: 'Salve os afiliados para aplicar.',
                  });
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 dark:border-white/20 dark:text-zinc-400">
            Sem afiliados {platform ? 'na plataforma' : 'na oferta'}.
          </p>
        )}
      </ScrollArea>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full cursor-pointer rounded-xl border-[#7c3aed]/30 bg-transparent text-[#7c3aed] hover:bg-[#7c3aed]/10 disabled:cursor-not-allowed dark:bg-transparent dark:text-[#a78bfa] dark:hover:bg-[#7c3aed]/10"
        disabled={disabled}
        onClick={addRow}
      >
        <Plus className="h-4 w-4" />
        Adicionar afiliado
      </Button>
      {inherited && inherited.affiliates.length > 0 && (
        <section
          aria-label="Afiliados herdados da plataforma"
          className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-white/10"
        >
          <h3 className="text-sm font-semibold">
            Afiliados da plataforma (somente leitura)
          </h3>
          <ul className="space-y-1 text-sm">
            {inherited.affiliates.map((row) => (
              <li key={row.code}>
                {row.name} — {formatPercentage(row.percentageBps)}%{' '}
                <span className="font-mono text-xs text-zinc-500">
                  {row.code}
                </span>
              </li>
            ))}
          </ul>
          {overlapping.length > 0 && (
            <p
              role="note"
              className="text-xs text-amber-700 dark:text-amber-400"
            >
              {overlapping.map((row) => row.name).join(', ')}: o percentual da
              oferta vale em vez do da plataforma.
            </p>
          )}
        </section>
      )}
      {(error ?? extraError) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error ?? extraError}
        </p>
      )}
      <DialogFooter className="border-t border-zinc-200 pt-5 dark:border-white/10">
        <Button
          type="button"
          variant="outline"
          className="h-11 cursor-pointer rounded-xl border-zinc-200 disabled:cursor-not-allowed dark:border-white/10"
          disabled={pending}
          onClick={onClose}
        >
          {closeLabel}
        </Button>
        <Button
          type="button"
          className="h-11 cursor-pointer rounded-xl border border-[#7c3aed] bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:cursor-not-allowed"
          disabled={disabled || Boolean(error ?? extraError)}
          onClick={() => onSave(serializeAffiliates(draft, platform))}
        >
          {pending ? 'Salvando...' : 'Salvar afiliados'}
        </Button>
      </DialogFooter>
    </>
  );
}
