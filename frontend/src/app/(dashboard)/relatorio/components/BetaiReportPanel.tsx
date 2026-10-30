'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { DateRangePickerField } from './DateRangePickerField';
import type { DateRange } from '../types';
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
} from '@/lib/betai-cache';

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}
function parseYmd(ymd?: string): Date | null {
  return ymd ? new Date(`${ymd}T00:00:00`) : null;
}
function isInRange(iso: string, range: DateRange) {
  if (!range.start && !range.end) return true;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const t = d.getTime();
  const start = range.start
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
  const end = range.end
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
  if (start !== null && t < start) return false;
  if (end !== null && t > end) return false;
  return true;
}

function ResultBadge({ result }: { result: BetaiOperation['result'] }) {
  const map: Record<string, { bg: string; fg: string }> = {
    GREEN: { bg: 'rgba(16,185,129,0.15)', fg: '#10b981' },
    RED: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
    VOID: { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b' },
    PENDING: { bg: 'rgba(99,102,241,0.15)', fg: '#818cf8' },
  };
  const c = map[result] ?? map.VOID;
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

function TxBadge({ status }: { status: BetaiTransaction['status'] }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
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

function MetricBox({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div
      className="rounded-2xl border bg-white p-4 dark:bg-zinc-900/60"
      style={{ borderColor: `${color}25` }}
    >
      <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="text-lg font-extrabold tracking-tight" style={{ color }}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

const inputCls =
  'w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

export function BetaiReportPanel({
  dashDataInicio,
  dashDataFim,
}: {
  dashDataInicio?: string;
  dashDataFim?: string;
}) {
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
  const [summaryDateRange, setSummaryDateRange] = useState<DateRange>({
    start: parseYmd(dashDataInicio),
    end: parseYmd(dashDataFim),
  });
  const [opsDateRange, setOpsDateRange] = useState<DateRange>({
    start: parseYmd(dashDataInicio),
    end: parseYmd(dashDataFim),
  });
  const [txDateRange, setTxDateRange] = useState<DateRange>({
    start: parseYmd(dashDataInicio),
    end: parseYmd(dashDataFim),
  });
  const [txSearch, setTxSearch] = useState('');

  const dateKey = `${dashDataInicio ?? ''}:${dashDataFim ?? ''}`;
  const [previousDateKey, setPreviousDateKey] = useState(dateKey);
  if (dateKey !== previousDateKey) {
    setPreviousDateKey(dateKey);
    setSummaryDateRange({
      start: parseYmd(dashDataInicio),
      end: parseYmd(dashDataFim),
    });
    setOpsDateRange({
      start: parseYmd(dashDataInicio),
      end: parseYmd(dashDataFim),
    });
    setTxDateRange({
      start: parseYmd(dashDataInicio),
      end: parseYmd(dashDataFim),
    });
  }

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
      if (!t) throw new Error('Token não retornado');
      saveBetaiToken(t);
      setToken(t);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Erro ao fazer login');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    clearBetaiToken();
    invalidateBetaiCache();
    setToken(null);
    setData(null);
  };

  const metrics = useMemo(() => {
    if (!data) return null;

    const ops = data.operations
      .filter((op) => isInRange(op.date, summaryDateRange))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const txs = data.transactions
      .filter((tx) => isInRange(tx.date, summaryDateRange))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // split do período — mesma lógica do betai frontend (computeSplitFromOperations)
    const adminTotal = ops.reduce(
      (s, op) =>
        s +
        (op.allocations?.reduce((a, al) => a + (al.houseAmount ?? 0), 0) ?? 0),
      0,
    );
    const clienteTotal = ops.reduce(
      (s, op) =>
        s + (op.allocations?.reduce((a, al) => a + (al.amount ?? 0), 0) ?? 0),
      0,
    );
    const afilTotal = ops.reduce(
      (s, op) =>
        s +
        (op.allocations?.reduce((a, al) => a + (al.affiliateAmount ?? 0), 0) ??
          0),
      0,
    );
    const lucroTotal = ops.reduce((s, op) => s + (op.profit ?? 0), 0);

    const approvedWithdrawals = txs.filter(
      (t) => t.type === 'WITHDRAWAL' && t.status === 'APPROVED',
    );
    const taxaSaquesTotal = data.withdrawalFee * approvedWithdrawals.length;
    const withdrawTotalAmount = approvedWithdrawals.reduce(
      (s, t) => s + t.amount,
      0,
    );

    const depositTotal = txs
      .filter((t) => t.type === 'DEPOSIT' && t.status === 'APPROVED')
      .reduce((s, t) => s + t.amount, 0);
    const pendingSaques = txs.filter(
      (t) => t.type === 'WITHDRAWAL' && t.status === 'PENDING',
    ).length;

    const greenOps = ops.filter((o) => o.result === 'GREEN').length;
    const winRate =
      ops.length > 0 ? ((greenOps / ops.length) * 100).toFixed(1) : '—';

    // ROI = lucro período / banca total investida
    const bancaTotal = data.users.reduce((s, u) => s + (u.balance ?? 0), 0);
    const roi =
      bancaTotal > 0 ? ((lucroTotal / bancaTotal) * 100).toFixed(2) : '—';

    return {
      ops,
      txs,
      adminTotal,
      clienteTotal,
      afilTotal,
      lucroTotal,
      taxaSaquesTotal,
      withdrawTotalAmount,
      depositTotal,
      pendingSaques,
      winRate,
      totalOps: ops.length,
      roi,
    };
  }, [data, summaryDateRange]);

  const filteredOps = useMemo(() => {
    const source = metrics?.ops ?? [];
    return source.filter((op) => {
      if (!isInRange(op.date, opsDateRange)) return false;
      return true;
    });
  }, [metrics, opsDateRange]);

  const filteredTxs = useMemo(() => {
    const source = metrics?.txs ?? [];
    const q = txSearch.trim().toLowerCase();
    return source.filter((tx) => {
      if (!isInRange(tx.date, txDateRange)) return false;
      if (!q) return true;
      const haystack = `${tx.user?.name ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [metrics, txDateRange, txSearch]);

  // ── Login screen ────────────────────────────────────────────────────────────

  if (!token) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <h3 className="mb-1 text-base font-bold text-zinc-900 dark:text-white">
            Betai — Acesso admin
          </h3>
          <p className="mb-5 text-xs text-zinc-500">
            Entre com sua conta de administrador para ver o relatório
          </p>
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="E-mail"
              value={loginForm.email}
              onChange={(e) =>
                setLoginForm((p) => ({ ...p, email: e.target.value }))
              }
              required
              className={inputCls}
            />
            <input
              type="password"
              placeholder="Senha"
              value={loginForm.password}
              onChange={(e) =>
                setLoginForm((p) => ({ ...p, password: e.target.value }))
              }
              required
              className={inputCls}
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
              className={inputCls}
              style={{ letterSpacing: '0.15em' }}
            />
            {loginError && <p className="text-xs text-red-500">{loginError}</p>}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="mt-1 rounded-xl bg-green-700 py-2.5 text-sm font-semibold text-white transition hover:bg-green-800 disabled:opacity-60"
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
      <div className="flex min-h-[200px] items-center justify-center text-sm text-zinc-500">
        Carregando dados do Betai...
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-500">{fetchError}</p>
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Tentar novamente
          </button>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-500"
          >
            Fazer login novamente
          </button>
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  const {
    adminTotal,
    clienteTotal,
    afilTotal,
    lucroTotal,
    taxaSaquesTotal,
    withdrawTotalAmount,
    depositTotal,
    pendingSaques,
    winRate,
    totalOps,
    roi,
  } = metrics;

  const periodLabel =
    summaryDateRange.start || summaryDateRange.end
      ? `${summaryDateRange.start ? summaryDateRange.start.toLocaleDateString('pt-BR') : '—'} a ${summaryDateRange.end ? summaryDateRange.end.toLocaleDateString('pt-BR') : '—'}`
      : 'todo o período';

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex max-w-md flex-1 flex-col gap-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Período dos cards:{' '}
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              {periodLabel}
            </span>
          </p>
          <DateRangePickerField
            label="Data inicial e final:"
            value={summaryDateRange}
            onChange={setSummaryDateRange}
            theme={fieldTheme}
          />
        </div>
        <div className="flex gap-2">
          {isLoading && (
            <span className="text-xs text-zinc-400">Atualizando...</span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            Atualizar
          </button>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
          >
            Sair
          </button>
        </div>
      </div>

      {/* Metrics row 1 — split do período */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricBox
          label="Lucro Admin (período)"
          value={fmtBRL(adminTotal)}
          sub="Receita da casa"
          color="#16a34a"
        />
        <MetricBox
          label="Lucro Cliente (período)"
          value={fmtBRL(clienteTotal)}
          sub="Repassado aos investidores"
          color="#10b981"
        />
        <MetricBox
          label="Lucro Afiliado (período)"
          value={fmtBRL(afilTotal)}
          sub="Comissões pagas"
          color="#7c3aed"
        />
        <MetricBox
          label="ROI do Período"
          value={roi !== '—' ? `${roi}%` : '—'}
          sub={`${totalOps} ops · win ${winRate}%`}
          color={lucroTotal >= 0 ? '#0891b2' : '#ef4444'}
        />
      </div>

      {/* Metrics row 2 — saques e depósitos */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricBox
          label="Taxa de saques"
          value={taxaSaquesTotal > 0 ? fmtBRL(taxaSaquesTotal) : 'Sem saques'}
          sub="Fee × saques aprovados"
          color="#f59e0b"
        />
        <MetricBox
          label="Saques totais processados"
          value={fmtBRL(withdrawTotalAmount)}
          sub="Volume aprovado"
          color="#f97316"
        />
        <MetricBox
          label="Depósitos aprovados"
          value={fmtBRL(depositTotal)}
          sub="Volume recebido"
          color="#06b6d4"
        />
        <MetricBox
          label="Saques pendentes"
          value={String(pendingSaques)}
          sub="Aguardando aprovação"
          color="#ef4444"
        />
      </div>

      {/* Operations table */}
      <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Operações no período{' '}
            <span className="ml-2 text-xs font-normal text-zinc-400">
              ({filteredOps.length})
            </span>
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <DateRangePickerField
              label="Data inicial e final:"
              value={opsDateRange}
              onChange={setOpsDateRange}
              theme={fieldTheme}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          {filteredOps.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-zinc-400">
              Nenhuma operação no período
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-xs text-zinc-400 dark:border-zinc-800">
                  <th className="px-5 py-2 text-left font-medium">Data</th>
                  <th className="px-5 py-2 text-left font-medium">Evento</th>
                  <th className="px-5 py-2 text-left font-medium">Resultado</th>
                  <th className="px-5 py-2 text-right font-medium">Lucro</th>
                  <th className="px-5 py-2 text-right font-medium">Admin</th>
                  <th className="px-5 py-2 text-right font-medium">Afiliado</th>
                </tr>
              </thead>
              <tbody>
                {filteredOps.map((op, i) => {
                  const opAdmin =
                    op.allocations?.reduce(
                      (a, al) => a + (al.houseAmount ?? 0),
                      0,
                    ) ?? 0;
                  const opAfil =
                    op.allocations?.reduce(
                      (a, al) => a + (al.affiliateAmount ?? 0),
                      0,
                    ) ?? 0;
                  return (
                    <tr
                      key={op.id}
                      className={`border-b border-zinc-50 dark:border-zinc-800/60 ${i % 2 === 0 ? '' : 'bg-zinc-50/50 dark:bg-zinc-800/20'}`}
                    >
                      <td className="px-5 py-2.5 text-xs text-zinc-500">
                        {fmtDate(op.date)}
                      </td>
                      <td className="px-5 py-2.5 font-medium text-zinc-800 dark:text-zinc-200">
                        {op.event || '—'}
                      </td>
                      <td className="px-5 py-2.5">
                        <ResultBadge result={op.result} />
                      </td>
                      <td
                        className={`px-5 py-2.5 text-right font-semibold ${op.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}
                      >
                        {fmtBRL(op.profit)}
                      </td>
                      <td className="px-5 py-2.5 text-right text-xs text-zinc-600 dark:text-zinc-400">
                        {fmtBRL(opAdmin)}
                      </td>
                      <td className="px-5 py-2.5 text-right text-xs text-violet-600 dark:text-violet-400">
                        {fmtBRL(opAfil)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Transactions table */}
      <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Transações no período{' '}
            <span className="ml-2 text-xs font-normal text-zinc-400">
              ({filteredTxs.length})
            </span>
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <DateRangePickerField
              label="Data inicial e final:"
              value={txDateRange}
              onChange={setTxDateRange}
              theme={fieldTheme}
            />
            <div className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              <span>Pesquisar por nome:</span>
              <input
                type="text"
                placeholder="Ex: Ana Luiza"
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          {filteredTxs.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-zinc-400">
              Nenhuma transação no período
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-xs text-zinc-400 dark:border-zinc-800">
                  <th className="px-5 py-2 text-left font-medium">Data</th>
                  <th className="px-5 py-2 text-left font-medium">
                    Investidor
                  </th>
                  <th className="px-5 py-2 text-left font-medium">Tipo</th>
                  <th className="px-5 py-2 text-left font-medium">Status</th>
                  <th className="px-5 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filteredTxs.map((tx, i) => (
                  <tr
                    key={tx.id}
                    className={`border-b border-zinc-50 dark:border-zinc-800/60 ${i % 2 === 0 ? '' : 'bg-zinc-50/50 dark:bg-zinc-800/20'}`}
                  >
                    <td className="px-5 py-2.5 text-xs text-zinc-500">
                      {fmtDate(tx.date)}
                    </td>
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">
                        {tx.user?.name ?? '—'}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {tx.user?.email ?? ''}
                      </p>
                    </td>
                    <td className="px-5 py-2.5 text-xs text-zinc-600 dark:text-zinc-400">
                      {tx.type === 'DEPOSIT' ? 'Depósito' : 'Saque'}
                    </td>
                    <td className="px-5 py-2.5">
                      <TxBadge status={tx.status} />
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold text-zinc-800 dark:text-zinc-200">
                      {fmtBRL(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
