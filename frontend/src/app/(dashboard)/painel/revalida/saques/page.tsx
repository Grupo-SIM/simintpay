'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { LoadingOverlay } from '@/components/ui/Loading';
import {
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';

interface Withdrawal {
  id: string;
  amount: number;
  grossAmount: number;
  fee: number;
  pixKey: string;
  status: string;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function formatBRL(value: number | undefined | null) {
  const v = Number(value ?? 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({
  status,
  rejectionReason,
}: {
  status: string;
  rejectionReason?: string | null;
}) {
  const s = status.toUpperCase();
  if (s === 'COMPLETED' || s === 'PAID') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(16,185,129,0.15)',
          color: '#10b981',
          border: '1px solid rgba(16,185,129,0.3)',
          borderRadius: 20,
          padding: '2px 10px',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        <CheckCircle2 size={10} /> CONCLUÍDO
      </span>
    );
  }
  if (s === 'APPROVED') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(59,130,246,0.15)',
          color: '#60a5fa',
          border: '1px solid rgba(59,130,246,0.3)',
          borderRadius: 20,
          padding: '2px 10px',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        <CheckCircle2 size={10} /> APROVADO
      </span>
    );
  }
  if (s === 'PENDING') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(245,158,11,0.15)',
          color: '#f59e0b',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 20,
          padding: '2px 10px',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        <Clock size={10} /> PENDENTE
      </span>
    );
  }
  if (s === 'REJECTED' || s === 'FAILED') {
    const badge = (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(239,68,68,0.15)',
          color: '#ef4444',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 20,
          padding: '2px 10px',
          fontSize: 11,
          fontWeight: 700,
          cursor: rejectionReason ? 'help' : 'default',
        }}
      >
        <XCircle size={10} /> REJEITADO
      </span>
    );
    if (rejectionReason) {
      return (
        <div
          style={{ position: 'relative', display: 'inline-block' }}
          className="group"
        >
          {badge}
          <div
            className="hidden group-hover:block"
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 240,
              background: '#1a1a2e',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 10,
              padding: '10px 12px',
              zIndex: 50,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#ef4444',
                marginBottom: 4,
              }}
            >
              Motivo da recusa:
            </p>
            <p
              style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.75)',
                lineHeight: 1.5,
              }}
            >
              {rejectionReason}
            </p>
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                borderWidth: 4,
                borderStyle: 'solid',
                borderColor:
                  'rgba(239,68,68,0.3) transparent transparent transparent',
              }}
            />
          </div>
        </div>
      );
    }
    return badge;
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'rgba(255,255,255,0.08)',
        color: 'rgba(255,255,255,0.5)',
        borderRadius: 20,
        padding: '2px 10px',
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <AlertCircle size={10} /> {s}
    </span>
  );
}

export default function RevalidaSaquesPage() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const fetchWithdrawals = useCallback((p: number) => {
    const token = localStorage.getItem('access_token');
    const api = createApiClient({
      baseUrl: getDefaultApiBaseUrl(),
      getToken: () => token ?? undefined,
    });
    return api
      .get<{ data: Withdrawal[]; meta: Meta }>(endpoints.revalida.withdrawals, {
        query: { page: p, limit: 10 },
      })
      .then((res) => {
        setWithdrawals(res?.data ?? []);
        setMeta(res?.meta ?? null);
        setError(null);
      })
      .catch(() => setError('Erro ao carregar saques.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchWithdrawals(page);
  }, [page, fetchWithdrawals]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        fontFamily: "'Inter', sans-serif",
        color: '#e2e8f0',
      }}
    >
      {loading && <LoadingOverlay show={true} />}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            Revalida
          </p>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#f8fafc',
              letterSpacing: '-0.5px',
            }}
          >
            Histórico de Saques
          </h1>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            void fetchWithdrawals(page);
          }}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            padding: '8px 16px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <RefreshCw
            size={14}
            style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}
          />
          Atualizar
        </button>
      </div>

      {/* Table */}
      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['Data', 'Valor Líquido', 'Taxa', 'Chave PIX', 'Status'].map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      padding: '12px 16px',
                      textAlign: 'left',
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'rgba(255,255,255,0.3)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: 48,
                    textAlign: 'center',
                    color: '#ef4444',
                    fontSize: 14,
                  }}
                >
                  {error}
                </td>
              </tr>
            ) : withdrawals.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: 48,
                    textAlign: 'center',
                    color: 'rgba(255,255,255,0.3)',
                    fontSize: 14,
                  }}
                >
                  Nenhum saque encontrado.
                </td>
              </tr>
            ) : (
              withdrawals.map((w) => (
                <tr
                  key={w.id}
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <td
                    style={{
                      padding: '14px 16px',
                      fontSize: 12,
                      color: 'rgba(255,255,255,0.45)',
                    }}
                  >
                    {fmtDate(w.createdAt)}
                  </td>
                  <td
                    style={{
                      padding: '14px 16px',
                      fontSize: 14,
                      fontWeight: 700,
                      color: '#10b981',
                    }}
                  >
                    {formatBRL(w.amount)}
                  </td>
                  <td
                    style={{
                      padding: '14px 16px',
                      fontSize: 12,
                      color: 'rgba(255,255,255,0.4)',
                    }}
                  >
                    {w.fee > 0 ? formatBRL(w.fee) : '—'}
                  </td>
                  <td
                    style={{
                      padding: '14px 16px',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      color: 'rgba(255,255,255,0.6)',
                    }}
                  >
                    {w.pixKey}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <StatusBadge
                      status={w.status}
                      rejectionReason={w.rejectionReason}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            Mostrando <strong>{withdrawals.length}</strong> de{' '}
            <strong>{meta.total}</strong> saques
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '6px 12px',
                color: 'rgba(255,255,255,0.7)',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
                fontSize: 13,
                opacity: page === 1 ? 0.4 : 1,
              }}
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
              Página {page} de {meta.totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              disabled={page === meta.totalPages || loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '6px 12px',
                color: 'rgba(255,255,255,0.7)',
                cursor: page === meta.totalPages ? 'not-allowed' : 'pointer',
                fontSize: 13,
                opacity: page === meta.totalPages ? 0.4 : 1,
              }}
            >
              Próximo <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
