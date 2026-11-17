'use client';

/**
 * Tela pós-compra de upsell/downsell do checkout de ofertas. O pedido principal já está pago:
 * cartão cobra a oferta à vista com um clique (re-tokenizando o cartão já digitado), PIX gera um
 * novo código. A cobrança filha é `POST /ofertas/public/:code/charge` com `parentChargeId`.
 * Em `preview` (prévia do dashboard) nada é buscado nem cobrado: usa os dados do rascunho.
 */
import { useEffect, useState } from 'react';
import { SIM_API_URL } from '@/lib/api-config';
import { cx } from '@/utils/cx';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import { browserCheckoutTracking } from '@/lib/payment-tracking';
import { PixDisplay, usePixConfirmation } from './PixPayment';
import { discountLabel } from './OrderBumpCard';
import {
  CtaButton,
  DesktopHeader,
  ErrorBox,
  GLASS,
  ProtectedPill,
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
import { useFunnelCountdown } from './useFunnelCountdown';

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

type FunnelPix = {
  id: string;
  content: string | null;
  qrCode: string | null;
  expire: string | null;
};

/** Capa da oferta; sem imagem, mostra um placeholder listrado para manter o layout em duas colunas. */
function FunnelImage({
  src,
  className,
}: {
  src?: string | null;
  className: string;
}) {
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={cx('shrink-0 object-cover', className)}
      />
    );
  return (
    <div
      aria-hidden="true"
      className={cx(
        'shrink-0 border border-white/[0.08] bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.05)_0_12px,rgba(255,255,255,0.02)_12px_24px)]',
        className,
      )}
    />
  );
}

const api = (code: string) =>
  `${SIM_API_URL}/ofertas/public/${encodeURIComponent(code)}`;

export function OfferFunnelScreen({
  stage,
  bump,
  method,
  customer,
  parentChargeId,
  card,
  preview = false,
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
  /** Prévia sem cobrança nem chamadas ao backend. */
  preview?: boolean;
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
  const [pix, setPix] = useState<FunnelPix | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (preview) return;
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
  }, [bump.code, method, preview]);

  // Sem a oferta (indisponível ou sem o meio do pedido), o funil segue sem ela.
  useEffect(() => {
    if (loadFailed) onDeclined();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFailed]);

  const price = target
    ? funnelPrice(target.pricing, method)
    : bump.amountCents / 100;
  const accepted = { code: bump.code, name: bump.name, amount: price };

  usePixConfirmation(pix?.id ?? null, confirmed, () => {
    setConfirmed(true);
    onAccepted(accepted);
  });

  if (!target && !preview)
    return <CheckoutLoadingScreen message="Carregando a oferta…" />;

  const isCard = method !== 'pix';

  async function accept() {
    if (preview) {
      onAccepted(accepted);
      return;
    }
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

  return (
    <OfferFunnelView
      stage={stage}
      bump={bump}
      price={price}
      isCard={isCard}
      loading={loading}
      error={error}
      pix={pix}
      onAccept={accept}
      onDecline={onDeclined}
    />
  );
}

/**
 * Apresentação do upsell/downsell (mobile e desktop), sem I/O: também alimenta a prévia do funil
 * no dashboard. O timer começa ao montar; ao zerar, desabilita o CTA e recusa a oferta após ~2s,
 * exceto com PIX gerado ou cobrança em andamento. Sem `countdownSeconds` não há timer.
 */
export function OfferFunnelView({
  stage,
  bump,
  price,
  isCard,
  loading,
  error,
  pix,
  onAccept,
  onDecline,
}: {
  stage: 'upsell' | 'downsell';
  bump: PublicBump;
  /** Preço cobrado no meio do pedido; 0 usa o preço base da oferta. */
  price: number;
  isCard: boolean;
  loading: boolean;
  error: string;
  pix: Pick<FunnelPix, 'content' | 'qrCode' | 'expire'> | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const isDown = stage === 'downsell';
  const timer = useFunnelCountdown(bump.countdownSeconds);
  const expired = timer.expired;
  const busy = loading || Boolean(pix);

  useEffect(() => {
    if (!expired || busy) return;
    const id = setTimeout(onDecline, 2000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired, busy]);

  const basePrice = bump.amountCents / 100;
  const original =
    bump.originalAmountCents != null ? bump.originalAmountCents / 100 : null;
  const off = discountLabel(basePrice, original);
  const hasDiscount = off != null;
  const shown = price || basePrice;

  const headline = sanitizeCheckoutText(
    bump.headline ||
      (isDown
        ? 'Última chance: uma condição especial para você'
        : 'Espere! Seu pedido ainda pode ficar melhor'),
  );
  const title = sanitizeCheckoutText(bump.name);
  const desc = bump.description ? sanitizeCheckoutText(bump.description) : '';
  const note1 = isCard ? '1x no mesmo cartão' : 'Pagamento via PIX';
  const note2 = isCard ? 'sem digitar de novo' : 'um novo código será gerado';
  const ctaLabel = isDown
    ? `Quero por ${formatCurrency(shown)}`
    : `Sim, adicionar por ${formatCurrency(shown)}`;
  const declineLabel = isDown
    ? 'Não, finalizar meu pedido'
    : 'Não, obrigado. Seguir sem esta oferta';

  const timerEl = timer.enabled ? (
    <div
      className={cx(
        'flex w-full flex-col gap-2 rounded-2xl border border-white/[0.14] bg-white/[0.07] px-4 py-3 text-left',
        expired && 'opacity-80',
      )}
      role="timer"
    >
      <div className="flex items-center justify-between gap-3 text-[13px] text-[#d9d4e3] lg:text-sm">
        <span>{expired ? 'Oferta encerrada' : 'Esta condição expira em'}</span>
        <span className="text-2xl font-semibold leading-none tabular-nums text-[#ffc48f] lg:text-[28px]">
          {timer.label}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#a99ef8,#f6b67a)] transition-[width] duration-300"
          style={{ width: `${(timer.remaining / timer.total) * 100}%` }}
        />
      </div>
    </div>
  ) : null;

  const action = pix ? (
    <PixDisplay
      embedded
      pixContent={pix.content}
      qrCode={pix.qrCode}
      pixExpire={pix.expire}
    />
  ) : (
    <CtaButton type="button" onClick={onAccept} disabled={loading || expired}>
      {loading ? (
        <>
          <Spinner size={18} width={3} />
          {isCard ? 'Processando seu cartão…' : 'Gerando seu PIX…'}
        </>
      ) : (
        ctaLabel
      )}
    </CtaButton>
  );
  const errorEl = error ? <ErrorBox>{error}</ErrorBox> : null;
  const declineEl = !loading ? (
    <button
      type="button"
      onClick={onDecline}
      className="pb-1 text-center text-sm text-[#a9a3b8] transition hover:text-[#d9d4e3] lg:pb-0 lg:text-[15px]"
    >
      {declineLabel}
    </button>
  ) : null;

  const priceBox = (
    <div className="flex items-center justify-between rounded-[20px] bg-white/[0.07] px-4 py-3.5 lg:px-5 lg:py-4">
      <div>
        {hasDiscount && (
          <div className="text-[13px] text-[#7d778b] line-through lg:text-sm">
            {formatCurrency(original!)}
          </div>
        )}
        <div className="text-[30px] font-semibold tabular-nums lg:text-4xl">
          {formatCurrency(shown)}
        </div>
      </div>
      <div className="text-right text-xs leading-[1.4] text-[#a9a3b8] lg:text-[13px] lg:leading-[1.45]">
        {note1}
        <br />
        {note2}
      </div>
    </div>
  );

  return (
    <Screen variant={isDown ? 'downsell' : 'default'}>
      <DesktopHeader badge="Pagamento protegido" />
      <div className="-mb-2 flex justify-end lg:hidden">
        <ProtectedPill compact label="Pagamento protegido" />
      </div>

      <div className="flex flex-col items-center gap-[18px] text-center lg:gap-4">
        <div className="flex items-center gap-2 rounded-full border border-white/[0.14] bg-white/[0.08] px-3.5 py-2 text-[13px] text-[#d9d4e3] lg:px-4 lg:py-[9px] lg:text-sm">
          <span className="h-2 w-2 rounded-full bg-[#7be3b0]" />
          {isDown
            ? 'Seu pedido está garantido'
            : 'Pagamento aprovado · não feche esta página'}
        </div>
        <div className="flex flex-col gap-2 px-1.5 lg:max-w-[760px]">
          <h1 className="text-[26px] font-medium leading-[1.2] [text-wrap:balance] lg:text-4xl lg:leading-[1.15]">
            {headline}
          </h1>
          {isDown && desc && (
            <p className="text-sm text-[#a9a3b8] lg:text-base">{desc}</p>
          )}
        </div>
      </div>

      {/* Mobile */}
      <div className="flex flex-1 flex-col gap-[18px] lg:hidden">
        {isDown ? (
          <div
            className={cx(
              'flex flex-col items-center gap-4 rounded-[28px] p-5 text-center',
              GLASS,
            )}
          >
            <FunnelImage
              src={bump.imageUrl}
              className="h-[140px] w-[140px] rounded-[28px]"
            />
            {timerEl}
            {hasDiscount && (
              <span className="rounded-full bg-[linear-gradient(90deg,#a99ef8,#f6b67a)] px-2.5 py-1 text-xs font-semibold uppercase text-[#17131f]">
                {off} · Oferta única pós-compra
              </span>
            )}
            <div className="text-xl font-medium">{title}</div>
            <div className="flex flex-col items-center gap-0.5">
              {hasDiscount && (
                <span className="text-sm text-[#7d778b] line-through">
                  {formatCurrency(original!)}
                </span>
              )}
              <span className="text-[40px] font-semibold leading-[1.1] tabular-nums">
                {formatCurrency(shown)}
              </span>
              <span className="text-xs text-[#a9a3b8]">{note1}</span>
            </div>
            {pix && action}
          </div>
        ) : (
          <div
            className={cx('flex flex-col gap-4 rounded-[28px] p-3.5', GLASS)}
          >
            <FunnelImage
              src={bump.imageUrl}
              className="h-[180px] w-full rounded-[20px]"
            />
            {timerEl}
            <div className="flex flex-col gap-2 px-1.5">
              {hasDiscount && (
                <span className="self-start rounded-full bg-[linear-gradient(90deg,#a99ef8,#f6b67a)] px-2.5 py-1 text-xs font-semibold uppercase text-[#17131f]">
                  {off} · Oferta única pós-compra
                </span>
              )}
              <div className="text-[21px] font-medium">{title}</div>
              {desc && (
                <div className="whitespace-pre-line text-sm leading-normal text-[#b8b2c6]">
                  {desc}
                </div>
              )}
            </div>
            {priceBox}
            {pix && action}
          </div>
        )}
        <div className="flex-1" />
        {errorEl}
        {!pix && action}
        {declineEl}
      </div>

      {/* Desktop */}
      <div
        className={cx(
          'hidden w-full max-w-[1000px] self-center rounded-[28px] p-5 lg:grid lg:items-stretch lg:gap-8',
          'lg:grid-cols-[440px_minmax(0,1fr)]',
          GLASS,
        )}
      >
        <FunnelImage
          src={bump.imageUrl}
          className="h-full min-h-[380px] w-full rounded-[22px]"
        />
        <div className="flex flex-col gap-[18px] pb-2 pr-2 pt-3">
          {timerEl}
          <div className="flex items-center gap-2.5">
            {off && (
              <span className="rounded-full bg-[linear-gradient(90deg,#a99ef8,#f6b67a)] px-2.5 py-1 text-xs font-semibold text-[#17131f]">
                {off}
              </span>
            )}
            <span className="text-xs uppercase tracking-[.08em] text-[#a9a3b8]">
              Oferta única pós-compra
            </span>
          </div>
          <div className="text-[28px] font-medium leading-[1.2]">{title}</div>
          {!isDown && desc && (
            <div className="whitespace-pre-line text-[15px] leading-[1.55] text-[#b8b2c6]">
              {desc}
            </div>
          )}
          {priceBox}
          <div className="flex-1" />
          {errorEl}
          {action}
          {declineEl}
        </div>
      </div>
    </Screen>
  );
}
