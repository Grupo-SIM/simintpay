'use client';
import { useBuyerMemory } from '@/hooks/use-buyer-memory';
import { BuyerMemoryPreference } from '@/components/checkout/BuyerMemoryPreference';
import { SIM_API_URL } from '@/lib/api-config';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  CheckCircle,
  CreditCard as CreditCardIcon,
  AlertCircle,
  Copy,
  Check,
  ArrowRight,
  Mail,
} from 'lucide-react';
import { getTokenCard } from '@/components/sdk';
import { CheckoutFlow } from '@/components/checkout/CheckoutFlow';
import { SummaryRow } from '@/components/checkout/ui';
import { CheckoutFooter } from '@/components/checkout/CheckoutChrome';
import {
  CheckoutGlassField,
  CheckoutGlassInput,
} from '@/components/checkout/CheckoutFormPrimitives';
import { CheckoutCardPreview } from '@/components/checkout/CheckoutLayout';
import { CheckoutStatusCard } from '@/components/checkout/CheckoutStatusCard';
import {
  CheckoutErrorScreen,
  CheckoutLoadingScreen,
  CheckoutSuccessScreen,
} from '@/components/checkout/CheckoutStateScreens';
import { CheckoutUiCard } from '@/components/checkout/CheckoutUiCard';
import {
  maskCardMonth,
  maskCardNumber,
  maskCardYear,
  maskCpfCnpj,
  maskCvv,
  maskPhoneBr,
} from '@/lib/input-masks';
import { sanitizeCheckoutText } from '@/lib/text-utils';

const Cards = dynamic(() => import('react-credit-cards-2'), {
  ssr: false,
  loading: () => null,
});

const SIM_API = SIM_API_URL;
const GATEWAY_PUBLIC_KEY = 'pk_4ce776b5-0d68-4fbe-b1eb-be10c94ca4e6';

type LinkData = {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  valor: number;
  valorComJuros: number;
  platformFee?: number;
  frequencia: string;
  isStandalone: boolean;
  ativo: boolean;
  redirectUrl: string | null;
  aceitaCartao: boolean;
  aceitaDebito?: boolean;
  aceitaPix: boolean;
  platformTag?: string | null;
};

type PaymentMethod = 'credit' | 'debit' | 'pix';

function formatCurrency(val: number) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function intervalLabel(tipo: string) {
  switch (tipo) {
    case 'MENSAL':
      return 'A cada mês';
    case 'TRIMESTRAL':
      return 'A cada 3 meses';
    case 'SEMESTRAL':
      return 'A cada 6 meses';
    case 'ANUAL':
      return 'A cada ano';
    default:
      return tipo;
  }
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
        Aguarde a confirmação do pagamento. Você receberá um e-mail com o link
        de acesso.
      </p>
    </div>
  );
}

export default function SimSubscriptionLinkCheckout() {
  const searchParams = useSearchParams();
  const subscriptionLinkCode = searchParams.get('subscriptionLinkCode');

  const [mounted, setMounted] = useState(false);
  const [link, setLink] = useState<LinkData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [linkError, setLinkError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pixContent, setPixContent] = useState<string | null>(null);
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [pixExpire, setPixExpire] = useState<string | null>(null);
  const [pixOrderId, setPixOrderId] = useState<string | null>(null);
  const [pixDomId, setPixDomId] = useState<string | null>(null);

  // Pagamento confirmado — tela de sucesso inline
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);
  const [confirmedRedirectUrl, setConfirmedRedirectUrl] = useState<
    string | null
  >(null);
  const [emailSent, setEmailSent] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(
    null,
  );

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

  // Cartão
  const [cardNumber, setCardNumber] = useState('');
  const [cardMonth, setCardMonth] = useState('');
  const [cardYear, setCardYear] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [holderName, setHolderName] = useState('');
  const [holderDocument, setHolderDocument] = useState('');
  const [cardFocused, setCardFocused] = useState<
    'number' | 'expiry' | 'cvc' | 'name' | ''
  >('');

  // Voucher
  const [voucherCode, setVoucherCode] = useState('');
  const [appliedVoucher, setAppliedVoucher] = useState<{
    id: string;
    discount: number;
    finalAmount: number;
  } | null>(null);
  const [isValidatingVoucher, setIsValidatingVoucher] = useState(false);
  const [voucherError, setVoucherError] = useState('');

  const handleValidateVoucher = async () => {
    if (!voucherCode || !link) return;
    setIsValidatingVoucher(true);
    setVoucherError('');
    try {
      const res = await fetch(
        `${SIM_API}/links-assinatura/public/${link.codigo}/validate-voucher?code=${voucherCode}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setVoucherError(data.message || 'Cupom inválido');
        setAppliedVoucher(null);
      } else {
        setAppliedVoucher(data);
      }
    } catch {
      setVoucherError('Erro ao validar cupom');
    } finally {
      setIsValidatingVoucher(false);
    }
  };

  const docDigits = document.replace(/\D/g, '');
  const docOk = docDigits.length === 11 || docDigits.length === 14;
  const dadosOk =
    name.trim().length >= 3 &&
    docOk &&
    phone.replace(/\D/g, '').length >= 11 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const hd = holderDocument.replace(/\D/g, '');
  const cardFieldsOk =
    cardNumber.replace(/\s/g, '').length >= 13 &&
    cardMonth.length === 2 &&
    cardYear.length === 2 &&
    cardCvv.length >= 3 &&
    holderName.trim().length >= 2 &&
    (hd.length === 11 || hd.length === 14);

  useEffect(() => {
    setMounted(true);
  }, []);

  // SSE com reconexão automática e fallback REST para não perder o evento de pagamento
  useEffect(() => {
    if (!pixDomId || !link) return;

    let done = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1500;

    const handleCompleted = async () => {
      if (done) return;
      done = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
      const redirectUrl: string | null = link.redirectUrl ?? null;
      setConfirmedOrderId(pixOrderId ?? null);
      setConfirmedRedirectUrl(redirectUrl);
      setEmailSent(true);
      setPaymentConfirmed(true);
    };

    const checkStatusFallback = async () => {
      if (done) return;
      try {
        const r = await fetch(`${SIM_API}/checkout/pix/${pixDomId}/status`);
        if (r.ok) {
          const d = await r.json();
          if (d.status === 'COMPLETED') void handleCompleted();
        }
      } catch {
        /* ignore */
      }
    };

    const connect = () => {
      if (done) return;
      es = new EventSource(`${SIM_API}/checkout/pix/${pixDomId}/sse`);
      es.addEventListener('payment-status', (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data);
          if (d.status === 'COMPLETED') void handleCompleted();
        } catch {
          /* ignore */
        }
      });
      es.addEventListener('heartbeat', () => {
        retryDelay = 1500;
      });
      es.onerror = () => {
        es?.close();
        es = null;
        if (done) return;
        // Immediately check if payment already went through while connection was down
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
  }, [pixDomId, pixOrderId, link]);

  useEffect(() => {
    if (!subscriptionLinkCode) {
      setFetching(false);
      return;
    }
    fetch(`${SIM_API}/links-assinatura/public/${subscriptionLinkCode}`)
      .then((r) => {
        if (!r.ok)
          throw new Error(`Link de assinatura não encontrado (${r.status})`);
        return r.json();
      })
      .then((data: LinkData) => {
        setLink(data);
        // PIX tem prioridade sempre que disponível
        if (data.aceitaPix) setPaymentMethod('pix');
        else if (data.aceitaCartao) setPaymentMethod('credit');
        else if (data.aceitaDebito) setPaymentMethod('debit');
      })
      .catch((err) =>
        setLinkError(err.message || 'Erro ao carregar link de assinatura'),
      )
      .finally(() => setFetching(false));
  }, [subscriptionLinkCode]);

  async function handleSubmit() {
    if (!link || !paymentMethod) return;
    setError('');
    setLoading(true);

    try {
      if (paymentMethod === 'pix') {
        const body = {
          customerName: name,
          customerEmail: email,
          customerDocument: document.replace(/\D/g, ''),
          customerPhone: phone.replace(/\D/g, ''),
          voucherCode: appliedVoucher ? voucherCode : undefined,
        };

        const res = await fetch(
          `${SIM_API}/links-assinatura/public/${link.codigo}/pix`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );

        const data = (await res.json()) as {
          id?: string;
          domPaymentId?: string;
          pixContent?: string;
          qrCode?: string;
          pixExpire?: string;
          message?: string;
        };
        if (!res.ok) {
          setError(data?.message ?? 'Erro ao gerar cobrança PIX');
          return;
        }

        setPixContent(data.pixContent ?? null);
        setPixQrCode(data.qrCode ?? null);
        setPixExpire(data.pixExpire ?? null);
        if (data.id) setPixOrderId(data.id);
        if (data.domPaymentId) setPixDomId(data.domPaymentId);
        return;
      }

      // Cartão de crédito
      const tokenRes = await getTokenCard(
        GATEWAY_PUBLIC_KEY,
        {
          name: holderName,
          document: holderDocument.replace(/\D/g, ''),
          number: cardNumber.replace(/\s/g, ''),
          cvv: cardCvv,
          month: cardMonth,
          year: cardYear,
        },
        1,
      );

      if (!tokenRes.token) {
        setError(tokenRes.msgError || 'Erro ao tokenizar cartão');
        return;
      }

      const body = {
        customerName: name,
        customerEmail: email,
        customerDocument: document.replace(/\D/g, ''),
        customerPhone: phone.replace(/\D/g, ''),
        paymentMethod: paymentMethod === 'debit' ? 'debit_card' : 'credit_card',
        card: {
          token: tokenRes.token,
          brand: tokenRes.brand,
          bin: tokenRes.bin,
          exp_month: cardMonth,
          exp_year: cardYear,
          cvv: cardCvv,
          holder_name: holderName,
          holder_document: holderDocument.replace(/\D/g, ''),
          number: cardNumber.replace(/\s/g, ''),
        },
        voucherCode: appliedVoucher ? voucherCode : undefined,
      };

      const res = await fetch(
        `${SIM_API}/links-assinatura/public/${link.codigo}/assinar`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      const data = (await res.json()) as {
        id?: string;
        message?: string;
        redirectUrl?: string | null;
      };
      if (!res.ok) {
        setError(data?.message ?? 'Erro ao criar assinatura');
        return;
      }

      // Cartão: backend já enviou o e-mail automaticamente — exibe sucesso inline
      const redirectUrl = data.redirectUrl ?? link.redirectUrl ?? null;
      setConfirmedOrderId(data.id ?? null);
      setConfirmedRedirectUrl(redirectUrl);
      setPaymentConfirmed(true);
      setEmailSent(true);
    } catch {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  if (fetching)
    return <CheckoutLoadingScreen message="Carregando a assinatura…" />;

  if (linkError || !link)
    return (
      <CheckoutErrorScreen
        title="Link não encontrado"
        message={linkError || 'Este link de assinatura não está disponível.'}
      />
    );

  if (paymentConfirmed)
    return (
      <CheckoutSuccessScreen
        eyebrow="Pagamento confirmado"
        headline="Sua assinatura foi ativada!"
        email={emailSent ? email : undefined}
        redirectUrl={confirmedRedirectUrl}
        accessLabel="Acessar"
        extra={
          confirmedOrderId ? (
            <p className="text-xs text-[#7d778b]">
              ID da assinatura:{' '}
              <span className="font-mono">{confirmedOrderId}</span>
            </p>
          ) : undefined
        }
      />
    );

  const statusItems =
    paymentMethod === 'pix'
      ? [
          { ok: dadosOk, label: 'Dados para cobrança PIX' },
          { ok: true, label: 'Forma: PIX selecionada' },
        ]
      : paymentMethod === 'credit'
        ? [
            { ok: dadosOk, label: 'Dados pessoais completos' },
            { ok: cardFieldsOk, label: 'Cartão e titular completos' },
          ]
        : [];

  const isPix = paymentMethod === 'pix';
  const isDebit = paymentMethod === 'debit';
  const hasPlatformFee = !link.isStandalone && (link.platformFee ?? 0) > 0;
  const feeAmount = hasPlatformFee
    ? Math.round(((link.valorComJuros ?? link.valor) - link.valor) * 100) / 100
    : 0;
  // PIX: cliente paga o valor base; cartão: valorComJuros (base + MDR embutido)
  const baseTotal = isPix ? link.valor : (link.valorComJuros ?? link.valor);
  const totalDisplay = appliedVoucher ? appliedVoucher.finalAmount : baseTotal;

  const isPagatg =
    link.platformTag === 'PAGATG' ||
    (typeof window !== 'undefined' &&
      (window.location.hostname.includes('pagatg') ||
        window.location.hostname.includes('jbmidia') ||
        window.location.hostname.includes('localhost')));

  const payLabel = isPix
    ? 'PIX'
    : isDebit
      ? 'Cartão de débito'
      : 'Cartão de crédito';

  const pixGenerated = isPix && Boolean(pixContent || pixQrCode);

  return (
    <CheckoutFlow
      product={{
        title: sanitizeCheckoutText(link.nome),
        description: link.descricao
          ? sanitizeCheckoutText(link.descricao)
          : undefined,
        price: formatCurrency(baseTotal),
        frequency: intervalLabel(link.frequencia),
      }}
      total={formatCurrency(totalDisplay)}
      totalCaption={intervalLabel(link.frequencia)}
      dadosSubtitle="Usados para emitir a cobrança e enviar seu acesso"
      validateDados={() => dadosOk}
      onSubmit={handleSubmit}
      finalLabel="Assinar agora"
      finalDisabled={!paymentMethod}
      loading={loading}
      error={error}
      finalAction={pixGenerated ? <></> : undefined}
      asideRows={
        <>
          <SummaryRow label="Pagamento" value={payLabel} />
          {appliedVoucher && (
            <SummaryRow
              label="Desconto"
              value={`- ${formatCurrency(appliedVoucher.discount)}`}
              accent
            />
          )}
        </>
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
                name="customer-document"
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
          {mounted && paymentMethod === 'credit' && link.aceitaCartao && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                visibility: 'hidden',
                pointerEvents: 'none',
                width: 0,
                height: 0,
                overflow: 'hidden',
              }}
            >
              <Cards number="" expiry="" cvc="" name="" focused="" />
            </div>
          )}

          {isPagatg && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-1">
                <div className="h-px flex-1 bg-white/5" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Cupom de Desconto
                </span>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <CheckoutGlassInput
                    placeholder="Tem um cupom?"
                    value={voucherCode}
                    onChange={setVoucherCode}
                    className={
                      voucherError
                        ? 'border-red-500/50'
                        : appliedVoucher
                          ? 'border-emerald-500/50'
                          : ''
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={handleValidateVoucher}
                  disabled={isValidatingVoucher || !voucherCode}
                  className="flex h-[42px] items-center justify-center rounded-lg bg-white/5 px-4 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-50"
                >
                  {isValidatingVoucher ? '...' : 'Aplicar'}
                </button>
              </div>
              {voucherError && (
                <p className="px-1 text-[10px] font-semibold text-red-400">
                  {voucherError}
                </p>
              )}
              {appliedVoucher && (
                <p className="px-1 text-[10px] font-semibold text-emerald-400">
                  Cupom aplicado com sucesso!
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-3 pt-1">
            {(link.aceitaCartao || link.aceitaPix) && (
              <div className="flex flex-wrap items-center gap-4 rounded-[20px] border border-white/[0.07] bg-white/[0.06] px-4 py-3">
                {link.aceitaCartao && (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-200">
                    <input
                      type="radio"
                      name="paymentMethod"
                      className="h-4 w-4 accent-[#f58a2a]"
                      checked={paymentMethod === 'credit'}
                      onChange={() => setPaymentMethod('credit')}
                    />
                    <CreditCardIcon className="h-4 w-4 shrink-0 text-[#d9d4e3]" />
                    Crédito
                  </label>
                )}
                {link.aceitaDebito && (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-200">
                    <input
                      type="radio"
                      name="paymentMethod"
                      className="h-4 w-4 accent-[#f58a2a]"
                      checked={paymentMethod === 'debit'}
                      onChange={() => setPaymentMethod('debit')}
                    />
                    <CreditCardIcon className="h-4 w-4 shrink-0 text-[#d9d4e3]" />
                    Débito
                  </label>
                )}
                {link.aceitaPix && (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-200">
                    <input
                      type="radio"
                      name="paymentMethod"
                      className="h-4 w-4 accent-[#f58a2a]"
                      checked={paymentMethod === 'pix'}
                      onChange={() => setPaymentMethod('pix')}
                    />
                    PIX
                  </label>
                )}
              </div>
            )}

            {(paymentMethod === 'credit' || paymentMethod === 'debit') &&
              link.aceitaCartao && (
                <>
                  {mounted && (
                    <CheckoutCardPreview>
                      <Cards
                        number={cardNumber}
                        expiry={`${cardMonth}/${cardYear}`}
                        cvc={cardCvv}
                        name={holderName || ' '}
                        focused={cardFocused}
                      />
                    </CheckoutCardPreview>
                  )}

                  <CheckoutGlassField label="Número do cartão" required>
                    <CheckoutGlassInput
                      name="cc-number"
                      placeholder="0000 0000 0000 0000"
                      value={cardNumber}
                      onChange={(v) => setCardNumber(maskCardNumber(v))}
                      onFocus={() => setCardFocused('number')}
                      inputMode="numeric"
                      autoComplete="cc-number"
                    />
                  </CheckoutGlassField>

                  <div className="grid grid-cols-2 gap-3">
                    <CheckoutGlassField label="Mês" required>
                      <CheckoutGlassInput
                        name="cc-exp-month"
                        placeholder="MM"
                        value={cardMonth}
                        onChange={(v) => setCardMonth(maskCardMonth(v))}
                        onFocus={() => setCardFocused('expiry')}
                        inputMode="numeric"
                        maxLength={2}
                        autoComplete="cc-exp-month"
                      />
                    </CheckoutGlassField>
                    <CheckoutGlassField label="Ano" required>
                      <CheckoutGlassInput
                        name="cc-exp-year"
                        placeholder="AA"
                        value={cardYear}
                        onChange={(v) => setCardYear(maskCardYear(v))}
                        onFocus={() => setCardFocused('expiry')}
                        inputMode="numeric"
                        maxLength={2}
                        autoComplete="cc-exp-year"
                      />
                    </CheckoutGlassField>
                  </div>

                  <CheckoutGlassField label="CVV" required>
                    <CheckoutGlassInput
                      name="cc-csc"
                      placeholder="000 ou 0000"
                      value={cardCvv}
                      onChange={(v) => setCardCvv(maskCvv(v))}
                      onFocus={() => setCardFocused('cvc')}
                      inputMode="numeric"
                      maxLength={4}
                      autoComplete="cc-csc"
                    />
                  </CheckoutGlassField>

                  <CheckoutGlassField label="Nome do titular" required>
                    <CheckoutGlassInput
                      name="cc-name"
                      placeholder="Como no cartão"
                      value={holderName}
                      onChange={setHolderName}
                      onFocus={() => setCardFocused('name')}
                      autoComplete="cc-name"
                    />
                  </CheckoutGlassField>

                  <CheckoutGlassField label="CPF / CNPJ do titular" required>
                    <CheckoutGlassInput
                      placeholder="000.000.000-00 ou 00.000.000/0000-00"
                      value={holderDocument}
                      onChange={(v) => setHolderDocument(maskCpfCnpj(v))}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </CheckoutGlassField>
                </>
              )}

            {paymentMethod === 'pix' && link.aceitaPix && !pixContent && (
              <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                <p className="text-sm text-zinc-300">
                  Para continuar com o pagamento via Pix, clique em{' '}
                  <strong className="text-white">Efetuar pagamento</strong>{' '}
                  abaixo. O código copia e cola será gerado automaticamente.
                </p>
              </div>
            )}

            {paymentMethod === 'pix' &&
              link.aceitaPix &&
              (pixContent || pixQrCode) && (
                <PixDisplay
                  pixContent={pixContent}
                  qrCode={pixQrCode}
                  pixExpire={pixExpire}
                />
              )}
          </div>
        </>
      }
      status={<CheckoutStatusCard error={error} items={statusItems} />}
    />
  );
}
