'use client';
import { SIM_API_URL } from '@/lib/api-config';

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, Mail, Copy, ArrowRight } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { CheckoutFooter } from '@/components/checkout/CheckoutChrome';
import {
  CheckoutMain,
  CheckoutSummaryColumn,
  CheckoutFormColumn,
} from '@/components/checkout/CheckoutLayout';
import { CheckoutUiCard } from '@/components/checkout/CheckoutUiCard';

const SIM_API = SIM_API_URL;

const AssinaturaSucesso = () => {
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference');
  const email = searchParams.get('email');
  const [directUrl, setDirectUrl] = useState(searchParams.get('redirectUrl'));

  const [copied, setCopied] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const autoSendTriggered = useRef(false);

  function handleCopy() {
    if (!reference) return;
    navigator.clipboard.writeText(reference).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleSendEmail() {
    if (!reference) return;
    setEmailLoading(true);
    setEmailError('');
    try {
      const res = await fetch(
        `${SIM_API}/links-assinatura/orders/${reference}/send-access-email`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message ?? 'Erro ao enviar e-mail');
      }
      setEmailSent(true);
    } catch (err) {
      setEmailError(
        err instanceof Error ? err.message : 'Erro ao enviar e-mail',
      );
    } finally {
      setEmailLoading(false);
    }
  }

  useEffect(() => {
    if (!reference) return;
    // Garante directUrl mesmo quando nao veio na query string.
    if (!directUrl) {
      fetch(`${SIM_API}/links-assinatura/orders/${reference}/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { redirectUrl?: string | null } | null) => {
          if (data?.redirectUrl) setDirectUrl(data.redirectUrl);
        })
        .catch(() => {
          // noop
        });
    }
  }, [reference, directUrl]);

  useEffect(() => {
    if (
      !reference ||
      !email ||
      emailSent ||
      emailLoading ||
      autoSendTriggered.current
    )
      return;
    autoSendTriggered.current = true;
    void handleSendEmail();
  }, [reference, email, emailSent, emailLoading]);

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
            description="Acesso e envio de link"
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

              {!emailSent ? (
                <button
                  onClick={handleSendEmail}
                  disabled={emailLoading}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/10 disabled:opacity-60"
                >
                  <Mail className="h-4 w-4" />
                  {emailLoading ? 'Enviando...' : 'Receber link por e-mail'}
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-3 text-sm font-semibold text-emerald-200">
                  <CheckCircle className="h-4 w-4" />
                  E-mail enviado para {email ?? 'seu endereco'}!
                </div>
              )}

              {emailError && (
                <p className="text-center text-xs text-red-300">{emailError}</p>
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
