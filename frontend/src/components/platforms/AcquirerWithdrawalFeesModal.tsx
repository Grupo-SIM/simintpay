'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { FinancialNumberField } from './FinancialNumberField';

export type WithdrawalFee = {
  code: string;
  name: string;
  active: boolean;
  feeCents: number | null;
};

export const acquirerFeesPath = '/platforms/acquirers/fees/withdrawal';

export function AcquirerWithdrawalFeesModal({
  open,
  fees,
  onClose,
}: {
  open: boolean;
  fees: WithdrawalFee[];
  onClose: () => void;
}) {
  const api = useClienteApi(),
    client = useQueryClient(),
    { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const close = () => {
    setDraft({});
    setInvalid({});
    onClose();
  };
  const save = useMutation({
    mutationFn: () =>
      Promise.all(
        Object.entries(draft).map(([code, feeCents]) =>
          api.post(`${acquirerFeesPath}/${encodeURIComponent(code)}`, {
            feeCents,
          }),
        ),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ['acquirer-withdrawal-fees'],
      });
      toast({ type: 'success', title: 'Taxas de saque salvas' });
      close();
    },
    onError: () =>
      toast({ type: 'error', title: 'Falha ao salvar taxas de saque' }),
  });
  return (
    <Modal
      open={open}
      title="Taxa de saque por adquirente"
      onClose={close}
      footer={
        <button
          type="button"
          className="cursor-pointer rounded border px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={
            !Object.keys(draft).length ||
            Object.values(invalid).some(Boolean) ||
            save.isPending
          }
          onClick={() => save.mutate()}
        >
          Salvar taxas
        </button>
      }
    >
      <div className="grid gap-3">
        {fees.map((acquirer) => (
          <FinancialNumberField
            key={acquirer.code}
            name={acquirer.code}
            label={`${acquirer.name}${acquirer.active ? '' : ' (inativa)'}${
              acquirer.feeCents === null && !(acquirer.code in draft)
                ? ' — não configurada'
                : ''
            }`}
            value={draft[acquirer.code] ?? acquirer.feeCents ?? 0}
            onChange={(value) =>
              setDraft((previous) => ({ ...previous, [acquirer.code]: value }))
            }
            onValidityChange={(name, valid) =>
              setInvalid((previous) => ({ ...previous, [name]: !valid }))
            }
          />
        ))}
      </div>
    </Modal>
  );
}
