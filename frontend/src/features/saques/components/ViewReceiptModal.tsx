'use client';

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Spinner } from '@/components/ui/Loading';
import { Modal } from '@/components/ui/Modal';
import { getDefaultApiBaseUrl } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import {
  isComprovantePdfUrl,
  resolveComprovanteUrl,
} from '../utils/comprovante-url';

export function ViewReceiptModal({
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
