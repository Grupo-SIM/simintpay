'use client';

import { Logo, ProtectedPill } from '@/components/checkout/ui';

/** Cabeçalho do "Checkout Novo": logo SimPay + selo "Pagamento 100% seguro". */
export function CheckoutHeader() {
  return (
    <header className="mx-auto flex w-full max-w-[480px] items-center justify-between gap-4 px-5 pt-4 lg:max-w-[1280px] lg:px-12 lg:pt-7">
      <span className="lg:hidden">
        <Logo />
      </span>
      <span className="hidden lg:block">
        <Logo size="lg" />
      </span>
      <span className="lg:hidden">
        <ProtectedPill compact />
      </span>
      <span className="hidden lg:block">
        <ProtectedPill />
      </span>
    </header>
  );
}

export function CheckoutFooter() {
  return (
    <footer className="mt-auto px-4 pb-6 pt-4 text-center">
      <p className="text-xs text-[#7d778b]">
        Processado por{' '}
        <span className="font-medium text-[#d9d4e3]">Simintpay</span>
      </p>
    </footer>
  );
}
