'use client';

import { useState } from 'react';
import { useTheme } from 'next-themes';
import { AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/use-current-user';
import { formatDocument } from '@/lib/utils';
import { useRequestSaque, useSaquesSummary } from '../hooks/use-saques';
import { formatBRL } from '../utils/saques-format';

export function RequestSaqueModal({
  open,
  onClose,
  summaryData,
}: {
  open: boolean;
  onClose: () => void;
  summaryData: ReturnType<typeof useSaquesSummary>['data'];
}) {
  const { toast } = useToast();
  const { mutate, isPending } = useRequestSaque();
  const { resolvedTheme } = useTheme();
  const { user } = useCurrentUser();
  const chavePix = formatDocument(user?.cpf ?? user?.cnpj);
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const [valor, setValor] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  function handleClose() {
    setValor('');
    setFormError(null);
    onClose();
  }

  function handleSubmit() {
    setFormError(null);
    const parsed = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
    if (isNaN(parsed) || parsed <= 0) {
      setFormError('Informe um valor válido.');
      return;
    }
    const minValor = summaryData
      ? summaryData.config.minValor
      : Number(process.env.NEXT_PUBLIC_SAQUE_MIN || 100);
    if (parsed < minValor) {
      setFormError(`O valor mínimo para saque é ${formatBRL(minValor)}.`);
      return;
    }
    if (summaryData && parsed > summaryData.availableBalance) {
      setFormError(
        `Saldo insuficiente. Seu saldo disponível é ${formatBRL(summaryData.availableBalance)}.`,
      );
      return;
    }
    if (!user?.cpf && !user?.cnpj) {
      setFormError('Cadastre seu CPF ou CNPJ no perfil para solicitar saques.');
      return;
    }

    mutate(
      { valor: parsed, chavePix },
      {
        onSuccess: (res) => {
          toast({
            type: 'success',
            title: 'Saque solicitado!',
            description: `Seu saque de ${formatBRL(res.data.valorBruto)} foi enviado para análise.`,
          });
          handleClose();
        },
        onError: (err: unknown) => {
          const message =
            err instanceof Error
              ? err.message
              : 'Erro ao solicitar saque. Tente novamente.';
          setFormError(message);
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      title="Solicitar saque"
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
            onClick={handleSubmit}
            disabled={isPending}
            className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
          >
            {isPending ? 'Enviando...' : 'Solicitar'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Chave Pix (CPF/CNPJ da conta)"
          type="text"
          value={chavePix}
          onChange={() => {}}
          theme={fieldTheme}
          variant={fieldTheme === 'dark' ? 'navbar' : 'default'}
          disabled
        />
        <Input
          label="Valor do saque"
          type="text"
          inputMode="numeric"
          placeholder="0,00"
          value={valor}
          onChange={setValor}
          prefix="R$"
          mask="currency"
          theme={fieldTheme}
          variant={fieldTheme === 'dark' ? 'navbar' : 'default'}
          disabled={isPending}
        />
        {summaryData ? (
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-white/40">
            <span>
              Saldo disponível: {formatBRL(summaryData.availableBalance)}
            </span>
            <button
              type="button"
              onClick={() =>
                setValor(
                  summaryData.availableBalance.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }),
                )
              }
              disabled={isPending || summaryData.availableBalance <= 0}
              className="font-semibold text-violet-600 hover:text-violet-500 disabled:opacity-50 dark:text-violet-400"
            >
              Usar saldo total
            </button>
          </div>
        ) : null}
        <p className="text-xs text-zinc-500 dark:text-white/40 text-center">
          Valor mínimo: {formatBRL(summaryData?.config?.minValor ?? 100)}
        </p>
        <div className="space-y-1 text-sm text-zinc-600 dark:text-white/55">
          <div className="space-y-1 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center justify-between text-xs">
              <span>Estimativa de recebimento:</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400">
                {formatBRL(
                  isNaN(parseFloat(valor.replace(/\./g, '').replace(',', '.')))
                    ? 0
                    : Math.max(
                        0,
                        parseFloat(valor.replace(/\./g, '').replace(',', '.')) -
                          (summaryData?.config?.taxaFixa ?? 2),
                      ),
                )}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-white/40">
              <span>Taxa de saque:</span>
              <span>{formatBRL(summaryData?.config?.taxaFixa ?? 2)}</span>
            </div>
          </div>
        </div>
        {formError ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-400" />
            <p className="text-sm text-red-400">{formError}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
