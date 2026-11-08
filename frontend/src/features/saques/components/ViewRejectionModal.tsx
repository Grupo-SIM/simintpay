'use client';

import { AlertCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { Saque } from '../types/saques.types';

export function ViewRejectionModal({
  open,
  onClose,
  saque,
}: {
  open: boolean;
  onClose: () => void;
  saque: Saque | null;
}) {
  if (!saque) return null;
  const reason = saque.rejectionReason || saque.observacao;
  return (
    <Modal open={open} title="Motivo da recusa" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* info do saque */}
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/5">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-white/50">
            Valor solicitado
          </div>
          <div className="text-xl font-bold text-zinc-900 dark:text-white">
            {(saque.valorLiquido ?? saque.valor ?? 0).toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}
          </div>
          {(saque.cliente ?? saque.usuario) && (
            <div className="mt-3 flex flex-col gap-0.5 border-t border-zinc-200 pt-3 dark:border-white/5">
              <span className="text-sm font-medium text-zinc-800 dark:text-white/80">
                {(saque.cliente ?? saque.usuario)!.nome}
              </span>
              <span className="text-xs text-zinc-500 dark:text-white/40">
                {(saque.cliente ?? saque.usuario)!.email}
              </span>
            </div>
          )}
        </div>

        {/* motivo */}
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-500/20 dark:bg-red-500/5">
          <div className="mb-2 flex items-center gap-2">
            <AlertCircle
              size={15}
              className="text-red-500 dark:text-red-400 shrink-0"
            />
            <span className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
              Motivo da recusa
            </span>
          </div>
          {reason ? (
            <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
              {reason}
            </p>
          ) : (
            <p className="text-sm italic text-zinc-400 dark:text-white/30">
              Nenhum motivo foi registrado.
            </p>
          )}
        </div>

        <p className="text-xs text-zinc-500 dark:text-white/40">
          O saldo foi devolvido para a conta do usuário após a recusa.
        </p>
      </div>
    </Modal>
  );
}
