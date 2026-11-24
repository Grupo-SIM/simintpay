'use client';

import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { formatPercentage } from '@/features/coproduction/coproduction';
import type { Coproduction } from '@/features/coproduction/types';

/** Modo da co-produção da oferta: própria ou herdada da plataforma. */
export function InheritanceField({
  mode,
  initial,
  disabled,
  onChange,
}: {
  mode: 'OWN' | 'INHERIT';
  initial: Coproduction;
  disabled: boolean;
  onChange: (mode: 'OWN' | 'INHERIT') => void;
}) {
  const { toast } = useToast();
  const inherited = mode === 'INHERIT';
  return (
    <div className="space-y-3 rounded-xl border border-violet-500/20 p-4">
      <p className="text-sm">
        {inherited
          ? 'Co-produção: padrão da plataforma, aplicado às novas cobranças. A plataforma efetiva da venda determina a divisão.'
          : 'Co-produção própria: prevalece sobre a plataforma. Sem coprodutores, desativa o repasse.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer disabled:cursor-not-allowed"
          aria-pressed={inherited}
          disabled={disabled}
          onClick={() => {
            onChange('INHERIT');
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
          className="cursor-pointer disabled:cursor-not-allowed"
          aria-pressed={!inherited}
          disabled={disabled}
          onClick={() => {
            onChange('OWN');
            toast({ type: 'info', title: 'Configuração própria selecionada' });
          }}
        >
          Configuração própria
        </Button>
      </div>
      {inherited && (
        <ul className="text-sm">
          {(initial.mode === 'INHERIT' && initial.effective?.participants.length
            ? initial.effective.participants
            : []
          ).map((row) => (
            <li key={row.email}>
              {row.name ?? row.email} — {formatPercentage(row.percentageBps)}%
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
