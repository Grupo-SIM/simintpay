'use client';

import { useState, type ChangeEvent, type DragEvent } from 'react';
import { useTheme } from 'next-themes';
import { Download, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useApproveSaque, useRejectSaque } from '../hooks/use-saques';
import type { Saque } from '../types/saques.types';
import { formatBRL } from '../utils/saques-format';

export function AdminActionsModal({
  open,
  onClose,
  saque,
  type,
}: {
  open: boolean;
  onClose: () => void;
  saque: Saque | null;
  type: 'APPROVE' | 'REJECT';
}) {
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';
  const approveMutation = useApproveSaque();
  const rejectMutation = useRejectSaque();
  const [motivo, setMotivo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isPending = approveMutation.isPending || rejectMutation.isPending;

  const handleConfirm = () => {
    if (!saque) return;
    if (type === 'APPROVE') {
      approveMutation.mutate(
        { id: saque.id, receiptImage: file || undefined },
        {
          onSuccess: () => {
            toast({
              type: 'success',
              title: 'Sucesso',
              description: 'Saque aprovado com sucesso',
            });
            setFile(null);
            onClose();
          },
          onError: (err) => {
            toast({
              type: 'error',
              title: 'Erro',
              description: err.message || 'Erro ao aprovar saque',
            });
          },
        },
      );
    } else {
      if (!motivo.trim()) {
        toast({
          type: 'error',
          title: 'Erro',
          description: 'Informe o motivo da rejeição',
        });
        return;
      }
      rejectMutation.mutate(
        { id: saque.id, motivo: motivo.trim() },
        {
          onSuccess: () => {
            toast({
              type: 'success',
              title: 'Sucesso',
              description: 'Saque rejeitado com sucesso',
            });
            setMotivo('');
            onClose();
          },
          onError: (err) => {
            toast({
              type: 'error',
              title: 'Erro',
              description: err.message || 'Erro ao rejeitar saque',
            });
          },
        },
      );
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };

  const handleDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  return (
    <Modal
      open={open}
      title={type === 'APPROVE' ? 'Aprovar saque' : 'Negar saque'}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 disabled:opacity-50 dark:text-white/60 dark:hover:text-white/90"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending || (type === 'REJECT' && !motivo.trim())}
            className={cn(
              'rounded-xl px-5 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
              type === 'APPROVE'
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-red-600 hover:bg-red-500',
            )}
          >
            {isPending
              ? 'Processando...'
              : type === 'APPROVE'
                ? 'Aprovar'
                : 'Negar'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/5">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-white/50">
            A pagar (Líquido)
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-white">
            {formatBRL(saque?.valorLiquido ?? saque?.valor)}
          </div>
          {saque?.valorBruto && (
            <div className="mt-1 text-xs text-zinc-500 dark:text-white/40">
              Total retirado da carteira: {formatBRL(saque.valorBruto)}
            </div>
          )}
          {(saque?.cliente ?? saque?.usuario) && (
            <div className="mt-3 flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-white/5">
              <span className="text-sm font-medium text-zinc-800 dark:text-white/80">
                {(saque.cliente ?? saque.usuario)!.nome}
              </span>
              <span className="text-xs text-zinc-500 dark:text-white/40">
                {(saque.cliente ?? saque.usuario)!.email}
              </span>
            </div>
          )}
        </div>

        {type === 'APPROVE' ? (
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-white/50">
              Comprovante de Pagamento
            </label>
            <div className="group relative">
              <input
                type="file"
                id="file-upload"
                className="hidden"
                onChange={handleFileChange}
                accept="image/*,.pdf"
              />
              <label
                htmlFor="file-upload"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                className={cn(
                  'flex h-36 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all select-none',
                  isDragging
                    ? 'border-violet-400 bg-violet-50 scale-[1.01] dark:border-violet-500/70 dark:bg-violet-500/10'
                    : file
                      ? 'border-emerald-400/70 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-500/5'
                      : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20 dark:hover:bg-white/[0.07]',
                )}
              >
                {isDragging ? (
                  <div className="flex flex-col items-center space-y-2 pointer-events-none">
                    <div className="rounded-full bg-violet-500/20 p-3 text-violet-600 dark:text-violet-400">
                      <Download size={26} className="animate-bounce" />
                    </div>
                    <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">
                      Solte para anexar
                    </span>
                  </div>
                ) : file ? (
                  <div className="flex flex-col items-center space-y-2">
                    <div className="rounded-full bg-emerald-500/20 p-2 text-emerald-600 dark:text-emerald-400">
                      <Receipt size={24} />
                    </div>
                    <span className="max-w-[200px] truncate text-xs font-medium text-zinc-800 dark:text-white/90">
                      {file.name}
                    </span>
                    <span className="text-[10px] text-zinc-500 dark:text-white/40">
                      Clique para trocar · arraste para substituir
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center space-y-2">
                    <div className="rounded-full bg-zinc-200 p-2 text-zinc-500 group-hover:text-zinc-700 dark:bg-white/10 dark:text-white/40 dark:group-hover:text-white/60">
                      <Download size={24} />
                    </div>
                    <span className="text-xs text-zinc-600 dark:text-white/60">
                      Arraste ou clique para selecionar
                    </span>
                    <span className="text-[10px] text-zinc-400 dark:text-white/30">
                      PNG, JPG ou PDF
                    </span>
                  </div>
                )}
              </label>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-white/50">
              Motivo da rejeição <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={4}
              placeholder="Descreva o motivo da recusa. Este texto ficará visível para o usuário..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={isPending}
              className={[
                'w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors',
                'placeholder:text-zinc-400 dark:placeholder:text-white/25',
                motivo.trim()
                  ? 'border-zinc-300 dark:border-white/15'
                  : 'border-red-400/60 dark:border-red-500/40',
                fieldTheme === 'dark'
                  ? 'border-white/10 bg-white/5 text-white focus:border-violet-400/50 focus:ring-2 focus:ring-violet-300/10'
                  : 'border-zinc-200 bg-white text-zinc-900 focus:border-violet-400 focus:ring-2 focus:ring-violet-200',
                'disabled:opacity-50',
              ].join(' ')}
            />
            {!motivo.trim() && (
              <p className="text-[11px] text-red-400">
                Campo obrigatório para negar o saque.
              </p>
            )}
          </div>
        )}
        <p className="text-sm text-zinc-600 dark:text-white/55">
          {type === 'APPROVE'
            ? 'Ao aprovar, o saldo será debitado e o comprovante ficará disponível para o usuário.'
            : 'Ao negar um saque, o saldo retornará para a conta do usuário.'}
        </p>
      </div>
    </Modal>
  );
}
