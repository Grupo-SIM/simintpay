'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import OfferCheckout from '@/components/ofertas/OfferCheckout';
import { isOfferPreviewMessage } from '@/lib/offer-preview';
import type { PublicOffer } from '@/lib/offer-checkout-model';
import { isAllowedPreviewParent } from '@/lib/payment-link-preview';

export function OfferPreview({ allowedOrigins }: { allowedOrigins: string[] }) {
  const params = useSearchParams();
  const parentOrigin = params.get('parentOrigin');
  const [draft, setDraft] = useState<PublicOffer | null>(null);
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const allowed =
    parentOrigin !== null &&
    isAllowedPreviewParent(
      parentOrigin,
      allowedOrigins.join(','),
      process.env.NODE_ENV === 'development',
    );
  const loaded = useCallback(() => {
    if (parentOrigin)
      window.parent.postMessage(
        { type: 'payment-link-preview:loaded', version: 1 },
        parentOrigin,
      );
  }, [parentOrigin]);

  useEffect(() => {
    if (!allowed || !parentOrigin || window.parent === window) return;
    const timeout = setTimeout(() => setFailed(true), 15000);
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== parentOrigin ||
        event.source !== window.parent ||
        !isOfferPreviewMessage(event.data)
      )
        return;
      clearTimeout(timeout);
      setDraft(event.data.draft);
      setRevision((value) => value + 1);
      setFailed(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        window.parent.postMessage(
          { type: 'payment-link-preview:close', version: 1 },
          parentOrigin,
        );
    };
    window.addEventListener('message', receive);
    window.addEventListener('keydown', escape);
    window.parent.postMessage(
      { type: 'payment-link-preview:ready', version: 1 },
      parentOrigin,
    );
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      window.removeEventListener('keydown', escape);
    };
  }, [allowed, parentOrigin]);

  if (!allowed)
    return (
      <p className="p-6 text-white" role="alert">
        Origem da prévia não autorizada.
      </p>
    );
  if (!draft)
    return (
      <div
        className="min-h-screen p-6 text-white"
        role={failed ? 'alert' : 'status'}
      >
        <p>
          {failed
            ? 'Não foi possível receber o rascunho. Feche e tente novamente.'
            : 'Carregando prévia…'}
        </p>
        {!failed && (
          <div
            className="mx-auto mt-6 grid max-w-5xl animate-pulse gap-6 md:grid-cols-2"
            aria-hidden="true"
          >
            <div className="h-80 rounded-xl bg-white/10" />
            <div className="h-96 rounded-xl bg-white/10" />
          </div>
        )}
      </div>
    );
  return (
    <OfferCheckout
      key={revision}
      previewOffer={draft}
      onPreviewLoaded={loaded}
    />
  );
}
