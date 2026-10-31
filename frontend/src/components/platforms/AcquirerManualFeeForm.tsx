'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useToast } from '@/components/ui/Toast';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { FinancialNumberField } from './FinancialNumberField';

/** Lets an admin enter costs by hand for acquirers without automatic fee sync. */
export function AcquirerManualFeeForm({
  acquirer,
  method,
  channel,
  installments,
  onSaved,
}: {
  acquirer: string;
  method: string;
  channel: string;
  /** Installments missing a fee table for this acquirer/method/channel. */
  installments: number[];
  onSaved: () => void;
}) {
  const api = useClienteApi(),
    queryClient = useQueryClient(),
    { toast } = useToast();
  const [fixedCents, setFixedCents] = useState(0);
  const [ratePpm, setRatePpm] = useState(0);
  const [interestPpm, setInterestPpm] = useState(0);
  const [base, setBase] = useState<'ORIGINAL' | 'BUYER_TOTAL'>('BUYER_TOTAL');
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const credit = method === 'CREDIT_CARD';
  const save = useMutation({
    mutationFn: async () => {
      for (const count of installments)
        await api.post(`/platforms/acquirers/fees/${acquirer}`, {
          method,
          channel,
          installments: count,
          fixedCents,
          ratePpm,
          interestPpm: credit ? interestPpm : 0,
          base,
        });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-acquirers'] });
      await queryClient.invalidateQueries({
        queryKey: ['platform-simulation'],
      });
      toast({
        type: 'success',
        title: 'Taxas da adquirente salvas',
        description: 'Somente novas cobranças usam estas taxas.',
      });
      onSaved();
    },
    onError: (error: Error) =>
      toast({
        type: 'error',
        title: 'Não foi possível salvar as taxas da adquirente',
        description: error.message,
      }),
  });
  const validity = (name: string, valid: boolean) =>
    setInvalid((previous) => ({ ...previous, [name]: !valid }));
  return (
    <fieldset className="min-w-0 space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <legend className="px-2 text-sm font-semibold">
        Taxas manuais da adquirente
      </legend>
      <p className="text-xs text-zinc-500">
        Informe o custo cobrado pela adquirente
        {credit && installments.length > 1
          ? ` (aplicado às ${installments.length} parcelas sem tabela)`
          : ''}
        . Use quando a adquirente não possui sincronização automática.
      </p>
      <div
        className={`grid items-end gap-3 ${credit ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}
      >
        <FinancialNumberField
          label="Taxa fixa"
          name="acquirer-fixed"
          value={fixedCents}
          onChange={setFixedCents}
          onValidityChange={validity}
        />
        <FinancialNumberField
          rate
          label="Taxa (%)"
          name="acquirer-rate"
          value={ratePpm}
          onChange={setRatePpm}
          onValidityChange={validity}
        />
        {credit && (
          <FinancialNumberField
            rate
            label="Juros (%)"
            name="acquirer-interest"
            value={interestPpm}
            onChange={setInterestPpm}
            onValidityChange={validity}
          />
        )}
        <CustomSelect
          label="Base de cálculo"
          value={base}
          onChange={(value) => setBase(value as typeof base)}
          options={[
            { value: 'BUYER_TOTAL', label: 'Total do comprador' },
            { value: 'ORIGINAL', label: 'Valor original' },
          ]}
        />
      </div>
      <Button
        type="button"
        className="cursor-pointer"
        disabled={save.isPending || Object.values(invalid).some(Boolean)}
        onClick={() => save.mutate()}
      >
        Salvar taxas da adquirente
      </Button>
    </fieldset>
  );
}
