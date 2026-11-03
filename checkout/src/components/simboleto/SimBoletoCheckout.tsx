'use client';
import { SIM_API_URL } from '@/lib/api-config';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  Barcode as BarcodeIcon,
} from 'lucide-react';
import { CheckoutFooter } from '@/components/checkout/CheckoutChrome';
import { CheckoutFlow } from '@/components/checkout/CheckoutFlow';
import { StatusPill } from '@/components/checkout/ui';
import {
  CheckoutGlassField,
  CheckoutGlassInput,
} from '@/components/checkout/CheckoutFormPrimitives';
import { CheckoutStatusCard } from '@/components/checkout/CheckoutStatusCard';
import {
  CheckoutErrorScreen,
  CheckoutLoadingScreen,
  CheckoutSuccessScreen,
} from '@/components/checkout/CheckoutStateScreens';
import { CheckoutUiCard } from '@/components/checkout/CheckoutUiCard';
import { maskCpfCnpj, maskPhoneBr } from '@/lib/input-masks';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import { validateBoletoCheckout } from '@/lib/boleto-checkout-validation';
import { BoletoDisplay, PixDisplay } from './components';
import { browserCheckoutTracking } from '@/lib/payment-tracking';

const SIM_API = SIM_API_URL;

type BoletoData = {
  id: string;
  titulo: string;
  descricao: string | null;
  valor: number;
  aceitaBoleto: boolean;
  aceitaPix: boolean;
  vencimentoDias: number;
  ativo: boolean;
  redirectUrl?: string | null;
};

type PaymentMethod = 'boleto' | 'pix';

function formatCurrency(val: number) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function maskCep(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export default function SimBoletoCheckout() {
  const searchParams = useSearchParams();
  const simBoletoCode = searchParams.get('simBoletoCode');

  const [boleto, setBoleto] = useState<BoletoData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [boletoError, setBoletoError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('boleto');

  // PIX
  const [pixContent, setPixContent] = useState<string | null>(null);
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [pixExpire, setPixExpire] = useState<string | null>(null);

  // Boleto
  const [boletoUrl, setBoletoUrl] = useState<string | null>(null);
  const [digitableLine, setDigitableLine] = useState<string | null>(null);
  const [barcode, setBarcode] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);

  // ID da transação (domPaymentId) para acompanhar a confirmação via SSE
  const [watchId, setWatchId] = useState<string | null>(null);

  // Cliente
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Endereço (obrigatório para boleto)
  const [cep, setCep] = useState('');
  const [rua, setRua] = useState('');
  const [numero, setNumero] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [complemento, setComplemento] = useState('');
  const [cepLoading, setCepLoading] = useState(false);

  async function lookupCep(raw: string) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const d = await r.json();
      if (!d?.erro) {
        if (d.logradouro) setRua(String(d.logradouro).slice(0, 40));
        if (d.bairro) setBairro(d.bairro);
        if (d.localidade) setCidade(d.localidade);
        if (d.uf) setUf(d.uf);
      }
    } catch {
      /* ignore — usuário preenche manualmente */
    } finally {
      setCepLoading(false);
    }
  }

  useEffect(() => {
    if (!watchId || paymentConfirmed) return;
    let done = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1500;

    const handleCompleted = () => {
      if (done) return;
      done = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
      setPaymentConfirmed(true);
    };

    const checkStatusFallback = async () => {
      if (done) return;
      try {
        const r = await fetch(`${SIM_API}/checkout/pix/${watchId}/status`);
        if (r.ok) {
          const d = await r.json();
          if (d.status === 'COMPLETED') handleCompleted();
        }
      } catch {
        /* ignore */
      }
    };

    const connect = () => {
      if (done) return;
      es = new EventSource(`${SIM_API}/checkout/pix/${watchId}/sse`);
      es.addEventListener('payment-status', (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data);
          if (d.status === 'COMPLETED') handleCompleted();
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
  }, [watchId, paymentConfirmed]);

  useEffect(() => {
    if (!simBoletoCode) {
      setFetching(false);
      return;
    }
    fetch(`${SIM_API}/boletos/public/${simBoletoCode}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Boleto não encontrado (${r.status})`);
        return r.json();
      })
      .then((data: BoletoData) => {
        setBoleto(data);
        setPaymentMethod(data.aceitaBoleto ? 'boleto' : 'pix');
      })
      .catch((err) => setBoletoError(err.message || 'Erro ao carregar boleto'))
      .finally(() => setFetching(false));
  }, [simBoletoCode]);

  async function handleSubmit() {
    if (!boleto || loading) return;
    if (!podeSubmeter) {
      setError('Preencha o endereço do pagador para gerar o boleto.');
      return;
    }
    setError('');
    setLoading(true);

    const body: Record<string, unknown> = {
      customerName: name.trim(),
      customerEmail: email.trim(),
      customerDocument: document.replace(/\D/g, ''),
      customerPhone: phone.replace(/\D/g, ''),
      documentType: document.replace(/\D/g, '').length === 14 ? 'CNPJ' : 'CPF',
    };
    // Boleto exige endereço do pagador.
    if (paymentMethod === 'boleto') {
      body.cep = cep.replace(/\D/g, '');
      body.rua = rua.trim();
      body.numero = numero.trim();
      body.bairro = bairro.trim();
      body.cidade = cidade.trim();
      body.uf = uf.trim().toUpperCase();
      body.complemento = complemento.trim();
    }

    try {
      const endpoint = paymentMethod === 'pix' ? 'pix' : 'boleto';
      const res = await fetch(
        `${SIM_API}/boletos/public/${boleto.id}/${endpoint}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            tracking: browserCheckoutTracking(),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? 'Erro ao gerar a cobrança');
        return;
      }

      if (paymentMethod === 'pix') {
        setPixContent(data.pixContent ?? null);
        setPixQrCode(data.qrCode ?? null);
        setPixExpire(data.pixExpire ?? null);
      } else {
        setBoletoUrl(data.boletoUrl ?? null);
        setDigitableLine(data.digitableLine ?? null);
        setBarcode(data.barcode ?? null);
        setDueDate(data.dueDate ?? null);
      }
      setWatchId(data.id ?? null);
    } catch {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  if (fetching)
    return <CheckoutLoadingScreen message="Carregando seu boleto…" />;

  if (paymentConfirmed)
    return (
      <CheckoutSuccessScreen
        headline="Pagamento confirmado"
        email={email}
        redirectUrl={boleto?.redirectUrl}
        accessLabel="Continuar"
      />
    );

  if (boletoError || !boleto)
    return (
      <CheckoutErrorScreen
        title="Boleto não encontrado"
        message={boletoError || 'Este boleto não está disponível.'}
      />
    );

  const { dadosOk, enderecoOk } = validateBoletoCheckout({
    name,
    document,
    phone,
    email,
    cep,
    rua,
    numero,
    bairro,
    cidade,
    uf,
  });
  const podeSubmeter = dadosOk && (paymentMethod !== 'boleto' || enderecoOk);

  // Considera só o método selecionado: trocar de método libera gerar outra cobrança
  const generated =
    paymentMethod === 'pix'
      ? Boolean(pixContent || pixQrCode)
      : Boolean(boletoUrl || digitableLine || barcode);

  const statusItems = [
    { ok: dadosOk, label: 'Dados para cobrança' },
    ...(paymentMethod === 'boleto'
      ? [{ ok: enderecoOk, label: 'Endereço do pagador' }]
      : []),
    {
      ok: true,
      label: `Forma: ${paymentMethod === 'pix' ? 'PIX' : 'Boleto'} selecionada`,
    },
    { ok: paymentConfirmed, label: 'Pagamento confirmado' },
  ];

  return (
    <CheckoutFlow
      product={{
        title: sanitizeCheckoutText(boleto.titulo),
        description: boleto.descricao
          ? sanitizeCheckoutText(boleto.descricao)
          : undefined,
        price: formatCurrency(boleto.valor),
        frequency: 'Pagamento único',
      }}
      total={formatCurrency(boleto.valor)}
      validateDados={() => dadosOk}
      onSubmit={() => void handleSubmit()}
      finalLabel={paymentMethod === 'pix' ? 'Gerar PIX' : 'Gerar boleto'}
      loading={loading}
      error={error}
      finalAction={
        generated ? (
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
                placeholder="Digite seu e-mail"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                name="email"
              />
            </CheckoutGlassField>
          </div>
        </>
      }
      pagamento={
        <>
          <div className="flex flex-col gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-4 rounded-[20px] border border-white/[0.07] bg-white/[0.06] px-4 py-3">
              {boleto.aceitaBoleto && (
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-200">
                  <input
                    type="radio"
                    name="paymentMethod"
                    className="h-4 w-4 accent-[#f58a2a]"
                    checked={paymentMethod === 'boleto'}
                    onChange={() => setPaymentMethod('boleto')}
                  />
                  <BarcodeIcon className="h-4 w-4 shrink-0 text-[#d9d4e3]" />
                  Boleto
                </label>
              )}
              {boleto.aceitaPix && (
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

            {paymentMethod === 'boleto' && !generated && (
              <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Endereço do pagador (obrigatório para boleto)
                </p>
                <CheckoutGlassField label="CEP" required>
                  <CheckoutGlassInput
                    name="cep"
                    autoComplete="postal-code"
                    placeholder="00000-000"
                    value={cep}
                    inputMode="numeric"
                    onChange={(v) => {
                      const masked = maskCep(v);
                      setCep(masked);
                      if (masked.replace(/\D/g, '').length === 8)
                        void lookupCep(masked);
                    }}
                  />
                </CheckoutGlassField>
                {cepLoading && (
                  <p className="text-xs text-zinc-500">
                    Buscando endereço pelo CEP…
                  </p>
                )}
                <div className="grid grid-cols-[1fr_5.5rem] gap-3">
                  <CheckoutGlassField label="Rua" required>
                    <CheckoutGlassInput
                      name="rua"
                      autoComplete="address-line1"
                      placeholder="Logradouro"
                      value={rua}
                      onChange={(v) => setRua(v.slice(0, 40))}
                    />
                  </CheckoutGlassField>
                  <CheckoutGlassField label="Número" required>
                    <CheckoutGlassInput
                      name="numero"
                      placeholder="123"
                      value={numero}
                      onChange={setNumero}
                      inputMode="numeric"
                    />
                  </CheckoutGlassField>
                </div>
                <CheckoutGlassField label="Bairro" required>
                  <CheckoutGlassInput
                    name="bairro"
                    placeholder="Bairro"
                    value={bairro}
                    onChange={setBairro}
                  />
                </CheckoutGlassField>
                <div className="grid grid-cols-[1fr_4.5rem] gap-3">
                  <CheckoutGlassField label="Cidade" required>
                    <CheckoutGlassInput
                      name="cidade"
                      autoComplete="address-level2"
                      placeholder="Cidade"
                      value={cidade}
                      onChange={setCidade}
                    />
                  </CheckoutGlassField>
                  <CheckoutGlassField label="UF" required>
                    <CheckoutGlassInput
                      name="uf"
                      autoComplete="address-level1"
                      placeholder="SP"
                      value={uf}
                      onChange={(v) =>
                        setUf(
                          v
                            .replace(/[^a-zA-Z]/g, '')
                            .toUpperCase()
                            .slice(0, 2),
                        )
                      }
                    />
                  </CheckoutGlassField>
                </div>
                <CheckoutGlassField label="Complemento (opcional)">
                  <CheckoutGlassInput
                    name="complemento"
                    autoComplete="address-line2"
                    placeholder="Apto, bloco…"
                    value={complemento}
                    onChange={setComplemento}
                  />
                </CheckoutGlassField>
              </div>
            )}
            {paymentMethod === 'pix' && !generated && (
              <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                <p className="text-sm text-zinc-300">
                  Clique em <strong className="text-white">Gerar PIX</strong>{' '}
                  abaixo. O código copia e cola será gerado automaticamente.
                </p>
              </div>
            )}

            {paymentMethod === 'pix' && (pixContent || pixQrCode) && (
              <PixDisplay
                pixContent={pixContent}
                qrCode={pixQrCode}
                pixExpire={pixExpire}
              />
            )}
            {paymentMethod === 'boleto' &&
              (boletoUrl || digitableLine || barcode) && (
                <BoletoDisplay
                  boletoUrl={boletoUrl}
                  digitableLine={digitableLine}
                  barcode={barcode}
                  dueDate={dueDate}
                />
              )}
          </div>
        </>
      }
      status={<CheckoutStatusCard error={error} items={statusItems} />}
    />
  );
}
