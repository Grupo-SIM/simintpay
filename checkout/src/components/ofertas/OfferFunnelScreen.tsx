'use client';

/**
 * Tela pós-compra de upsell/downsell do checkout de ofertas. O pedido principal já está pago:
 * cartão cobra a oferta à vista com um clique (re-tokenizando o cartão já digitado), PIX gera um
 * novo código. A cobrança filha é `POST /ofertas/public/:code/charge` com `parentChargeId`.
 */
import { useEffect, useState } from 'react';
import { SIM_API_URL } from '@/lib/api-config';
import { cx } from '@/utils/cx';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import { browserCheckoutTracking } from '@/lib/payment-tracking';
import {
  PixDisplay,
  usePixConfirmation,
} from '@/components/simlink/PixPayment';
import {
  CtaButton,
  DesktopHeader,
  ErrorBox,
  GLASS,
  Screen,
  Spinner,
  formatCurrency,
} from '@/components/checkout/ui';
import { CheckoutLoadingScreen } from '@/components/checkout/CheckoutStateScreens';
import {
  isDeclined,
  type OfferCheckoutPricing,
  type OfferMethod,
  type PublicBump,
  type PublicOffer,
} from '@/lib/offer-checkout-model';
import {
  acceptsFunnelMethod,
  funnelChargeBody,
  funnelPrice,
} from '@/lib/offer-funnel-model';
import { tokenizeTypedCard, type TypedCard } from './offer-card-token';

type Customer = {
  name: string;
  email: string;
  document: string;
  phone: string;
};

export type AcceptedFunnelOffer = {
  code: string;
  name: string;
  amount: number;
};

const api = (code: string) =>
  `${SIM_API_URL}/ofertas/public/${encodeURIComponent(code)}`;

export function OfferFunnelScreen({
  stage,
  bump,
  method,
  customer,
  parentChargeId,
  card,
  onAccepted,
  onDeclined,
}: {
  stage: 'upsell' | 'downsell';
  bump: PublicBump;
  method: OfferMethod;
  customer: Customer;
  parentChargeId: string;
  /** Cartão digitado no pedido principal (só para crédito/débito). */
  card: TypedCard | null;
  onAccepted: (accepted: AcceptedFunnelOffer) => void;
  onDeclined: () => void;
}) {
  const [target, setTarget] = useState<{
    offer: PublicOffer;
    pricing: OfferCheckoutPricing;
  } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pix, setPix] = useState<{
    id: string;
    content: string | null;
    qrCode: string | null;
    expire: string | null;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(api(bump.code)).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch(`${api(bump.code)}/pricing`).then((r) =>
        r.ok ? r.json() : Promise.reject(),
      ),
    ])
      .then(([offer, pricing]) => {
        if (!alive) return;
        if (!acceptsFunnelMethod(offer, method)) setLoadFailed(true);
        else setTarget({ offer, pricing });
      })
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, [bump.code, method]);

  // Sem a oferta (indisponível ou sem o meio do pedido), o funil segue sem ela.
  useEffect(() => {
    if (loadFailed) onDeclined();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFailed]);

  const price = target ? funnelPrice(target.pricing, method) : 0;
  const accepted = { code: bump.code, name: bump.name, amount: price };

  usePixConfirmation(pix?.id ?? null, confirmed, () => {
    setConfirmed(true);
    onAccepted(accepted);
  });

  if (!target) return <CheckoutLoadingScreen message="Carregando a oferta…" />;

  const isCard = method !== 'pix';
  const isDown = stage === 'downsell';
  const original = bump.amountCents / 100;

  async function accept() {
    setError('');
    setLoading(true);
    try {
      let tokenized: Record<string, string | undefined> | undefined;
      if (isCard) {
        if (!card) {
          setError(
            'Não foi possível reutilizar o cartão. Siga sem esta oferta.',
          );
          return;
        }
        const res = await tokenizeTypedCard(card);
        if (!res.card) {
          setError(res.error || 'Erro ao processar o cartão');
          return;
        }
        tokenized = res.card;
      }
      const res = await fetch(`${api(bump.code)}/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...funnelChargeBody({
            method,
            parentChargeId,
            customer,
            card: tokenized,
          }),
          tracking: browserCheckoutTracking(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? 'Erro ao processar pagamento');
        return;
      }
      if (method === 'pix') {
        setPix({
          id: data.id,
          content: data.pixContent ?? null,
          qrCode: data.qrCode ?? null,
          expire: data.pixExpire ?? null,
        });
        return;
      }
      if (isDeclined(data.status)) {
        setError(
          'Pagamento da oferta não aprovado. Você pode recusar e seguir com seu pedido.',
        );
        return;
      }
      onAccepted({
        ...accepted,
        amount: Number(data.amount) || accepted.amount,
      });
    } catch {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  const headline = isDown
    ? 'Última chance: uma condição especial para você'
    : 'Espere! Seu pedido ainda pode ficar melhor';
  const title = sanitizeCheckoutText(bump.name);
  const desc = bump.description ? sanitizeCheckoutText(bump.description) : '';
  const ctaLabel = isDown
    ? `Quero por ${formatCurrency(price)}`
    : 'Sim, quero aproveitar';
  const declineLabel = isDown
    ? 'Não, finalizar meu pedido'
    : 'Não, obrigado. Seguir sem esta oferta';

  return (
    <Screen variant={isDown ? 'downsell' : 'default'}>
      <DesktopHeader />
      <div className="flex flex-1 flex-col items-center gap-[18px] text-center lg:gap-6">
        <div className="flex items-center gap-2 rounded-full border border-white/[0.14] bg-white/[0.08] px-3.5 py-2 text-[13px] text-[#d9d4e3] lg:text-sm">
          <span className="h-2 w-2 rounded-full bg-[#7be3b0]" />
          {isDown
            ? 'Seu pedido está garantido'
            : 'Pagamento aprovado · não feche esta página'}
        </div>
        <h1 className="px-1.5 text-[26px] font-medium leading-[1.2] [text-wrap:balance] lg:max-w-[760px] lg:text-4xl lg:leading-[1.15]">
          {headline}
        </h1>
        <div
          className={cx(
            'flex w-full max-w-[560px] flex-col gap-4 rounded-[28px] p-5 text-left',
            GLASS,
          )}
        >
          {bump.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bump.imageUrl}
              alt={title}
              className="max-h-[260px] w-full rounded-[20px] object-cover"
            />
          )}
          <div className="text-[21px] font-medium lg:text-[26px]">{title}</div>
          {desc && (
            <div className="whitespace-pre-line text-sm leading-normal text-[#b8b2c6] lg:text-[15px]">
              {desc}
            </div>
          )}
          <div className="flex items-center justify-between rounded-[20px] bg-white/[0.07] px-4 py-3.5 lg:px-5 lg:py-4">
            <div className="text-[30px] font-semibold tabular-nums lg:text-4xl">
              {formatCurrency(price || original)}
            </div>
            <div className="text-right text-xs leading-[1.4] text-[#a9a3b8] lg:text-[13px]">
              {isCard ? '1x no mesmo cartão' : 'Pagamento via PIX'}
              <br />
              {isCard ? 'sem digitar de novo' : 'um novo código será gerado'}
            </div>
          </div>
          {pix ? (
            <PixDisplay
              embedded
              pixContent={pix.content}
              qrCode={pix.qrCode}
              pixExpire={pix.expire}
            />
          ) : (
            <CtaButton type="button" onClick={accept} disabled={loading}>
              {loading ? (
                <>
                  <Spinner size={18} width={3} />
                  {isCard ? 'Processando seu cartão…' : 'Gerando seu PIX…'}
                </>
              ) : (
                ctaLabel
              )}
            </CtaButton>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
          {!loading && (
            <button
              type="button"
              onClick={onDeclined}
              className="text-center text-sm text-[#a9a3b8] transition hover:text-[#d9d4e3] lg:text-[15px]"
            >
              {declineLabel}
            </button>
          )}
        </div>
      </div>
    </Screen>
  );
}
