'use client';

import type { ComponentType } from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  DollarSign,
  MapPin,
  ShoppingCart,
  User,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';

function formatIntervalLine(tipo: string, n: number) {
  const unit = tipo === 'mes' ? 'MÊS' : tipo === 'semana' ? 'SEMANA' : 'ANO';
  return `A cada ${n} ${unit}`;
}

function AccordionSection({
  title,
  icon: Icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/4">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-white/6"
      >
        <Icon className="h-5 w-5 shrink-0 text-zinc-500 dark:text-zinc-400" />
        <span className="flex-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {title}
        </span>
        <span
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors',
            'border-zinc-200 bg-white dark:border-white/15 dark:bg-white/5',
          )}
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 text-zinc-500 transition-transform duration-300 ease-out dark:text-zinc-400',
              open ? 'rotate-180' : 'rotate-0',
            )}
          />
        </span>
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-zinc-100 px-4 pb-4 pt-2 dark:border-white/10">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlanosPreviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const nome = searchParams.get('nome')?.trim() || '';
  const valor = searchParams.get('valor') || '0,00';
  const intervalo = Number(searchParams.get('intervalo') || '1') || 1;
  const tipo = searchParams.get('tipo') || 'mes';
  const repeticoes = Number(searchParams.get('repeticoes') || '1') || 1;
  const askBirth = searchParams.get('askBirth') === '1';
  const askGender = searchParams.get('askGender') === '1';
  const askDelivery = searchParams.get('askDelivery') === '1';
  const askBilling = searchParams.get('askBilling') === '1';

  const planTitle = nome || 'Assinatura';

  const intervalLine = useMemo(
    () => formatIntervalLine(tipo, intervalo),
    [tipo, intervalo],
  );
  const repeatLine = useMemo(() => {
    if (tipo === 'mes') return 'Por todos os MESES';
    if (tipo === 'semana') return 'Por todas as SEMANAS';
    return 'Por todos os ANOS';
  }, [tipo]);

  /** Apenas uma seção aberta: ao abrir uma, a outra fecha. */
  const [openSection, setOpenSection] = useState<
    'dados' | 'entrega' | 'faturamento' | 'pagamento'
  >('dados');

  const [nomeCompleto, setNomeCompleto] = useState('');
  const [docType, setDocType] = useState('cpf');
  const [documento, setDocumento] = useState('');
  const [celular, setCelular] = useState('');
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState('');

  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardHolder, setCardHolder] = useState('');

  const [deliveryCep, setDeliveryCep] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNumber, setDeliveryNumber] = useState('');
  const [deliveryComplement, setDeliveryComplement] = useState('');
  const [deliveryDistrict, setDeliveryDistrict] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryState, setDeliveryState] = useState('');

  const [billingCep, setBillingCep] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingNumber, setBillingNumber] = useState('');
  const [billingComplement, setBillingComplement] = useState('');
  const [billingDistrict, setBillingDistrict] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingState, setBillingState] = useState('');

  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-white/70';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 pb-16">
      <nav className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Link
          href="/planos"
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          Planos de assinaturas
        </Link>
        <span className="mx-2 text-zinc-400">&gt;</span>
        <Link
          href="/planos/criar"
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          Criar plano
        </Link>
      </nav>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/planos/criar')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-emerald-800 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/10 dark:text-emerald-300 dark:hover:bg-white/15"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
            Criar plano
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => router.push('/planos/criar')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white/15"
            aria-label="Fechar pré-visualização"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Moldura tipo navegador */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-zinc-100/80 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] dark:border-white/10 dark:bg-zinc-900/50">
        <div className="flex items-center gap-2 border-b border-zinc-200/80 bg-zinc-200/90 px-3 py-2.5 dark:border-white/10 dark:bg-zinc-800/80">
          <div className="flex gap-1.5 pl-1">
            <span className="h-3 w-3 rounded-full bg-red-400/90" />
            <span className="h-3 w-3 rounded-full bg-amber-400/90" />
            <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
          </div>
          <div className="mx-auto flex min-w-0 flex-1 justify-center px-2">
            <div className="truncate rounded-md bg-white px-4 py-1.5 text-center text-xs text-zinc-500 shadow-sm dark:bg-zinc-950 dark:text-zinc-400">
              https://dom.link/dp.com
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row">
          {/* Resumo do plano */}
          <div className="flex flex-1 flex-col border-b border-zinc-200/80 bg-[#f8f9fa] p-8 dark:border-white/10 dark:bg-zinc-950/40 lg:border-b-0 lg:border-r">
            <div className="mb-6">
              <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Nome do plano
              </p>
              <p className="mt-1 text-base font-medium text-zinc-700 dark:text-zinc-300">
                {planTitle}
              </p>
            </div>

            <div className="mx-auto w-full max-w-sm rounded-2xl border border-zinc-200/80 bg-zinc-100/90 p-6 text-center shadow-sm dark:border-white/10 dark:bg-white/5">
              <ShoppingCart className="mx-auto mb-3 h-8 w-8 text-zinc-400" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Total a pagar
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                R$ {valor}
              </p>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {intervalLine}
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                {repeatLine}
                {repeticoes > 1 ? ` · ${repeticoes} cobranças` : ''}
              </p>
            </div>

            <div className="mt-auto pt-10 text-center">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Dom Pagamentos
              </p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                Powered by Dom Pagamentos. Termos de uso e políticas de
                privacidade.
              </p>
            </div>
          </div>

          {/* Checkout — inputs com theme do dashboard (igual relatório) */}
          <div className="flex flex-1 flex-col gap-4 bg-white p-6 dark:bg-[#070712]/90">
            <AccordionSection
              title="Seus dados"
              icon={User}
              open={openSection === 'dados'}
              onToggle={() => setOpenSection('dados')}
            >
              <div className="flex flex-col gap-3 pt-2">
                <div className="flex flex-col gap-1">
                  <span className={labelClass}>
                    Nome completo<span className="text-red-500">*</span>
                  </span>
                  <Input
                    theme={fieldTheme}
                    variant="navbar"
                    placeholder="Digite seu nome completo"
                    value={nomeCompleto}
                    onChange={setNomeCompleto}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>Tipo de documento</span>
                    <Dropdown
                      theme={fieldTheme}
                      variant="navbar"
                      value={docType}
                      onChange={setDocType}
                      options={[
                        { label: 'CPF', value: 'cpf' },
                        { label: 'CNPJ', value: 'cnpj' },
                      ]}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Documento<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Digite documento"
                      value={documento}
                      onChange={setDocumento}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className={labelClass}>
                    Celular<span className="text-red-500">*</span>
                  </span>
                  <Input
                    theme={fieldTheme}
                    variant="navbar"
                    prefix="+55"
                    placeholder="( ) ____-____"
                    value={celular}
                    onChange={setCelular}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className={labelClass}>
                    E-mail<span className="text-red-500">*</span>
                  </span>
                  <Input
                    theme={fieldTheme}
                    variant="navbar"
                    type="email"
                    placeholder="Digite seu e-mail"
                    value={email}
                    onChange={setEmail}
                  />
                </div>
                {askBirth ? (
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Data de nascimento<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      type="date"
                      value={birthDate}
                      onChange={setBirthDate}
                    />
                  </div>
                ) : null}
                {askGender ? (
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Sexo<span className="text-red-500">*</span>
                    </span>
                    <Dropdown
                      theme={fieldTheme}
                      variant="navbar"
                      value={gender}
                      onChange={setGender}
                      options={[
                        { label: 'Selecione', value: '' },
                        { label: 'Masculino', value: 'masculino' },
                        { label: 'Feminino', value: 'feminino' },
                        { label: 'Outro', value: 'outro' },
                      ]}
                    />
                  </div>
                ) : null}
              </div>
            </AccordionSection>

            {askDelivery ? (
              <AccordionSection
                title="Endereço de entrega"
                icon={MapPin}
                open={openSection === 'entrega'}
                onToggle={() => setOpenSection('entrega')}
              >
                <div className="flex flex-col gap-3 pt-2">
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      CEP<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Digite seu cep"
                      value={deliveryCep}
                      onChange={setDeliveryCep}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Endereço<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Digite seu endereço"
                      value={deliveryAddress}
                      onChange={setDeliveryAddress}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <span className={labelClass}>
                        Número<span className="text-red-500">*</span>
                      </span>
                      <Input
                        theme={fieldTheme}
                        variant="navbar"
                        placeholder="Número do seu endereço"
                        value={deliveryNumber}
                        onChange={setDeliveryNumber}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className={labelClass}>Complemento</span>
                      <Input
                        theme={fieldTheme}
                        variant="navbar"
                        placeholder="Informação adicional"
                        value={deliveryComplement}
                        onChange={setDeliveryComplement}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Bairro<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Digite o nome do seu bairro"
                      value={deliveryDistrict}
                      onChange={setDeliveryDistrict}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Cidade<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Digite o nome da sua cidade"
                      value={deliveryCity}
                      onChange={setDeliveryCity}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Estado<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Selecione um estado"
                      value={deliveryState}
                      onChange={setDeliveryState}
                    />
                  </div>
                </div>
              </AccordionSection>
            ) : null}

            {askBilling ? (
              <AccordionSection
                title="Endereço de faturamento"
                icon={MapPin}
                open={openSection === 'faturamento'}
                onToggle={() => setOpenSection('faturamento')}
              >
                <div className="flex flex-col gap-3 pt-2">
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      CEP<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Digite seu cep"
                      value={billingCep}
                      onChange={setBillingCep}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Endereço<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Digite seu endereço"
                      value={billingAddress}
                      onChange={setBillingAddress}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <span className={labelClass}>
                        Número<span className="text-red-500">*</span>
                      </span>
                      <Input
                        theme={fieldTheme}
                        variant="navbar"
                        placeholder="Número do seu endereço"
                        value={billingNumber}
                        onChange={setBillingNumber}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className={labelClass}>Complemento</span>
                      <Input
                        theme={fieldTheme}
                        variant="navbar"
                        placeholder="Informação adicional"
                        value={billingComplement}
                        onChange={setBillingComplement}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Bairro<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Digite o nome do seu bairro"
                      value={billingDistrict}
                      onChange={setBillingDistrict}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Cidade<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Digite o nome da sua cidade"
                      value={billingCity}
                      onChange={setBillingCity}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Estado<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Selecione um estado"
                      value={billingState}
                      onChange={setBillingState}
                    />
                  </div>
                </div>
              </AccordionSection>
            ) : null}

            <AccordionSection
              title="Forma de pagamento"
              icon={DollarSign}
              open={openSection === 'pagamento'}
              onToggle={() => setOpenSection('pagamento')}
            >
              <div className="flex flex-col gap-4 pt-2">
                <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
                  <CheckCircle2
                    className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden
                  />
                  <CreditCard
                    className="h-5 w-5 shrink-0 text-zinc-600 dark:text-zinc-300"
                    aria-hidden
                  />
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    Crédito
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className={labelClass}>
                    Número do cartão<span className="text-red-500">*</span>
                  </span>
                  <Input
                    theme={fieldTheme}
                    variant="navbar"
                    placeholder="1234 1234 1234 1234"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    value={cardNumber}
                    onChange={setCardNumber}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Mês / Ano<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="MM/AA"
                      autoComplete="cc-exp"
                      value={cardExpiry}
                      onChange={setCardExpiry}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>
                      CVV<span className="text-red-500">*</span>
                    </span>
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="CVC"
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      value={cardCvv}
                      onChange={setCardCvv}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className={labelClass}>
                    Nome do titular do cartão
                    <span className="text-red-500">*</span>
                  </span>
                  <Input
                    theme={fieldTheme}
                    variant="navbar"
                    placeholder="Titular do Cartão"
                    autoComplete="cc-name"
                    value={cardHolder}
                    onChange={setCardHolder}
                  />
                </div>
              </div>
            </AccordionSection>

            <button
              type="button"
              className="mt-2 w-full rounded-xl py-3.5 text-base font-semibold text-white shadow-md transition hover:opacity-95 active:scale-[0.99]"
              style={{ backgroundColor: '#5E9284' }}
            >
              Efetuar pagamento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
