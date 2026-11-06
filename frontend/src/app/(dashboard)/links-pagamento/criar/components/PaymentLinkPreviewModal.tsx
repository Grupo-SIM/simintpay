'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  checkoutPreviewUrl,
  isPreviewSignal,
  type PaymentLinkPreviewDraft,
} from '@/features/links-pagamento/payment-link-preview';
import { PaymentLinkPreviewSkeleton } from './PaymentLinkPreviewSkeleton';

type Props = {
  draft: PaymentLinkPreviewDraft | Record<string, unknown>;
  onClose: () => void;
  offerPreview?: boolean;
};

/** Mounted only while open, so every open and retry uses a fresh handshake. */
export function PaymentLinkPreviewModal({
  draft,
  onClose,
  offerPreview = false,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const draftRef = useRef(draft);
  const titleId = useId();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [preview] = useState(() => {
    try {
      const url = checkoutPreviewUrl(
        process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL ||
          'https://checkout.simintermediacoes.com',
        window.location.origin,
      );
      if (offerPreview) url.pathname = '/preview/offer';
      return url;
    } catch {
      return null;
    }
  });
  const url = preview?.toString();
  useEffect(() => {
    onCloseRef.current = onClose;
    draftRef.current = draft;
  }, [onClose, draft]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    closeRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (!preview) return;
    const checkoutUrl = preview;
    let sent = false;
    const timeout = window.setTimeout(() => setStatus('error'), 15000);
    function receive(event: MessageEvent) {
      const frame = iframeRef.current?.contentWindow;
      if (
        !frame ||
        event.source !== frame ||
        event.origin !== checkoutUrl.origin
      )
        return;
      if (isPreviewSignal(event.data, 'ready')) {
        sent = true;
        frame.postMessage(
          {
            type: 'payment-link-preview:draft',
            version: 1,
            draft: draftRef.current,
          },
          checkoutUrl.origin,
        );
      } else if (sent && isPreviewSignal(event.data, 'loaded')) {
        window.clearTimeout(timeout);
        setStatus('ready');
      } else if (isPreviewSignal(event.data, 'close')) {
        onCloseRef.current();
      }
    }
    window.addEventListener('message', receive);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, [attempt, preview]);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      className="fixed inset-0 m-auto h-[94dvh] max-h-none w-[96vw] max-w-6xl overflow-hidden rounded-2xl border border-zinc-300 bg-white p-0 shadow-2xl backdrop:bg-black/60 dark:border-white/20 dark:bg-zinc-950"
    >
      <div className="flex h-14 items-center justify-between gap-4 border-b border-zinc-200 px-4 dark:border-white/10">
        <h2
          id={titleId}
          className="font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {offerPreview ? 'Prévia da oferta' : 'Prévia do link de pagamento'}
        </h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={
            offerPreview
              ? 'Fechar prévia da oferta'
              : 'Fechar prévia do link de pagamento'
          }
          className="cursor-pointer rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-white/20 dark:text-zinc-200 dark:hover:bg-white/10"
        >
          Fechar
        </button>
      </div>
      <div className="relative h-[calc(100%-3.5rem)]">
        {url && status !== 'error' && (
          <iframe
            key={attempt}
            ref={iframeRef}
            src={url}
            title="Checkout em modo de prévia, pagamentos desabilitados"
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            onError={() => setStatus('error')}
            className={`h-full w-full border-0 ${status === 'ready' ? 'visible' : 'invisible'}`}
          />
        )}
        {preview && status === 'loading' && <PaymentLinkPreviewSkeleton />}
        {(!preview || status === 'error') && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-zinc-700 dark:text-zinc-200"
          >
            <p>
              Não foi possível carregar a prévia. Seu formulário foi preservado.
            </p>
            <button
              type="button"
              onClick={() => {
                setStatus('loading');
                setAttempt((value) => value + 1);
              }}
              className="cursor-pointer rounded-lg border border-zinc-300 px-4 py-2 hover:bg-zinc-100 dark:border-white/20 dark:hover:bg-white/10"
            >
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
