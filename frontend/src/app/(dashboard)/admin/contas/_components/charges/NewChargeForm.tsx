'use client';
import { useTheme } from 'next-themes';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { ChargeDateField } from './ChargeDateField';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { Modal } from '@/components/ui/Modal';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/components/ui/Toast';
import { endpoints } from '@/services/api/endpoints';
import { ChargeInput } from './ChargeInput';
import { chargesApi, money } from './api';
import type { ChargeClient } from './types';

export function NewChargeForm({
  client,
  onClose,
  onSuccess,
}: {
  client?: ChargeClient;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const [mode, setMode] = useState('pagar');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [review, setReview] = useState(false);
  const { toast } = useToast();
  const cache = useQueryClient();
  const [scope, setScope] = useState<'all' | 'one'>('all');
  const [selectedId, setSelectedId] = useState('');
  // Platform balances may include external funds: resolve the actual Simintpay balance.
  const clients = useQuery({
    queryKey: ['cobrancas', 'clientes', client?.id ?? 'all'],
    queryFn: async () => {
      const found: ChargeClient[] = [];
      for (let page = 1; ; page++) {
        const result = await chargesApi().get<{
          data: ChargeClient[];
          totalPages: number;
        }>(endpoints.admin.cobrancas.clientes, {
          query: { search: client?.email, pageSize: 100, page },
        });
        found.push(...result.data);
        if (!client && page < result.totalPages) continue;
        break;
      }
      if (!client) return found;
      const own = found.find((item) => item.id === client.id);
      if (!own) throw new Error('Conta indisponível para cobrança.');
      return [own];
    },
  });
  const targets: ChargeClient[] = !clients.data
    ? []
    : client || scope === 'all'
      ? clients.data
      : clients.data.filter((item) => item.id === selectedId);
  const single = targets.length === 1 ? targets[0] : null;
  const balance = { data: single?.saldoDisponivel ?? 0 };
  const amount = Number(value.replace(/\./g, '').replace(',', '.'));
  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        itens: targets.map((target) => ({ userId: target.id, amount })),
        descricao: description.trim() || undefined,
        ...(mode === 'pagar' ? { dueDate } : {}),
      };
      if (mode === 'debitar') {
        const result = await chargesApi().post<{
          resultados: { ok: boolean; erro?: string; saldoDepois?: number }[];
        }>(endpoints.admin.cobrancas.debitar, payload);
        const failed = result.resultados.filter((item) => !item.ok);
        if (failed.length > 0)
          throw new Error(
            failed.length === 1 && targets.length === 1
              ? failed[0]?.erro || 'Débito não aplicado.'
              : `${failed.length} de ${targets.length} débitos não aplicados.`,
          );
        return single ? result.resultados[0]?.saldoDepois : undefined;
      }
      const result = await chargesApi().post<{ criadas: number }>(
        endpoints.admin.cobrancas.gerar,
        payload,
      );
      if (result.criadas !== targets.length)
        throw new Error(
          `${result.criadas} de ${targets.length} cobranças criadas.`,
        );
      return undefined;
    },
    onSuccess: (saldo) => {
      void cache.invalidateQueries({ queryKey: ['cobrancas'] });
      toast({
        type: 'success',
        title: mode === 'debitar' ? 'Débito aplicado' : 'Cobrança gerada',
        description:
          saldo !== undefined
            ? `Saldo após débito: ${money(saldo)}`
            : 'Link disponível no histórico.',
      });
      onSuccess();
      onClose();
    },
    onError: (error) =>
      toast({
        type: 'error',
        title: 'Erro ao cobrar',
        description: error.message,
      }),
  });
  const valid =
    Number.isFinite(amount) &&
    amount > 0 &&
    (mode !== 'pagar' || Boolean(dueDate)) &&
    targets.length > 0 &&
    clients.isSuccess;
  return (
    <Modal
      open
      title="Nova cobrança"
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <form
        className="space-y-4 text-zinc-900 dark:text-zinc-100"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !mutation.isPending) {
            if (mode === 'debitar' && !review) setReview(true);
            else if (mode === 'pagar') mutation.mutate();
          }
        }}
      >
        {!client && (
          <Dropdown
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            variant="navbar"
            label="Destinatário"
            value={scope}
            onChange={(value) => {
              setScope(value as 'all' | 'one');
              setReview(false);
            }}
            options={[
              { value: 'all', label: 'Todos os clientes' },
              { value: 'one', label: 'Cliente específico' },
            ]}
            portal
          />
        )}
        {!client && scope === 'one' && (
          <Dropdown
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            variant="navbar"
            label="Cliente"
            placeholder="Selecione um cliente"
            value={selectedId}
            searchable
            searchPlaceholder="Buscar por nome ou e-mail"
            onChange={(value) => {
              setSelectedId(value);
              setReview(false);
            }}
            options={(clients.data ?? []).map((item) => ({
              value: item.id,
              label: `${item.name} — ${item.email}`,
            }))}
            portal
          />
        )}
        {clients.isPending ? (
          <p className="text-sm text-zinc-500">Carregando clientes…</p>
        ) : clients.isError ? (
          <p className="text-sm text-red-500">{clients.error.message}</p>
        ) : (
          single && (
            <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
              Saldo disponível: {money(single.saldoDisponivel)}
            </p>
          )
        )}
        {clients.isError && (
          <button
            type="button"
            className="cursor-pointer rounded border px-3 py-2"
            onClick={() => void clients.refetch()}
          >
            Tentar novamente
          </button>
        )}
        <Dropdown
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          variant="navbar"
          label="Modo"
          value={mode}
          onChange={(value) => {
            setMode(value);
            setReview(false);
          }}
          options={[
            { value: 'pagar', label: 'Gerar cobrança a pagar' },
            { value: 'debitar', label: 'Debitar do saldo' },
          ]}
          portal
        />
        <ChargeInput
          label="Valor (R$)"
          required
          inputMode="numeric"
          prefix="R$"
          placeholder="50,00"
          value={value}
          onValueChange={(raw) => {
            const digits = raw.replace(/\D/g, '');
            setValue(
              digits
                ? (Number(digits) / 100).toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : '',
            );
            setReview(false);
          }}
        />
        <ChargeInput
          label="Descrição"
          placeholder="Ex: Mensalidade de outubro"
          value={description}
          onValueChange={setDescription}
        />
        {mode === 'pagar' && (
          <ChargeDateField
            label="Vencimento"
            required
            value={dueDate}
            onChange={setDueDate}
          />
        )}
        {mode === 'debitar' && valid && single && (
          <p
            className={`rounded-lg border p-3 text-sm ${balance.data - amount < 0 ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300'}`}
          >
            Saldo após débito: {money(balance.data - amount)}.{' '}
            {balance.data - amount < 0 && 'Conta ficará com saldo negativo.'}{' '}
            {review &&
              'Débito imediato, sem desfazer automático. Confira antes de confirmar.'}
          </p>
        )}
        {mode === 'debitar' && valid && !single && review && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            Débito imediato em {targets.length} contas, sem desfazer automático.
            Contas podem ficar com saldo negativo.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <ActionButton
            type="button"
            disabled={mutation.isPending}
            onClick={onClose}
            className="cursor-pointer"
          >
            Descartar
          </ActionButton>
          <span>
            {mode === 'debitar' && review ? (
              <ConfirmActionButton
                variant="outline"
                className="h-10 cursor-pointer rounded-full border-violet-500/30 bg-violet-500/10 px-4 text-violet-700 dark:text-violet-300"
                type="button"
                label="Aplicar débito"
                confirmation="Débito imediato e sem desfazer. Confirmar?"
                confirmContent="Confirmar débito"
                disabled={!valid || mutation.isPending}
                onConfirm={() => mutation.mutate()}
              >
                Aplicar débito
              </ConfirmActionButton>
            ) : (
              <ActionButton
                type="submit"
                variant="primary"
                disabled={!valid || mutation.isPending}
                className="cursor-pointer disabled:cursor-not-allowed"
              >
                {mutation.isPending
                  ? 'Salvando…'
                  : mode === 'debitar'
                    ? 'Revisar débito'
                    : 'Salvar'}
              </ActionButton>
            )}
          </span>
        </div>
      </form>
    </Modal>
  );
}
