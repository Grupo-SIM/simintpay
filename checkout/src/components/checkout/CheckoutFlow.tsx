'use client';

import type { FormEvent, ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useEffect } from 'react';
import {
  useCheckoutSteps,
  type CheckoutStepsController,
} from '@/hooks/use-checkout-steps';
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
 * - mobile: Pedido (etapa 0) → Dados → Pagamento, uma etapa por vez, CTA no rodapé;
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
  paymentSplit,
  steps: controlled,
  bare,
  orderContent,
  focusPayment,
  busy,
  formaLabel,
  onStepChange,
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
  pagamento?: ReactNode;
  pagamentoTitle?: string;
  /** Checklist/estado (ex.: `CheckoutStatusCard`), mostrado junto do pagamento. */
  status?: ReactNode;
  /** Aviso no topo (ex.: prévia). */
  banner?: ReactNode;
  /**
   * Divide o pagamento no mobile em "forma" (etapa 2) e "detalhe" (etapa 3);
   * no desktop os dois aparecem juntos.
   */
  paymentSplit?: {
    forma: ReactNode;
    detalhe: ReactNode;
    detalheTitle: string;
    /** Bloqueia o avanço da etapa "forma" (ex.: nenhuma forma disponível). */
    formaDisabled?: boolean;
  };
  /** Controle de etapa externo (quando o checkout reposiciona a etapa). */
  steps?: CheckoutStepsController;
  /** `dados`/`pagamento`/`orderContent` já trazem seus próprios cards e títulos. */
  bare?: boolean;
  /** Substitui o cartão de produto + total da etapa Pedido. */
  orderContent?: ReactNode;
  /** No desktop, mostra só o pagamento (ex.: PIX já gerado). */
  focusPayment?: boolean;
  /** Bloqueia o botão em qualquer etapa (ex.: recalculando valores). */
  busy?: boolean;
  /** Rótulo do botão na etapa "forma". */
  formaLabel?: string;
  /** Roda a cada avanço/volta de etapa (ex.: limpar erro). */
  onStepChange?: () => void;
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
  const last = paymentSplit ? 3 : 2;
  const own = useCheckoutSteps(last);
  const { step, setStep, desktop } = controlled ?? own;
  const showAll = desktop && !focusPayment;
  const visible = (s: number) => showAll || step === s;
  const isFinal = step === last;
  const isForma = Boolean(paymentSplit) && step === 2;

  // Cada etapa começa do topo (no mobile o botão fica no fim da página)
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading || busy) return;
    onStepChange?.();
    if (step === 0) return setStep(1);
    if (step === 1) {
      if (validateDados()) setStep(2);
      return;
    }
    if (isForma) {
      if (!paymentSplit?.formaDisabled) setStep(3);
      return;
    }
    if (desktop && !focusPayment && !validateDados()) return;
    if (finalDisabled) return;
    onSubmit();
  }

  const label =
    step === 0
      ? 'Continuar'
      : step === 1 && !desktop
        ? 'Continuar para pagamento'
        : isForma
          ? (formaLabel ?? 'Continuar')
          : finalLabel;

  const cta = (className?: string) =>
    finalAction && isFinal ? (
      finalAction
    ) : (
      <CtaButton
        type="submit"
        disabled={
          loading ||
          busy ||
          (isFinal && finalDisabled) ||
          (isForma && paymentSplit?.formaDisabled)
        }
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
      <div className="flex items-center justify-between lg:hidden">
        <Logo />
        <ProtectedPill compact />
      </div>
      {step === 0 ? (
        <div className="flex flex-col gap-4 lg:hidden">
          <div className="text-2xl font-medium">Seu pedido</div>
        </div>
      ) : (
        <>
          <MobileTopBar
            title={
              step === 1
                ? 'Seus dados'
                : paymentSplit && step === 3
                  ? paymentSplit.detalheTitle
                  : pagamentoTitle
            }
            onBack={() => {
              onStepChange?.();
              setStep(step - 1);
            }}
          />
          <MobileProgress step={step} total={paymentSplit ? 3 : 2} />
        </>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-1 flex-col gap-4 lg:grid lg:flex-none lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-7"
      >
        <div className="flex flex-1 flex-col gap-4 lg:gap-5">
          {visible(0) && bare && orderContent}
          {visible(0) && !bare && (
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

          {visible(1) && bare && dados}
          {visible(1) && !bare && (
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

          {paymentSplit && visible(2) && paymentSplit.forma}
          {paymentSplit && visible(3) && paymentSplit.detalhe}
          {!paymentSplit && visible(2) && bare && pagamento}
          {!paymentSplit && visible(2) && !bare && (
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
          {error && <ErrorBox>{error}</ErrorBox>}
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
