'use client';

/**
 * Checkout público de oferta avulsa (`?ofertaCode=`): PIX, crédito (com parcelas) e débito.
 * Lê `GET /ofertas/public/:code` e cobra em `POST /ofertas/public/:code/charge`, reutilizando
 * CheckoutFlow, os campos de vidro, o cartão ilustrado e o PIX do restante do checkout.
 * Ofertas recorrentes ainda não têm endpoint de assinatura: mostram "indisponível por enquanto".
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { CheckCircle, Loader2 } from 'lucide-react';
import { getTokenCard } from '@/components/sdk';
import { SIM_API_URL } from '@/lib/api-config';
import { CheckoutFlow } from '@/components/checkout/CheckoutFlow';
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
import { StatusPill, SummaryRow } from '@/components/checkout/ui';
import {
  PixDisplay,
  usePixConfirmation,
} from '@/components/simlink/PixPayment';
import {
  maskCardMonth,
  maskCardNumber,
  maskCardYear,
  maskCpfCnpj,
  maskCvv,
  maskPhoneBr,
} from '@/lib/input-masks';
import { buildInstallmentLabel } from '@/lib/installment-label';
import { browserCheckoutTracking } from '@/lib/payment-tracking';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import {
  availableMethods,
  chargeBody,
  isDeclined,
  isRecurringOffer,
  offerAmount,
  recurrenceNotice,
  type OfferMethod,
  type PublicOffer,
} from '@/lib/offer-checkout-model';

const Cards = dynamic(() => import('react-credit-cards-2'), {
  ssr: false,
  loading: () => null,
});

/** Chave pública do gateway (tokenização de cartão) */
const GATEWAY_PUBLIC_KEY = 'pk_4ce776b5-0d68-4fbe-b1eb-be10c94ca4e6';

type InstallmentOption = {
  installments: number;
  totalAmount: number;
  installmentAmount: number;
  interestAmount?: number;
};

const money = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const METHOD_TITLE: Record<OfferMethod, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
};

export default function OfferCheckout() {
  const code = useSearchParams().get('ofertaCode');
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [fetching, setFetching] = useState(Boolean(code));
  const [offerError, setOfferError] = useState('');
  const [method, setMethod] = useState<OfferMethod>('pix');
  const [options, setOptions] = useState<InstallmentOption[]>([]);
  const [installments, setInstallments] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  const [pix, setPix] = useState<{
    id: string;
    content: string | null;
    qrCode: string | null;
    expire: string | null;
  } | null>(null);

  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardMonth, setCardMonth] = useState('');
  const [cardYear, setCardYear] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [holderName, setHolderName] = useState('');
  const [holderDocument, setHolderDocument] = useState('');
  const [cardFocused, setCardFocused] = useState<
    'number' | 'expiry' | 'cvc' | 'name' | ''
  >('');

  useEffect(() => {
    if (!code) return;
    fetch(`${SIM_API_URL}/ofertas/public/${encodeURIComponent(code)}`)
      .then((r) => {
        if (!r.ok) throw new Error('Esta oferta não está disponível.');
        return r.json();
      })
      .then((data: PublicOffer) => {
        setOffer(data);
        const methods = availableMethods(data);
        if (methods.length) setMethod(methods[0]);
        if (methods.includes('credit_card') && data.maxInstallments > 1) {
          fetch(`${SIM_API_URL}/checkout/card/installment-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              price: offerAmount(data),
              store: 'GLOBAL',
              maxInstallments: data.maxInstallments,
            }),
          })
            .then((res) => res.json())
            .then((quote) => {
              if (Array.isArray(quote?.options)) setOptions(quote.options);
            })
            .catch(() => setOptions([]));
        }
      })
      .catch((err: Error) => setOfferError(err.message))
      .finally(() => setFetching(false));
  }, [code]);

  usePixConfirmation(pix?.id ?? null, paidAmount !== null, () =>
    setPaidAmount(offer ? offerAmount(offer) : 0),
  );

  const docDigits = document.replace(/\D/g, '');
  const dadosOk =
    name.trim().length >= 3 &&
    (docDigits.length === 11 || docDigits.length === 14) &&
    phone.replace(/\D/g, '').length >= 11 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const holderDigits = holderDocument.replace(/\D/g, '');
  const cardOk =
    cardNumber.replace(/\s/g, '').length >= 13 &&
    cardMonth.length === 2 &&
    cardYear.length === 2 &&
    cardCvv.length >= 3 &&
    holderName.trim().length >= 2 &&
    (holderDigits.length === 11 || holderDigits.length === 14);
  const isCard = method !== 'pix';

  async function handleSubmit() {
    if (!offer || !code) return;
    setError('');
    setLoading(true);
    try {
      const customer = {
        name,
        email,
        document: docDigits,
        phone: phone.replace(/\D/g, ''),
      };
      let card;
      if (isCard) {
        const chosen = method === 'debit_card' ? 1 : installments;
        const tokenRes = await getTokenCard(
          GATEWAY_PUBLIC_KEY,
          {
            name: holderName,
            document: holderDigits,
            number: cardNumber.replace(/\s/g, ''),
            cvv: cardCvv,
            month: cardMonth,
            year: cardYear,
          },
          chosen,
        );
        if (!tokenRes.token) {
          setError(tokenRes.msgError || 'Erro ao tokenizar cartão');
          return;
        }
        card = {
          token: tokenRes.token,
          brand: tokenRes.brand,
          bin: tokenRes.bin,
          exp_month: cardMonth,
          exp_year: cardYear,
          cvv: cardCvv,
          holder_name: holderName,
          holder_document: holderDigits,
          number: cardNumber.replace(/\s/g, ''),
        };
      }
      const res = await fetch(
        `${SIM_API_URL}/ofertas/public/${encodeURIComponent(code)}/charge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...chargeBody({ method, customer, installments, card }),
            tracking: browserCheckoutTracking(),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? 'Erro ao processar pagamento');
        return;
      }
      if (method === 'pix') {
        setPix({
          id: data.id,
          content: data.pixContent ?? null,
          qrCode: data.qrCode ?? null,
          expire: data.pixExpire ?? null,
        });
        return;
      }
      if (isDeclined(data.status)) {
        setError('Pagamento recusado. Confira os dados ou use outro cartão.');
        return;
      }
      setRedirectUrl(data.redirectUrl ?? null);
      setPaidAmount(Number(data.amount) || offerAmount(offer));
    } catch {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  if (fetching) return <CheckoutLoadingScreen message="Carregando a oferta…" />;
  if (offerError || !offer)
    return (
      <CheckoutErrorScreen
        title="Oferta não encontrada"
        message={offerError || 'Esta oferta não está disponível.'}
      />
    );
  if (isRecurringOffer(offer))
    return (
      <CheckoutErrorScreen
        title="Indisponível por enquanto"
        message={recurrenceNotice(offer)}
      />
    );
  const methods = availableMethods(offer);
  if (methods.length === 0)
    return (
      <CheckoutErrorScreen
        title="Indisponível por enquanto"
        message="Esta oferta ainda não aceita as formas de pagamento deste checkout."
      />
    );

  const base = offerAmount(offer);
  const selected = options.find((o) => o.installments === installments);
  const total =
    isCard && method === 'credit_card' && selected
      ? selected.totalAmount
      : base;

  if (paidAmount !== null)
    return (
      <CheckoutSuccessScreen
        headline={`${money(paidAmount)} pagos com sucesso`}
        email={email}
        redirectUrl={redirectUrl}
        total={money(paidAmount)}
        rows={
          <>
            <SummaryRow
              label={sanitizeCheckoutText(offer.name)}
              value={money(base)}
            />
            <SummaryRow muted label="Forma" value={METHOD_TITLE[method]} last />
          </>
        }
      />
    );

  return (
    <CheckoutFlow
      product={{
        title: sanitizeCheckoutText(offer.name),
        description: offer.description
          ? sanitizeCheckoutText(offer.description)
          : undefined,
        price: money(base),
        frequency: 'Pagamento único',
      }}
      total={money(total)}
      totalCaption="Pagamento único"
      dadosSubtitle="Usados para emitir a cobrança e enviar seu acesso"
      validateDados={() => dadosOk}
      onSubmit={handleSubmit}
      finalLabel="Efetuar pagamento"
      finalDisabled={isCard && !cardOk}
      loading={loading}
      error={error}
      finalAction={
        pix ? (
          <StatusPill>
            <Loader2 className="h-4 w-4 animate-spin" />
            Aguardando pagamento…
          </StatusPill>
        ) : undefined
      }
      dados={
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
      }
      pagamento={
        <div className="flex flex-col gap-3 pt-1">
          <div
            role="radiogroup"
            aria-label="Forma de pagamento"
            className="flex flex-col gap-2"
          >
            {methods.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={method === item}
                data-testid={`method-${item}`}
                disabled={Boolean(pix) || loading}
                onClick={() => {
                  setMethod(item);
                  setError('');
                  if (item !== 'credit_card') setInstallments(1);
                }}
                className={`flex items-center gap-3 rounded-[20px] border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed ${
                  method === item
                    ? 'border-[rgba(240,168,108,.7)] bg-white/[0.1]'
                    : 'border-white/[0.07] bg-white/[0.06]'
                }`}
              >
                <CheckCircle
                  className={`h-4 w-4 shrink-0 ${method === item ? 'text-[#f6b67a]' : 'text-[#6f6a7d]'}`}
                />
                <span className="text-sm font-semibold text-zinc-100">
                  {METHOD_TITLE[item]}
                </span>
              </button>
            ))}
          </div>

          {method === 'pix' && !pix && (
            <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
              <p className="text-sm text-zinc-300">
                Preencha seus dados e clique em{' '}
                <strong className="text-white">Efetuar pagamento</strong>. O
                código PIX será gerado automaticamente.
              </p>
            </div>
          )}
          {method === 'pix' && pix && (pix.content || pix.qrCode) && (
            <PixDisplay
              pixContent={pix.content}
              qrCode={pix.qrCode}
              pixExpire={pix.expire}
              amount={base}
            />
          )}

          {isCard && (
            <>
              <CheckoutCardPreview>
                <Cards
                  number={cardNumber}
                  expiry={`${cardMonth}/${cardYear}`}
                  cvc={cardCvv}
                  name={holderName || ' '}
                  focused={cardFocused}
                />
              </CheckoutCardPreview>
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
              {method === 'credit_card' && offer.maxInstallments > 1 && (
                <CheckoutGlassField label="Parcelas">
                  <div
                    role="radiogroup"
                    aria-label="Parcelas"
                    className="flex flex-col gap-2"
                  >
                    {Array.from(
                      { length: offer.maxInstallments },
                      (_, i) => i + 1,
                    ).map((n) => {
                      const option = options.find((o) => o.installments === n);
                      return (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={installments === n}
                          data-testid={`installments-${n}`}
                          onClick={() => setInstallments(n)}
                          className={`rounded-[16px] border px-4 py-3 text-left text-sm transition-colors ${
                            installments === n
                              ? 'border-[rgba(240,168,108,.7)] bg-white/[0.1] text-white'
                              : 'border-white/[0.07] bg-white/[0.06] text-zinc-300'
                          }`}
                        >
                          {option
                            ? buildInstallmentLabel({
                                installments: n,
                                perInstallment: option.installmentAmount,
                                total: option.totalAmount,
                                interestAmount: option.interestAmount,
                                formatCurrency: money,
                              })
                            : `${n}x`}
                        </button>
                      );
                    })}
                  </div>
                </CheckoutGlassField>
              )}
            </>
          )}
        </div>
      }
      status={
        <CheckoutStatusCard
          error={error}
          items={[
            { ok: dadosOk, label: 'Dados pessoais completos' },
            ...(isCard
              ? [{ ok: cardOk, label: 'Cartão e titular preenchidos' }]
              : []),
          ]}
        />
      }
    />
  );
}
