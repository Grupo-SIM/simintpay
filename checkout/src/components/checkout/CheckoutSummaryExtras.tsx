'use client';

import { Lock, ShieldCheck } from 'lucide-react';
import { cx } from '@/utils/cx';

const trustItems = [
  { Icon: ShieldCheck, text: 'Conexão criptografada de ponta a ponta.' },
  { Icon: Lock, text: 'Dados tratados conforme a LGPD.' },
] as const;

/** Selos de confiança (dentro de um CheckoutUiCard). */
export function CheckoutSummaryTrustPanel({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-2.5', className)}>
      {trustItems.map(({ Icon, text }) => (
        <div
          key={text}
          className="flex items-center gap-2.5 text-left text-[13px] text-[#a9a3b8]"
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          {text}
        </div>
      ))}
    </div>
  );
}

/**
 * Antes era a marca em texto no topo do resumo. No layout novo a marca fica no header
 * (CheckoutMain/CheckoutBrandingRow), então não renderiza nada.
 */
export function CheckoutSummaryBranding(_props: { className?: string }) {
  return null;
}
