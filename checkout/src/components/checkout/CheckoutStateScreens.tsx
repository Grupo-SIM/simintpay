'use client';

import type { ReactNode } from 'react';
import { AlertCircle, Check, Mail } from 'lucide-react';
import { cx } from '@/utils/cx';
import {
  DesktopHeader,
  GLASS,
  Screen,
  Spinner,
} from '@/components/checkout/ui';

/** Carregando o link/plano/boleto. */
export function CheckoutLoadingScreen({
  message = 'Carregando seu pedido…',
}: {
  message?: string;
}) {
  return (
    <Screen variant="processing">
      <DesktopHeader />
      <div className="flex flex-1 flex-col items-center justify-center gap-[22px] text-center">
        <Spinner size={64} width={6} />
        <div className="text-sm text-[#a9a3b8]">{message}</div>
      </div>
    </Screen>
  );
}

/** Link/plano/boleto inexistente ou indisponível. */
export function CheckoutErrorScreen({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <Screen variant="error">
      <DesktopHeader />
      <div className="flex flex-1 flex-col items-center justify-center gap-3.5 text-center">
        <div className="flex h-[100px] w-[100px] items-center justify-center rounded-full border border-[rgba(255,160,160,.35)] bg-[rgba(255,140,140,.14)]">
          <AlertCircle className="h-10 w-10 text-[#ff9d9d]" strokeWidth={2.2} />
        </div>
        <div className="text-2xl font-medium">{title}</div>
        <div className="max-w-sm text-sm leading-normal text-[#a9a3b8]">
          {message}
        </div>
      </div>
    </Screen>
  );
}

/** Pagamento/assinatura concluído: selo, título, resumo e, se houver, botão de acesso. */
export function CheckoutSuccessScreen({
  eyebrow = 'Pagamento aprovado',
  headline,
  email,
  redirectUrl,
  accessLabel = 'Acessar meu conteúdo',
  rows,
  total,
  extra,
}: {
  eyebrow?: string;
  headline: string;
  email?: string;
  redirectUrl?: string | null;
  accessLabel?: string;
  /** Linhas do resumo (`SummaryRow`). */
  rows?: ReactNode;
  /** Total exibido no desktop, abaixo das linhas. */
  total?: string;
  extra?: ReactNode;
}) {
  const access = (className: string) =>
    redirectUrl ? (
      <a
        href={redirectUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {accessLabel}
      </a>
    ) : null;

  return (
    <Screen variant="success">
      <DesktopHeader />
      <div className="flex flex-1 flex-col gap-[18px] lg:grid lg:grid-cols-[minmax(0,1fr)_460px] lg:items-center lg:gap-12 lg:px-10">
        <div className="flex flex-col items-center gap-3.5 pt-6 text-center lg:items-start lg:gap-[22px] lg:pt-0 lg:text-left">
          <div className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-[linear-gradient(135deg,#9a8cf7,#6c5ce0)] shadow-[0_20px_60px_-10px_rgba(124,106,232,.7),inset_0_2px_0_rgba(255,255,255,.35)]">
            <Check className="h-[52px] w-[52px] text-white" strokeWidth={2.6} />
          </div>
          <div>
            <div className="text-[15px] text-[#c8c2d4] lg:text-base">
              {eyebrow}
            </div>
            <div className="mt-1 text-2xl font-semibold lg:mt-1.5 lg:text-[38px] lg:leading-[1.15]">
              {headline}
            </div>
          </div>
          {email && (
            <div className="hidden items-center gap-2.5 text-[15px] text-[#a9a3b8] lg:flex">
              <Mail className="h-[18px] w-[18px]" strokeWidth={2} />
              Acesso enviado para {email}
            </div>
          )}
          {extra}
          {access('sp2-cta hidden px-10 lg:inline-flex')}
        </div>
        {(rows || total) && (
          <div
            className={cx(
              'rounded-[26px] px-[18px] py-1.5 lg:rounded-[28px] lg:px-6 lg:py-2',
              GLASS,
            )}
          >
            {rows}
            {total && (
              <div className="hidden justify-between gap-4 border-t border-dashed border-white/[0.12] py-[13px] text-[15px] lg:flex">
                <span className="text-[#a9a3b8]">Total</span>
                <span className="text-[22px] font-semibold tabular-nums">
                  {total}
                </span>
              </div>
            )}
          </div>
        )}
        {email && (
          <div className="flex items-center justify-center gap-2.5 px-2.5 text-center text-[13px] text-[#a9a3b8] lg:hidden">
            <Mail className="h-4 w-4 shrink-0" strokeWidth={2} />
            Acesso enviado para {email}
          </div>
        )}
        <div className="flex-1 lg:hidden" />
        {access('sp2-cta w-full lg:hidden')}
      </div>
    </Screen>
  );
}
