'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { OfferFunnelView } from '@/components/ofertas/OfferFunnelScreen';
import {
  isFunnelPreviewMessage,
  normalizeFunnelPreviewDraft,
  nextFunnelPreviewOffer,
  type FunnelPreviewDraft,
} from '@/lib/funnel-preview';
import { isAllowedPreviewParent } from '@/lib/payment-link-preview';

export function FunnelPreview({
  allowedOrigins,
}: {
  allowedOrigins: string[];
}) {
  const params = useSearchParams();
  const parentOrigin = params.get('parentOrigin');
  const [draft, setDraft] = useState<FunnelPreviewDraft | null>(null);
  const [index, setIndex] = useState(0);
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
        !isFunnelPreviewMessage(event.data)
      )
        return;
      clearTimeout(timeout);
      setDraft(normalizeFunnelPreviewDraft(event.data.draft));
      setIndex(0);
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

  useEffect(() => {
    if (draft) loaded();
  }, [draft, loaded]);

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
  const offer = draft.offers[index];
  return (
    <>
      <nav
        className="flex flex-wrap items-center justify-center gap-2 bg-[#100d19] p-3 text-sm text-white"
        aria-label="Navegar pela prévia do funil"
      >
        <span>Prévia · nenhuma cobrança será realizada</span>
        {draft.offers.map((item, itemIndex) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={index === itemIndex}
            onClick={() => setIndex(itemIndex)}
            className="rounded-lg border border-white/30 px-3 py-2 aria-pressed:bg-white/20"
          >
            {item.role === 'UPSELL' ? 'Upsell' : 'Downsell'}: {item.name}
          </button>
        ))}
      </nav>
      {offer ? (
        <OfferFunnelView
          key={offer.id}
          stage={offer.role === 'UPSELL' ? 'upsell' : 'downsell'}
          bump={{
            code: offer.id,
            role: offer.role,
            name: offer.name,
            description: offer.description,
            amountCents: offer.amountCents,
            imageUrl: offer.imageUrl,
            headline: offer.headline,
            originalAmountCents: offer.originalAmountCents,
            countdownSeconds: offer.countdownSeconds,
          }}
          price={0}
          isCard
          loading={false}
          error=""
          pix={null}
          onAccept={() => setIndex(nextFunnelPreviewOffer(draft, index, true))}
          onDecline={() =>
            setIndex(nextFunnelPreviewOffer(draft, index, false))
          }
        />
      ) : (
        <div
          className="min-h-screen bg-[#100d19] p-8 text-center text-white"
          role="status"
        >
          <p>Fim da prévia do funil.</p>
          <button
            type="button"
            className="mt-4 rounded-lg border border-white/30 px-4 py-2"
            onClick={() => setIndex(0)}
          >
            Reiniciar prévia
          </button>
        </div>
      )}
    </>
  );
}
