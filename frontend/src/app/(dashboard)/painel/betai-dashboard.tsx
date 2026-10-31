'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { DateRangePickerField } from '@/app/(dashboard)/relatorio/components/DateRangePickerField';
import type { DateRange } from '@/app/(dashboard)/relatorio/types';
import {
  BETAI_BASE,
  type BetaiData,
  type BetaiOperation,
  type BetaiTransaction,
  getBetaiToken,
  saveBetaiToken,
  clearBetaiToken,
  getBetaiCache,
  invalidateBetaiCache,
  fetchBetaiData,
  betaiReq,
} from '@/lib/betai-cache';

function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function inDateRange(value: string, range: DateRange) {
  if (!range.start && !range.end) return true;
  const current = new Date(value);
  if (Number.isNaN(current.getTime())) return false;
  const currentTs = current.getTime();
  const startTs = range.start
    ? new Date(
        range.start.getFullYear(),
        range.start.getMonth(),
        range.start.getDate(),
        0,
        0,
        0,
        0,
      ).getTime()
    : null;
  const endTs = range.end
    ? new Date(
        range.end.getFullYear(),
        range.end.getMonth(),
        range.end.getDate(),
        23,
        59,
        59,
        999,
      ).getTime()
    : null;
  if (startTs !== null && currentTs < startTs) return false;
  if (endTs !== null && currentTs > endTs) return false;
  return true;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--painel-card-bg)',
  border: '1px solid var(--painel-card-border)',
  borderRadius: 16,
  padding: 20,
};

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid var(--painel-card-border)',
  background: 'var(--painel-card-bg)',
  color: 'var(--painel-fg)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

function MetricCard({
  title,
  value,
  sub,
  color,
}: {
  title: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: 'var(--painel-card-bg)',
        border: '1px solid var(--painel-card-border)',
        borderRadius: 14,
        padding: 18,
      }}
    >
      <p
        style={{ fontSize: 12, color: 'var(--painel-subtle)', marginBottom: 8 }}
      >
        {title}
      </p>
      <p
        style={{
          fontSize: 20,
          fontWeight: 800,
          color,
          letterSpacing: '-0.5px',
          lineHeight: 1.1,
        }}
      >
        {value}
      </p>
      <p style={{ fontSize: 11, color: 'var(--painel-faint)', marginTop: 4 }}>
        {sub}
      </p>
    </div>
  );
}

function ResultBadge({ result }: { result: BetaiOperation['result'] }) {
  const colors: Record<BetaiOperation['result'], { bg: string; fg: string }> = {
    GREEN: { bg: 'rgba(16,185,129,0.15)', fg: '#10b981' },
    RED: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
    VOID: { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b' },
    PENDING: { bg: 'rgba(99,102,241,0.15)', fg: '#818cf8' },
  };
  const c = colors[result] ?? colors.VOID;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 20,
        background: c.bg,
        color: c.fg,
      }}
    >
      {result}
    </span>
  );
}

function StatusBadge({ status }: { status: BetaiTransaction['status'] }) {
  const map: Record<
    BetaiTransaction['status'],
    { bg: string; fg: string; label: string }
  > = {
    APPROVED: { bg: 'rgba(16,185,129,0.15)', fg: '#10b981', label: 'Aprovado' },
    REJECTED: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444', label: 'Rejeitado' },
    PENDING: { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b', label: 'Pendente' },
  };
  const c = map[status] ?? map.PENDING;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 20,
        background: c.bg,
        color: c.fg,
      }}
    >
      {c.label}
    </span>
  );
}

// ── Modals ─────────────────────────────────────────────────────────────────────

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.78)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          ...cardStyle,
          width: 420,
          maxWidth: '100%',
          borderRadius: 18,
          background: 'var(--painel-modal-bg, #0b1220)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.65)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 0',
        borderBottom: '1px solid var(--painel-card-border)',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--painel-subtle)' }}>
        {label}
      </span>
      <span
        style={{ fontSize: 13, fontWeight: 600, color: 'var(--painel-fg)' }}
      >
        {value}
      </span>
    </div>
  );
}

function ApproveModal({
  tx,
  withdrawalFee,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  tx: BetaiTransaction;
  withdrawalFee: number;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const net = tx.amount - withdrawalFee;
  return (
    <Modal onClose={onClose}>
      <h3
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--painel-heading)',
          marginBottom: 16,
        }}
      >
        Aprovar Saque
      </h3>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          marginBottom: 20,
        }}
      >
        <InfoRow label="Investidor" value={tx.user?.name ?? '—'} />
        <InfoRow label="E-mail" value={tx.user?.email ?? '—'} />
        <InfoRow label="Chave PIX" value={tx.bankDetails ?? '—'} />
        <InfoRow label="Valor solicitado" value={formatBRL(tx.amount)} />
        <InfoRow
          label="Taxa de saque"
          value={
            withdrawalFee > 0 ? `-${formatBRL(withdrawalFee)}` : 'Sem taxa'
          }
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 0',
            marginTop: 4,
          }}
        >
          <span
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--painel-fg)' }}
          >
            Valor líquido a pagar
          </span>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#10b981' }}>
            {formatBRL(net)}
          </span>
        </div>
      </div>
      {error && (
        <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 12 }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onClose}
          disabled={saving}
          style={{
            flex: 1,
            padding: '9px 0',
            borderRadius: 10,
            border: '1px solid var(--painel-card-border)',
            background: 'transparent',
            color: 'var(--painel-fg)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Cancelar
        </button>
        <button
          onClick={onConfirm}
          disabled={saving}
          style={{
            flex: 1,
            padding: '9px 0',
            borderRadius: 10,
            border: 'none',
            background: '#10b981',
            color: '#fff',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Aprovando...' : 'Confirmar Aprovação'}
        </button>
      </div>
    </Modal>
  );
}

function RejectModal({
  tx,
  reason,
  saving,
  error,
  onChangeReason,
  onClose,
  onConfirm,
}: {
  tx: BetaiTransaction;
  reason: string;
  saving: boolean;
  error: string | null;
  onChangeReason: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onClose={onClose}>
      <h3
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--painel-heading)',
          marginBottom: 16,
        }}
      >
        Recusar Saque
      </h3>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          marginBottom: 16,
        }}
      >
        <InfoRow label="Investidor" value={tx.user?.name ?? '—'} />
        <InfoRow label="Valor" value={formatBRL(tx.amount)} />
      </div>
      <textarea
        placeholder="Motivo da recusa (opcional)"
        value={reason}
        onChange={(e) => onChangeReason(e.target.value)}
        rows={3}
        style={{ ...inputStyle, resize: 'vertical', marginBottom: 12 }}
      />
      {error && (
        <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 12 }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onClose}
          disabled={saving}
          style={{
            flex: 1,
            padding: '9px 0',
            borderRadius: 10,
            border: '1px solid var(--painel-card-border)',
            background: 'transparent',
            color: 'var(--painel-fg)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Cancelar
        </button>
        <button
          onClick={onConfirm}
          disabled={saving}
          style={{
            flex: 1,
            padding: '9px 0',
            borderRadius: 10,
            border: 'none',
            background: '#ef4444',
            color: '#fff',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Recusando...' : 'Confirmar Recusa'}
        </button>
      </div>
    </Modal>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function BetaiDashboard() {
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';
  const [token, setToken] = useState<string | null>(() => getBetaiToken());
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
    totpCode: '',
  });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [data, setData] = useState<BetaiData | null>(() => getBetaiCache());
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Modal state
  const [approveTx, setApproveTx] = useState<BetaiTransaction | null>(null);
  const [rejectTx, setRejectTx] = useState<BetaiTransaction | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [operationsDateRange, setOperationsDateRange] = useState<DateRange>({
    start: null,
    end: null,
  });
  const [transactionsDateRange, setTransactionsDateRange] = useState<DateRange>(
    { start: null, end: null },
  );
  const [transactionsSearch, setTransactionsSearch] = useState('');

  const loadData = useCallback((t: string, force = false) => {
    return fetchBetaiData(t, force)
      .then((fetched) => {
        setData(fetched);
        setFetchError(null);
      })
      .catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          error.status === 401
        ) {
          clearBetaiToken();
          setToken(null);
          return;
        }
        setFetchError('Erro ao carregar dados do Betai. Tente novamente.');
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (token) loadData(token, refreshKey > 0);
  }, [token, loadData, refreshKey]);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch(`${BETAI_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginForm.email,
          password: loginForm.password,
          ...(loginForm.totpCode.trim()
            ? { totpCode: loginForm.totpCode.trim() }
            : {}),
        }),
      });
      if (!res.ok) throw new Error('Credenciais inválidas');
      const json = (await res.json()) as Record<string, unknown>;
      const t = (json.token ?? json.access_token ?? json.accessToken) as
        string | undefined;
      if (!t) throw new Error('Token não retornado pelo servidor');
      saveBetaiToken(t);
      setToken(t);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : 'Erro ao fazer login');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    clearBetaiToken();
    invalidateBetaiCache();
    setToken(null);
    setData(null);
    setFetchError(null);
  };

  const updateTxStatus = async (
    id: string,
    status: 'APPROVED' | 'REJECTED',
    adminNote?: string,
  ) => {
    if (!token) return;
    setModalSaving(true);
    setModalError(null);
    try {
      await betaiReq(`/transactions/${id}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(adminNote ? { adminNote } : {}) }),
      });
      invalidateBetaiCache();
      setApproveTx(null);
      setRejectTx(null);
      setRejectReason('');
      handleRefresh();
    } catch {
      setModalError('Erro ao atualizar saque. Tente novamente.');
    } finally {
      setModalSaving(false);
    }
  };

  // ── Derived metrics ──────────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    if (!data) return null;

    const firstOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );

    const monthOps = data.operations.filter(
      (op) => new Date(op.date) >= firstOfMonth,
    );

    // month split — mesma lógica do betai frontend (computeSplitFromOperations)
    const adminMes = monthOps.reduce(
      (s, op) =>
        s +
        (op.allocations?.reduce((a, al) => a + (al.houseAmount ?? 0), 0) ?? 0),
      0,
    );
    const clientesMes = monthOps.reduce(
      (s, op) =>
        s + (op.allocations?.reduce((a, al) => a + (al.amount ?? 0), 0) ?? 0),
      0,
    );
    const afiliadoMes = monthOps.reduce(
      (s, op) =>
        s +
        (op.allocations?.reduce((a, al) => a + (al.affiliateAmount ?? 0), 0) ??
          0),
      0,
    );
    const lucroMes = monthOps.reduce((s, op) => s + (op.profit ?? 0), 0);

    // global (não filtrado por mês)
    const bancaTotal = data.users.reduce((s, u) => s + (u.balance ?? 0), 0);
    const investidoresAtivos = data.users.filter(
      (u) => (u.investedAmount ?? 0) > 0,
    ).length;

    const withdrawalFee = data.withdrawalFee;

    // taxa de saques = fee × saques de clientes aprovados no mês
    const approvedWithdrawalsMonth = data.transactions.filter(
      (tx) =>
        tx.type === 'WITHDRAWAL' &&
        tx.status === 'APPROVED' &&
        new Date(tx.date) >= firstOfMonth,
    );
    const taxaSaquesMes = withdrawalFee * approvedWithdrawalsMonth.length;

    const saquesPendentes = data.transactions.filter(
      (tx) => tx.type === 'WITHDRAWAL' && tx.status === 'PENDING',
    );
    const solicitacoesRecentes = [...saquesPendentes].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    const recentOps = [...data.operations].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    const recentTxs = [...data.transactions]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .filter((tx) => tx.type === 'WITHDRAWAL');

    return {
      bancaTotal,
      investidoresAtivos,
      adminMes,
      clientesMes,
      afiliadoMes,
      lucroMes,
      withdrawalFee,
      taxaSaquesMes,
      saquesPendentesCount: saquesPendentes.length,
      solicitacoesRecentes,
      recentOps,
      recentTxs,
    };
  }, [data]);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!token) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 400,
        }}
      >
        <div style={{ ...cardStyle, width: 360, maxWidth: '100%' }}>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--painel-heading)',
              marginBottom: 4,
            }}
          >
            Betai — Acesso admin
          </h2>
          <p
            style={{
              fontSize: 13,
              color: 'var(--painel-subtle)',
              marginBottom: 24,
            }}
          >
            Entre com sua conta de administrador
          </p>
          <form
            onSubmit={handleLogin}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <input
              type="email"
              placeholder="E-mail"
              value={loginForm.email}
              onChange={(e) =>
                setLoginForm((p) => ({ ...p, email: e.target.value }))
              }
              required
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Senha"
              value={loginForm.password}
              onChange={(e) =>
                setLoginForm((p) => ({ ...p, password: e.target.value }))
              }
              required
              style={inputStyle}
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Código 2FA (Google Authenticator)"
              value={loginForm.totpCode}
              onChange={(e) =>
                setLoginForm((p) => ({
                  ...p,
                  totpCode: e.target.value.replace(/\D/g, '').slice(0, 6),
                }))
              }
              style={{ ...inputStyle, letterSpacing: '0.15em' }}
            />
            {loginError && (
              <p style={{ fontSize: 12, color: '#ef4444', margin: 0 }}>
                {loginError}
              </p>
            )}
            <button
              type="submit"
              disabled={isLoggingIn}
              style={{
                padding: '10px 0',
                borderRadius: 10,
                border: 'none',
                background: '#7c3aed',
                color: '#fff',
                fontWeight: 600,
                fontSize: 14,
                cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                opacity: isLoggingIn ? 0.7 : 1,
              }}
            >
              {isLoggingIn ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 400,
        }}
      >
        <p style={{ color: 'var(--painel-subtle)', fontSize: 14 }}>
          Carregando dados do Betai...
        </p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 400,
          gap: 12,
        }}
      >
        <p style={{ color: '#ef4444', fontSize: 14 }}>{fetchError}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleRefresh}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--painel-card-border)',
              background: 'transparent',
              color: 'var(--painel-fg)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Tentar novamente
          </button>
          <button
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #ef4444',
              background: 'transparent',
              color: '#ef4444',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Fazer login novamente
          </button>
        </div>
      </div>
    );
  }

  const filteredOps = (metrics?.recentOps ?? [])
    .filter((op) => {
      if (!inDateRange(op.date, operationsDateRange)) return false;
      return true;
    })
    .slice(0, 30);

  const filteredTxs = (() => {
    const q = transactionsSearch.trim().toLowerCase();
    return (metrics?.recentTxs ?? [])
      .filter((tx) => {
        if (!inDateRange(tx.date, transactionsDateRange)) return false;
        if (!q) return true;
        const haystack =
          `${tx.user?.name ?? ''} ${tx.user?.email ?? ''}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 30);
  })();

  if (!metrics) return null;

  const {
    bancaTotal,
    investidoresAtivos,
    adminMes,
    clientesMes,
    afiliadoMes,
    lucroMes,
    withdrawalFee,
    taxaSaquesMes,
    saquesPendentesCount,
    solicitacoesRecentes,
    recentOps,
    recentTxs,
  } = metrics;

  return (
    <>
      {approveTx && (
        <ApproveModal
          tx={approveTx}
          withdrawalFee={withdrawalFee}
          saving={modalSaving}
          error={modalError}
          onClose={() => {
            setApproveTx(null);
            setModalError(null);
          }}
          onConfirm={() => updateTxStatus(approveTx.id, 'APPROVED')}
        />
      )}
      {rejectTx && (
        <RejectModal
          tx={rejectTx}
          reason={rejectReason}
          saving={modalSaving}
          error={modalError}
          onChangeReason={setRejectReason}
          onClose={() => {
            setRejectTx(null);
            setRejectReason('');
            setModalError(null);
          }}
          onConfirm={() =>
            updateTxStatus(rejectTx.id, 'REJECTED', rejectReason)
          }
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <p
              style={{
                fontSize: 13,
                color: 'var(--painel-subtle)',
                marginBottom: 2,
              }}
            >
              Plataforma de investimentos
            </p>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 700,
                color: 'var(--painel-heading)',
                letterSpacing: '-0.5px',
                lineHeight: 1.2,
              }}
            >
              Betai
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isLoading && (
              <span style={{ fontSize: 12, color: 'var(--painel-subtle)' }}>
                Atualizando...
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid var(--painel-card-border)',
                background: 'transparent',
                color: 'var(--painel-fg)',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontSize: 13,
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              Atualizar
            </button>
            <button
              onClick={handleLogout}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid var(--painel-card-border)',
                background: 'transparent',
                color: '#ef4444',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Sair
            </button>
          </div>
        </div>

        {/* Row 1: banca + investidores */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 14,
          }}
        >
          <MetricCard
            title="Banca Total"
            value={formatBRL(bancaTotal)}
            sub="Saldo de todos os investidores"
            color="#7c3aed"
          />
          <MetricCard
            title="Investidores Ativos"
            value={String(investidoresAtivos)}
            sub={`de ${data?.users.length ?? 0} cadastrados`}
            color="#3b82f6"
          />
          <MetricCard
            title="Lucro do Mês"
            value={formatBRL(lucroMes)}
            sub="Operações do mês atual"
            color={lucroMes >= 0 ? '#10b981' : '#ef4444'}
          />
          <MetricCard
            title="Saques Pendentes"
            value={String(saquesPendentesCount)}
            sub="Aguardando aprovação"
            color="#f59e0b"
          />
        </div>

        {/* Row 2: admin + taxa + clientes + afiliado */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 14,
          }}
        >
          <MetricCard
            title="Admin (mês)"
            value={formatBRL(adminMes)}
            sub="Receita da casa no mês"
            color="#6366f1"
          />
          <MetricCard
            title="Taxa de saques"
            value={taxaSaquesMes > 0 ? formatBRL(taxaSaquesMes) : 'Sem saques'}
            sub={`${withdrawalFee > 0 ? formatBRL(withdrawalFee) + ' × saques aprovados' : 'Sem taxa configurada'}`}
            color="#f59e0b"
          />
          <MetricCard
            title="Clientes (mês)"
            value={formatBRL(clientesMes)}
            sub="Lucro repassado no mês"
            color="#22d3ee"
          />
          <MetricCard
            title="Afiliado (mês)"
            value={formatBRL(afiliadoMes)}
            sub="Comissões pagas no mês"
            color="#a78bfa"
          />
        </div>

        {/* Solicitações de saque pendentes */}
        <div style={cardStyle}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--painel-fg-strong)',
              marginBottom: 14,
            }}
          >
            Solicitações Recentes
            {saquesPendentesCount > 0 && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 20,
                  background: 'rgba(245,158,11,0.15)',
                  color: '#f59e0b',
                }}
              >
                {saquesPendentesCount} pendente
                {saquesPendentesCount !== 1 ? 's' : ''}
              </span>
            )}
          </p>
          {solicitacoesRecentes.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--painel-subtle)' }}>
              Nenhuma solicitação de saque pendente
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {solicitacoesRecentes.map((tx, i) => (
                <div
                  key={tx.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom:
                      i < solicitacoesRecentes.length - 1
                        ? '1px solid var(--painel-card-border)'
                        : 'none',
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--painel-fg-strong)',
                        lineHeight: 1.3,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tx.user?.name ?? 'Investidor'}
                    </p>
                    <p
                      style={{
                        fontSize: 11,
                        color: 'var(--painel-subtle)',
                        marginTop: 2,
                      }}
                    >
                      {tx.user?.email ?? '—'} ·{' '}
                      {new Date(tx.date).toLocaleDateString('pt-BR')}
                    </p>
                    {tx.bankDetails && (
                      <p
                        style={{
                          fontSize: 11,
                          color: 'var(--painel-faint)',
                          marginTop: 2,
                        }}
                      >
                        PIX: {tx.bankDetails}
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: 'var(--painel-fg-strong)',
                        marginBottom: 6,
                      }}
                    >
                      {formatBRL(tx.amount)}
                    </p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => {
                          setApproveTx(tx);
                          setModalError(null);
                        }}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 8,
                          border: 'none',
                          background: '#10b981',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        Aceitar
                      </button>
                      <button
                        onClick={() => {
                          setRejectTx(tx);
                          setRejectReason('');
                          setModalError(null);
                        }}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 8,
                          border: '1px solid #ef4444',
                          background: 'transparent',
                          color: '#ef4444',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        Recusar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tables */}
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}
        >
          {/* Operações no período */}
          <div style={cardStyle}>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--painel-fg-strong)',
                marginBottom: 14,
              }}
            >
              Operações no período
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                marginBottom: 14,
              }}
            >
              <DateRangePickerField
                label="Data inicial e final:"
                value={operationsDateRange}
                onChange={setOperationsDateRange}
                theme={fieldTheme}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {filteredOps.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--painel-subtle)' }}>
                  Nenhuma operação encontrada
                </p>
              ) : (
                filteredOps.map((op, i) => (
                  <div
                    key={op.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '9px 0',
                      borderBottom:
                        i < filteredOps.length - 1
                          ? '1px solid var(--painel-card-border)'
                          : 'none',
                    }}
                  >
                    <div>
                      <p
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--painel-fg-strong)',
                          lineHeight: 1.3,
                        }}
                      >
                        {op.event || 'Operação'}
                      </p>
                      <p
                        style={{ fontSize: 11, color: 'var(--painel-subtle)' }}
                      >
                        {new Date(op.date).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <div
                      style={{
                        textAlign: 'right',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: 3,
                      }}
                    >
                      <ResultBadge result={op.result} />
                      <p
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: (op.profit ?? 0) >= 0 ? '#10b981' : '#ef4444',
                        }}
                      >
                        {formatBRL(op.profit ?? 0)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Transações no período */}
          <div style={cardStyle}>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--painel-fg-strong)',
                marginBottom: 14,
              }}
            >
              Transações no período
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                marginBottom: 14,
              }}
            >
              <DateRangePickerField
                label="Data inicial e final:"
                value={transactionsDateRange}
                onChange={setTransactionsDateRange}
                theme={fieldTheme}
              />
              <input
                type="text"
                placeholder="Pesquisar nome ou e-mail"
                value={transactionsSearch}
                onChange={(e) => setTransactionsSearch(e.target.value)}
                style={{ ...inputStyle, height: 42 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {filteredTxs.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--painel-subtle)' }}>
                  Nenhuma transação encontrada
                </p>
              ) : (
                filteredTxs.map((tx, i) => (
                  <div
                    key={tx.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '9px 0',
                      borderBottom:
                        i < filteredTxs.length - 1
                          ? '1px solid var(--painel-card-border)'
                          : 'none',
                    }}
                  >
                    <div>
                      <p
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--painel-fg-strong)',
                          lineHeight: 1.3,
                        }}
                      >
                        {tx.type === 'DEPOSIT' ? 'Depósito' : 'Saque'}
                      </p>
                      <p
                        style={{ fontSize: 11, color: 'var(--painel-subtle)' }}
                      >
                        {tx.user?.name ?? '—'} ·{' '}
                        {new Date(tx.date).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <div
                      style={{
                        textAlign: 'right',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: 3,
                      }}
                    >
                      <StatusBadge status={tx.status} />
                      <p
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--painel-fg-strong)',
                        }}
                      >
                        {formatBRL(tx.amount)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
