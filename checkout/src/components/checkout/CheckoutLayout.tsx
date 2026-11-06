'use client';

import { Children, isValidElement, type ReactNode } from 'react';
import { Logo, ProtectedPill } from '@/components/checkout/ui';

/**
 * Área principal do checkout — layout "Checkout Novo" (ver DESIGN.md):
 * header (logo + selo) no topo; desktop = conteúdo à esquerda + resumo fixo de 400px à direita;
 * mobile = coluna única (resumo primeiro, depois formulário).
 */
export function CheckoutMain({ children }: { children: ReactNode }) {
  const hasBranding = Children.toArray(children).some(
    (c) => isValidElement(c) && c.type === CheckoutBrandingRow,
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-[480px] px-5 pb-6 pt-4 lg:max-w-[1280px] lg:px-12 lg:pb-10 lg:pt-7">
        <div className="grid w-full auto-rows-min content-start items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-7">
          {!hasBranding && (
            <CheckoutBrandingRow>
              <span className="lg:hidden">
                <Logo />
              </span>
              <span className="hidden lg:block">
                <Logo size="lg" />
              </span>
            </CheckoutBrandingRow>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Header: logo (ou marca do cliente) à esquerda + selo "Pagamento 100% seguro" à direita. */
export function CheckoutBrandingRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full items-center justify-between gap-4 lg:col-span-2 lg:mb-1">
      {/* creditCardForm passa um wrapper centralizado com <Image className="h-16">: alinha à esquerda e reduz */}
      <div className="flex min-w-0 items-center [&>div.w-full]:w-auto [&>div.w-full]:justify-start [&>div.w-full]:pb-0 [&_img.h-16]:h-10 lg:[&_img.h-16]:h-12">
        {children}
      </div>
      <span className="lg:hidden">
        <ProtectedPill compact />
      </span>
      <span className="hidden lg:block">
        <ProtectedPill />
      </span>
    </div>
  );
}

/** Resumo do pedido: primeiro no mobile, coluna fixa à direita no desktop. */
export function CheckoutSummaryColumn({ children }: { children: ReactNode }) {
  return (
    <aside className="flex h-fit w-full shrink-0 flex-col gap-4 self-start lg:sticky lg:top-5 lg:order-2 lg:gap-5">
      {children}
    </aside>
  );
}

/** Coluna do formulário (mantém preview do cartão react-credit-cards-2 dentro) */
export function CheckoutFormColumn({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-fit w-full min-w-0 flex-col gap-4 self-start lg:order-1 lg:gap-5">
      {children}
    </div>
  );
}

/**
 * Wrapper do componente Cards (react-credit-cards-2): não altera a UI do cartão, só escala e centraliza.
 */
export function CheckoutCardPreview({ children }: { children: ReactNode }) {
  return (
    <div className="checkout-card-preview flex w-full justify-center py-1 [&_.rccs]:mx-auto [&_.rccs]:max-w-[min(100%,420px)] [&_.rccs]:scale-[1.02] sm:[&_.rccs]:scale-105">
      {children}
    </div>
  );
}
