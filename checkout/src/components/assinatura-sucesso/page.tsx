'use client';
import React, { useState } from 'react';
import { CheckCircle, ArrowRight } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { CheckoutFooter } from '@/components/checkout/CheckoutChrome';
import {
  CheckoutMain,
  CheckoutSummaryColumn,
  CheckoutFormColumn,
} from '@/components/checkout/CheckoutLayout';
import { CheckoutUiCard } from '@/components/checkout/CheckoutUiCard';

const AssinaturaSucesso = () => {
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference');
  const email = searchParams.get('email');
  const directUrl = searchParams.get('redirectUrl');

  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!reference) return;
    navigator.clipboard.writeText(reference).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="checkout-page-bg flex min-h-screen flex-col">
      <CheckoutMain>
        <CheckoutSummaryColumn>
          <CheckoutUiCard
            variant="success"
            title="Pagamento confirmado"
            description="Assinatura concluida com sucesso"
          >
            <div className="flex items-start gap-3">
              <CheckCircle className="mt-0.5 h-6 w-6 shrink-0 text-emerald-300" />
              <div className="space-y-1">
                <p className="text-base font-semibold text-zinc-100">
                  Assinatura realizada com sucesso!
                </p>
                <p className="text-sm text-zinc-300">
                  Seu pagamento foi confirmado.
                </p>
              </div>
            </div>
          </CheckoutUiCard>

          <CheckoutUiCard
            title="Identificacao"
            description="Guarde estes dados para suporte"
          >
            {reference && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    ID da assinatura
                  </p>
                  <p className="mt-1 break-all font-mono text-sm text-zinc-100">
                    {reference}
                  </p>
                </div>
                <button
                  onClick={handleCopy}
                  className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-white/10"
                >
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            )}
            {email && (
              <p className="mt-3 text-sm text-zinc-300">
                E-mail de acesso:{' '}
                <span className="font-semibold text-zinc-100">{email}</span>
              </p>
            )}
          </CheckoutUiCard>
        </CheckoutSummaryColumn>

        <CheckoutFormColumn>
          <CheckoutUiCard
            title="Proximos passos"
            description="Acesso ao conteúdo"
          >
            <div className="flex flex-col gap-3">
              {directUrl && (
                <a
                  href={directUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 sp2-cta font-medium px-5 py-3 text-sm transition "
                >
                  Acessar conteúdo
                  <ArrowRight className="h-4 w-4" />
                </a>
              )}

              <p className="mt-2 text-center text-xs text-zinc-500">
                Guarde o ID da sua assinatura para suporte futuro.
              </p>
            </div>
          </CheckoutUiCard>
        </CheckoutFormColumn>
      </CheckoutMain>
      <CheckoutFooter />
    </div>
  );
};

export default AssinaturaSucesso;
