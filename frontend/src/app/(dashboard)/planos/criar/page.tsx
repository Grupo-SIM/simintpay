'use client';

import { useCoproductionDraft } from '@/features/coproduction/use-coproduction-draft';
import { CoproductionButton } from '@/components/coproduction';

import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { ProductPlatformSelect } from '@/components/product-platforms';

import { FieldLabel } from '@/components/ui/FieldLabel';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Minus, Plus, Scan } from 'lucide-react';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';

import { cn } from '@/lib/utils';
import { fieldDividerClassNames, fieldShellClassNames } from '@/lib/fieldShell';
import { Input } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { EmailPreview } from '@/components/ui/EmailPreview';

/** Limite de caracteres da mensagem de e-mail ao comprador. */
const EMAIL_BODY_MAX = 2000;

function FormSwitch({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950',
        checked ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-600',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  theme,
  variant = 'navbar',
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  theme: 'light' | 'dark';
  variant?: 'default' | 'navbar';
}) {
  const step = (d: number) => {
    const next = value + d;
    if (next < min || next > max) return;
    onChange(next);
  };

  const btnSide = cn(
    'px-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30',
    theme === 'dark' && variant === 'navbar'
      ? 'text-white/50 hover:bg-white/10 hover:text-white/90'
      : theme === 'dark'
        ? 'text-zinc-300 hover:bg-white/10'
        : 'text-zinc-600 hover:bg-zinc-50',
  );

  const valueClass =
    theme === 'dark' && variant === 'navbar'
      ? 'text-white/80'
      : theme === 'dark'
        ? 'text-white'
        : 'text-zinc-900';

  return (
    <div
      className={fieldShellClassNames(theme, variant, { focusWithin: false })}
    >
      <button
        type="button"
        className={btnSide}
        onClick={() => step(-1)}
        aria-label="Diminuir"
      >
        <Minus className="mx-auto h-4 w-4" />
      </button>
      <div
        className={cn(
          'flex min-w-12 flex-1 items-center justify-center border-x text-sm font-medium tabular-nums',
          fieldDividerClassNames(theme, variant),
          valueClass,
        )}
      >
        {value}
      </div>
      <button
        type="button"
        className={btnSide}
        onClick={() => step(1)}
        aria-label="Aumentar"
      >
        <Plus className="mx-auto h-4 w-4" />
      </button>
    </div>
  );
}

function formatCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '0,00';
  const normalized = digits.padStart(3, '0');
  const cents = normalized.slice(-2);
  let integer = normalized.slice(0, -2).replace(/^0+(?=\d)/, '');
  if (!integer) integer = '0';
  const integerWithThousands = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${integerWithThousands},${cents}`;
}

function formatCurrencyFromNumber(value: number): string {
  const cents = Math.round(value * 100);
  const digits = String(cents).padStart(3, '0');
  const centsPart = digits.slice(-2);
  let intPart = digits.slice(0, -2).replace(/^0+(?=\d)/, '') || '0';
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intPart},${centsPart}`;
}

function mapApiTypeToInterval(apiType: string): string {
  switch (apiType) {
    case 'ANUAL':
      return 'ano';
    case 'SEMANAL':
      return 'semana';
    case 'MENSAL':
    default:
      return 'mes';
  }
}

function mapIntervalType(type: string): string {
  switch (type) {
    case 'ano':
      return 'ANUAL';
    case 'semana':
      return 'SEMANAL';
    case 'mes':
    default:
      return 'MENSAL';
  }
}

interface ApiPlanDetail {
  id: string;
  nome?: string;
  descricao?: string | null;
  preco?: number;
  tipo?: string;
  frequencia?: number;
  repeticoes?: number;
  diasRetentativa?: number;
  redirectUrl?: string | null;
  ativo?: boolean;
  emailBody?: string | null;
  plataformas?: string[];
  plataforma?: string | null;
  platformTag?: string | null;
}

export default function CriarPlanoPage() {
  const router = useRouter();
  const coproduction = useCoproductionDraft();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const editId = searchParams.get('id');
  const isEditing = !!editId;

  const [planName, setPlanName] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [cashback, setCashback] = useState('cobranca');

  const [amount, setAmount] = useState('0,00');
  const [intervalType, setIntervalType] = useState('mes');
  const [intervalCount, setIntervalCount] = useState(1);
  const [repetitions, setRepetitions] = useState(1);
  const [retryDays, setRetryDays] = useState(10);

  const [askBirth, setAskBirth] = useState(false);
  const [askGender, setAskGender] = useState(false);
  const [askDelivery, setAskDelivery] = useState(false);
  const [cardEnabled, setCardEnabled] = useState(true);
  const [askBilling, setAskBilling] = useState(false);

  const [formReady, setFormReady] = useState(!isEditing);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [financialOwner, setFinancialOwner] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [emailBody, setEmailBody] = useState('');

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () =>
          typeof window !== 'undefined'
            ? localStorage.getItem('access_token')
            : null,
      }),
    [],
  );

  const { data: planData, isLoading: isLoadingPlan } = useQuery({
    queryKey: ['plan', editId],
    queryFn: async () => {
      const response = await api.get<{ data: ApiPlanDetail }>(
        endpoints.planos.detail(editId!),
      );
      const p = response.data;
      setPlanName(p.nome ?? '');
      setRedirectUrl(p.redirectUrl ?? '');
      setAmount(p.preco != null ? formatCurrencyFromNumber(p.preco) : '0,00');
      setIntervalType(mapApiTypeToInterval(p.tipo ?? 'MENSAL'));
      setIntervalCount(p.frequencia ?? 1);
      setRepetitions(p.repeticoes ?? 1);
      setRetryDays(p.diasRetentativa ?? 10);
      const platform =
        p.plataformas?.[0] || p.plataforma || p.platformTag || null;
      if (platform) {
        setSelectedPlatform(platform);
      }
      setEmailBody(p.emailBody ?? '');
      setFormReady(true);
      return response;
    },
    enabled: isEditing,
    staleTime: 0,
  });

  const platformCatalog = useProductPlatforms();
  const allPlatformTags = platformCatalog.selectableTags;

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ data: { id: string } }>(
        endpoints.planos.create,
        coproduction.withBody(body),
      ),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Plano criado',
        description: 'Plano criado com sucesso na DOM Pagamentos.',
      });
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      router.push('/planos');
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível criar o plano.',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ data: ApiPlanDetail }>(endpoints.planos.update(editId!), body),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Plano atualizado',
        description: 'Plano atualizado com sucesso.',
      });
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      router.push('/planos');
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível atualizar o plano.',
      });
    },
  });

  function handleSave() {
    if (!planName.trim()) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe o nome do plano.',
      });
      return;
    }
    const preco = Number(amount.replace(/\./g, '').replace(',', '.')) || 0;
    if (preco <= 0) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe um valor válido.',
      });
      return;
    }
    if (
      !isEditing &&
      (platformCatalog.isLoading ||
        platformCatalog.isError ||
        (selectedPlatform
          ? !allPlatformTags.includes(selectedPlatform)
          : platformCatalog.user?.isAdmin && !financialOwner))
    ) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Selecione um titular ou uma plataforma válida.',
      });
      return;
    }
    const body = {
      nome: planName.trim(),
      preco,
      tipo: mapIntervalType(intervalType),
      frequencia: intervalCount,
      repeticoes: repetitions,
      diasRetentativa: retryDays,
      redirectUrl: redirectUrl.trim() || undefined,
      ...(!isEditing
        ? {
            ownerUserId: financialOwner?.id,
            plataformas: selectedPlatform ? [selectedPlatform] : [],
          }
        : {}),
      ...(selectedPlatform ? { emailBody: emailBody.trim() || null } : {}),
    };
    if (isEditing) {
      updateMutation.mutate(body);
    } else {
      createMutation.mutate(body);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  const sectionCard =
    'rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-16">
      {/* Breadcrumb */}
      <nav className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Link
          href="/planos"
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          Planos de assinaturas
        </Link>
        <span className="mx-2 text-zinc-400">&gt;</span>
        <span className="text-zinc-400">
          {isEditing ? 'Editar plano' : 'Criar plano'}
        </span>
      </nav>

      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/planos')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-emerald-800 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/10 dark:text-emerald-300 dark:hover:bg-white/15"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
            {isEditing ? 'Editar plano' : 'Criar plano'}
          </h1>
        </div>
        <Button
          type="button"
          variant="outline"
          className="gap-2 self-start border-zinc-300 bg-white sm:self-auto dark:border-white/15 dark:bg-transparent"
          onClick={() => {
            const params = new URLSearchParams();
            if (planName.trim()) params.set('nome', planName.trim());
            params.set('valor', amount || '0,00');
            params.set('intervalo', String(intervalCount));
            params.set('tipo', intervalType);
            params.set('repeticoes', String(repetitions));
            params.set('askBirth', askBirth ? '1' : '0');
            params.set('askGender', askGender ? '1' : '0');
            params.set('askDelivery', askDelivery ? '1' : '0');
            params.set('askBilling', askBilling ? '1' : '0');
            router.push(`/planos/preview?${params.toString()}`);
          }}
        >
          <Scan className="h-4 w-4" />
          Pré-visualizar
        </Button>
      </div>

      {isEditing && isLoadingPlan ? (
        <div className="flex items-center justify-center py-20 text-sm text-zinc-400">
          Carregando plano...
        </div>
      ) : (
        <>
          {/* Configuração do plano */}
          <section className={sectionCard}>
            <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Configuração do plano
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1 md:col-span-2">
                <FieldLabel
                  required
                  infoText="O nome aparecerá como título da página de pagamento."
                >
                  Nome do plano
                </FieldLabel>
                <Input
                  theme={fieldTheme}
                  variant="navbar"
                  placeholder="Ex: Plano básico"
                  value={planName}
                  onChange={setPlanName}
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel>Redirecionamento após aprovação</FieldLabel>
                <Input
                  theme={fieldTheme}
                  variant="navbar"
                  placeholder="https://"
                  value={redirectUrl}
                  onChange={setRedirectUrl}
                />
              </div>
            </div>
          </section>

          {/* Configurações da cobrança */}
          <section className={sectionCard}>
            <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Configurações da cobrança
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <div className="flex flex-col gap-1 lg:col-span-1">
                <FieldLabel
                  required
                  infoText="Valor que será cobrado em cada ciclo de cobrança da assinatura."
                >
                  Valor
                </FieldLabel>
                <Input
                  theme={fieldTheme}
                  variant="navbar"
                  prefix="R$"
                  placeholder="0,00"
                  inputMode="decimal"
                  value={amount}
                  onChange={(v) => setAmount(formatCurrencyInput(v))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel infoText="Frequência em que a cobrança será feita: diária, semanal, mensal ou anual.">
                  Tipo de intervalo
                </FieldLabel>
                <Dropdown
                  theme={fieldTheme}
                  variant="navbar"
                  value={intervalType}
                  onChange={setIntervalType}
                  options={[
                    { label: 'Mês', value: 'mes' },
                    { label: 'Semana', value: 'semana' },
                    { label: 'Ano', value: 'ano' },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel
                  required
                  infoText="Define de quantos em quantos períodos a cobrança será feita, com base no tipo de intervalo escolhido."
                >
                  Intervalo
                </FieldLabel>
                <NumberStepper
                  value={intervalCount}
                  onChange={setIntervalCount}
                  min={1}
                  theme={fieldTheme}
                />
              </div>
            </div>
          </section>

          {/* Duas colunas: cliente / pagamento */}
          <div className="grid gap-4 md:grid-cols-2">
            <section className={sectionCard}>
              <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Informação do cliente
              </h2>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <FieldLabel infoText="Quando ativado, o checkout solicita a data de nascimento do cliente.">
                    Solicitar data de nascimento
                  </FieldLabel>
                  <FormSwitch checked={askBirth} onChange={setAskBirth} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <FieldLabel infoText="Quando ativado, o checkout solicita a informação de sexo do cliente.">
                    Solicitar sexo
                  </FieldLabel>
                  <FormSwitch checked={askGender} onChange={setAskGender} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <FieldLabel infoText="Quando ativado, o checkout exibe o formulário de endereço de entrega.">
                    Solicitar endereço de entrega
                  </FieldLabel>
                  <FormSwitch checked={askDelivery} onChange={setAskDelivery} />
                </div>
              </div>
            </section>

            <section className={sectionCard}>
              <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Formas de pagamento
              </h2>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <FieldLabel infoText="Mantém a opção padrão de pagamento por cartão de crédito no checkout.">
                    Cartão de crédito
                  </FieldLabel>
                  <FormSwitch checked={cardEnabled} onChange={setCardEnabled} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <FieldLabel infoText="Quando ativado, o checkout exibe o formulário de endereço de faturamento.">
                    Solicitar endereço de faturamento
                  </FieldLabel>
                  <FormSwitch checked={askBilling} onChange={setAskBilling} />
                </div>
              </div>
            </section>
          </div>

          {/* Plataformas */}
          <section className={sectionCard}>
            <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Plataforma (opcional)
            </h2>
            <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
              Opcional: associe uma plataforma ou use o titular financeiro.
            </p>
            <ProductPlatformSelect
              catalog={platformCatalog}
              value={selectedPlatform}
              owner={financialOwner}
              onOwnerChange={setFinancialOwner}
              onChange={(tag) => {
                setSelectedPlatform(tag || null);
                setFinancialOwner(null);
              }}
              theme={fieldTheme}
              disabled={isEditing}
            />
            {!selectedPlatform && allPlatformTags.length > 0 && (
              <p className="mt-2 text-xs text-red-500">
                Sem plataforma, o recebimento e as taxas pertencem ao titular.
              </p>
            )}
          </section>

          {/* Mensagem do e-mail ao comprador (vinculada à plataforma associada) */}
          {selectedPlatform && (
            <section className={sectionCard}>
              <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Mensagem do e-mail ao comprador
              </h2>
              <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
                Este texto será o corpo do e-mail enviado ao comprador quando o
                pagamento for aprovado. Você pode incluir o link de acesso ao
                produto.
              </p>
              <textarea
                value={emailBody}
                onChange={(e) =>
                  setEmailBody(e.target.value.slice(0, EMAIL_BODY_MAX))
                }
                maxLength={EMAIL_BODY_MAX}
                rows={6}
                placeholder={
                  'Ex: Olá! Obrigado pela sua compra.\nAcesse seu acesso pelo link: https://...'
                }
                className="w-full rounded-2xl border border-zinc-200/80 bg-white p-4 text-sm text-zinc-800 outline-none transition-colors focus:border-emerald-500/50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100"
              />
              <p
                className={`mt-1.5 text-right text-xs ${emailBody.length >= EMAIL_BODY_MAX ? 'text-red-500' : 'text-zinc-400 dark:text-zinc-500'}`}
              >
                {emailBody.length}/{EMAIL_BODY_MAX} caracteres
              </p>
              <EmailPreview
                body={emailBody}
                title={planName}
                redirectUrl={redirectUrl}
              />
            </section>
          )}

          <CoproductionButton
            product="planos"
            productId={editId}
            draft={coproduction.participants}
            onDraftChange={coproduction.setParticipants}
            disabled={createMutation.isPending}
          />

          <div className="flex justify-center pt-2">
            <Button
              type="button"
              className="h-11 min-w-[200px] rounded-lg bg-emerald-800 text-base font-semibold text-white hover:bg-emerald-900 dark:bg-emerald-700 dark:hover:bg-emerald-600 disabled:opacity-60"
              onClick={handleSave}
              disabled={
                isPending ||
                !formReady ||
                (!isEditing &&
                  (platformCatalog.isLoading ||
                    platformCatalog.isError ||
                    (selectedPlatform
                      ? !allPlatformTags.includes(selectedPlatform)
                      : platformCatalog.user?.isAdmin && !financialOwner)))
              }
            >
              {isPending
                ? 'Salvando...'
                : isEditing
                  ? 'Salvar alterações'
                  : 'Salvar'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
