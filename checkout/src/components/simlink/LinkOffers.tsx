'use client';
import { useState } from 'react';
import { Tag } from 'lucide-react';
import { cx } from '@/utils/cx';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import { PixDisplay, SIM_API, usePixConfirmation } from './PixPayment';
import {
  CtaButton,
  DesktopHeader,
  ErrorBox,
  GLASS,
  ProductImage,
  Screen,
  Spinner,
  formatCurrency,
} from '@/components/checkout/ui';

export type LinkOffer = {
  id: string;
  tipo: 'ORDER_BUMP' | 'UPSELL' | 'DOWNSELL';
  chamada: string | null;
  titulo: string;
  descricao: string | null;
  imagemUrl: string | null;
  valor: number;
  valorOriginal: number | null;
};

export type FunnelOffer = LinkOffer & { valorCartao: number };

export type LinkOffers = {
  orderBumps: LinkOffer[];
  upsell: FunnelOffer | null;
  downsell: FunnelOffer | null;
};

/** "−67%" quando há preço original maior que o atual; senão null. */
function discountLabel(price: number, original: number | null): string | null {
  if (original == null || !(original > price)) return null;
  return `−${Math.round((1 - price / original) * 100)}%`;
}

/**
 * Order bump (telas 4a mobile / 5a desktop): moldura em gradiente, selo "Oferta especial",
 * preço riscado e botão "+ Adicionar" / "✓ Adicionado".
 */
export function OrderBumpCard({
  offer,
  checked,
  disabled,
  onToggle,
}: {
  offer: LinkOffer;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const off = discountLabel(offer.valor, offer.valorOriginal);
  const hasDiscount = off != null;

  const button = (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={checked}
      className={cx(
        'h-11 shrink-0 whitespace-nowrap rounded-full border px-[18px] text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 lg:h-[46px] lg:px-5 lg:text-[15px]',
        checked
          ? 'border-[rgba(246,182,122,.5)] bg-white/10 text-[#ffc48f]'
          : 'border-transparent bg-[linear-gradient(90deg,#f6b67a,#f58a2a)] text-[#17131f] shadow-[0_8px_22px_-10px_rgba(245,138,42,.8)]',
      )}
    >
      {checked ? '✓ Adicionado' : '+ Adicionar'}
    </button>
  );

  const prices = (
    <>
      {hasDiscount && (
        <div className="text-xs text-[#8d879a] line-through lg:text-[13px]">
          {formatCurrency(offer.valorOriginal!)}
        </div>
      )}
      <div className="text-xl font-semibold tabular-nums text-[#ffc48f] lg:text-[19px]">
        + {formatCurrency(offer.valor)}
      </div>
    </>
  );

  return (
    <div
      className={cx(
        'rounded-[24px] p-px transition-shadow lg:rounded-[22px]',
        checked
          ? 'bg-[#f6b67a] shadow-[0_0_0_4px_rgba(246,182,122,.16)]'
          : 'bg-[linear-gradient(135deg,rgba(141,128,244,.9),rgba(246,182,122,.55)_50%,rgba(245,138,42,.95))] shadow-[0_18px_44px_-22px_rgba(245,138,42,.75)]',
      )}
    >
      <div className="flex flex-col gap-3 rounded-[23px] bg-[linear-gradient(140deg,rgba(30,24,44,.95)_0%,rgba(52,34,30,.95)_100%)] p-3.5 lg:rounded-[21px] lg:bg-[linear-gradient(120deg,rgba(30,24,44,.95)_0%,rgba(52,34,30,.95)_100%)] lg:px-[18px]">
        <div className="flex items-center gap-1.5 lg:gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(246,182,122,.32)] bg-[rgba(245,138,42,.14)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.1em] text-[#ffc48f]">
            <Tag className="h-3 w-3" strokeWidth={2.2} />
            Oferta especial
          </span>
          {off && (
            <span className="rounded-full bg-[linear-gradient(90deg,#a99ef8,#f6b67a)] px-[9px] py-1 text-xs font-semibold text-[#17131f]">
              {off}
            </span>
          )}
          {offer.chamada && (
            <span className="ml-auto hidden min-w-0 truncate pl-2 text-xs text-[#b8b2c6] lg:block">
              {sanitizeCheckoutText(offer.chamada)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 lg:gap-4">
          <ProductImage
            src={offer.imagemUrl}
            className="h-[60px] w-[60px] rounded-2xl lg:h-16 lg:w-16"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium leading-[1.25] lg:text-base lg:leading-normal">
              {sanitizeCheckoutText(offer.titulo)}
            </div>
            {offer.descricao && (
              <div className="mt-[3px] text-xs leading-[1.35] text-[#b8b2c6] lg:text-[13px] lg:leading-normal">
                {sanitizeCheckoutText(offer.descricao)}
              </div>
            )}
          </div>
          <div className="hidden shrink-0 text-right lg:block">{prices}</div>
          <div className="hidden lg:block">{button}</div>
        </div>
        <div className="flex items-center justify-between gap-3 lg:hidden">
          <div>{prices}</div>
          {button}
        </div>
      </div>
    </div>
  );
}

type Customer = {
  name: string;
  email: string;
  document: string;
  phone: string;
};

/** Monta o objeto `card` (tokenizado de novo — tokens do gateway são de uso único). */
export type BuildCardBody = () => Promise<{
  card?: Record<string, unknown>;
  error?: string;
}>;

/**
 * Tela pós-compra de upsell/downsell. Cartão: cobra no mesmo cartão (1x) com um clique.
 * PIX: gera um novo código e aguarda a confirmação.
 */
export function FunnelOfferScreen({
  stage,
  offer,
  linkId,
  method,
  customer,
  parentPaymentId,
  buildCardBody,
  onAccepted,
  onDeclined,
  preview = false,
}: {
  preview?: boolean;
  stage: 'upsell' | 'downsell';
  offer: FunnelOffer;
  linkId: string;
  method: 'credit' | 'debit' | 'pix';
  customer: Customer;
  parentPaymentId: string;
  buildCardBody: BuildCardBody;
  onAccepted: () => void;
  onDeclined: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pix, setPix] = useState<{
    id: string;
    content: string | null;
    qrCode: string | null;
    expire: string | null;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  usePixConfirmation(pix?.id ?? null, confirmed, () => {
    setConfirmed(true);
    onAccepted();
  });

  const isCard = method !== 'pix';
  const price = method === 'credit' ? offer.valorCartao : offer.valor;
  const hasDiscount =
    offer.valorOriginal != null && offer.valorOriginal > price;
  const doc = customer.document.replace(/\D/g, '');
  const base = {
    customerName: customer.name,
    customerEmail: customer.email,
    customerDocument: doc,
    customerPhone: customer.phone.replace(/\D/g, ''),
    offerId: offer.id,
    parentPaymentId,
  };

  async function accept() {
    if (preview) {
      onAccepted();
      return;
    }
    setError('');
    setLoading(true);
    try {
      if (!isCard) {
        const res = await fetch(
          `${SIM_API}/links-pagamento/public/${linkId}/pix`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...base,
              documentType: doc.length === 14 ? 'CNPJ' : 'CPF',
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data?.message ?? 'Erro ao gerar cobrança PIX');
          return;
        }
        setPix({
          id: data.id,
          content: data.pixContent ?? null,
          qrCode: data.qrCode ?? null,
          expire: data.pixExpire ?? null,
        });
        return;
      }

      const { card, error: cardError } = await buildCardBody();
      if (!card) {
        setError(cardError || 'Erro ao processar o cartão');
        return;
      }
      const res = await fetch(
        `${SIM_API}/links-pagamento/public/${linkId}/charge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...base,
            paymentMethod: method === 'debit' ? 'debit_card' : 'credit_card',
            installments: 1,
            card,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? 'Erro ao processar pagamento');
        return;
      }
      const status = String(data.status ?? '').toUpperCase();
      if (['PAID', 'APPROVED', 'COMPLETED'].includes(status)) {
        onAccepted();
        return;
      }
      setError(
        'Pagamento da oferta não aprovado. Você pode recusar e seguir com seu pedido.',
      );
    } catch {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  const isDown = stage === 'downsell';
  const headline = sanitizeCheckoutText(
    offer.chamada ||
      (stage === 'upsell'
        ? 'Espere! Seu pedido ainda pode ficar melhor'
        : 'Última chance: uma condição especial para você'),
  );
  const title = sanitizeCheckoutText(offer.titulo);
  const desc = offer.descricao ? sanitizeCheckoutText(offer.descricao) : '';
  const off = discountLabel(price, offer.valorOriginal);
  const note1 = isCard ? '1x no mesmo cartão' : 'Pagamento via PIX';
  const note2 = isCard ? 'sem digitar de novo' : 'um novo código será gerado';
  const ctaLabel = isDown
    ? `Quero por ${formatCurrency(price)}`
    : 'Sim, quero aproveitar';
  const declineLabel = isDown
    ? 'Não, finalizar meu pedido'
    : 'Não, obrigado. Seguir sem esta oferta';

  // Ação principal: CTA ou, com o PIX da oferta já gerado, o QR / copia e cola.
  const action = pix ? (
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
  );

  const errorEl = error ? <ErrorBox>{error}</ErrorBox> : null;

  const declineEl = !loading ? (
    <button
      type="button"
      onClick={onDeclined}
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
            {formatCurrency(offer.valorOriginal!)}
          </div>
        )}
        <div className="text-[30px] font-semibold tabular-nums lg:text-4xl">
          {formatCurrency(price)}
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
      <DesktopHeader />

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

      {/* Mobile (2a upsell / 2c downsell) */}
      <div className="flex flex-1 flex-col gap-[18px] lg:hidden">
        {isDown ? (
          <div
            className={cx(
              'flex flex-col items-center gap-4 rounded-[28px] p-5 text-center',
              GLASS,
            )}
          >
            <ProductImage
              src={offer.imagemUrl}
              className="h-[140px] w-[140px] rounded-[28px]"
            />
            <div className="text-xl font-medium">{title}</div>
            <div className="flex flex-col items-center gap-0.5">
              {hasDiscount && (
                <span className="text-sm text-[#7d778b] line-through">
                  {formatCurrency(offer.valorOriginal!)}
                </span>
              )}
              <span className="text-[40px] font-semibold leading-[1.1] tabular-nums">
                {formatCurrency(price)}
              </span>
              <span className="text-xs text-[#a9a3b8]">{note1}</span>
            </div>
            {pix && action}
          </div>
        ) : (
          <div
            className={cx('flex flex-col gap-4 rounded-[28px] p-3.5', GLASS)}
          >
            <ProductImage
              src={offer.imagemUrl}
              className="h-[180px] w-full rounded-[20px]"
            />
            <div className="flex flex-col gap-2 px-1.5">
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

      {/* Desktop (6a upsell / 6c downsell) */}
      <div
        className={cx(
          'hidden w-full max-w-[1000px] self-center rounded-[28px] p-5 lg:grid lg:items-stretch lg:gap-8',
          offer.imagemUrl
            ? 'lg:grid-cols-[440px_minmax(0,1fr)]'
            : 'lg:grid-cols-1',
          GLASS,
        )}
      >
        <ProductImage
          src={offer.imagemUrl}
          className="h-full min-h-[380px] w-full rounded-[22px]"
        />
        <div className="flex flex-col gap-[18px] pb-2 pr-2 pt-3">
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
