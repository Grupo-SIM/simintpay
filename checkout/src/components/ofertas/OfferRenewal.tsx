'use client';

/**
 * Renovação pública de assinatura (`?ofertaCode=&renovar=&sig=`), aberta pelo link dos avisos
 * por e-mail: sem login e sem formulário. A cobrança só é criada após o clique de confirmação
 * (um GET de pré-visualização ou antivírus não gera PIX). Usa `POST /ofertas/public/:code/renew`
 * e acompanha o PIX com `usePixConfirmation`. A assinatura do link nunca é exibida nem logada.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SIM_API_URL } from '@/lib/api-config';
import {
  CheckoutErrorScreen,
  CheckoutLoadingScreen,
  CheckoutSuccessScreen,
} from '@/components/checkout/CheckoutStateScreens';
import { CheckoutUiCard } from '@/components/checkout/CheckoutUiCard';
import {
  CtaButton,
  DesktopHeader,
  ErrorBox,
  formatCurrency,
  Screen,
  SummaryRow,
} from '@/components/checkout/ui';
import {
  PixDisplay,
  usePixConfirmation,
} from '@/components/simlink/PixPayment';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import type { PublicOffer } from '@/lib/offer-checkout-model';
import {
  INVALID_LINK_MESSAGE,
  isPixExpired,
  mapRenewalError,
  mapRenewalResponse,
  parseRenewalParams,
  RENEWAL_BUTTON_LABEL,
  renewalBody,
  renewalTitle,
  type RenewalFailure,
  type RenewalPix,
} from '@/lib/offer-renewal-model';

export default function OfferRenewal() {
  const searchParams = useSearchParams();
  const code = searchParams.get('ofertaCode') ?? '';
  const link = parseRenewalParams(searchParams);

  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [fetching, setFetching] = useState(true);
  const [offerError, setOfferError] = useState('');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<RenewalFailure | null>(null);
  const [pix, setPix] = useState<RenewalPix | null>(null);
  const [paid, setPaid] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!link) return;
    fetch(`${SIM_API_URL}/ofertas/public/${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Esta oferta não está disponível.');
        setOffer((await res.json()) as PublicOffer);
      })
      .catch((err: Error) => setOfferError(err.message))
      .finally(() => setFetching(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  usePixConfirmation(pix?.transactionId ?? null, paid, () => setPaid(true));

  // Relógio para detectar o vencimento do PIX.
  useEffect(() => {
    if (!pix?.pixExpire) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pix]);

  async function generate() {
    if (!link || loading) return;
    setLoading(true);
    setFailure(null);
    try {
      const res = await fetch(
        `${SIM_API_URL}/ofertas/public/${encodeURIComponent(code)}/renew`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(renewalBody(link)),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFailure(mapRenewalError(res.status, data));
        return;
      }
      const mapped = mapRenewalResponse(data);
      if (!mapped) {
        setFailure(mapRenewalError(500));
        return;
      }
      setNow(Date.now());
      setPix(mapped);
    } catch {
      setFailure(mapRenewalError(500));
    } finally {
      setLoading(false);
    }
  }

  if (!link)
    return (
      <CheckoutErrorScreen
        title="Link inválido"
        message={INVALID_LINK_MESSAGE}
      />
    );
  if (fetching) return <CheckoutLoadingScreen message="Carregando…" />;
  if (offerError || !offer)
    return (
      <CheckoutErrorScreen
        title="Oferta não encontrada"
        message={offerError || 'Esta oferta não está disponível.'}
      />
    );
  if (failure && !failure.retryable)
    return (
      <CheckoutErrorScreen title={failure.title} message={failure.message} />
    );

  const offerName = sanitizeCheckoutText(offer.name);
  const amount = pix?.amount ?? null;

  if (paid)
    return (
      <CheckoutSuccessScreen
        eyebrow="Pagamento confirmado"
        headline={
          pix?.kind === 'REACTIVATION'
            ? 'Assinatura reativada'
            : 'Assinatura renovada'
        }
        total={amount !== null ? formatCurrency(amount) : undefined}
        rows={
          <SummaryRow
            label={offerName}
            value={
              amount !== null ? formatCurrency(amount) : 'Pagamento confirmado'
            }
            last
          />
        }
      />
    );

  const expired = pix ? isPixExpired(pix.pixExpire, now) : false;
  const showPix = pix && !expired;

  return (
    <Screen>
      <DesktopHeader />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 py-6">
        <CheckoutUiCard
          title={renewalTitle(pix?.kind ?? null)}
          description={
            pix?.existing
              ? 'Você já tem um PIX em aberto para esta assinatura.'
              : offerName
          }
        >
          <div className="flex flex-col gap-4">
            {pix?.existing && (
              <div className="text-sm text-[#d9d4e3]">{offerName}</div>
            )}
            {offer.description && !pix && (
              <p className="text-sm text-[#a9a3b8]">
                {sanitizeCheckoutText(offer.description)}
              </p>
            )}
            {amount !== null && (
              <div className="text-3xl font-semibold text-[#f4f2f7]">
                {formatCurrency(amount)}
              </div>
            )}
            {failure && <ErrorBox>{failure.message}</ErrorBox>}
            {!pix && (
              <CtaButton
                type="button"
                onClick={generate}
                disabled={loading}
                aria-busy={loading}
              >
                {loading ? 'Gerando PIX…' : RENEWAL_BUTTON_LABEL}
              </CtaButton>
            )}
            {showPix && (
              <PixDisplay
                pixContent={pix.pixContent}
                qrCode={pix.qrCode}
                pixExpire={pix.pixExpire}
                amount={amount ?? undefined}
                embedded
              />
            )}
            {pix && expired && (
              <>
                <p className="text-center text-sm text-[#f6b67a]">
                  Este PIX expirou. Gere um novo para concluir o pagamento.
                </p>
                <CtaButton
                  type="button"
                  onClick={generate}
                  disabled={loading}
                  aria-busy={loading}
                >
                  {loading ? 'Gerando PIX…' : 'Gerar novo PIX'}
                </CtaButton>
              </>
            )}
          </div>
        </CheckoutUiCard>
      </div>
    </Screen>
  );
}
