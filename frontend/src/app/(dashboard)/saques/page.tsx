'use client';

import {
  useState,
  Suspense,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import {
  isComprovantePdfUrl,
  resolveComprovanteUrl,
} from '@/features/saques/utils/comprovante-url';
import { getDefaultApiBaseUrl } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  ArrowUpRight,
  Clock,
  AlertCircle,
  Wallet,
  DollarSign,
  ArrowDownLeft,
  Receipt,
  Download,
  Eye,
  EyeOff,
  Upload,
  Search,
  Eraser,
} from 'lucide-react';

import { cn, negativeMoneyClass } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { Dropdown } from '@/components/ui/Dropdown';
import { Spinner } from '@/components/ui/Loading';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { ActionButton } from '../relatorio/components/ActionButton';
import { DateRangePickerField } from '../relatorio/components/DateRangePickerField';
import type { DateRange } from '../relatorio/types';

import {
  useSaques,
  useSaquesAdmin,
  usePendingSaque,
  useRequestSaque,
  useApproveSaque,
  useRejectSaque,
  useSaquesSummary,
  useUpdateSaqueReceipt,
  useToggleComprovanteVisivel,
} from '@/features/saques/hooks/use-saques';
import { useCurrentUser } from '@/hooks/use-current-user';
import type {
  Saque,
  RequestSaqueResult,
} from '@/features/saques/types/saques.types';
import {
  buildAdminDateRangeParam,
  filterSaquesByDateRange,
  normalizeDateFilterRange,
  parseDateRangeFromYmd,
  parseQueryDate,
  resolveYmdDateFilter,
  toLocalYmd,
} from '@/features/saques/utils/date-filter';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(value: number | undefined | null) {
  const v = Number(value ?? 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(value: string | undefined | null) {
  if (!value || value === '0000-00-00' || value === '0000-00-00 00:00:00')
    return '-';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    if (year === '0000') return '-';
    return `${day}/${month}/${year}`;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR');
}

function mapStatusLabel(status: string) {
  const s = (status ?? '').toUpperCase();
  if (s === 'PAGO' || s === 'COMPLETED') return 'Pago';
  if (s === 'APROVADO' || s === 'APROVADA' || s === 'APPROVED')
    return 'Aprovado';
  if (s === 'PENDENTE' || s === 'PENDING') return 'Pendente';
  if (
    s === 'REJEITADO' ||
    s === 'REJECTED' ||
    s === 'RECUSADO' ||
    s === 'RECUSADA'
  )
    return 'Recusado';
  return status ?? '-';
}

function mapStatusBadgeValue(status: string) {
  const s = (status ?? '').toUpperCase();
  if (
    s === 'PAGO' ||
    s === 'APROVADO' ||
    s === 'APROVADA' ||
    s === 'APPROVED' ||
    s === 'COMPLETED'
  )
    return 'APPROVED';
  if (s === 'PENDENTE' || s === 'PENDING') return 'PENDING';
  if (
    s === 'REJEITADO' ||
    s === 'REJECTED' ||
    s === 'RECUSADO' ||
    s === 'RECUSADA'
  )
    return 'REJECTED';
  return 'DEFAULT';
}

/** Só pendente pode ser confirmado/negado pelo admin; já aprovado ou pago não. */
function isSaqueAguardandoAcaoAdmin(status: string) {
  const s = (status ?? '').toUpperCase();
  return s === 'PENDENTE' || s === 'PENDING';
}

const TABLE_PAGE_SIZE = 20;
/** Busca mais itens quando há filtro de data para filtrar no cliente se a API ignorar o parâmetro. */
const DATE_FILTER_FETCH_SIZE = 500;

// ── Rejection tooltip ─────────────────────────────────────────────────────────

function RejectionTooltip({
  children,
  reason,
}: {
  children: React.ReactNode;
  reason: string;
}) {
  // Portal com position:fixed — o tooltip ficava dentro do overflow-auto da tabela
  // e era cortado pelas linhas vizinhas; via portal ele sobrepõe tudo.
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const mostrar = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top - 8, left: r.left + r.width / 2 });
  };

  return (
    <div
      ref={anchorRef}
      className="inline-flex"
      onMouseEnter={mostrar}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              transform: 'translate(-50%, -100%)',
              zIndex: 9999,
            }}
            className={[
              'pointer-events-none w-60',
              'rounded-xl border border-zinc-700/60 bg-zinc-900 px-3 py-2.5 shadow-xl',
              'dark:border-white/10 dark:bg-zinc-800',
            ].join(' ')}
          >
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-400">
              Motivo da recusa
            </p>
            <p className="text-xs leading-relaxed text-zinc-100">{reason}</p>
            <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-zinc-900 dark:border-t-zinc-800" />
          </div>,
          document.body,
        )}
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────

function RequestSaqueModal({
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
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const [valor, setValor] = useState('');
  const [chavePix, setChavePix] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  function handleClose() {
    setValor('');
    setChavePix('');
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
    if (!chavePix.trim()) {
      setFormError('Informe sua chave Pix.');
      return;
    }

    mutate(
      { valor: parsed, chavePix: chavePix.trim() },
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
        <div className="space-y-1 text-sm text-zinc-600 dark:text-white/55">
          <p>Informe o valor e sua chave Pix para solicitar a transferência.</p>
          <div className="mt-1 space-y-1 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
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
        <Input
          label="Valor do saque (Total a retirar da carteira)"
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
        <Input
          label="Chave Pix"
          type="text"
          placeholder="CPF, e-mail, telefone ou chave aleatória"
          value={chavePix}
          onChange={setChavePix}
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
          Valor mínimo: {formatBRL(summaryData?.config?.minValor ?? 100)} ·
          Taxa: {formatBRL(summaryData?.config?.taxaFixa ?? 2)}
        </p>
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

function AdminActionsModal({
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
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

function ViewReceiptModal({
  open,
  onClose,
  saqueId,
  hintUrl,
}: {
  open: boolean;
  onClose: () => void;
  saqueId: string | null;
  /** URL original (banco) — só para inferir PDF quando o Content-Type vier genérico. */
  hintUrl: string | null;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  const receiptKey = `${open}:${saqueId ?? ''}`;
  const [previousReceiptKey, setPreviousReceiptKey] = useState(receiptKey);
  if (receiptKey !== previousReceiptKey) {
    setPreviousReceiptKey(receiptKey);
    setBlobUrl(null);
    setContentType(null);
    setLoading(Boolean(open && saqueId));
    setError(false);
  }

  useEffect(() => {
    if (!open || !saqueId) {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      return;
    }

    let cancelled = false;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    const base = getDefaultApiBaseUrl().replace(/\/$/, '');
    const url = `${base}${endpoints.saque.comprovante(saqueId)}`;
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('access_token')
        : null;

    (async () => {
      try {
        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct =
          res.headers.get('content-type')?.split(';')[0]?.trim() ?? null;
        const blob = await res.blob();
        if (cancelled) return;
        const u = URL.createObjectURL(blob);
        blobUrlRef.current = u;
        setContentType(ct);
        setBlobUrl(u);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [open, saqueId]);

  const hintResolved = hintUrl ? resolveComprovanteUrl(hintUrl) : '';
  const isPdf =
    (contentType?.toLowerCase().includes('pdf') ?? false) ||
    (hintUrl ? isComprovantePdfUrl(hintResolved) : false);
  const isImage =
    (contentType?.toLowerCase().startsWith('image/') ?? false) ||
    (!contentType && hintUrl && !isComprovantePdfUrl(hintResolved));

  if (!saqueId) return null;

  return (
    <Modal
      open={open}
      title="Visualizar Comprovante"
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/3">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Spinner size={36} />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Carregando comprovante…
            </p>
          </div>
        ) : error ? (
          <div className="flex max-w-md flex-col items-center gap-4 px-4 py-8 text-center">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Não foi possível carregar o comprovante. Verifique se você tem
              permissão e se o backend está atualizado (rota autenticada{' '}
              <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-white/10">
                GET /saques/:id/comprovante
              </code>
              ).
            </p>
          </div>
        ) : blobUrl && isPdf ? (
          <iframe
            src={blobUrl}
            className="h-[600px] w-full rounded-xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-zinc-950"
            title="PDF Comprovante"
          />
        ) : blobUrl && isImage ? (
          <img
            src={blobUrl}
            alt="Comprovante"
            className="max-h-[70vh] max-w-full rounded-xl border border-zinc-200 bg-white object-contain shadow-lg dark:border-white/10 dark:bg-transparent dark:shadow-2xl"
          />
        ) : blobUrl ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Formato não suportado para visualização (
              {contentType ?? 'desconhecido'}). Use baixar.
            </p>
            <a
              href={blobUrl}
              download="comprovante"
              className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
            >
              <Download size={16} />
              Baixar arquivo
            </a>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function ViewRejectionModal({
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

function UpdateReceiptModal({
  open,
  onClose,
  saque,
}: {
  open: boolean;
  onClose: () => void;
  saque: Saque | null;
}) {
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
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

async function handleForceDownload(
  saqueId: string | null,
  storedUrl: string,
  filename: string,
) {
  const base = getDefaultApiBaseUrl().replace(/\/$/, '');
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  if (saqueId) {
    try {
      const res = await fetch(
        `${base}${endpoints.saque.comprovante(saqueId)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (res.ok) {
        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
        return;
      }
    } catch {
      /* fallback */
    }
  }
  const resolved = resolveComprovanteUrl(storedUrl);
  try {
    const res = await fetch(resolved);
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch {
    const link = document.createElement('a');
    link.href = resolved;
    link.target = '_blank';
    link.download = filename;
    link.click();
  }
}

// ── Main Page Content ────────────────────────────────────────────────────────

function SaquesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const [page, setPage] = useState(() => Number(searchParams.get('page') ?? 1));
  const [statusFilter, setStatusFilter] = useState(
    () => searchParams.get('status') ?? 'all',
  );
  const [moduloFilter, setModuloFilter] = useState(
    () => searchParams.get('search') ?? '',
  );
  const [dateRange, setDateRange] = useState<DateRange>(() =>
    parseDateRangeFromYmd(
      searchParams.get('dataInicio') || undefined,
      searchParams.get('dataFim') || undefined,
    ),
  );
  const [modalOpen, setModalOpen] = useState(false);

  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [selectedSaque, setSelectedSaque] = useState<Saque | null>(null);
  const [adminActionType, setAdminActionType] = useState<'APPROVE' | 'REJECT'>(
    'APPROVE',
  );

  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [selectedReceiptSaqueId, setSelectedReceiptSaqueId] = useState<
    string | null
  >(null);
  const [selectedReceiptUrl, setSelectedReceiptUrl] = useState<string | null>(
    null,
  );

  const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
  const [selectedRejectionSaque, setSelectedRejectionSaque] =
    useState<Saque | null>(null);

  const [updateReceiptOpen, setUpdateReceiptOpen] = useState(false);
  const [selectedUpdateSaque, setSelectedUpdateSaque] = useState<Saque | null>(
    null,
  );

  const toggleVisibilMutation = useToggleComprovanteVisivel();
  const { toast } = useToast();

  const { user, loading: userLoading } = useCurrentUser();
  const isAdmin = user?.isAdmin ?? false;

  const { data: pendingData } = usePendingSaque();
  const { data: summaryData } = useSaquesSummary();
  const hasPending = pendingData?.temPendente ?? false;

  // Sync state with searchParams for UX consistency (e.g. back button)
  const searchKey = searchParams.toString();
  const [previousSearchKey, setPreviousSearchKey] = useState(searchKey);
  if (searchKey !== previousSearchKey) {
    setPreviousSearchKey(searchKey);
    setPage(Number(searchParams.get('page') ?? 1));
    setStatusFilter(searchParams.get('status') ?? 'all');
    setModuloFilter(searchParams.get('search') ?? '');
    setDateRange(
      parseDateRangeFromYmd(
        searchParams.get('dataInicio') || undefined,
        searchParams.get('dataFim') || undefined,
      ),
    );
  }

  const updateUrl = useCallback(
    (params: Record<string, string | number | undefined | Date | null>) => {
      const urlParams = new URLSearchParams(searchParams.toString());
      Object.entries(params).forEach(([k, v]) => {
        if (v instanceof Date) {
          urlParams.set(k, toLocalYmd(v));
        } else if (v != null && v !== '') {
          urlParams.set(k, String(v));
        } else {
          urlParams.delete(k);
        }
      });
      if (Object.keys(params).some((k) => k !== 'page')) {
        urlParams.delete('page');
        urlParams.set('page', '1');
      }
      router.push(`${pathname}?${urlParams.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const queryParams = useMemo(() => {
    const { dataInicio, dataFim } = resolveYmdDateFilter(
      searchParams.get('dataInicio') || undefined,
      searchParams.get('dataFim') || undefined,
    );
    const hasDateFilter = !!(dataInicio || dataFim);
    const start = parseQueryDate(dataInicio ?? null);
    const end = parseQueryDate(dataFim ?? null);
    return {
      page: hasDateFilter ? 1 : Number(searchParams.get('page') ?? 1),
      pageSize: hasDateFilter ? DATE_FILTER_FETCH_SIZE : TABLE_PAGE_SIZE,
      status: (searchParams.get('status') as Saque['status']) || undefined,
      dataInicio,
      dataFim,
      dateRange: buildAdminDateRangeParam(start, end),
    };
  }, [searchParams]);

  const adminQueryParams = useMemo(
    () => ({
      ...queryParams,
      search: searchParams.get('search') || undefined,
    }),
    [queryParams, searchParams],
  );

  const userQuery = useSaques(queryParams, {
    enabled: !userLoading && !isAdmin,
  });
  const adminQuery = useSaquesAdmin(adminQueryParams, {
    enabled: !userLoading && isAdmin,
  });

  const { data, isPending } = isAdmin ? adminQuery : userQuery;

  const tableView = useMemo(() => {
    const rows = data?.data ?? [];
    const { start, end } = parseDateRangeFromYmd(
      searchParams.get('dataInicio') || undefined,
      searchParams.get('dataFim') || undefined,
    );
    const hasDateFilter = !!(start || end);

    if (!hasDateFilter) {
      return {
        rows,
        page: data?.page ?? 1,
        total: data?.total ?? 0,
        pageSize: TABLE_PAGE_SIZE,
      };
    }

    const filtered = filterSaquesByDateRange(rows, start, end);
    const currentPage = Number(searchParams.get('page') ?? 1);
    const startIdx = (currentPage - 1) * TABLE_PAGE_SIZE;
    return {
      rows: filtered.slice(startIdx, startIdx + TABLE_PAGE_SIZE),
      page: currentPage,
      total: filtered.length,
      pageSize: TABLE_PAGE_SIZE,
    };
  }, [data, searchParams]);

  const availableBalance = user?.wallet?.netBalance ?? 0;
  const lockedBalance = user?.wallet?.lockedBalance ?? 0;

  const columns = useMemo(() => {
    const cols = [
      {
        key: 'criadoEm',
        header: 'Data',
        render: (row: Saque) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatDate(row.criadoEm)}
          </span>
        ),
      },
      {
        key: 'usuario_nome',
        header: 'Nome/Plataforma',
        render: (row: Saque) => (
          <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {(row.cliente ?? row.usuario)?.nome ?? '---'}
          </span>
        ),
      },
      {
        key: 'usuario_email',
        header: 'Email',
        render: (row: Saque) => (
          <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
            {(row.cliente ?? row.usuario)?.email ?? '---'}
          </span>
        ),
      },
      {
        key: 'valor',
        header: 'Valor solicitado',
        render: (row: Saque) => (
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {formatBRL(row.valor)}
          </span>
        ),
      },
      {
        key: 'valorAReceber',
        header: 'Valor a receber',
        render: (row: Saque) => {
          const taxaTotal = row.taxas?.total ?? row.taxa ?? 0;
          const net =
            taxaTotal > 0
              ? row.valor - taxaTotal
              : (row.valorLiquido ?? row.valor);
          return (
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {formatBRL(net)}
            </span>
          );
        },
      },
      {
        key: 'chavePix',
        header: 'Chave PIX',
        render: (row: Saque) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {row.chavePix ?? '---'}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row: Saque) => {
          const badge = (
            <Badge value={mapStatusBadgeValue(row.status)}>
              {mapStatusLabel(row.status)}
            </Badge>
          );
          const isRejected = [
            'REJEITADO',
            'REJECTED',
            'RECUSADO',
            'RECUSADA',
          ].includes((row.status ?? '').toUpperCase());
          const motivo = row.rejectionReason || row.observacao;
          if (isRejected && motivo) {
            return <RejectionTooltip reason={motivo}>{badge}</RejectionTooltip>;
          }
          return badge;
        },
      },
      {
        key: 'comprovante',
        header: 'Nota Fiscal',
        render: (row: Saque) => {
          const statusUp = (row.status ?? '').toUpperCase();
          const isRejected = [
            'REJEITADO',
            'REJECTED',
            'RECUSADO',
            'RECUSADA',
          ].includes(statusUp);
          const isApproved = [
            'APROVADO',
            'APROVADA',
            'APPROVED',
            'PAGO',
            'COMPLETED',
          ].includes(statusUp);
          const img = row.comprovante || row.receiptImage;
          const visivel = row.comprovanteVisivel !== false;

          if (isRejected) {
            return (
              <div className="flex justify-center">
                <button
                  onClick={() => {
                    setSelectedRejectionSaque(row);
                    setRejectionModalOpen(true);
                  }}
                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 dark:text-red-400 transition-colors"
                  title="Ver motivo da recusa"
                >
                  <Eye size={16} />
                </button>
              </div>
            );
          }

          if (isAdmin && isApproved) {
            return (
              <div className="flex flex-col items-center gap-2 min-w-[130px]">
                {/* Visualizar + Download */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setSelectedReceiptSaqueId(row.id);
                      setSelectedReceiptUrl(img ?? null);
                      setReceiptModalOpen(true);
                    }}
                    className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 transition-colors"
                    title="Visualizar Nota Fiscal"
                  >
                    <Eye size={15} />
                  </button>
                  {img && (
                    <button
                      onClick={() =>
                        handleForceDownload(
                          row.id,
                          img,
                          `nota_fiscal_${row.id}${isComprovantePdfUrl(resolveComprovanteUrl(img)) ? '.pdf' : '.png'}`,
                        )
                      }
                      className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
                      title="Baixar Nota Fiscal"
                    >
                      <Download size={15} />
                    </button>
                  )}
                  {/* Trocar / Adicionar */}
                  <button
                    onClick={() => {
                      setSelectedUpdateSaque(row);
                      setUpdateReceiptOpen(true);
                    }}
                    className="p-1.5 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-500/10 text-violet-600 dark:text-violet-400 transition-colors"
                    title={img ? 'Trocar comprovante' : 'Adicionar comprovante'}
                  >
                    <Upload size={15} />
                  </button>
                </div>
                {/* Toggle visível para cliente */}
                <button
                  disabled={toggleVisibilMutation.isPending}
                  onClick={() =>
                    toggleVisibilMutation.mutate(
                      { id: row.id, visivel: !visivel },
                      {
                        onError: (err) =>
                          toast({
                            type: 'error',
                            title: 'Erro',
                            description:
                              err.message || 'Erro ao alterar visibilidade',
                          }),
                      },
                    )
                  }
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all border',
                    visivel
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400'
                      : 'bg-zinc-100 border-zinc-300 text-zinc-500 hover:bg-zinc-200 dark:bg-white/5 dark:border-white/10 dark:text-zinc-500',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                  title={
                    visivel
                      ? 'Visível para cliente — clique para ocultar'
                      : 'Oculto para cliente — clique para exibir'
                  }
                >
                  {visivel ? <Eye size={10} /> : <EyeOff size={10} />}
                  {visivel ? 'Visível' : 'Oculto'}
                </button>
              </div>
            );
          }

          // Cliente
          if (isApproved) {
            if (!img || !visivel) {
              return (
                <span className="text-zinc-400 text-xs">Não disponível</span>
              );
            }
            return (
              <div className="flex items-center gap-1.5 justify-center">
                <button
                  onClick={() => {
                    setSelectedReceiptSaqueId(row.id);
                    setSelectedReceiptUrl(img);
                    setReceiptModalOpen(true);
                  }}
                  className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 transition-colors"
                  title="Visualizar Nota Fiscal"
                >
                  <Eye size={16} />
                </button>
                <button
                  onClick={() =>
                    handleForceDownload(
                      row.id,
                      img,
                      `nota_fiscal_${row.id}${isComprovantePdfUrl(resolveComprovanteUrl(img)) ? '.pdf' : '.png'}`,
                    )
                  }
                  className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
                  title="Baixar Nota Fiscal"
                >
                  <Download size={16} />
                </button>
              </div>
            );
          }

          return <span className="text-zinc-400 text-xs">Não disponível</span>;
        },
      },
    ];

    if (isAdmin) {
      cols.push({
        key: 'actions',
        header: 'Ações',
        render: (row: Saque) => (
          <div className="flex justify-center flex-wrap gap-2 min-w-[140px]">
            {isSaqueAguardandoAcaoAdmin(row.status) ? (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setSelectedSaque(row);
                    setAdminActionType('APPROVE');
                    setAdminModalOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-all border border-emerald-500/20"
                >
                  Confirmar
                </button>
                <button
                  onClick={() => {
                    setSelectedSaque(row);
                    setAdminActionType('REJECT');
                    setAdminModalOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-all border border-red-400/20"
                >
                  Negar
                </button>
              </div>
            ) : (
              <span className="text-xs text-zinc-500 italic">Finalizado</span>
            )}
          </div>
        ),
      });
    }

    return cols;
  }, [isAdmin]);

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Saques</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Histórico de transferências
          </p>
        </div>
        {!isAdmin && (
          <div className="flex items-center gap-2">
            <ActionButton
              variant="primary"
              onClick={() => setModalOpen(true)}
              disabled={hasPending}
            >
              <ArrowUpRight className="h-4 w-4" />
              Solicitar saque
            </ActionButton>
          </div>
        )}
      </div>

      {!isAdmin && (
        <div className="w-full bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/20 rounded-xl p-4 flex items-center gap-4">
          <div className="shrink-0 p-2 bg-blue-100 dark:bg-blue-500/10 rounded-lg">
            <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
            Atenção: As solicitações de saque são processadas em até 48 horas
            apenas em dias úteis.
          </p>
        </div>
      )}

      {!isAdmin && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="relative z-30 rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-100 dark:bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-500">
                <DollarSign className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  Saldo disponível
                </p>
                <p
                  className={cn(
                    'text-xl font-bold text-zinc-900 dark:text-zinc-100',
                    negativeMoneyClass(availableBalance),
                  )}
                >
                  {formatBRL(availableBalance)}
                </p>
              </div>
            </div>
          </div>

          <div className="relative z-30 rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-zinc-100 dark:bg-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400">
                <ArrowDownLeft className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  Saldo em processamento
                </p>
                <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                  {formatBRL(lockedBalance)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-30 rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        <div
          className={cn(
            'grid gap-3',
            isAdmin ? 'md:grid-cols-3' : 'md:grid-cols-2',
          )}
        >
          <DateRangePickerField
            label="Data inicial e final:"
            value={dateRange}
            onChange={(next) => {
              const { start, end } = normalizeDateFilterRange(
                next.start,
                next.end,
              );
              setDateRange({ start, end });
              setPage(1);
              updateUrl({
                dataInicio: start,
                dataFim: end,
              });
            }}
            theme={fieldTheme}
          />
          <Dropdown
            label="Status:"
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
              updateUrl({ status: v !== 'all' ? v : undefined });
            }}
            theme={fieldTheme}
            variant="navbar"
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'PENDENTE', label: 'Pendente' },
              { value: 'APROVADO', label: 'Aprovado' },
              { value: 'REJEITADO', label: 'Recusado' },
            ]}
          />
          {isAdmin && (
            <Input
              label="Pesquisar:"
              placeholder="Nome ou email..."
              value={moduloFilter}
              onChange={(v) => {
                setModuloFilter(v);
                setPage(1);
                updateUrl({ search: v || undefined });
              }}
              theme={fieldTheme}
              variant="navbar"
            />
          )}
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setStatusFilter('all');
              setModuloFilter('');
              setDateRange({ start: null, end: null });
              setPage(1);
              router.push(pathname);
            }}
            className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
          >
            <Eraser className="h-4 w-4" />
            Limpar filtros
          </button>
        </div>
      </div>

      {!isAdmin && (
        <>
          {hasPending && pendingData?.saquePendente && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/10">
              <Clock
                size={16}
                className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
              />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  Saque em análise —{' '}
                  {formatBRL(pendingData.saquePendente.valorBruto)}
                </p>
                <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400/80">
                  Solicitado em {formatDate(pendingData.saquePendente.criadoEm)}
                  .
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* {isAdmin && (
        <div className="mt-2 flex justify-end gap-2 px-2">
          <ActionButton
            variant="danger"
            onClick={() => {
              setStatusFilter("all");
              setModuloFilter("");
              setPage(1);
              router.push(pathname);
            }}
            className="h-8"
          >
            <Eraser className="h-3.5 w-3.5" />
            Limpar filtros
          </ActionButton>
        </div>
      )} */}

      <DataTable
        columns={columns}
        rows={tableView.rows}
        loading={isPending}
        page={tableView.page}
        pageSize={tableView.pageSize}
        total={tableView.total}
        onPageChange={(p) => {
          setPage(p);
          updateUrl({ page: p });
        }}
        minWidth="min-w-[1200px]"
      />

      {!isAdmin && (
        <RequestSaqueModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          summaryData={summaryData}
        />
      )}
      <AdminActionsModal
        key={`${selectedSaque?.id ?? 'none'}-${adminActionType}`}
        open={adminModalOpen}
        onClose={() => setAdminModalOpen(false)}
        saque={selectedSaque}
        type={adminActionType}
      />
      <ViewReceiptModal
        open={receiptModalOpen}
        onClose={() => {
          setReceiptModalOpen(false);
          setSelectedReceiptSaqueId(null);
          setSelectedReceiptUrl(null);
        }}
        saqueId={selectedReceiptSaqueId}
        hintUrl={selectedReceiptUrl}
      />
      <ViewRejectionModal
        open={rejectionModalOpen}
        onClose={() => {
          setRejectionModalOpen(false);
          setSelectedRejectionSaque(null);
        }}
        saque={selectedRejectionSaque}
      />
      <UpdateReceiptModal
        open={updateReceiptOpen}
        onClose={() => {
          setUpdateReceiptOpen(false);
          setSelectedUpdateSaque(null);
        }}
        saque={selectedUpdateSaque}
      />
    </div>
  );
}

export default function SaquesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center">
          <Spinner size={40} />
        </div>
      }
    >
      <SaquesContent />
    </Suspense>
  );
}
