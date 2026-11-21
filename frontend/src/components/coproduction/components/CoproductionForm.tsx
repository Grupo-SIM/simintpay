'use client';

import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DialogFooter } from '@/components/ui/Dialog';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { useToast } from '@/components/ui/Toast';
import {
  formatPercentage,
  serializeParticipants,
  validateParticipants,
} from '@/features/coproduction/coproduction';
import type { CoproductionRowsDraft } from '@/features/coproduction/use-coproduction-rows';
import type { Coproducer, Coproduction } from '@/features/coproduction/types';
import { CoproducerRow } from './CoproducerRow';

export function CoproductionForm({
  initial,
  draft,
  extraError = null,
  closeLabel = 'Descartar',
  notice,
  pending,
  blocked,
  ownerEmail,
  saveLabel = 'Salvar co-produção',
  onSave,
  onClose,
  allowInheritance = false,
  platform = false,
}: {
  initial: Coproduction;
  draft: CoproductionRowsDraft;
  /** Erro da validação conjunta com a outra aba; bloqueia o salvar. */
  extraError?: string | null;
  closeLabel?: string;
  /** Erro do servidor e recarga, logo acima dos botões. */
  notice?: ReactNode;
  pending: boolean;
  blocked: boolean;
  ownerEmail?: string;
  saveLabel?: string;
  allowInheritance?: boolean;
  platform?: boolean;
  onSave: (participants: Coproducer[], mode?: 'OWN' | 'INHERIT') => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { rows, setRows, mode, setMode } = draft;
  const inherited = allowInheritance && mode === 'INHERIT';
  const error = inherited ? null : validateParticipants(rows, ownerEmail);
  return (
    <>
      {allowInheritance && (
        <div className="space-y-3 rounded-xl border border-violet-500/20 p-4">
          <p className="text-sm">
            {inherited
              ? 'Padrão da plataforma: aplicado às novas cobranças. A plataforma efetiva da venda determina a divisão.'
              : 'Configuração própria: prevalece sobre a plataforma. Lista vazia desativa o repasse.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              aria-pressed={inherited}
              disabled={pending || blocked}
              onClick={() => {
                setMode('INHERIT');
                toast({
                  type: 'info',
                  title: 'Herança selecionada no rascunho',
                  description: 'Salve para aplicar.',
                });
              }}
            >
              Usar padrão da plataforma
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-pressed={!inherited}
              disabled={pending || blocked}
              onClick={() => {
                setMode('OWN');
                toast({
                  type: 'info',
                  title: 'Configuração própria selecionada',
                });
              }}
            >
              Configuração própria
            </Button>
          </div>
          {inherited && (
            <ul className="text-sm">
              {(initial.mode === 'INHERIT' &&
              initial.effective?.participants.length
                ? initial.effective.participants
                : []
              ).map((row) => (
                <li key={row.email}>
                  {row.name ?? row.email} —{' '}
                  {formatPercentage(row.percentageBps)}%
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {platform && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          No Delivery, a divisão é sobre os itens, sem frete nem taxas.
        </p>
      )}
      {!inherited && (
        <ScrollArea className="max-h-[40vh]">
          {rows.length ? (
            <ul className="space-y-2">
              {rows.map((row) => (
                <CoproducerRow
                  key={row.id}
                  row={row}
                  disabled={pending || blocked}
                  onChange={(next) =>
                    setRows((previous) =>
                      previous.map((item) =>
                        item.id === next.id ? next : item,
                      ),
                    )
                  }
                  onRemove={() => {
                    setRows((previous) =>
                      previous.filter((item) => item.id !== row.id),
                    );
                    toast({
                      type: 'info',
                      title: 'Participação removida do rascunho',
                      description: 'Salve a co-produção para aplicar.',
                    });
                  }}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 dark:border-white/20 dark:text-zinc-400">
              Sem coprodutores. O proprietário recebe 100% do líquido.
            </p>
          )}
        </ScrollArea>
      )}
      {!inherited && (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full cursor-pointer rounded-xl border-[#7c3aed]/30 bg-transparent text-[#7c3aed] hover:bg-[#7c3aed]/10 disabled:cursor-not-allowed dark:bg-transparent dark:text-[#a78bfa] dark:hover:bg-[#7c3aed]/10"
          disabled={pending || blocked}
          onClick={() =>
            setRows((previous) => [
              ...previous,
              { id: crypto.randomUUID(), email: '', percentage: '' },
            ])
          }
        >
          <Plus className="h-4 w-4" />
          Adicionar coprodutor
        </Button>
      )}
      {(error ?? extraError) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error ?? extraError}
        </p>
      )}
      {notice}
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
          disabled={pending || blocked || Boolean(error ?? extraError)}
          onClick={() =>
            onSave(
              inherited ? [] : serializeParticipants(rows),
              allowInheritance || platform ? mode : undefined,
            )
          }
        >
          {pending ? 'Salvando...' : saveLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
