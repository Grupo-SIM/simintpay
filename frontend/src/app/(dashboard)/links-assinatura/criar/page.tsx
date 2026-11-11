'use client';
import { PlatformOwnerSelect } from '@/components/platforms/PlatformOwnerSelect';

import { useCoproductionDraft } from '@/features/coproduction/use-coproduction-draft';
import { CoproductionButton } from '@/components/coproduction';

import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { ProductPlatformSelect } from '@/components/product-platforms';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { Input } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { Button } from '@/components/ui/Button';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useToast } from '@/components/ui/Toast';
import { EmailPreview } from '@/components/ui/EmailPreview';
import { useCurrentUser } from '@/hooks/use-current-user';
import { isMasterAdminClient } from '@/lib/is-master-admin-client';
import type { FrequencyType } from '../types';

type ApiAdminUser = {
  id?: string;
  email?: string;
  cpf?: string | null;
  document?: string | null;
};

/** Limite de caracteres da mensagem de e-mail ao comprador. */
const EMAIL_BODY_MAX = 2000;

function formatCpf(value?: string | null) {
  if (!value) return 'CPF não informado';
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11) return value;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

export default function CriarLinkAssinaturaPage() {
  const router = useRouter();
  const coproduction = useCoproductionDraft();
  const searchParams = useSearchParams();
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';
  const linkId = searchParams.get('id');
  const returnTo = searchParams.get('returnTo');
  const isEditing = Boolean(linkId);

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

  // Form state
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [frequencyType, setFrequencyType] = useState<FrequencyType>('MONTHLY');
  const [isStandalone, setIsStandalone] = useState(true);
  const [maxUses, setMaxUses] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<
    'PIX' | 'CREDIT_CARD' | 'BOTH'
  >('BOTH');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [financialOwner, setFinancialOwner] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [emailBody, setEmailBody] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const hydratedRef = useRef(false);

  const queryClient = useQueryClient();
  const isMasterAdmin = isMasterAdminClient(user);
  const shouldSearch = isMasterAdmin && ownerEmail.trim().length >= 3;

  // Autocomplete de usuários (apenas admin master)
  const usersQuery = useQuery({
    queryKey: ['admin-users-suggest', ownerEmail],
    queryFn: async () => {
      const res = await api.get<{ data?: ApiAdminUser[] }>(
        endpoints.admin.users.list,
        {
          query: { page: 1, pageSize: 20, search: ownerEmail.trim() },
        },
      );
      const list = res.data ?? [];
      const term = ownerEmail.trim().toLowerCase();
      return list
        .filter((item) => (item.email ?? '').toLowerCase().startsWith(term))
        .slice(0, 6);
    },
    enabled: shouldSearch,
    staleTime: 20_000,
  });

  // Lista de plataformas disponíveis
  const platformCatalog = useProductPlatforms();
  const allPlatformTags = platformCatalog.selectableTags;

  const linkDetailQuery = useQuery({
    queryKey: ['links-assinatura-detail', linkId],
    queryFn: async () => {
      if (!linkId) return null;
      const response = await api.get<{
        data?: {
          nome?: string;
          descricao?: string | null;
          valor?: number;
          frequencyType?: FrequencyType;
          isStandalone?: boolean;
          platformFee?: number;
          maxUsos?: number | null;
          redirectUrl?: string | null;
          webhookUrl?: string | null;
          paymentMethods?: 'PIX' | 'CREDIT_CARD' | 'BOTH';
          ownerEmail?: string | null;
          platformTag?: string | null;
          emailBody?: string | null;
          plataformas?: string[];
          plataforma?: string | null;
        };
      }>(endpoints.linksAssinatura.detail(linkId));
      if (response.data && !hydratedRef.current) {
        const detail = response.data;
        setNome(detail.nome ?? '');
        setDescricao(detail.descricao ?? '');
        setValor(detail.valor != null ? (detail.valor * 100).toFixed(0) : '');
        setFrequencyType(detail.frequencyType ?? 'MONTHLY');
        setIsStandalone(detail.isStandalone ?? true);
        setMaxUses(detail.maxUsos != null ? String(detail.maxUsos) : '');
        setRedirectUrl(detail.redirectUrl ?? '');
        setWebhookUrl(detail.webhookUrl ?? '');
        setPaymentMethods(detail.paymentMethods ?? 'BOTH');
        setOwnerEmail(detail.ownerEmail ?? '');
        setSelectedPlatform(
          detail.platformTag ??
            detail.plataformas?.[0] ??
            detail.plataforma ??
            null,
        );
        setEmailBody(detail.emailBody ?? '');
        hydratedRef.current = true;
      }
      return response;
    },
    enabled: isEditing,
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanValor = valor.replace(/\D/g, '');
      const valorNum = cleanValor ? Number(cleanValor) / 100 : 0;
      if (!nome.trim()) throw new Error('Nome é obrigatório');
      if (!valorNum || valorNum <= 0) throw new Error('Valor inválido');
      if (
        !isEditing &&
        (platformCatalog.isLoading ||
          platformCatalog.isError ||
          (selectedPlatform
            ? !allPlatformTags.includes(selectedPlatform)
            : platformCatalog.user?.isAdmin && !financialOwner))
      )
        throw new Error('Selecione um titular ou uma plataforma válida');

      const frequencyMap: Record<string, string> = {
        WEEKLY: 'SEMANAL',
        SEMANAL: 'SEMANAL',
        MONTHLY: 'MENSAL',
        MENSAL: 'MENSAL',
        ANUAL: 'ANUAL',
      };

      const payload: Record<string, unknown> = {
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        valor: valorNum,
        frequencia: frequencyMap[frequencyType] ?? frequencyType,
        isStandalone,
        maxUses: maxUses.trim() ? Number(maxUses) : undefined,
        redirectUrl: redirectUrl.trim() || undefined,
        webhookUrl: webhookUrl.trim() || undefined,
        paymentMethods,
        email: ownerEmail.trim() || undefined,
        ...(!isEditing
          ? {
              ownerUserId: financialOwner?.id,
              platformTag: selectedPlatform ?? undefined,
            }
          : {}),
        ...(!isEditing
          ? {
              ownerUserId: financialOwner?.id,
              plataformas: selectedPlatform ? [selectedPlatform] : [],
            }
          : {}),
        ...(selectedPlatform ? { emailBody: emailBody.trim() || null } : {}),
      };

      if (isEditing && linkId) {
        // Campos editáveis (não envia isActive: o status é controlado pelo toggle da lista)
        return api.put(endpoints.linksAssinatura.update(linkId), {
          nome: payload.nome,
          descricao: payload.descricao,
          valor: payload.valor,
          frequencia: payload.frequencia,
          paymentMethods: payload.paymentMethods,
          isStandalone: payload.isStandalone,
          maxUses: payload.maxUses,
          redirectUrl: payload.redirectUrl,
          webhookUrl: payload.webhookUrl,
          ...(selectedPlatform ? { emailBody: emailBody.trim() || null } : {}),
        });
      }
      return api.post(
        endpoints.linksAssinatura.create,
        coproduction.withBody(payload),
      );
    },
    onSuccess: () => {
      toast({
        type: 'success',
        title: isEditing ? 'Link atualizado' : 'Link criado',
        description: isEditing
          ? 'Link de assinatura atualizado com sucesso.'
          : 'Link de assinatura criado com sucesso.',
      });
      void queryClient.invalidateQueries({ queryKey: ['links-assinatura'] });
      // Remove o cache de detalhe (não só invalida): a hidratação só roda uma vez
      // (hydratedRef), então o cache antigo serviria valores velhos ao reeditar.
      // Removendo, a próxima edição busca os dados frescos do zero.
      if (linkId) {
        queryClient.removeQueries({
          queryKey: ['links-assinatura-detail', linkId],
        });
      }
      if (isEditing) {
        const target =
          returnTo && returnTo.startsWith('/links-assinatura')
            ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}updatedAt=${Date.now()}`
            : `/links-assinatura?updatedAt=${Date.now()}`;
        router.push(target);
        return;
      }
      router.push('/links-assinatura');
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar o link.';
      toast({ type: 'error', title: 'Erro', description: message });
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-16">
      {/* Breadcrumb */}
      <nav className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Link
          href="/links-assinatura"
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          Links de assinatura
        </Link>
        <span className="mx-2 text-zinc-400">&gt;</span>
        <span className="text-zinc-400">
          {isEditing ? 'Editar link' : 'Criar link'}
        </span>
      </nav>

      {/* Page title */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/links-assinatura')}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-emerald-800 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/10 dark:text-emerald-300 dark:hover:bg-white/15"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
          {isEditing ? 'Editar link de assinatura' : 'Novo link de assinatura'}
        </h1>
      </div>

      {/* Main form */}
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
        {isEditing && linkDetailQuery.isLoading && (
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            Carregando dados do link...
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Nome */}
          <div className="md:col-span-2">
            <Input
              label="Nome do link"
              required
              value={nome}
              onChange={setNome}
              placeholder="Ex: Assinatura Anual Marketing Raiz"
              theme={fieldTheme}
              variant="navbar"
            />
          </div>

          {/* Descrição */}
          <div className="md:col-span-2">
            <Input
              label="Descrição (opcional)"
              value={descricao}
              onChange={setDescricao}
              placeholder="Breve descrição do plano"
              theme={fieldTheme}
              variant="navbar"
            />
          </div>

          {/* Valor */}
          <Input
            label="Valor (R$)"
            required
            value={valor}
            onChange={setValor}
            placeholder="Ex: 49,90"
            theme={fieldTheme}
            variant="navbar"
            inputMode="decimal"
            mask="currency"
          />

          {/* Frequência */}
          <Dropdown
            label="Frequência de cobrança"
            required
            value={frequencyType}
            onChange={(v) => setFrequencyType(v as FrequencyType)}
            theme={fieldTheme}
            variant="navbar"
            options={[
              { value: 'WEEKLY', label: 'Semanal' },
              { value: 'MONTHLY', label: 'Mensal' },
              { value: 'ANUAL', label: 'Anual' },
            ]}
          />

          {/* Tipo de link */}
          <Dropdown
            label="Tipo de link"
            required
            value={isStandalone ? 'standalone' : 'plataforma'}
            onChange={(v) => setIsStandalone(v === 'standalone')}
            theme={fieldTheme}
            variant="navbar"
            options={[
              {
                value: 'standalone',
                label: 'Sem juros (absorve taxa — cliente paga o valor exato)',
              },
              {
                value: 'plataforma',
                label:
                  'Com juros (percentual somado ao valor cobrado do cliente)',
              },
            ]}
          />

          {/* Método de pagamento */}
          <Dropdown
            label="Formas de pagamento aceitas"
            required
            value={paymentMethods}
            onChange={(v) =>
              setPaymentMethods(v as 'PIX' | 'CREDIT_CARD' | 'BOTH')
            }
            theme={fieldTheme}
            variant="navbar"
            options={[
              { value: 'BOTH', label: 'PIX e Cartão de crédito' },
              { value: 'CREDIT_CARD', label: 'Somente Cartão de crédito' },
              { value: 'PIX', label: 'Somente PIX' },
            ]}
          />

          {/* Máximo de usos */}
          <Input
            label="Máximo de usos (opcional)"
            value={maxUses}
            onChange={setMaxUses}
            placeholder="Ilimitado se vazio"
            theme={fieldTheme}
            variant="navbar"
            inputMode="numeric"
          />
        </div>

        {/* Conta destino — apenas admin master */}
        {isMasterAdmin && (
          <div className="mt-4">
            <div className="relative">
              <Input
                label="Conta destino — buscar por e-mail (opcional)"
                value={ownerEmail}
                onChange={(v) => {
                  setOwnerEmail(v);
                  setShowSuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Buscar por email ou nome…"
                theme={fieldTheme}
                variant="navbar"
              />
              {showSuggestions &&
                usersQuery.data &&
                usersQuery.data.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-white/10 dark:bg-zinc-900">
                    {usersQuery.data.map((item) => (
                      <button
                        key={item.id ?? item.email}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (item.email) setOwnerEmail(item.email);
                          setShowSuggestions(false);
                        }}
                        className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-white/10"
                      >
                        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                          {item.email}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatCpf(item.cpf ?? item.document)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
            </div>
            {ownerEmail && (
              <p className="mt-1 text-xs text-zinc-500">
                Se vazio, o link é criado para a sua própria conta.
              </p>
            )}
          </div>
        )}

        {/* Configurações avançadas */}
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            ▶ Configurações avançadas
          </summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Input
              label="URL de redirecionamento (pós-pagamento)"
              value={redirectUrl}
              onChange={setRedirectUrl}
              placeholder="https://…"
              theme={fieldTheme}
              variant="navbar"
            />
            <Input
              label="Webhook URL"
              value={webhookUrl}
              onChange={setWebhookUrl}
              placeholder="https://…"
              theme={fieldTheme}
              variant="navbar"
            />
          </div>
        </details>

        {/* Tipo de link explicação */}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {isStandalone
            ? 'Sem juros: o cliente paga o valor cadastrado, a taxa é absorvida.'
            : 'Com juros: o percentual abaixo é somado ao valor e cobrado do cliente.'}
        </p>

        {/* Plataforma */}
        <div className="mt-5">
          <p className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Plataforma associada (opcional)
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
          {!selectedPlatform && (
            <p className="mt-2 text-xs text-red-500">
              Sem plataforma, o recebimento e as taxas pertencem ao titular.
            </p>
          )}
        </div>

        {selectedPlatform && (
          <div className="mt-6">
            <h3 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Mensagem do e-mail ao comprador
            </h3>
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
              title={nome}
              redirectUrl={redirectUrl}
            />
          </div>
        )}

        <CoproductionButton
          product="links-assinatura"
          productId={linkId}
          draft={coproduction.participants}
          onDraftChange={coproduction.setParticipants}
          disabled={saveMutation.isPending}
        />

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/links-assinatura')}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="bg-emerald-700 text-white hover:bg-emerald-800"
            onClick={() => saveMutation.mutate()}
            disabled={
              saveMutation.isPending ||
              (!isEditing &&
                (platformCatalog.isLoading ||
                  platformCatalog.isError ||
                  (selectedPlatform
                    ? !allPlatformTags.includes(selectedPlatform)
                    : platformCatalog.user?.isAdmin && !financialOwner)))
            }
          >
            {saveMutation.isPending
              ? 'Salvando...'
              : isEditing
                ? 'Atualizar link'
                : 'Criar link'}
          </Button>
        </div>
      </section>
    </div>
  );
}
