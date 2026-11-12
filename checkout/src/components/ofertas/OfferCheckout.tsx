'use client';

/**
 * Checkout público de oferta avulsa (`?oferta=`): PIX, crédito (com parcelas), débito e boleto.
 * Lê `GET /ofertas/public/:code` e cobra em `POST /ofertas/public/:code/charge`, reutilizando
 * CheckoutFlow, os campos de vidro, o cartão ilustrado e o PIX do restante do checkout.
 * Ofertas recorrentes (`renewalMode` AUTO_CHARGE com cartão, MANUAL_PAY com PIX) usam
 * `card-customer` + `subscribe`: o cartão é tokenizado no navegador (SDK) e só o token vai à API.
 */
import { useEffect, useRef, useState } from 'react';
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
import { GLASS, StatusPill, SummaryRow } from '@/components/checkout/ui';
import { OrderBumpCard } from '@/components/simlink/LinkOffers';
import { cx } from '@/utils/cx';
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
import { validateBoletoCheckout } from '@/lib/boleto-checkout-validation';
import { InstallmentSelect } from './InstallmentSelect';
import { OfferVoucherField } from './OfferVoucherField';
import { voucherField, type AppliedVoucher } from '@/lib/offer-voucher-model';
import { browserCheckoutTracking } from '@/lib/payment-tracking';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import {
  availableMethods,
  chargeBody,
  isDeclined,
  isRecurringOffer,
  mapBoletoResponse,
  offerAmount,
  orderBumpsOf,
  type BoletoAddressFields,
  type BoletoResult,
  type OfferMethod,
  type PublicOffer,
  type OfferCheckoutPricing,
} from '@/lib/offer-checkout-model';
import {
  EMPTY_ADDRESS,
  OfferBoletoAddress,
  OfferBoletoResult,
} from './OfferBoleto';
import {
  cardCustomerBody,
  cardLast4,
  consentText,
  frequencyLabel,
  mapSubscribeError,
  mapSubscribeResponse,
  parseCardExpiry,
  renewalNotice,
  subscribeBody,
  subscribeMethods,
  trialDaysOf,
  trialNotice,
  type SubscribeOutcome,
  type SubscribeResponse,
} from '@/lib/offer-subscribe-model';

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
  boleto: 'Boleto bancário',
};

/** Recorrente: cartão (só AUTO_CHARGE) e PIX conforme aceitos; avulsa: PIX/crédito/débito. */
function methodsOf(offer: PublicOffer): OfferMethod[] {
  if (!isRecurringOffer(offer)) return availableMethods(offer);
  return subscribeMethods(offer);
}

export default function OfferCheckout({
  previewOffer,
  onPreviewLoaded,
  previewPricing,
}: {
  previewOffer?: PublicOffer;
  onPreviewLoaded?: () => void;
  /** Prévia: pede ao painel o preço com os order bumps marcados. */
  previewPricing?: (bumpCodes: string[]) => Promise<OfferCheckoutPricing>;
} = {}) {
  const searchParams = useSearchParams();
  const code = searchParams.get('oferta');
  const [offer, setOffer] = useState<PublicOffer | null>(previewOffer ?? null);
  const [fetching, setFetching] = useState(!previewOffer && Boolean(code));
  const [offerError, setOfferError] = useState('');
  const [method, setMethod] = useState<OfferMethod>(
    previewOffer ? (methodsOf(previewOffer)[0] ?? 'pix') : 'pix',
  );
  const [options, setOptions] = useState<InstallmentOption[]>(
    previewOffer?.pricing?.options ?? [],
  );
  const [pricing, setPricing] = useState<OfferCheckoutPricing | null>(
    previewOffer?.pricing ?? null,
  );
  const [pricingLoading, setPricingLoading] = useState(!previewOffer);
  const [pricingError, setPricingError] = useState('');
  const [pricingAttempt, setPricingAttempt] = useState(0);
  const [selectedBumps, setSelectedBumps] = useState<string[]>([]);
  const previewRequest = useRef(0);
  /** Última seleção de bumps que a prévia conseguiu precificar. */
  const pricedBumps = useRef<string[]>([]);
  const [installments, setInstallments] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<
    SubscribeOutcome,
    { kind: 'paid' | 'trial' }
  > | null>(null);
  const [consent, setConsent] = useState(false);
  const [voucher, setVoucher] = useState<AppliedVoucher | null>(null);
  const [blocked, setBlocked] = useState(false);

  const [boleto, setBoleto] = useState<BoletoResult | null>(null);
  const [address, setAddress] = useState<BoletoAddressFields>(EMPTY_ADDRESS);
  const [pix, setPix] = useState<{
    id: string;
    content: string | null;
    qrCode: string | null;
    expire: string | null;
  } | null>(null);

  // Dados já informados pelo parceiro (?name=&document=&email=&phone=) iniciam preenchidos.
  const [name, setName] = useState(
    () => searchParams.get('name')?.trim() ?? '',
  );
  const [document, setDocument] = useState(() =>
    maskCpfCnpj(searchParams.get('document') ?? ''),
  );
  const [email, setEmail] = useState(
    () => searchParams.get('email')?.trim() ?? '',
  );
  const [phone, setPhone] = useState(() =>
    maskPhoneBr(searchParams.get('phone') ?? ''),
  );
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
    if (previewOffer || !code) return;
    fetch(`${SIM_API_URL}/ofertas/public/${encodeURIComponent(code)}`)
      .then((r) => {
        if (!r.ok) throw new Error('Esta oferta não está disponível.');
        return r.json();
      })
      .then((data: PublicOffer) => {
        setOffer(data);
        const methods = methodsOf(data);
        if (methods.length) setMethod(methods[0]);
      })
      .catch((err: Error) => setOfferError(err.message))
      .finally(() => setFetching(false));
  }, [code, previewOffer]);

  useEffect(() => {
    if (previewOffer || !offer || !code) return;
    const controller = new AbortController();
    const query = selectedBumps.length
      ? `?bumps=${encodeURIComponent(selectedBumps.join(','))}`
      : '';
    fetch(
      `${SIM_API_URL}/ofertas/public/${encodeURIComponent(code)}/pricing${query}`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (!r.ok)
          throw new Error(
            'Não foi possível calcular o preço. Tente novamente.',
          );
        return r.json();
      })
      .then((data: OfferCheckoutPricing) => {
        setPricing(data);
        setOptions(data.options);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setPricingError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPricingLoading(false);
      });
    return () => controller.abort();
  }, [offer, code, previewOffer, pricingAttempt, selectedBumps]);

  useEffect(() => {
    if (previewOffer) onPreviewLoaded?.();
  }, [previewOffer, onPreviewLoaded]);

  // O mesmo SSE/polling do PIX serve ao boleto: a chave é o id do pagamento no gateway.
  usePixConfirmation(
    pix?.id ?? boleto?.paymentId ?? null,
    paidAmount !== null,
    () => setPaidAmount(boleto?.amount ?? (offer ? offerAmount(offer) : 0)),
  );
  const recurring = offer ? isRecurringOffer(offer) : false;
  const autoCharge =
    offer?.renewalMode === 'AUTO_CHARGE' && method === 'credit_card';

  const docDigits = document.replace(/\D/g, '');
  const dadosOk =
    name.trim().length >= 3 &&
    (docDigits.length === 11 || docDigits.length === 14) &&
    phone.replace(/\D/g, '').length >= 11 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  // Assinatura: o SDK exige um documento, usa-se o do comprador; ele não é pedido nem enviado à API.
  const holderDigits = recurring
    ? docDigits
    : holderDocument.replace(/\D/g, '');
  const cardOk =
    cardNumber.replace(/\s/g, '').length >= 13 &&
    cardMonth.length === 2 &&
    cardYear.length === 2 &&
    cardCvv.length >= 3 &&
    holderName.trim().length >= 2 &&
    (holderDigits.length === 11 || holderDigits.length === 14);
  const methods = offer ? methodsOf(offer) : [];
  const hasMethod = methods.includes(method);
  const isCard =
    hasMethod && (method === 'credit_card' || method === 'debit_card');
  const isBoleto = hasMethod && method === 'boleto';
  const addressOk = validateBoletoCheckout({
    name,
    document,
    phone,
    email,
    ...address,
  }).enderecoOk;

  /** AUTO_CHARGE: card-customer -> SDK (token no navegador) -> subscribe. Só o token vai à API. */
  async function subscribe() {
    if (
      previewOffer ||
      !offer ||
      !code ||
      !hasMethod ||
      !pricing ||
      pricingLoading ||
      pricingError
    )
      return;
    const target = `${SIM_API_URL}/ofertas/public/${encodeURIComponent(code)}`;
    const post = (path: string, body: unknown) =>
      fetch(`${target}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const customer = {
      name,
      email,
      document: docDigits,
      phone: phone.replace(/\D/g, ''),
    };
    let card;
    if (method === 'credit_card') {
      const expiry = parseCardExpiry(cardMonth, cardYear);
      if (!expiry || expiry.expired) {
        setError('Validade do cartão inválida ou vencida.');
        return;
      }
      const customerRes = await post(
        'card-customer',
        cardCustomerBody(customer),
      );
      const customerData = await customerRes.json().catch(() => ({}));
      if (!customerRes.ok) {
        const failure = mapSubscribeError(customerRes.status, customerData);
        setBlocked(!failure.retryable);
        setError(failure.message);
        return;
      }
      const tokenized = await getTokenCard(customerData.publicKey, {
        name: holderName,
        document: holderDigits,
        customer_id: customerData.customerId,
        number: cardNumber.replace(/\s/g, ''),
        cvv: cardCvv,
        month: cardMonth,
        year: cardYear,
      });
      if (!tokenized.token) {
        setError(tokenized.msgError || 'Erro ao validar o cartão');
        return;
      }
      card = {
        tokenized,
        customerId: String(customerData.customerId),
        last4: cardLast4(cardNumber),
        expMonth: expiry.month,
        expYear: expiry.year,
        holderName,
      };
    }
    const res = await post(
      'subscribe',
      subscribeBody({
        method: method === 'pix' ? 'pix' : 'credit_card',
        customer,
        card,
        tracking: browserCheckoutTracking(),
        ...(voucher ? { voucherCode: voucher.code } : {}),
      }),
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const failure = mapSubscribeError(res.status, data);
      setBlocked(!failure.retryable);
      setError(failure.message);
      return;
    }
    const outcome = mapSubscribeResponse(data as SubscribeResponse);
    if (outcome.kind === 'pix') {
      if (outcome.transactionId && (outcome.pixContent || outcome.qrCode))
        setPix({
          id: outcome.transactionId,
          content: outcome.pixContent,
          qrCode: outcome.qrCode,
          expire: outcome.pixExpire,
        });
      else setError('Não foi possível gerar o PIX agora. Tente novamente.');
      return;
    }
    setRedirectUrl(outcome.redirectUrl);
    setDone(outcome);
    setPaidAmount(outcome.amount);
  }

  /** Prévia: o painel recalcula o preço; respostas antigas são descartadas. */
  function repricePreview(codes: string[]) {
    if (!previewPricing) return;
    const request = ++previewRequest.current;
    setPricingError('');
    setPricingLoading(true);
    previewPricing(codes)
      .then((priced) => {
        if (request !== previewRequest.current) return;
        pricedBumps.current = codes;
        setPricing(priced);
        setOptions(priced.options);
      })
      .catch((e: Error) => {
        if (request !== previewRequest.current) return;
        // Total e seleção não podem divergir: volta à última seleção precificada.
        setSelectedBumps(pricedBumps.current);
        setPricingError(e.message);
      })
      .finally(() => {
        if (request === previewRequest.current) setPricingLoading(false);
      });
  }

  /** Marca/desmarca um order bump e recalcula o preço (na prévia, pedindo o preço ao painel). */
  function toggleBump(bumpCode: string) {
    const next = selectedBumps.includes(bumpCode)
      ? selectedBumps.filter((c) => c !== bumpCode)
      : [...selectedBumps, bumpCode];
    setSelectedBumps(next);
    if (previewOffer) {
      repricePreview(next);
      return;
    }
    setPricingError('');
    setPricingLoading(true);
  }

  async function handleSubmit() {
    if (
      previewOffer ||
      !offer ||
      !code ||
      !hasMethod ||
      !pricing ||
      pricingLoading ||
      pricingError
    )
      return;
    setError('');
    setLoading(true);
    try {
      if (recurring) {
        await subscribe();
        return;
      }
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
            ...chargeBody({
              method,
              customer,
              installments,
              card,
              address: isBoleto ? address : undefined,
              bumpCodes: selectedBumps,
              ...voucherField(voucher),
            }),
            tracking: browserCheckoutTracking(),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? 'Erro ao processar pagamento');
        return;
      }
      if (method === 'boleto') {
        const issued = mapBoletoResponse(data);
        if (issued) setBoleto(issued);
        else
          setError('Não foi possível gerar o boleto agora. Tente novamente.');
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
  if (blocked)
    return (
      <CheckoutErrorScreen title="Não foi possível concluir" message={error} />
    );
  const bumps = orderBumpsOf(offer);
  const chosenBumps = bumps.filter((b) => selectedBumps.includes(b.code));
  const base =
    offerAmount(offer) +
    chosenBumps.reduce((n, b) => n + b.amountCents, 0) / 100;
  // Com cupom, os preços vêm da API já calculados sobre o valor descontado.
  const activePricing = voucher ? voucher.quote.pricing : pricing;
  const activeOptions = voucher ? voucher.quote.pricing.options : options;
  const discount = voucher ? voucher.quote.discountAmountCents / 100 : 0;
  const selected = activeOptions.find((o) => o.installments === installments);
  const total =
    isCard && method === 'credit_card' && selected
      ? selected.totalAmount
      : method === 'pix'
        ? (activePricing?.pixAmount ?? base - discount)
        : method === 'debit_card'
          ? (activePricing?.debitAmount ?? base - discount)
          : method === 'boleto'
            ? (activePricing?.boletoAmount ?? base - discount)
            : base - discount;

  if (paidAmount !== null && recurring) {
    const next = done?.nextChargeAt
      ? new Date(done.nextChargeAt).toLocaleDateString('pt-BR')
      : null;
    const trial = done?.kind === 'trial';
    return (
      <CheckoutSuccessScreen
        eyebrow={trial ? 'Teste grátis ativado' : 'Assinatura confirmada'}
        headline={
          done?.existing
            ? 'Você já tem esta assinatura'
            : trial
              ? 'Teste grátis ativado'
              : `${money(paidAmount)} pagos com sucesso`
        }
        email={email}
        redirectUrl={redirectUrl}
        total={money(trial ? 0 : base)}
        rows={
          <>
            <SummaryRow
              label={sanitizeCheckoutText(offer.name)}
              value={`${money(base)} · ${frequencyLabel(offer)}`}
            />
            {trial && <SummaryRow muted label="Hoje" value={money(0)} />}
            {next && (
              <SummaryRow
                muted
                label={autoCharge ? 'Próxima cobrança' : 'Próximo aviso'}
                value={next}
                last
              />
            )}
          </>
        }
      />
    );
  }

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
        price: money(offerAmount(offer)),
        frequency: recurring ? frequencyLabel(offer) : 'Pagamento único',
        itemsLabel: `${1 + chosenBumps.length} ${chosenBumps.length ? 'itens' : 'item'}`,
      }}
      total={recurring && trialDaysOf(offer) > 0 ? money(0) : money(total)}
      totalCaption={recurring ? frequencyLabel(offer) : 'Pagamento único'}
      orderExtra={
        <>
          {bumps.length > 0 && (
            <div
              className={cx(
                'flex flex-col gap-2.5 rounded-[26px] p-3.5 lg:gap-3.5 lg:rounded-[28px] lg:p-6',
                GLASS,
              )}
            >
              <div className="px-1 pb-1 pt-0.5 lg:p-0">
                <div className="text-base lg:text-2xl lg:font-medium">
                  Aproveite também
                </div>
                <div className="mt-0.5 text-xs text-[#a9a3b8] lg:mt-1 lg:text-sm">
                  Condições disponíveis só nesta compra
                </div>
              </div>
              {bumps.map((bump) => (
                <OrderBumpCard
                  key={bump.code}
                  offer={{
                    id: bump.code,
                    tipo: 'ORDER_BUMP',
                    chamada: null,
                    titulo: bump.name,
                    descricao: bump.description,
                    imagemUrl: null,
                    valor: bump.amountCents / 100,
                    valorOriginal: null,
                  }}
                  checked={selectedBumps.includes(bump.code)}
                  disabled={loading || pricingLoading || Boolean(pix || boleto)}
                  onToggle={() => toggleBump(bump.code)}
                />
              ))}
            </div>
          )}
          {pricingError && (
            <button
              type="button"
              onClick={() => {
                if (previewOffer) return repricePreview(selectedBumps);
                setPricingLoading(true);
                setPricingError('');
                setPricingAttempt((v) => v + 1);
              }}
            >
              Tentar calcular novamente
            </button>
          )}
        </>
      }
      asideRows={
        <>
          {chosenBumps.map((b) => (
            <SummaryRow
              key={b.code}
              accent
              label={`+ ${sanitizeCheckoutText(b.name)}`}
              value={money(b.amountCents / 100)}
            />
          ))}
          {voucher && (
            <SummaryRow
              label={`Cupom ${voucher.code}`}
              value={`- ${money(discount)}`}
            />
          )}
          {recurring && trialDaysOf(offer) > 0 ? (
            <SummaryRow
              muted
              label={`Após ${trialDaysOf(offer)} dias`}
              value={money(base)}
              last
            />
          ) : null}
        </>
      }
      dadosSubtitle="Usados para emitir a cobrança e enviar seu acesso"
      validateDados={() => Boolean(previewOffer) || dadosOk}
      onSubmit={handleSubmit}
      finalLabel={
        recurring
          ? trialDaysOf(offer) > 0
            ? 'Começar teste grátis'
            : 'Assinar'
          : isBoleto
            ? 'Gerar boleto'
            : 'Efetuar pagamento'
      }
      finalDisabled={
        Boolean(previewOffer) ||
        !pricing ||
        pricingLoading ||
        Boolean(pricingError) ||
        !hasMethod ||
        (isCard && !cardOk) ||
        (isBoleto && !addressOk) ||
        (autoCharge && !consent) ||
        Boolean(boleto)
      }
      loading={loading || pricingLoading}
      error={pricingError || error}
      finalAction={
        pix || boleto ? (
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
          {code && !previewOffer && !(recurring && trialDaysOf(offer) > 0) && (
            <OfferVoucherField
              offerCode={code}
              applied={voucher}
              onChange={(next) => {
                setVoucher(next);
                setInstallments(1);
              }}
              disabled={Boolean(pix) || Boolean(boleto) || loading}
            />
          )}
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
                disabled={Boolean(pix) || Boolean(boleto) || loading}
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

          {hasMethod && recurring && (
            <div
              data-testid="recurrence-notice"
              className="flex flex-col gap-1 rounded-lg border border-white/10 bg-black/25 px-4 py-3 text-sm text-zinc-300"
            >
              <p className="font-semibold text-white">
                {renewalNotice(
                  offer,
                  money(base),
                  method === 'credit_card' ? 'credit_card' : 'pix',
                )}
              </p>
              {trialNotice(offer) && (
                <p data-testid="trial-notice">{trialNotice(offer)}</p>
              )}
            </div>
          )}
          {hasMethod && method === 'pix' && !pix && !recurring && (
            <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
              <p className="text-sm text-zinc-300">
                Preencha seus dados e clique em{' '}
                <strong className="text-white">Efetuar pagamento</strong>. O
                código PIX será gerado automaticamente.
              </p>
            </div>
          )}
          {hasMethod && method === 'pix' && !pix && recurring && (
            <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
              <p className="text-sm text-zinc-300">
                Clique em{' '}
                <strong className="text-white">
                  {trialDaysOf(offer) > 0 ? 'Começar teste grátis' : 'Assinar'}
                </strong>{' '}
                para gerar o PIX do primeiro ciclo.
              </p>
            </div>
          )}
          {isBoleto && !boleto && (
            <OfferBoletoAddress value={address} onChange={setAddress} />
          )}
          {isBoleto && boleto && <OfferBoletoResult boleto={boleto} />}
          {hasMethod &&
            method === 'pix' &&
            pix &&
            (pix.content || pix.qrCode) && (
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
              {!recurring && (
                <CheckoutGlassField label="CPF / CNPJ do titular" required>
                  <CheckoutGlassInput
                    placeholder="000.000.000-00 ou 00.000.000/0000-00"
                    value={holderDocument}
                    onChange={(v) => setHolderDocument(maskCpfCnpj(v))}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </CheckoutGlassField>
              )}
              {autoCharge && (
                <div className="flex items-start gap-3 text-sm text-zinc-200">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={consent}
                    aria-label="Autorizo a cobrança automática"
                    data-testid="consent"
                    onClick={() => setConsent((v) => !v)}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                      consent
                        ? 'border-[rgba(240,168,108,.9)] bg-[rgba(240,168,108,.9)]'
                        : 'border-white/30 bg-white/[0.06]'
                    }`}
                  >
                    {consent && <CheckCircle className="h-4 w-4 text-black" />}
                  </button>
                  <span>{consentText(offer, money(base))}</span>
                </div>
              )}
              {!recurring &&
                method === 'credit_card' &&
                offer.maxInstallments > 1 && (
                  <CheckoutGlassField label="Parcelas">
                    <InstallmentSelect
                      options={activeOptions}
                      value={installments}
                      onChange={setInstallments}
                      disabled={
                        pricingLoading || Boolean(pricingError) || !pricing
                      }
                    />
                  </CheckoutGlassField>
                )}
            </>
          )}
        </div>
      }
      status={
        <CheckoutStatusCard
          error={pricingError || error}
          items={[
            { ok: dadosOk, label: 'Dados pessoais completos' },
            ...(isCard
              ? [{ ok: cardOk, label: 'Cartão e titular preenchidos' }]
              : []),
            ...(isBoleto
              ? [{ ok: addressOk, label: 'Endereço do pagador' }]
              : []),
            ...(autoCharge
              ? [{ ok: consent, label: 'Cobrança automática autorizada' }]
              : []),
          ]}
        />
      }
    />
  );
}
