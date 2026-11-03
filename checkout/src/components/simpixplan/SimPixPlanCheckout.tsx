'use client';
import { useBuyerMemory } from '@/hooks/use-buyer-memory';
import { BuyerMemoryPreference } from '@/components/checkout/BuyerMemoryPreference';
import { PAGATG_API_URL, SIM_API_URL } from '@/lib/api-config';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Copy, Check, CheckCircle, Loader2 } from 'lucide-react';
import {
  CheckoutErrorScreen,
  CheckoutLoadingScreen,
  CheckoutSuccessScreen,
} from '@/components/checkout/CheckoutStateScreens';
import { CheckoutFlow } from '@/components/checkout/CheckoutFlow';
import { StatusPill } from '@/components/checkout/ui';
import { CheckoutFooter } from '@/components/checkout/CheckoutChrome';
import {
  CheckoutGlassField,
  CheckoutGlassInput,
} from '@/components/checkout/CheckoutFormPrimitives';
import { CheckoutStatusCard } from '@/components/checkout/CheckoutStatusCard';
import { CheckoutUiCard } from '@/components/checkout/CheckoutUiCard';
import { maskCpfCnpj, maskPhoneBr } from '@/lib/input-masks';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import { browserCheckoutTracking } from '@/lib/payment-tracking';

const SIM_API = SIM_API_URL;

type PlanDetails = {
  id: string;
  code: string;
  pixCreditPlanId: string;
  plan: {
    id: string;
    value: number;
    description: string | null;
    redirectUrl: string | null;
    status: string;
  };
};

type VoucherStatus = {
  valid: boolean;
  message: string;
  discount?: number;
  voucherId?: string;
  code?: string;
  discountType?: string;
  discountValue?: number;
  finalAmount?: number;
};

function formatCurrency(val: number) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function PixDisplay({
  pixContent,
  qrCode,
  pixExpire,
}: {
  pixContent: string | null;
  qrCode: string | null;
  pixExpire: string | null;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!pixContent) return;
    navigator.clipboard.writeText(pixContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <p className="text-center text-sm font-semibold text-zinc-100">
        PIX gerado com sucesso!
      </p>

      {qrCode && (
        <div className="flex flex-col items-center gap-1">
          <p className="text-xs text-zinc-400">
            Escaneie o QR Code com seu app de pagamentos
          </p>
          <div className="rounded-xl border border-white/15 bg-white p-3 shadow-lg shadow-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrCode}
              alt="QR Code PIX"
              className="h-44 w-44 object-contain"
            />
          </div>
          <p className="text-xs text-zinc-500">
            ou use o código Copia e Cola abaixo
          </p>
        </div>
      )}

      {pixContent && (
        <>
          <div className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">
            <p className="select-all break-all text-xs text-zinc-300">
              {pixContent}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[rgba(246,182,122,.35)] bg-[rgba(245,138,42,.12)] px-4 py-2.5 text-sm font-semibold text-[#d9d4e3] transition hover:bg-[rgba(245,138,42,.2)]"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? 'Copiado!' : 'Copiar código PIX'}
          </button>
        </>
      )}

      {pixExpire && (
        <p className="text-center text-xs text-zinc-500">
          Válido até: {pixExpire}
        </p>
      )}

      <p className="text-center text-xs text-zinc-500">
        Aguarde a confirmação do pagamento após pagar.
      </p>
    </div>
  );
}

export default function SimPixPlanCheckout() {
  const searchParams = useSearchParams();
  const pixPlanCode = searchParams.get('code');

  const [planDetails, setPlanDetails] = useState<PlanDetails | null>(null);
  const [fetching, setFetching] = useState(true);
  const [planError, setPlanError] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [pixContent, setPixContent] = useState<string | null>(null);
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [pixExpire, setPixExpire] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [pixDomId, setPixDomId] = useState<string | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [fetchingInviteLink, setFetchingInviteLink] = useState(false);

  // Dados do cliente
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const buyerMemory = useBuyerMemory(
    { name, email, document, phone },
    (saved) => {
      setName((current) => current || saved.name);
      setEmail((current) => current || saved.email);
      setDocument((current) => current || maskCpfCnpj(saved.document));
      setPhone((current) => current || maskPhoneBr(saved.phone));
    },
  );
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherStatus, setVoucherStatus] = useState<VoucherStatus | null>(
    null,
  );
  const [validatingVoucher, setValidatingVoucher] = useState(false);

  const docDigits = document.replace(/\D/g, '');
  const docOk = docDigits.length === 11 || docDigits.length === 14;
  const dadosOk =
    name.trim().length >= 3 &&
    docOk &&
    phone.replace(/\D/g, '').length >= 11 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const pixGerado = !!(pixContent || pixQrCode);
  const statusItems = [
    { ok: dadosOk, label: 'Dados para cobrança PIX' },
    { ok: pixGerado, label: 'Código PIX gerado' },
    { ok: paymentConfirmed, label: 'Pagamento confirmado' },
  ];

  // SSE via checkoutEvents (mesmo canal do ebook)
  useEffect(() => {
    if (!pixDomId || paymentConfirmed) return;

    const PAGATG_API = PAGATG_API_URL;

    const fetchInviteLink = async () => {
      if (!pixPlanCode || !email) return;
      setFetchingInviteLink(true);
      // Backoff: o webhook do PagaTG precisa de um instante para gravar o registro.
      // Começa curto (pega o caso rápido em ~1s) e cresce até 5s.
      const DELAYS_MS = [1000, 1000, 2000, 3000, 5000, 5000, 5000, 5000];
      for (let attempt = 0; attempt < DELAYS_MS.length; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, DELAYS_MS[attempt]));
        try {
          const linkRes = await fetch(
            `${PAGATG_API}/group-pages/public/invite-link-by-pix-code?linkCode=${encodeURIComponent(pixPlanCode)}&email=${encodeURIComponent(email)}`,
          );
          if (linkRes.ok) {
            const linkData = await linkRes.json();
            if (linkData?.inviteLink) {
              setInviteLink(linkData.inviteLink);
              setFetchingInviteLink(false);
              return;
            }
          }
        } catch {
          // tenta novamente
        }
      }
      setFetchingInviteLink(false);
    };

    let done = false;
    const handleConfirmed = () => {
      if (done) return;
      done = true;
      setPaymentConfirmed(true);
      fetchInviteLink();
    };

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1500;

    const checkStatusFallback = async () => {
      if (done) return;
      try {
        const r = await fetch(`${SIM_API}/checkout/pix/${pixDomId}/status`);
        if (r.ok) {
          const d = await r.json();
          if (d?.status === 'COMPLETED') handleConfirmed();
        }
      } catch {
        /* ignore */
      }
    };

    const connect = () => {
      if (done) return;
      es = new EventSource(`${SIM_API}/checkout/pix/${pixDomId}/sse`);
      es.addEventListener('payment-status', (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data);
          if (payload?.status === 'COMPLETED') handleConfirmed();
        } catch {
          /* ignore */
        }
      });
      // heartbeat indica conexão saudável — volta ao retry rápido
      es.addEventListener('heartbeat', () => {
        retryDelay = 1500;
      });
      es.onerror = () => {
        es?.close();
        es = null;
        if (done) return;
        // Confere se o pagamento passou enquanto a conexão estava caída
        void checkStatusFallback();
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 8000);
          connect();
        }, retryDelay);
      };
    };

    connect();

    return () => {
      done = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixDomId, paymentConfirmed]);

  const isPagatgDomain =
    typeof window !== 'undefined' &&
    (window.location.hostname.includes('pagatg') ||
      window.location.hostname.includes('jbmidia') ||
      window.location.hostname.includes('localhost'));

  useEffect(() => {
    if (!pixPlanCode) {
      setFetching(false);
      return;
    }
    fetch(
      `${SIM_API}/payments/pix-plan/link-code-details/${pixPlanCode}/checkout`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`Plano PIX não encontrado (${r.status})`);
        return r.json();
      })
      .then((data: PlanDetails) => setPlanDetails(data))
      .catch((err) => setPlanError(err.message || 'Erro ao carregar plano PIX'))
      .finally(() => setFetching(false));
  }, [pixPlanCode]);

  function getFinalValueWithDiscount(): number {
    const baseValue = planDetails?.plan.value ?? 0;
    if (!(isPagatgDomain && voucherStatus?.valid)) return baseValue;

    if (
      voucherStatus.finalAmount !== undefined &&
      voucherStatus.finalAmount !== null
    ) {
      return voucherStatus.finalAmount;
    }

    return Math.max(0, baseValue - getDiscountAmount());
  }

  function getDiscountAmount(): number {
    const base = planDetails?.plan.value ?? 0;
    if (!(isPagatgDomain && voucherStatus?.valid)) return 0;

    if (voucherStatus.discount !== undefined && voucherStatus.discount !== null)
      return voucherStatus.discount;

    if (
      voucherStatus.discountType === 'PERCENTAGE' &&
      voucherStatus.discountValue !== undefined
    ) {
      return (base * voucherStatus.discountValue) / 100;
    }

    if (
      voucherStatus.discountType === 'FIXED' &&
      voucherStatus.discountValue !== undefined
    ) {
      return voucherStatus.discountValue;
    }

    const finalValue = voucherStatus.finalAmount ?? base;
    return Math.max(0, base - finalValue);
  }

  async function validateVoucher() {
    if (!voucherCode.trim() || !pixPlanCode) return;

    setValidatingVoucher(true);
    setVoucherStatus(null);

    try {
      const response = await fetch(
        `${SIM_API_URL}/checkout/public/validate-voucher`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            linkCode: pixPlanCode,
            voucherCode: voucherCode.trim().toUpperCase(),
            amount: planDetails?.plan.value ?? 0,
          }),
        },
      );

      let data;
      try {
        data = await response.json();
      } catch {
        setVoucherStatus({
          valid: false,
          message:
            response.status === 401
              ? 'Token de autenticação inválido. Tente novamente.'
              : 'Erro ao validar cupom. Tente novamente.',
        });
        return;
      }

      if (response.ok && data.valid) {
        setVoucherStatus({
          valid: true,
          discount: data.discountAmount,
          message: `Cupom válido! Desconto de ${formatCurrency(data.discountAmount)}`,
          voucherId: data.voucherId,
          code: data.code,
          discountType: data.discountType,
          discountValue: data.discountValue,
          finalAmount: data.finalAmount,
        });
      } else {
        let errorMessage = data.message || 'Cupom inválido ou expirado';

        if (data.code === 'VOUCHER_NOT_VALID_FOR_GROUP_PAGE') {
          errorMessage = 'Este voucher não é válido para este group-page';
        } else if (data.code === 'API_DOM_ERROR') {
          errorMessage =
            data.message || 'Erro na validação do voucher. Tente novamente.';
        } else if (response.status === 401) {
          errorMessage = 'Token de autenticação inválido. Tente novamente.';
        } else if (response.status === 500) {
          errorMessage =
            'Erro interno do servidor. Tente novamente mais tarde.';
        }

        setVoucherStatus({
          valid: false,
          message: errorMessage,
        });
      }
    } catch {
      setVoucherStatus({
        valid: false,
        message: 'Erro ao validar cupom. Tente novamente.',
      });
    } finally {
      setValidatingVoucher(false);
    }
  }

  async function handleSubmit() {
    if (!planDetails || !pixPlanCode) return;
    setError('');
    setLoading(true);

    try {
      const cleanDoc = document.replace(/\D/g, '');
      const body: {
        code: string;
        name: string;
        email: string;
        document: string;
        document_type: 'CPF' | 'CNPJ';
        mobile_phone: string;
        voucherCode?: string;
        finalAmount?: number | null;
      } = {
        code: pixPlanCode,
        name,
        email,
        document: cleanDoc,
        document_type: cleanDoc.length === 14 ? 'CNPJ' : 'CPF',
        mobile_phone: phone.replace(/\D/g, ''),
      };

      if (isPagatgDomain && voucherCode.trim()) {
        body.voucherCode = voucherCode.trim().toUpperCase();
        // O backend deve revalidar o voucher; enviamos o valor promocional exibido no front para manter consistência visual.
        body.finalAmount = voucherStatus?.valid
          ? (voucherStatus.finalAmount ?? getFinalValueWithDiscount())
          : null;
      }

      const res = await fetch(`${SIM_API}/payments/pix-plan/checkout-by-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, tracking: browserCheckoutTracking() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? 'Erro ao gerar cobrança PIX');
        return;
      }

      setPixContent(data.pixContent ?? data.pix_code ?? null);
      setPixQrCode(data.qrCode ?? data.qr_code_image ?? null);
      setPixExpire(data.pixExpire ?? data.expiration ?? null);
      setTransactionId(data.transactionId ?? null);
      setPixDomId(data.paymentId ?? data.id ?? null);
    } catch {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  if (fetching)
    return <CheckoutLoadingScreen message="Carregando o plano PIX…" />;

  if (planError || !planDetails)
    return (
      <CheckoutErrorScreen
        title="Erro ao carregar o plano"
        message={planError || 'Este plano não está disponível.'}
      />
    );

  const plan = planDetails.plan;

  if (paymentConfirmed)
    return (
      <CheckoutSuccessScreen
        headline="Seu acesso foi liberado"
        email={email}
        redirectUrl={inviteLink}
        accessLabel="Acessar grupo no Telegram"
        extra={
          fetchingInviteLink ? (
            <p className="text-xs text-[#7d778b]">Gerando link de acesso…</p>
          ) : !inviteLink ? (
            <p className="text-xs text-[#7d778b]">
              Verifique seu e-mail para obter o link de acesso.
            </p>
          ) : undefined
        }
      />
    );

  return (
    <CheckoutFlow
      product={{
        title: sanitizeCheckoutText(plan.description) || 'Plano PIX',
        price: formatCurrency(plan.value),
        frequency: 'Pagamento via PIX',
      }}
      total={formatCurrency(getFinalValueWithDiscount())}
      dadosSubtitle="Usados para emitir o PIX e enviar seu acesso"
      validateDados={() => dadosOk}
      onSubmit={handleSubmit}
      finalLabel="Efetuar pagamento"
      finalDisabled={validatingVoucher}
      loading={loading}
      error={error}
      finalAction={
        pixGerado ? (
          <StatusPill>
            <Loader2 className="h-4 w-4 animate-spin" />
            Aguardando pagamento…
          </StatusPill>
        ) : undefined
      }
      dados={
        <>
          <div className="flex flex-col gap-3 pt-1">
            <CheckoutGlassField label="Nome completo" required>
              <CheckoutGlassInput
                name="name"
                placeholder="Digite seu nome"
                value={name}
                onChange={setName}
                autoComplete="name"
              />
            </CheckoutGlassField>
            <CheckoutGlassField label="CPF / CNPJ" required>
              <CheckoutGlassInput
                placeholder="000.000.000-00 ou 00.000.000/0000-00"
                value={document}
                onChange={(v) => setDocument(maskCpfCnpj(v))}
                inputMode="numeric"
                autoComplete="off"
              />
            </CheckoutGlassField>
            <CheckoutGlassField label="Celular" required>
              <CheckoutGlassInput
                name="phone"
                prefix="+55"
                placeholder="(00) 00000-0000"
                value={phone}
                onChange={(v) => setPhone(maskPhoneBr(v))}
                inputMode="tel"
                autoComplete="tel-national"
              />
            </CheckoutGlassField>
            <CheckoutGlassField label="E-mail" required>
              <CheckoutGlassInput
                type="email"
                name="email"
                placeholder="Digite seu e-mail"
                value={email}
                onChange={setEmail}
                autoComplete="email"
              />
            </CheckoutGlassField>
          </div>
          <BuyerMemoryPreference {...buyerMemory} />
        </>
      }
      pagamento={
        <>
          <div className="flex flex-col gap-3 pt-1">
            <div className="flex items-center gap-3 rounded-[20px] border border-white/[0.07] bg-white/[0.06] px-4 py-3">
              <CheckCircle className="h-4 w-4 shrink-0 text-[#f6b67a]" />
              <span className="text-sm font-semibold text-zinc-100">PIX</span>
            </div>

            {!pixContent && !pixQrCode && (
              <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                <p className="text-sm text-zinc-300">
                  Preencha seus dados e clique em{' '}
                  <strong className="text-white">Efetuar pagamento</strong>. O
                  código PIX será gerado automaticamente.
                </p>
              </div>
            )}

            {(pixContent || pixQrCode) && (
              <PixDisplay
                pixContent={pixContent}
                qrCode={pixQrCode}
                pixExpire={pixExpire}
              />
            )}
          </div>

          {isPagatgDomain && (
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-100">Cupom de desconto</span>
                <span className="text-xs text-zinc-400">(opcional)</span>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Digite seu cupom"
                  value={voucherCode}
                  onChange={(e) => {
                    setVoucherCode(e.target.value);
                    if (voucherStatus) setVoucherStatus(null);
                  }}
                  disabled={pixGerado}
                  className="flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-[rgba(240,168,108,.7)] focus:ring-2 focus:ring-[rgba(240,168,108,.3)] disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={validateVoucher}
                  disabled={
                    !voucherCode.trim() || validatingVoucher || pixGerado
                  }
                  className="min-w-24 sp2-cta h-auto min-h-[44px] font-medium px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {validatingVoucher ? 'Validando...' : 'Validar'}
                </button>
              </div>

              {pixGerado && (
                <p className="text-xs text-zinc-400">
                  O voucher pode ser validado apenas antes de clicar em{' '}
                  <strong className="text-zinc-200">Efetuar pagamento</strong>.
                </p>
              )}

              {voucherStatus && (
                <div
                  className={`mt-1 rounded-lg border px-3 py-2 text-xs ${
                    voucherStatus.valid
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                      : 'border-red-500/30 bg-red-500/10 text-red-200'
                  }`}
                >
                  {voucherStatus.valid ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">Cupom aplicado!</span>
                        {!pixGerado && (
                          <button
                            type="button"
                            onClick={() => {
                              setVoucherStatus(null);
                              setVoucherCode('');
                            }}
                            className="text-xs font-medium text-red-300 transition hover:text-red-200"
                          >
                            Remover
                          </button>
                        )}
                      </div>
                      <div>
                        {voucherStatus.discountType === 'PERCENTAGE'
                          ? `${voucherStatus.discountValue}% de desconto (${formatCurrency(getDiscountAmount())})`
                          : `${formatCurrency(getDiscountAmount())} de desconto`}
                      </div>
                      <div className="text-zinc-300 line-through">
                        De: {formatCurrency(plan.value)}
                      </div>
                      <div className="text-emerald-300">
                        Por: {formatCurrency(getFinalValueWithDiscount())}
                      </div>
                    </div>
                  ) : (
                    <div>{voucherStatus.message}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      }
      status={<CheckoutStatusCard error={error} items={statusItems} />}
    />
  );
}
