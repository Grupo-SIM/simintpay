'use client';
import { PlatformOwnerSelect } from '@/components/platforms/PlatformOwnerSelect';

import { BoletoDueDaysField } from '@/components/boletos/BoletoDueDaysField';
import { FieldLabel } from '@/components/ui/FieldLabel';

import { useCoproductionDraft } from '@/features/coproduction/use-coproduction-draft';
import { CoproductionButton } from '@/components/coproduction';

import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { ProductPlatformSelect } from '@/components/product-platforms';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Minus, Plus } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { SingleDatePickerField } from '@/app/(dashboard)/links-pagamento/components/SingleDatePickerField';

/** Formata dígitos para "1.234,56" enquanto o usuário digita. */
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

type ApiBoletoDetail = {
  id: string;
  titulo?: string;
  descricao?: string | null;
  valor?: number;
  vencimentoDias?: number;
  ativo?: boolean;
  dataExpiracao?: string | null;
  redirectUrl?: string | null;
  webhookUrl?: string | null;
  maxUses?: number | null;
  plataformas?: string[];
};

export default function CriarBoletoPage() {
  const router = useRouter();
  const coproduction = useCoproductionDraft();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const boletoId = searchParams.get('id');
  const isEditing = Boolean(boletoId);
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';
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
  const ownedPlatforms = platformCatalog.selectableTags.map((tag) => ({ tag }));
  const platformsLoading = platformCatalog.isLoading;

  const [status, setStatus] = useState('ativo');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [preco, setPreco] = useState('0,00');
  const [vencimentoDias, setVencimentoDias] = useState('3');
  const [dataExpiracao, setDataExpiracao] = useState<Date | null>(null);
  const [limitePedidos, setLimitePedidos] = useState(0);
  const [limitePedidosInput, setLimitePedidosInput] = useState('Ilimitado');
  const [urlRedirecionamento, setUrlRedirecionamento] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [financialOwner, setFinancialOwner] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (boletoId) {
        return api.put<{ data: { id: string } }>(
          endpoints.boletos.update(boletoId),
          body,
        );
      }
      return api.post<{ data: { id: string } }>(
        endpoints.boletos.create,
        coproduction.withBody(body),
      );
    },
    onSuccess: () => {
      toast({
        type: 'success',
        title: isEditing ? 'Boleto atualizado' : 'Boleto criado',
        description: isEditing
          ? 'Boleto atualizado com sucesso.'
          : 'Boleto criado com sucesso na DOM Pagamentos.',
      });
      void queryClient.invalidateQueries({ queryKey: ['boletos'] });
      router.push('/boletos');
    },
    onError: (error: Error) => {
      toast({
        type: 'error',
        title: 'Erro',
        description:
          error?.message ||
          (isEditing
            ? 'Não foi possível atualizar o boleto.'
            : 'Não foi possível criar o boleto.'),
      });
    },
  });

  const detailQuery = useQuery({
    queryKey: ['boleto-detail', boletoId],
    queryFn: async () => {
      const response = await api.get<{ data: ApiBoletoDetail }>(
        endpoints.boletos.detail(boletoId!),
      );
      const data = response.data;
      setTitulo(data.titulo ?? '');
      setDescricao(data.descricao ?? '');
      setUrlRedirecionamento(data.redirectUrl ?? '');
      setWebhookUrl(data.webhookUrl ?? '');
      setStatus(data.ativo === false ? 'inativo' : 'ativo');
      setVencimentoDias(data.vencimentoDias ? String(data.vencimentoDias) : '');
      setDataExpiracao(
        data.dataExpiracao ? new Date(data.dataExpiracao) : null,
      );
      setPreco(
        data.valor != null
          ? formatCurrencyInput(String(Math.round(data.valor * 100)))
          : '0,00',
      );
      if (data.maxUses != null && data.maxUses > 0) {
        setLimitePedidos(data.maxUses);
        setLimitePedidosInput(String(data.maxUses));
      }
      const platform = data.plataformas?.[0] ?? null;
      if (platform) setSelectedPlatform(platform);

      return data;
    },
    enabled: Boolean(boletoId),
    staleTime: 60 * 1000,
  });

  function handleSave() {
    if (!titulo.trim()) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe o título do boleto.',
      });
      return;
    }
    if (
      !isEditing &&
      (selectedPlatform
        ? !ownedPlatforms.some((platform) => platform.tag === selectedPlatform)
        : platformCatalog.user?.isAdmin && !financialOwner)
    ) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Selecione um titular ou uma plataforma válida.',
      });
      return;
    }
    const valor = Number(preco.replace(/\./g, '').replace(',', '.')) || 0;
    if (valor <= 0) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe um valor válido.',
      });
      return;
    }

    createMutation.mutate({
      titulo: titulo.trim(),
      descricao: descricao.trim() || undefined,
      valor,
      vencimentoDias:
        vencimentoDias === ''
          ? 0
          : Math.min(90, Math.max(1, Number(vencimentoDias))),
      dataExpiracao: dataExpiracao ? dataExpiracao.toISOString() : undefined,
      redirectUrl: urlRedirecionamento.trim() || undefined,
      webhookUrl: webhookUrl.trim() || undefined,
      maxUses: limitePedidos > 0 ? limitePedidos : undefined,
      ...(!isEditing
        ? {
            ownerUserId: financialOwner?.id,
            plataformas: selectedPlatform ? [selectedPlatform] : [],
          }
        : {}),
      ...(isEditing ? { isActive: status === 'ativo' } : {}),
    });
  }

  const cardClass =
    'rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5';

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 pb-16">
      <nav className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Link
          href="/boletos"
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          Boletos
        </Link>
        <span className="mx-2 text-zinc-400">&gt;</span>
        <span className="text-zinc-400">
          {isEditing ? 'Editar boleto' : 'Criar boleto'}
        </span>
      </nav>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/boletos')}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-emerald-800 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/10 dark:text-emerald-300 dark:hover:bg-white/15"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
          {isEditing ? 'Editar boleto' : 'Criar boleto'}
        </h1>
      </div>

      <section className={cardClass}>
        <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Configurações gerais
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <FieldLabel>Status</FieldLabel>
            <Dropdown
              theme={fieldTheme}
              variant="navbar"
              value={status}
              onChange={setStatus}
              options={[
                { label: 'Ativo', value: 'ativo' },
                { label: 'Inativo', value: 'inativo' },
              ]}
            />
          </div>
          <SingleDatePickerField
            label="Data de expiração"
            value={dataExpiracao}
            onChange={setDataExpiracao}
            theme={fieldTheme}
          />
          <div className="flex flex-col gap-1">
            <FieldLabel info="Quantidade máxima de pedidos que podem ser feitos. Use zero ou Ilimitado para não limitar.">
              Limite de pedidos
            </FieldLabel>
            <div
              className={fieldShellClassNames(fieldTheme, 'navbar', {
                focusWithin: false,
              })}
            >
              <button
                type="button"
                onClick={() => {
                  const next = Math.max(0, limitePedidos - 1);
                  setLimitePedidos(next);
                  setLimitePedidosInput(
                    next === 0 ? 'Ilimitado' : String(next),
                  );
                }}
                className="px-3 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                aria-label="Diminuir limite de pedidos"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="text"
                inputMode="numeric"
                value={limitePedidosInput}
                onFocus={() => {
                  if (limitePedidos === 0) setLimitePedidosInput('');
                }}
                onChange={(e) =>
                  setLimitePedidosInput(e.target.value.replace(/\D/g, ''))
                }
                onBlur={() => {
                  const next =
                    Number(limitePedidosInput.replace(/\D/g, '')) || 0;
                  setLimitePedidos(next);
                  setLimitePedidosInput(
                    next === 0 ? 'Ilimitado' : String(next),
                  );
                }}
                className={cn(
                  'flex-1 border-x bg-transparent px-2 text-center text-sm outline-none',
                  fieldDividerClassNames(fieldTheme, 'navbar'),
                  'text-zinc-800 dark:text-zinc-100',
                )}
                aria-label="Limite de pedidos"
              />
              <button
                type="button"
                onClick={() => {
                  const next = Math.min(9999, limitePedidos + 1);
                  setLimitePedidos(next);
                  setLimitePedidosInput(String(next));
                }}
                className="px-3 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                aria-label="Aumentar limite de pedidos"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <Input
            label="Título do boleto"
            placeholder="Ex: Mensalidade"
            value={titulo}
            onChange={setTitulo}
            theme={fieldTheme}
            variant="navbar"
          />
          <Input
            label="Valor"
            theme={fieldTheme}
            variant="navbar"
            prefix="R$"
            value={preco}
            onChange={(value) => setPreco(formatCurrencyInput(value))}
          />
          <BoletoDueDaysField
            value={vencimentoDias}
            onChange={setVencimentoDias}
            theme={fieldTheme}
          />

          <div className="md:col-span-3">
            <Input
              label="Descrição"
              placeholder="Máximo de caracteres (0/200)"
              value={descricao}
              onChange={setDescricao}
              theme={fieldTheme}
              variant="navbar"
            />
          </div>
          <div className="md:col-span-3">
            <Input
              label="Redirecionamento após aprovação (opcional)"
              placeholder="https://…"
              value={urlRedirecionamento}
              onChange={setUrlRedirecionamento}
              theme={fieldTheme}
              variant="navbar"
              inputMode="url"
            />
          </div>
          <div className="md:col-span-3">
            <Input
              label="Webhook URL (opcional)"
              placeholder="https://… (notificado quando o boleto for pago)"
              value={webhookUrl}
              onChange={setWebhookUrl}
              theme={fieldTheme}
              variant="navbar"
              inputMode="url"
            />
          </div>

          <div className="md:col-span-3">
            <div className="flex flex-col gap-2">
              <FieldLabel info="Plataforma à qual este produto pertence. Define a associação usada no processamento do pagamento.">
                Plataforma associada (opcional)
              </FieldLabel>
              {!isEditing &&
                platformCatalog.user?.isAdmin &&
                !selectedPlatform && (
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
            </div>
          </div>
        </div>
      </section>

      <CoproductionButton
        product="boletos"
        productId={boletoId}
        draft={coproduction.participants}
        onDraftChange={coproduction.setParticipants}
        disabled={createMutation.isPending}
      />

      <div className="flex justify-center pt-2">
        <Button
          type="button"
          className="h-11 min-w-[220px] rounded-lg bg-emerald-700 text-base font-semibold text-white hover:bg-emerald-800"
          onClick={handleSave}
          disabled={
            createMutation.isPending ||
            (isEditing
              ? !detailQuery.data
              : platformsLoading ||
                platformCatalog.isError ||
                (selectedPlatform
                  ? !ownedPlatforms.some(
                      (platform) => platform.tag === selectedPlatform,
                    )
                  : platformCatalog.user?.isAdmin && !financialOwner))
          }
        >
          {createMutation.isPending
            ? 'Salvando...'
            : isEditing
              ? 'Atualizar'
              : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}
