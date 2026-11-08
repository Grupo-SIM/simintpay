'use client';

import { useState } from 'react';
import { Receipt, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useUpdateSaqueReceipt } from '../hooks/use-saques';
import type { Saque } from '../types/saques.types';

export function UpdateReceiptModal({
  open,
  onClose,
  saque,
}: {
  open: boolean;
  onClose: () => void;
  saque: Saque | null;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { mutate, isPending } = useUpdateSaqueReceipt();

  function handleClose() {
    setFile(null);
    onClose();
  }

  function handleConfirm() {
    if (!saque || !file) return;
    mutate(
      { id: saque.id, file },
      {
        onSuccess: () => {
          toast({
            type: 'success',
            title: 'Comprovante atualizado',
            description: 'A imagem foi salva com sucesso.',
          });
          handleClose();
        },
        onError: (err) => {
          toast({
            type: 'error',
            title: 'Erro',
            description: err.message || 'Erro ao atualizar comprovante',
          });
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      title={
        saque?.comprovante || saque?.receiptImage
          ? 'Trocar comprovante'
          : 'Adicionar comprovante'
      }
      onClose={handleClose}
      footer={
        <>
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 disabled:opacity-50 dark:text-white/60 dark:hover:text-white/90"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending || !file}
            className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-zinc-600 dark:text-white/55">
          Selecione a imagem ou PDF do comprovante. Ela ficará disponível para o
          cliente visualizar.
        </p>
        <div className="group relative">
          <input
            type="file"
            id="update-receipt-upload"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) setFile(e.target.files[0]);
            }}
            accept="image/*,.pdf"
          />
          <label
            htmlFor="update-receipt-upload"
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
              setIsDragging(false);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragging(false);
            }}
            className={cn(
              'flex h-36 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all select-none',
              isDragging
                ? 'border-violet-400 bg-violet-50 dark:border-violet-500/70 dark:bg-violet-500/10'
                : file
                  ? 'border-emerald-400/70 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-500/5'
                  : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20',
            )}
          >
            {file ? (
              <div className="flex flex-col items-center space-y-2">
                <div className="rounded-full bg-emerald-500/20 p-2 text-emerald-600 dark:text-emerald-400">
                  <Receipt size={22} />
                </div>
                <span className="max-w-[200px] truncate text-xs font-medium text-zinc-800 dark:text-white/90">
                  {file.name}
                </span>
                <span className="text-[10px] text-zinc-500 dark:text-white/40">
                  Clique para trocar
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center space-y-2">
                <div className="rounded-full bg-zinc-200 p-2 text-zinc-500 dark:bg-white/10 dark:text-white/40">
                  <Upload size={22} />
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
    </Modal>
  );
}
