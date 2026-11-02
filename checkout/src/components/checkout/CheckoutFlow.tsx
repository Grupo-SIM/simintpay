'use client';

import type { FormEvent, ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useCheckoutSteps } from '@/hooks/use-checkout-steps';
import { cx } from '@/utils/cx';
import {
  CtaButton,
  GLASS,
  DesktopHeader,
  ErrorBox,
  Logo,
  MobileProgress,
  MobileTopBar,
  ProductImage,
  ProtectedPill,
  Screen,
  Spinner,
  SummaryAside,
} from '@/components/checkout/ui';

/**
 * Base compartilhada dos checkouts (layout "Checkout Novo"):
 * - mobile: Pedido → Dados → Pagamento, uma etapa por vez, CTA no rodapé;
 * - desktop (lg): sem etapas, tudo na mesma tela com o resumo fixo à direita.
 * Cada checkout só informa o conteúdo das etapas; chamadas de API e regras ficam com ele.
 */
export function CheckoutFlow({
  product,
  orderExtra,
  dados,
  dadosSubtitle = 'Usados para emitir o pagamento e enviar seu acesso',
  pagamento,
  pagamentoTitle = 'Pagamento',
  status,
  banner,
  asideRows,
  total,
  totalCaption,
  dimTotal,
  validateDados,
  onSubmit,
  finalLabel,
  loading,
  finalDisabled,
  error,
  finalAction,
}: {
  product: {
    title: string;
    description?: string;
    image?: string | null;
    /** Preço exibido no cartão do pedido. */
    price: string;
    /** Ex.: "Pagamento único", "Mensal". */
    frequency?: string;
    itemsLabel?: string;
  };
  /** Conteúdo extra na etapa Pedido (ex.: order bumps). */
  orderExtra?: ReactNode;
  dados: ReactNode;
  dadosSubtitle?: string;
  pagamento: ReactNode;
  pagamentoTitle?: string;
  /** Checklist/estado (ex.: `CheckoutStatusCard`), mostrado junto do pagamento. */
  status?: ReactNode;
  /** Aviso no topo (ex.: prévia). */
  banner?: ReactNode;
  /** Linhas extras do resumo (`SummaryRow`). */
  asideRows?: ReactNode;
  total: string;
  /** Texto abaixo do total no mobile (ex.: "Mensal"). */
  totalCaption?: string;
  dimTotal?: boolean;
  /** Roda ao sair de "Dados" (mobile) e antes de enviar (desktop). `false` barra. */
  validateDados: () => boolean;
  /** Envio final, já com os dados validados. */
  onSubmit: () => void;
  finalLabel: string;
  loading?: boolean;
  finalDisabled?: boolean;
  error?: string;
  /** Substitui o botão final (ex.: "Aguardando pagamento…" depois de gerar PIX/boleto). */
  finalAction?: ReactNode;
}) {
  const { step, setStep, desktop } = useCheckoutSteps();
  const showAll = desktop;
  const visible = (s: 0 | 1 | 2) => showAll || step === s;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    if (step === 0) return setStep(1);
    if (step === 1) {
      if (validateDados()) setStep(2);
      return;
    }
    if (desktop && !validateDados()) return;
    if (finalDisabled) return;
    onSubmit();
  }

  const label =
    step === 0
      ? 'Continuar'
      : step === 1 && !desktop
        ? 'Continuar para pagamento'
        : finalLabel;

  const cta = (className?: string) =>
    finalAction && step === 2 ? (
      finalAction
    ) : (
      <CtaButton
        type="submit"
        disabled={step === 2 && (loading || finalDisabled)}
        className={className}
      >
        {loading && <Spinner size={18} width={3} />}
        {label}
      </CtaButton>
    );

  const itemsLabel = product.itemsLabel ?? '1 item';

  return (
    <Screen>
      {banner}
      <DesktopHeader />
      {step === 0 ? (
        <div className="flex flex-col gap-4 lg:hidden">
          <div className="flex items-center justify-between">
            <Logo />
            <ProtectedPill compact />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-2xl font-medium">Seu pedido</div>
            <MobileProgress step={1} />
          </div>
        </div>
      ) : (
        <>
          <MobileTopBar
            title={step === 1 ? 'Seus dados' : pagamentoTitle}
            onBack={() => setStep(step === 2 ? 1 : 0)}
          />
          <MobileProgress step={step === 1 ? 2 : 3} />
        </>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-1 flex-col gap-4 lg:grid lg:flex-none lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-7"
      >
        <div className="flex flex-1 flex-col gap-4 lg:gap-5">
          {visible(0) && (
            <>
              <div
                className={cx(
                  'flex flex-col gap-3.5 rounded-[28px] p-3 lg:p-5',
                  product.image
                    ? 'lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-center lg:gap-6'
                    : 'pt-[18px]',
                  GLASS,
                )}
              >
                {product.image && (
                  <ProductImage
                    src={product.image}
                    className="h-40 w-full rounded-[20px] lg:h-[200px]"
                  />
                )}
                <div className="flex items-start justify-between gap-3 px-1.5 pb-1.5 lg:flex-col lg:justify-start lg:gap-2.5 lg:p-0">
                  <div className="min-w-0">
                    <div className="text-[19px] font-medium lg:text-[28px]">
                      {product.title}
                    </div>
                    {product.description && (
                      <div className="mt-1 text-[13px] leading-[1.4] text-[#a9a3b8] lg:mt-2.5 lg:text-[15px] lg:leading-normal lg:text-[#b8b2c6]">
                        {product.description}
                      </div>
                    )}
                  </div>
                  <div className="text-right lg:mt-1.5 lg:text-left">
                    <div className="whitespace-nowrap text-lg font-semibold tabular-nums lg:text-[26px]">
                      {product.price}
                    </div>
                    {product.frequency && (
                      <div className="text-xs text-[#a9a3b8]">
                        {product.frequency}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {orderExtra}
              <div className="flex items-baseline justify-between px-2 lg:hidden">
                <span className="text-[15px] text-[#a9a3b8]">
                  Total · {itemsLabel}
                </span>
                <span
                  className={cx(
                    'text-[26px] font-semibold tabular-nums transition-opacity',
                    dimTotal && 'opacity-50',
                  )}
                >
                  {total}
                </span>
              </div>
              {totalCaption && (
                <div className="-mt-3 px-2 text-right text-xs text-[#a9a3b8] lg:hidden">
                  {totalCaption}
                </div>
              )}
            </>
          )}

          {visible(1) && (
            <div
              className={cx(
                'flex flex-col gap-3.5 rounded-[28px] p-[18px] lg:gap-[22px] lg:p-7',
                GLASS,
              )}
            >
              <div className="hidden lg:block">
                <div className="text-2xl font-medium">Seus dados</div>
                <div className="mt-1 text-sm text-[#a9a3b8]">
                  {dadosSubtitle}
                </div>
              </div>
              {dados}
              <div className="flex items-center justify-center gap-2.5 text-xs text-[#7d778b] lg:justify-start lg:text-[13px]">
                <Lock className="h-3.5 w-3.5" strokeWidth={2} />
                Dados protegidos durante sua compra
              </div>
            </div>
          )}

          {visible(2) && (
            <div
              className={cx(
                'flex flex-col gap-3.5 rounded-[28px] p-[18px] lg:gap-[22px] lg:p-7',
                GLASS,
              )}
            >
              <div className="hidden text-2xl font-medium lg:block">
                {pagamentoTitle}
              </div>
              {pagamento}
              {status}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:hidden">
          {error && step === 2 && <ErrorBox>{error}</ErrorBox>}
          {cta()}
        </div>

        <SummaryAside
          productTitle={product.title}
          productImage={product.image}
          itemsLabel={itemsLabel}
          rows={asideRows}
          total={total}
          dimTotal={dimTotal}
          action={
            <>
              {error && <ErrorBox>{error}</ErrorBox>}
              {cta()}
            </>
          }
        />
      </form>
    </Screen>
  );
}
