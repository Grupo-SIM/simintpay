'use client';

import { useState } from 'react';
import { useTheme } from 'next-themes';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/ui/DataTable';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import {
  useAcquirerWithdrawals,
  useCreateAcquirerWithdrawal,
  useDeleteAcquirerWithdrawal,
  useUpdateAcquirerWithdrawal,
  useWithdrawalFeeAcquirers,
  type AcquirerWithdrawal,
} from '../hooks/use-acquirer-withdrawals';
import { formatCents, formatYmd, todayYmdSaoPaulo } from '../utils/ymd';
import { SingleDatePickerField } from './SingleDatePickerField';

const CANCEL_BUTTON_CLASS =
  'rounded-xl px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 disabled:opacity-50 dark:text-white/60 dark:hover:text-white/90';
const PRIMARY_BUTTON_CLASS =
  'rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60';

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function centsFromMasked(value: string): number | null {
  const digits = value.replace(/\D+/g, '');
  const cents = digits ? parseInt(digits, 10) : 0;
  return cents > 0 ? cents : null;
}

function maskedFromCents(cents: number | null | undefined): string {
  return cents
    ? (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    : '';
}

function useFieldTheme(): 'light' | 'dark' {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? 'dark' : 'light';
}

export function RegisterAcquirerWithdrawalModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fieldTheme = useFieldTheme();
  const { data: acquirers = [], isPending: loadingAcquirers } =
    useWithdrawalFeeAcquirers();
  const { mutate, isPending } = useCreateAcquirerWithdrawal();
  const [acquirerCode, setAcquirerCode] = useState('');
  const [date, setDate] = useState(() => todayYmdSaoPaulo());
  const [amount, setAmount] = useState('');
  const today = todayYmdSaoPaulo();

  function handleClose() {
    setAcquirerCode('');
    setAmount('');
    setDate(todayYmdSaoPaulo());
    onClose();
  }

  function handleSubmit() {
    if (!acquirerCode) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Selecione a adquirente.',
      });
      return;
    }
    if (!date || date > today) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe uma data válida (não pode ser futura).',
      });
      return;
    }
    mutate(
      {
        acquirerCode,
        date,
        ...(centsFromMasked(amount)
          ? { amountCents: centsFromMasked(amount) as number }
          : {}),
      },
      {
        onSuccess: () => {
          toast({
            type: 'success',
            title: 'Saque de adquirente registrado',
            description: `Registrado em ${formatYmd(date)}.`,
          });
          handleClose();
        },
        onError: (err) =>
          toast({
            type: 'error',
            title: 'Erro',
            description: errorMessage(err, 'Erro ao registrar saque.'),
          }),
      },
    );
  }

  return (
    <Modal
      open={open}
      title="Registrar novo saque"
      onClose={handleClose}
      footer={
        <>
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className={CANCEL_BUTTON_CLASS}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !acquirerCode}
            className={PRIMARY_BUTTON_CLASS}
          >
            {isPending ? 'Registrando...' : 'Registrar'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-zinc-600 dark:text-white/55">
          Registra o custo de um saque realizado na adquirente, usando a taxa de
          saque configurada para ela.
        </p>
        <Dropdown
          label="Adquirente:"
          placeholder={
            loadingAcquirers ? 'Carregando...' : 'Selecione a adquirente'
          }
          value={acquirerCode}
          onChange={setAcquirerCode}
          theme={fieldTheme}
          variant="navbar"
          disabled={isPending || loadingAcquirers}
          options={acquirers.map((a) => ({
            value: a.code,
            label:
              a.feeCents === null
                ? `${a.name} — sem taxa configurada`
                : `${a.name} — ${formatCents(a.feeCents)}`,
            selectedLabel: a.name,
            disabled: a.feeCents === null,
          }))}
        />
        <SingleDatePickerField
          label="Data do saque:"
          value={date}
          onChange={setDate}
          max={today}
          theme={fieldTheme}
          disabled={isPending}
        />
        <Input
          label="Valor sacado (opcional):"
          type="text"
          inputMode="numeric"
          placeholder="0,00"
          value={amount}
          onChange={setAmount}
          prefix="R$"
          mask="currency"
          theme={fieldTheme}
          variant={fieldTheme === 'dark' ? 'navbar' : 'default'}
          disabled={isPending}
        />
      </div>
    </Modal>
  );
}

function EditAcquirerWithdrawalDateModal({
  withdrawal,
  onClose,
}: {
  withdrawal: AcquirerWithdrawal | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fieldTheme = useFieldTheme();
  const { mutate, isPending } = useUpdateAcquirerWithdrawal();
  const [date, setDate] = useState(withdrawal?.date ?? '');
  const [amount, setAmount] = useState(
    maskedFromCents(withdrawal?.amountCents),
  );
  const today = todayYmdSaoPaulo();

  function handleSubmit() {
    if (!withdrawal) return;
    if (!date || date > today) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe uma data válida (não pode ser futura).',
      });
      return;
    }
    mutate(
      { id: withdrawal.id, date, amountCents: centsFromMasked(amount) },
      {
        onSuccess: () => {
          toast({
            type: 'success',
            title: 'Saque atualizado',
            description: `Saque agora em ${formatYmd(date)}.`,
          });
          onClose();
        },
        onError: (err) =>
          toast({
            type: 'error',
            title: 'Erro',
            description: errorMessage(err, 'Erro ao atualizar saque.'),
          }),
      },
    );
  }

  return (
    <Modal
      open={withdrawal !== null}
      title="Editar saque"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className={CANCEL_BUTTON_CLASS}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              isPending ||
              !date ||
              (date === withdrawal?.date &&
                centsFromMasked(amount) === (withdrawal?.amountCents ?? null))
            }
            className={PRIMARY_BUTTON_CLASS}
          >
            {isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-zinc-600 dark:text-white/55">
          {withdrawal?.acquirerName} — {formatCents(withdrawal?.feeCents)}
        </p>
        <SingleDatePickerField
          label="Data do saque:"
          value={date}
          onChange={setDate}
          max={today}
          theme={fieldTheme}
          disabled={isPending}
        />
        <Input
          label="Valor sacado (opcional):"
          type="text"
          inputMode="numeric"
          placeholder="0,00"
          value={amount}
          onChange={setAmount}
          prefix="R$"
          mask="currency"
          theme={fieldTheme}
          variant={fieldTheme === 'dark' ? 'navbar' : 'default'}
          disabled={isPending}
        />
      </div>
    </Modal>
  );
}

function DeleteAcquirerWithdrawalModal({
  withdrawal,
  onClose,
}: {
  withdrawal: AcquirerWithdrawal | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { mutate, isPending } = useDeleteAcquirerWithdrawal();

  function handleConfirm() {
    if (!withdrawal) return;
    mutate(withdrawal.id, {
      onSuccess: () => {
        toast({
          type: 'success',
          title: 'Saque de adquirente removido',
          description: 'O registro foi excluído.',
        });
        onClose();
      },
      onError: (err) =>
        toast({
          type: 'error',
          title: 'Erro',
          description: errorMessage(err, 'Erro ao excluir saque.'),
        }),
    });
  }

  return (
    <Modal
      open={withdrawal !== null}
      title="Excluir saque de adquirente"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className={CANCEL_BUTTON_CLASS}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
            className="rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? 'Excluindo...' : 'Excluir'}
          </button>
        </>
      }
    >
      <p className="text-sm text-zinc-600 dark:text-white/55">
        Deseja excluir o saque de {withdrawal?.acquirerName} (
        {formatCents(withdrawal?.feeCents)}) de {formatYmd(withdrawal?.date)}?
        Esta ação não pode ser desfeita.
      </p>
    </Modal>
  );
}

export function AcquirerWithdrawalsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: rows = [], isPending } = useAcquirerWithdrawals();
  const [registering, setRegistering] = useState(false);
  const [editing, setEditing] = useState<AcquirerWithdrawal | null>(null);
  const [deleting, setDeleting] = useState<AcquirerWithdrawal | null>(null);

  // Mais recentes primeiro (data do saque, depois criação).
  const sorted = [...rows].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <Modal
      open={open}
      title="Saques de adquirente"
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Custos de saque registrados por adquirente
          </p>
          <button
            type="button"
            onClick={() => setRegistering(true)}
            className={`${PRIMARY_BUTTON_CLASS} flex items-center gap-1.5`}
          >
            <Plus size={15} />
            Registrar novo saque
          </button>
        </div>
        <DataTable
          columns={[
            {
              key: 'acquirer',
              header: 'Adquirente',
              render: (row: AcquirerWithdrawal) => (
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {row.acquirerName}
                </span>
              ),
            },
            {
              key: 'amount',
              header: 'Valor',
              render: (row: AcquirerWithdrawal) => (
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {row.amountCents ? formatCents(row.amountCents) : '—'}
                </span>
              ),
            },
            {
              key: 'cost',
              header: 'Custo',
              render: (row: AcquirerWithdrawal) => (
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatCents(row.feeCents)}
                </span>
              ),
            },
            {
              key: 'date',
              header: 'Data',
              render: (row: AcquirerWithdrawal) => (
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {formatYmd(row.date)}
                </span>
              ),
            },
            {
              key: 'actions',
              header: 'Ações',
              render: (row: AcquirerWithdrawal) => (
                <div className="flex items-center justify-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditing(row)}
                    className="rounded-lg p-1.5 text-violet-600 transition-colors hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-500/10"
                    title="Editar"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                    title="Excluir"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ),
            },
          ]}
          rows={sorted}
          loading={isPending}
          page={1}
          pageSize={Math.max(sorted.length, 1)}
          total={sorted.length}
          onPageChange={() => {}}
          emptyTitle="Nenhum saque de adquirente"
          emptyDescription="Use “Registrar novo saque” para adicionar o primeiro."
          minWidth="min-w-[620px]"
        />
      </div>
      <RegisterAcquirerWithdrawalModal
        open={registering}
        onClose={() => setRegistering(false)}
      />
      <EditAcquirerWithdrawalDateModal
        key={editing?.id ?? 'none'}
        withdrawal={editing}
        onClose={() => setEditing(null)}
      />
      <DeleteAcquirerWithdrawalModal
        withdrawal={deleting}
        onClose={() => setDeleting(null)}
      />
    </Modal>
  );
}
