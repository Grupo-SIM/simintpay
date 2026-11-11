'use client';
import { PlatformOwnerSelect } from '@/components/platforms/PlatformOwnerSelect';

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
import { ArrowLeft } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { EmailPreview } from '@/components/ui/EmailPreview';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';

/** Limite de caracteres da mensagem de e-mail ao comprador. */
const EMAIL_BODY_MAX = 2000;

/*
function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  theme,
  variant = "navbar",
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  theme: "light" | "dark";
  variant?: "default" | "navbar";
}) {
  const step = (d: number) => {
    const next = value + d;
    if (next < min || next > max) return;
    onChange(next);
  };

  const btnSide = cn(
    "px-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30",
    theme === "dark" && variant === "navbar"
      ? "text-white/50 hover:bg-white/10 hover:text-white/90"
      : theme === "dark"
        ? "text-zinc-300 hover:bg-white/10"
        : "text-zinc-600 hover:bg-zinc-50",
  );

  const valueClass =
    theme === "dark" && variant === "navbar"
      ? "text-white/80"
      : theme === "dark"
        ? "text-white"
        : "text-zinc-900";

  return (
    <div className={fieldShellClassNames(theme, variant, { focusWithin: false })}>
      <button type="button" className={btnSide} onClick={() => step(-1)} aria-label="Diminuir">
        <Minus className="mx-auto h-4 w-4" />
      </button>
      <div
        className={cn(
          "flex min-w-12 flex-1 items-center justify-center border-x text-sm font-medium tabular-nums",
          fieldDividerClassNames(theme, variant),
          valueClass,
        )}
      >
        {value}
      </div>
      <button type="button" className={btnSide} onClick={() => step(1)} aria-label="Aumentar">
        <Plus className="mx-auto h-4 w-4" />
      </button>
    </div>
  );
}
*/

function stripPlanDescription(raw: string | null | undefined) {
  return (raw ?? '')
    .replace(/\s*\[CPF_DONO:[^\]]*\]/gi, '')
    .replace(/\s*\[CPF:[^\]]*\]/gi, '')
    .replace(/\s*\[TENANT:[^\]]*\]/gi, '')
    .replace(/\s*\[NOME_DONO:[^\]]*\]/gi, '')
    .replace(/\s+\d{11}\b/g, '')
    .replace(
      /\s+(pagatg|atlashosting|areaflix|bosque|renovada|ebooksim|frendz|revalida)\b/gi,
      '',
    )
    .trim();
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

export default function CriarPlanoPixPage() {
  const router = useRouter();
  const coproduction = useCoproductionDraft();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');
  const isEditing = Boolean(editId);
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const [planName, setPlanName] = useState('');
  const [description, setDescription] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [amount, setAmount] = useState('0,00');
  const [frequencyType, setFrequencyType] = useState('MONTH');
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

  const platformCatalog = useProductPlatforms();
  const platformTags = platformCatalog.selectableTags;

  const { data: planDetail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['pix-plan', editId],
    queryFn: async () => {
      const response = await api.get<{
        data: {
          id: string;
          description?: string | null;
          price: number;
          frequency_type: string;
          redirectUrl?: string | null;
          webhookUrl?: string | null;
          tenantTag?: string | null;
          emailBody?: string | null;
        };
      }>(endpoints.planosPix.detail(editId!));
      const d = response.data;
      const cleanDesc = stripPlanDescription(d.description);
      setPlanName(cleanDesc);
      setDescription(cleanDesc);
      if (d.price != null) {
        setAmount(formatCurrencyInput(String(Math.round(d.price * 100))));
      }
      const freqMap: Record<string, string> = {
        MONTHLY: 'MONTH',
        TRIMESTRAL: 'QUARTER',
        SEMESTRAL: 'SEMESTER',
        ANUAL: 'YEAR',
        MONTH: 'MONTH',
        QUARTER: 'QUARTER',
        SEMESTER: 'SEMESTER',
        YEAR: 'YEAR',
      };
      setFrequencyType(freqMap[d.frequency_type ?? 'MONTH'] ?? 'MONTH');
      setRedirectUrl(d.redirectUrl ?? '');
      setWebhookUrl(d.webhookUrl ?? '');
      if (d.tenantTag) setSelectedPlatform(d.tenantTag);
      setEmailBody(d.emailBody ?? '');
      return response;
    },
    enabled: isEditing,
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post(endpoints.planosPix.create, coproduction.withBody(body)),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Plano PIX criado',
        description: 'Plano PIX criado com sucesso.',
      });
      queryClient.invalidateQueries({ queryKey: ['pix-plans'] });
      router.push('/planos-pix');
    },
    onError: (error: Error) => {
      toast({
        type: 'error',
        title: 'Erro',
        description: error?.message || 'Não foi possível criar o plano PIX.',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(endpoints.planosPix.update(editId!), body),
    onSuccess: () => {
      toast({
        type: 'success',
        title: 'Plano PIX atualizado',
        description: 'Plano PIX atualizado com sucesso.',
      });
      queryClient.invalidateQueries({ queryKey: ['pix-plans'] });
      router.push('/planos-pix');
    },
    onError: (error: Error) => {
      toast({
        type: 'error',
        title: 'Erro',
        description:
          error?.message || 'Não foi possível atualizar o plano PIX.',
      });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSave() {
    if (!planName.trim()) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe o nome do plano.',
      });
      return;
    }
    const price = Number(amount.replace(/\./g, '').replace(',', '.')) || 0;
    if (price <= 0) {
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
        !platformTags.includes(selectedPlatform ?? ''))
    ) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Selecione um titular ou uma plataforma válida.',
      });
      return;
    }

    const body = {
      price,
      description: description.trim() || planName.trim(),
      redirectUrl: redirectUrl.trim() || undefined,
      webhookUrl: webhookUrl.trim() || undefined,
      frequency_type: frequencyType,
      ...(!isEditing
        ? { ownerUserId: financialOwner?.id, tenantTag: selectedPlatform }
        : {}),
      ...(selectedPlatform ? { emailBody: emailBody.trim() || null } : {}),
    };

    if (isEditing) {
      updateMutation.mutate(body);
    } else {
      createMutation.mutate(body);
    }
  }

  const sectionCard =
    'rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-16">
      <nav className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Link
          href="/planos-pix"
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          Planos por PIX
        </Link>
        <span className="mx-2 text-zinc-400">&gt;</span>
        <span className="text-zinc-400">
          {isEditing ? 'Editar plano' : 'Criar plano'}
        </span>
      </nav>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/planos-pix')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-emerald-800 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/10 dark:text-emerald-300 dark:hover:bg-white/15"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
            {isEditing ? 'Editar plano por PIX' : 'Criar plano por PIX'}
          </h1>
        </div>
      </div>

      {isEditing && isLoadingDetail ? (
        <div className="flex items-center justify-center py-20 text-sm text-zinc-400">
          Carregando plano...
        </div>
      ) : null}

      <section className={sectionCard}>
        <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Configuração do plano PIX
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1 md:col-span-2">
            <FieldLabel
              required
              infoText="Nome interno para identificar este plano PIX."
            >
              Nome do plano
            </FieldLabel>
            <Input
              theme={fieldTheme}
              variant="navbar"
              placeholder="Ex: Plano PIX Mensal"
              value={planName}
              onChange={setPlanName}
            />
          </div>

          <div className="flex flex-col gap-1 md:col-span-2">
            <FieldLabel
              required
              infoText="Descrição mostrada no checkout do plano PIX."
            >
              Descrição
            </FieldLabel>
            <Input
              theme={fieldTheme}
              variant="navbar"
              placeholder="Ex: Acesso premium por 30 dias"
              value={description}
              onChange={setDescription}
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

          <div className="flex flex-col gap-1">
            <FieldLabel>Webhook do plano</FieldLabel>
            <Input
              theme={fieldTheme}
              variant="navbar"
              placeholder="https://"
              value={webhookUrl}
              onChange={setWebhookUrl}
            />
          </div>
        </div>
      </section>

      <section className={sectionCard}>
        <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Configurações da cobrança
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <FieldLabel
              required
              infoText="Valor cobrado no checkout PIX do plano."
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
            <FieldLabel
              required
              infoText="Tipo do plano PIX (mês, trimestre, semestre ou ano)."
            >
              Tipo de plano
            </FieldLabel>
            <Dropdown
              theme={fieldTheme}
              variant="navbar"
              value={frequencyType}
              onChange={setFrequencyType}
              options={[
                { label: 'Mensal (30 dias)', value: 'MONTH' },
                { label: 'Trimestral (90 dias)', value: 'QUARTER' },
                { label: 'Semestral (180 dias)', value: 'SEMESTER' },
                { label: 'Anual (365 dias)', value: 'YEAR' },
              ]}
            />
          </div>

          {/*
          <div className="flex flex-col gap-1">
            <FieldLabel infoText="Campo visual para manter o layout igual ao de planos.">
              Intervalo
            </FieldLabel>
            <NumberStepper value={dummyInterval} onChange={setDummyInterval} min={1} max={1} theme={fieldTheme} />
          </div>
          */}
        </div>
      </section>

      <section className={sectionCard}>
        <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Plataforma (opcional)
        </h2>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          Opcional: associe uma plataforma ou use o titular financeiro.
        </p>
        {!isEditing && platformCatalog.user?.isAdmin && !selectedPlatform && (
          <PlatformOwnerSelect
            owner={financialOwner}
            disabled={false}
            onChange={setFinancialOwner}
          />
        )}
        <ProductPlatformSelect
          catalog={platformCatalog}
          value={selectedPlatform}
          onChange={(tag) => {
            setSelectedPlatform(tag || null);
            setFinancialOwner(null);
          }}
          theme={fieldTheme}
          disabled={isEditing}
        />
        {!selectedPlatform && platformTags.length > 0 && (
          <p className="mt-2 text-xs text-red-500">
            Sem plataforma, o recebimento e as taxas pertencem ao titular.
          </p>
        )}
      </section>

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
            title={description || planName}
            redirectUrl={redirectUrl}
          />
        </section>
      )}

      <CoproductionButton
        product="planos-pix"
        productId={editId}
        draft={coproduction.participants}
        onDraftChange={coproduction.setParticipants}
        disabled={createMutation.isPending}
      />

      <div className="flex justify-center pt-2">
        <Button
          type="button"
          className="h-11 min-w-[220px] rounded-lg bg-emerald-800 text-base font-semibold text-white hover:bg-emerald-900 dark:bg-emerald-700 dark:hover:bg-emerald-600 disabled:opacity-60"
          onClick={handleSave}
          disabled={
            isPending ||
            (!isEditing &&
              (platformCatalog.isLoading ||
                platformCatalog.isError ||
                !platformTags.includes(selectedPlatform ?? '')))
          }
        >
          {isPending
            ? 'Salvando...'
            : isEditing
              ? 'Salvar alterações'
              : 'Salvar plano PIX'}
        </Button>
      </div>
    </div>
  );
}
