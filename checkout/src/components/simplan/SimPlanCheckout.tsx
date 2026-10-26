'use client';
import { SIM_API_URL } from '@/lib/api-config';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  CheckCircle,
  CreditCard as CreditCardIcon,
  AlertCircle,
  User,
  DollarSign,
  Loader2,
} from 'lucide-react';
import { getTokenCard } from '@/components/sdk';
import { CheckoutAccordionSection } from '@/components/checkout/CheckoutAccordionSection';
import { CheckoutFooter } from '@/components/checkout/CheckoutChrome';
import { CheckoutCartLottie } from '@/components/checkout/CheckoutCartLottie';
import {
  CheckoutGlassField,
  CheckoutGlassInput,
} from '@/components/checkout/CheckoutFormPrimitives';
import {
  CheckoutSummaryBranding,
  CheckoutSummaryTrustPanel,
} from '@/components/checkout/CheckoutSummaryExtras';
import {
  CheckoutCardPreview,
  CheckoutFormColumn,
  CheckoutMain,
  CheckoutSummaryColumn,
} from '@/components/checkout/CheckoutLayout';
import { CheckoutStatusCard } from '@/components/checkout/CheckoutStatusCard';
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
/** Chave pública do gateway (tokenização de cartão) */
const GATEWAY_PUBLIC_KEY = 'pk_4ce776b5-0d68-4fbe-b1eb-be10c94ca4e6';

type PlanData = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  tipo: string;
  ativo: boolean;
};

type Section = 'dados' | 'pagamento';

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

export default function SimPlanCheckout() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const simPlanCode = searchParams.get('simPlanCode');
  const storeParam = searchParams.get('store');

  const [mounted, setMounted] = useState(false);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [planError, setPlanError] = useState('');
  const [totalWithFee, setTotalWithFee] = useState<number | null>(null);
  const [openSection, setOpenSection] = useState<Section>('dados');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Dados pessoais
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

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

  const docDigits = document.replace(/\D/g, '');
  const docOk = docDigits.length === 11 || docDigits.length === 14;
  const dadosOk =
    name.trim().length >= 3 &&
    docOk &&
    phone.replace(/\D/g, '').length >= 11 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (dadosOk && openSection === 'dados') {
      setOpenSection('pagamento');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dadosOk]);

  useEffect(() => {
    if (!simPlanCode) {
      setFetching(false);
      return;
    }
    fetch(`${SIM_API}/planos/public/${simPlanCode}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Plano não encontrado (${r.status})`);
        return r.json();
      })
      .then((data) => {
        setPlan(data);
        // Ao carregar o plano, buscar a taxa personalizada (1x)
        // Usa a plataforma do plano para garantir a taxa correta por plataforma
        const store = data.plataformas?.[0] ?? storeParam ?? 'GLOBAL';
        if (data.preco > 0) {
          fetch(`${SIM_API}/checkout/card/installment-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              price: data.preco,
              store,
              maxInstallments: 1,
            }),
          })
            .then((res) => res.json())
            .then((feeData) => {
              if (feeData?.options?.[0]?.totalAmount) {
                setTotalWithFee(feeData.options[0].totalAmount);
              }
            })
            .catch((err) =>
              console.error('Erro ao buscar taxas para simPlan:', err),
            );
        }
      })
      .catch((err) => setPlanError(err.message || 'Erro ao carregar plano'))
      .finally(() => setFetching(false));
  }, [simPlanCode, storeParam]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!plan) return;
    setError('');
    setLoading(true);

    try {
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
        setLoading(false);
        return;
      }

      const body = {
        customerName: name,
        customerEmail: email,
        customerDocument: document.replace(/\D/g, ''),
        customerPhone: phone.replace(/\D/g, ''),
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
      };

      const res = await fetch(`${SIM_API}/planos/public/${plan.id}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? 'Erro ao criar assinatura');
        setLoading(false);
        return;
      }

      if (data.redirectUrl) {
        window.location.replace(data.redirectUrl);
        return;
      }

      router.push(`/subscription/success?reference=${data.id}`);
    } catch {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  if (fetching) {
    return (
      <div className="checkout-page-bg flex min-h-screen flex-col">
        <div className="flex flex-1 items-center justify-center px-4 py-12">
          <CheckoutUiCard
            title="Carregando"
            description="Buscando seu plano"
            className="max-w-sm text-center"
          >
            <p className="text-sm text-zinc-300">Aguarde um instante…</p>
          </CheckoutUiCard>
        </div>
        <CheckoutFooter />
      </div>
    );
  }

  if (planError || !plan) {
    return (
      <div className="checkout-page-bg flex min-h-screen flex-col">
        <div className="flex flex-1 items-center justify-center px-4 py-12">
          <CheckoutUiCard
            variant="danger"
            title="Plano não encontrado"
            className="w-full max-w-md text-center"
          >
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-100/90">{planError}</p>
          </CheckoutUiCard>
        </div>
        <CheckoutFooter />
      </div>
    );
  }

  if (success) {
    return (
      <div className="checkout-page-bg flex min-h-screen flex-col">
        <div className="flex flex-1 items-center justify-center px-4 py-12">
          <CheckoutUiCard
            variant="success"
            title="Assinatura realizada!"
            className="w-full max-w-md text-center"
          >
            <CheckCircle className="mx-auto mb-3 h-10 w-10 text-emerald-400" />
            <p className="text-sm text-zinc-300">
              {sanitizeCheckoutText(plan.nome)}
            </p>
          </CheckoutUiCard>
        </div>
        <CheckoutFooter />
      </div>
    );
  }

  const hd = holderDocument.replace(/\D/g, '');
  const cardOk =
    cardNumber.replace(/\s/g, '').length >= 13 &&
    cardMonth.length === 2 &&
    cardYear.length === 2 &&
    cardCvv.length >= 3 &&
    holderName.trim().length >= 2 &&
    (hd.length === 11 || hd.length === 14);

  const statusItems = [
    { ok: dadosOk, label: 'Dados pessoais completos' },
    { ok: cardOk, label: 'Cartão e titular preenchidos' },
  ];

  return (
    <div className="checkout-page-bg flex min-h-screen flex-col">
      <CheckoutMain>
        <CheckoutSummaryColumn>
          <CheckoutSummaryBranding />
          <CheckoutUiCard
            title="Plano"
            description="O que você está contratando"
          >
            <p className="text-lg font-bold tracking-tight text-white sm:text-xl">
              {sanitizeCheckoutText(plan.nome)}
            </p>
            {plan.descricao && (
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {sanitizeCheckoutText(plan.descricao)}
              </p>
            )}
          </CheckoutUiCard>

          <CheckoutUiCard
            title="Resumo"
            description="Total em tempo real"
            className="text-center"
          >
            <CheckoutCartLottie />
            <p className="text-sm font-medium text-zinc-400">Total a pagar</p>
            <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-[#d9d4e3] sm:text-4xl">
              {formatCurrency(totalWithFee ?? plan.preco)}
            </p>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[#a9a3b8]">
              {intervalLabel(plan.tipo)}
            </p>
          </CheckoutUiCard>

          <CheckoutUiCard
            title="Confiança"
            description="Segurança da transação"
          >
            <CheckoutSummaryTrustPanel />
          </CheckoutUiCard>
        </CheckoutSummaryColumn>

        <CheckoutFormColumn>
          {mounted && (
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
          <CheckoutUiCard title="Pagamento" description="Dados e cartão">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <CheckoutAccordionSection
                title="Seus dados"
                icon={User}
                open={openSection === 'dados'}
                onToggle={() => setOpenSection('dados')}
              >
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
              </CheckoutAccordionSection>

              <CheckoutAccordionSection
                title="Forma de pagamento"
                icon={DollarSign}
                open={openSection === 'pagamento'}
                onToggle={() => setOpenSection('pagamento')}
              >
                <div className="flex flex-col gap-3 pt-1">
                  <div className="flex items-center gap-3 rounded-[20px] border border-white/[0.07] bg-white/[0.06] px-4 py-3">
                    <CheckCircle className="h-4 w-4 shrink-0 text-[#f6b67a]" />
                    <CreditCardIcon className="h-4 w-4 shrink-0 text-[#d9d4e3]" />
                    <span className="text-sm font-semibold text-zinc-100">
                      Cartão de crédito
                    </span>
                  </div>

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
                </div>
              </CheckoutAccordionSection>

              <CheckoutStatusCard error={error} items={statusItems} />

              {loading ? (
                <div className="mt-1 flex flex-col items-center gap-3 rounded-xl border border-[rgba(246,182,122,.35)] bg-[rgba(245,138,42,.12)] px-4 py-6 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#f6b67a]" />
                  <div>
                    <p className="text-sm font-semibold text-[#d9d4e3]">
                      Processando pagamento…
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      Aguarde alguns segundos, estamos processando seu cartão
                    </p>
                  </div>
                </div>
              ) : (
                <button
                  type="submit"
                  className="mt-1 w-full sp2-cta font-medium py-3.5 text-base transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f6b67a] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:scale-[0.99]"
                >
                  Efetuar pagamento
                </button>
              )}
            </form>
          </CheckoutUiCard>
        </CheckoutFormColumn>
      </CheckoutMain>
      <CheckoutFooter />
    </div>
  );
}
