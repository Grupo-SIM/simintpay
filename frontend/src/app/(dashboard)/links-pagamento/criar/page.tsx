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
import {
  ArrowLeft,
  Minus,
  Paperclip,
  Plus,
  Scan,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  PLATAFORMA_TAXA_LABELS,
  taxaFromDisplay,
  taxaToDisplay,
  type PlataformaTaxaKey,
} from '@/features/platform-taxas/taxa-fields';
import type { PlataformaTaxasGetResponse } from '@/features/platform-taxas/types';
import { cn } from '@/lib/utils';
import { fieldDividerClassNames, fieldShellClassNames } from '@/lib/fieldShell';
import { Input } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { EmailPreview } from '@/components/ui/EmailPreview';
import { PaymentLinkPreviewModal } from './components/PaymentLinkPreviewModal';
import {
  calcularParcela,
  FALLBACK_SIMINTPAY_COSTS,
  type CalcRates,
} from '@/features/links-pagamento/payment-link-calculation';
import type { PaymentLinkPreviewDraft } from '@/features/links-pagamento/payment-link-preview';
import { SingleDatePickerField } from '../components/SingleDatePickerField';
import type { PaymentLinkFile, PaymentLinkOffer } from '../types';
import {
  PaymentLinkOffersSection,
  offerDraftsFromApi,
  persistOfferDrafts,
  validateOfferDrafts,
  type OfferDraft,
} from './components/PaymentLinkOffersSection';
import {
  uploadPaymentLinkFiles,
  deletePaymentLinkFile,
} from '@/features/links-pagamento/services/links-pagamento.service';

type ProdutoFormItem = {
  id: string;
  codigoExterno: string;
  nome: string;
  preco: string;
  quantidadeMin: number;
  quantidadeMax: number;
};

/** Limite de caracteres da mensagem de e-mail ao comprador. */
const EMAIL_BODY_MAX = 2000;

/** Máximo de PDFs anexáveis ao link (deve casar com o backend). */
const MAX_PDF_FILES = 20;

type ApiLinkDetail = {
  id: string;
  titulo?: string;
  descricao?: string | null;
  valor?: number;
  parcelasMax?: number;
  ativo?: boolean;
  isStandalone?: boolean;
  dataExpiracao?: string | null;
  redirectUrl?: string | null;
  webhookUrl?: string | null;
  emailBody?: string | null;
  plataformas?: string[];
  platformFee1x?: number;
  platformFee2x?: number;
  platformFee3x?: number;
  platformFee4x?: number;
  platformFee5x?: number;
  platformFee6x?: number;
  platformFee7x?: number;
  platformFee8x?: number;
  platformFee9x?: number;
  platformFee10x?: number;
  platformFee11x?: number;
  platformFee12x?: number;
  aceitaDebito?: boolean;
  debitFeePercent?: number;
  debitFeeFixed?: number;
  files?: PaymentLinkFile[];
  ofertas?: PaymentLinkOffer[];
};

function createEmptyProdutoItem(): ProdutoFormItem {
  return {
    id: `produto-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    codigoExterno: '',
    nome: '',
    preco: '0,00',
    quantidadeMin: 1,
    quantidadeMax: 1,
  };
}

function FormSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full border-2 border-transparent transition-colors',
        checked ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-600',
      )}
    >
      <span
        className={cn(
          'inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  theme,
  disabled = false,
  formatValue,
  valueClassName,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  theme: 'light' | 'dark';
  disabled?: boolean;
  formatValue?: (value: number) => string;
  valueClassName?: (value: number) => string;
}) {
  if (disabled) {
    return (
      <div
        className={cn(
          fieldShellClassNames(theme, 'navbar', { focusWithin: false }),
          'opacity-60',
        )}
      >
        <button
          type="button"
          disabled
          className="cursor-not-allowed px-2 text-zinc-400"
          aria-label="Diminuir"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <div
          className={cn(
            'flex min-w-8 flex-1 items-center justify-center border-x px-2 text-sm text-zinc-400',
            fieldDividerClassNames(theme, 'navbar'),
          )}
        >
          {formatValue ? formatValue(value) : value}
        </div>
        <button
          type="button"
          disabled
          className="cursor-not-allowed px-2 text-zinc-400"
          aria-label="Aumentar"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const step = (delta: number) => {
    const next = value + delta;
    if (next < min || next > max) return;
    onChange(next);
  };

  return (
    <div
      className={fieldShellClassNames(theme, 'navbar', { focusWithin: false })}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        className="px-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
        aria-label="Diminuir"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <div
        className={cn(
          'flex min-w-8 flex-1 items-center justify-center border-x px-2 text-sm',
          fieldDividerClassNames(theme, 'navbar'),
          valueClassName?.(value),
        )}
      >
        {formatValue ? formatValue(value) : value}
      </div>
      <button
        type="button"
        onClick={() => step(1)}
        className="px-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
        aria-label="Aumentar"
      >
        <Plus className="h-3.5 w-3.5" />
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

const DEFAULT_DOM_FEE_RATES: Record<number, number> = {
  1: 0.0,
  2: 0.0451,
  3: 0.0604,
  4: 0.0759,
  5: 0.0915,
  6: 0.1072,
  7: 0.1231,
  8: 0.1392,
  9: 0.1554,
  10: 0.1717,
  11: 0.1882,
  12: 0.2048,
};

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function CriarLinkPagamentoPage() {
  const router = useRouter();
  const coproduction = useCoproductionDraft();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const linkId = searchParams.get('id');
  const isEditing = Boolean(linkId);
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

  const { user } = useCurrentUser();
  const { data: taxasRes, isLoading: loadingTaxas } = useQuery({
    queryKey: ['admin', 'platform-taxas'],
    queryFn: () =>
      api.get<PlataformaTaxasGetResponse>(
        endpoints.admin.plataformas.taxasList,
      ),
  });

  const activeTag = useMemo(() => {
    return (user?.tenantModule?.slug ?? '').toUpperCase();
  }, [user]);

  const globalFees = useMemo(() => {
    if (!taxasRes) return null;
    return taxasRes.data[activeTag] || {};
  }, [taxasRes, activeTag]);

  const domLinkRates = useMemo(() => {
    if (!taxasRes?.meta?.domLinkRates) return DEFAULT_DOM_FEE_RATES;
    const raw = taxasRes.meta.domLinkRates as Record<string, number>;
    const mapped: Record<number, number> = {};
    for (let i = 1; i <= 12; i++) {
      mapped[i] = raw[`DOM_LINK_${i}X`] ?? DEFAULT_DOM_FEE_RATES[i];
    }
    return mapped;
  }, [taxasRes]);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [status, setStatus] = useState('ativo');
  const [cashback, setCashback] = useState('ativo');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [urlRedirecionamento, setUrlRedirecionamento] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [dataExpiracao, setDataExpiracao] = useState<Date | null>(null);

  const [produtos, setProdutos] = useState<ProdutoFormItem[]>([
    createEmptyProdutoItem(),
  ]);
  const [limitePedidos, setLimitePedidos] = useState(0);
  const [limitePedidosInput, setLimitePedidosInput] = useState('Ilimitado');
  const [cartaoCredito, setCartaoCredito] = useState(true);
  const [debito, setDebito] = useState(true);
  const [pix, setPix] = useState(true);
  const [pendingPdfFiles, setPendingPdfFiles] = useState<File[]>([]);
  const [existingFiles, setExistingFiles] = useState<PaymentLinkFile[]>([]);
  const [, setAjustesModalOpen] = useState(false);
  const [ajustesModalMounted, setAjustesModalMounted] = useState(false);
  const [ajustesModalClosing, setAjustesModalClosing] = useState(false);
  const [tabJuros, setTabJuros] = useState<
    'editar' | 'parcela' | 'mes' | 'liquido'
  >('editar');
  const [assumirTaxas, setAssumirTaxas] = useState('nenhuma');
  const [isStandalone, setIsStandalone] = useState(true);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [financialOwner, setFinancialOwner] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [pdfSizeError, setPdfSizeError] = useState<string | null>(null);
  const [emailBody, setEmailBody] = useState('');
  const [offerDrafts, setOfferDrafts] = useState<OfferDraft[]>([]);
  // Só sincroniza ofertas quando houve edição (ou já existiam) — evita PUT desnecessário.
  const [offersTouched, setOffersTouched] = useState(false);

  // Fees da plataforma selecionada para o link (prioridade sobre globalFees)
  const selectedPlatformFees = useMemo(() => {
    if (!taxasRes || !selectedPlatform) return null;
    return taxasRes.data[selectedPlatform.toUpperCase()] ?? {};
  }, [taxasRes, selectedPlatform]);

  const activeFees = selectedPlatformFees ?? globalFees;
  const calcRates: CalcRates = useMemo(
    () => ({
      domFees: domLinkRates,
      sellerFees: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => {
          const n = index + 1;
          return [
            n,
            activeFees?.[`LINK_COST_${n}X` as PlataformaTaxaKey] ??
              FALLBACK_SIMINTPAY_COSTS[n] / 100,
          ];
        }),
      ),
      sellerFeeFixed: activeFees?.TAXA_LINK_FIXA ?? 4.0,
      cashbackFee: activeFees?.TAXA_CASHBACK ?? 3.0,
    }),
    [domLinkRates, activeFees],
  );

  const platformCatalog = useProductPlatforms();
  const allPlatformTags = platformCatalog.selectableTags;
  // jurosEditaveis: chave "2x"-"12x" → valor % como string
  const [jurosOverride, setJurosEditaveis] = useState<Record<string, string>>(
    {},
  );

  const jurosEditaveis = useMemo(() => {
    if (isEditing || Object.keys(jurosOverride).length > 0)
      return jurosOverride;
    const fees = selectedPlatformFees ?? globalFees;
    if (!fees) return jurosOverride;
    return Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => {
        const i = index + 1;
        const key = `MDR_LINK_${i}X` as PlataformaTaxaKey;
        return [`${i}x`, taxaToDisplay(key, i === 1 ? 0 : (fees[key] ?? 0))];
      }),
    );
  }, [isEditing, jurosOverride, selectedPlatformFees, globalFees]);

  const produtoPrincipal = produtos[0] ?? {
    id: '',
    codigoExterno: '',
    nome: '',
    preco: '0,00',
    quantidadeMin: 1,
    quantidadeMax: 1,
  };
  const preco = produtoPrincipal.preco;
  const quantidadeMin = produtoPrincipal.quantidadeMin;
  const precoNumerico =
    Number(
      preco
        .replace(/\./g, '')
        .replace(',', '.')
        .replace(/[^\d.]/g, ''),
    ) || 0;
  const podeAjustarTaxas = cartaoCredito && precoNumerico > 0;

  // Linhas calculadas dinamicamente com base no valor real e juros editáveis
  const linhasSimulador = useMemo(() => {
    const base = precoNumerico > 0 ? precoNumerico : 1000;
    return Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      const absorbed =
        assumirTaxas !== 'nenhuma' && n <= parseInt(assumirTaxas, 10);
      const rateStr = absorbed ? '0' : jurosEditaveis[`${n}x`];
      const platformFeeRate =
        rateStr !== undefined ? Number(rateStr.replace(',', '.')) : 0;
      const calc = calcularParcela(
        base,
        n,
        platformFeeRate,
        isStandalone,
        calcRates,
      );
      return { n, platformFeeRate, ...calc };
    });
  }, [jurosEditaveis, isStandalone, precoNumerico, calcRates, assumirTaxas]);

  const previewDraft: PaymentLinkPreviewDraft = {
    title: titulo.trim() || produtoPrincipal.nome.trim() || 'Título do link',
    description: descricao.trim(),
    amount: precoNumerico,
    methods: { credit: cartaoCredito, debit: debito, pix },
    maxInstallments: cartaoCredito ? 12 : 1,
    installments: linhasSimulador
      .slice(0, cartaoCredito ? 12 : 1)
      .map((row) => {
        // The simulator uses R$ 1.000 as an empty-form example; preview uses the real draft.
        const calculation =
          precoNumerico > 0 ? row : { total: 0, parcela: 0, juros: 0 };
        return {
          count: row.n,
          total: calculation.total,
          amount: calculation.parcela,
          interest: calculation.juros,
        };
      }),
    pixAmount: precoNumerico,
    debitAmount: precoNumerico,
  };

  function updateProduto(id: string, updates: Partial<ProdutoFormItem>) {
    setProdutos((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    );
  }

  function addProduto() {
    setProdutos((prev) => [...prev, createEmptyProdutoItem()]);
  }

  function removeProduto(id: string) {
    setProdutos((prev) => {
      const next = prev.filter((item) => item.id !== id);
      return next.length > 0 ? next : [createEmptyProdutoItem()];
    });
  }

  const updateGlobalTaxasMutation = useMutation({
    mutationFn: (patch: Partial<Record<PlataformaTaxaKey, number>>) => {
      return api.patch(
        endpoints.admin.plataformas.taxasUpdate(activeTag.toLowerCase()),
        patch,
      );
    },
    onSuccess: () => {
      toast({ type: 'success', title: 'Taxas globais atualizadas' });
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'platform-taxas'],
      });
    },
  });

  function closeAjustesModal() {
    setAjustesModalOpen(false);
    setAjustesModalClosing(true);
    setTimeout(() => {
      setAjustesModalMounted(false);
      setAjustesModalClosing(false);
    }, 220);

    // Sincroniza com a taxa global como solicitado pelo usuário
    const patch: Partial<Record<PlataformaTaxaKey, number>> = {};
    let changed = false;
    for (let i = 1; i <= 12; i++) {
      const k = `MDR_LINK_${i}X` as PlataformaTaxaKey;
      const newVal = taxaFromDisplay(k, jurosEditaveis[`${i}x`] ?? '');
      if (!Number.isNaN(newVal) && newVal !== globalFees?.[k]) {
        patch[k] = newVal;
        changed = true;
      }
    }

    if (changed) {
      updateGlobalTaxasMutation.mutate(patch);
    }
  }

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (linkId) {
        return api.put<{ data?: { id: string }; id?: string }>(
          endpoints.linksPagamento.update(linkId),
          body,
        );
      }
      return api.post<{ data?: { id: string }; id?: string }>(
        endpoints.linksPagamento.create,
        coproduction.withBody(body),
      );
    },
    onSuccess: async (result) => {
      const savedLinkId = linkId ?? result.data?.id ?? result.id;
      if (offersTouched && savedLinkId) {
        try {
          await persistOfferDrafts(api, savedLinkId, offerDrafts);
        } catch (err) {
          toast({
            type: 'error',
            title: 'Aviso',
            description: `Link salvo, mas falha ao salvar order bumps/upsell/downsell${err instanceof Error && err.message ? `: ${err.message}` : '.'}`,
          });
        }
      }
      if (pendingPdfFiles.length > 0 && savedLinkId) {
        try {
          await uploadPaymentLinkFiles(api, savedLinkId, pendingPdfFiles);
        } catch {
          toast({
            type: 'error',
            title: 'Aviso',
            description: 'Link salvo, mas falha ao enviar PDFs.',
          });
        }
      }
      toast({
        type: 'success',
        title: isEditing ? 'Link atualizado' : 'Link criado',
        description: isEditing
          ? 'Link de pagamento atualizado com sucesso.'
          : 'Link de pagamento criado com sucesso na DOM Pagamentos.',
      });
      void queryClient.invalidateQueries({ queryKey: ['links-pagamento'] });
      router.push('/links-pagamento');
    },
    onError: () => {
      toast({
        type: 'error',
        title: 'Erro',
        description: isEditing
          ? 'Não foi possível atualizar o link de pagamento.'
          : 'Não foi possível criar o link de pagamento.',
      });
    },
  });

  const detailQuery = useQuery({
    queryKey: ['link-pagamento-detail', linkId],
    queryFn: async () => {
      const response = await api.get<{ data: ApiLinkDetail }>(
        endpoints.linksPagamento.detail(linkId!),
      );
      const data = response.data;
      setTitulo(data.titulo ?? '');
      setDescricao(data.descricao ?? '');
      setUrlRedirecionamento(data.redirectUrl ?? '');
      setWebhookUrl(data.webhookUrl ?? '');
      setStatus(data.ativo === false ? 'inativo' : 'ativo');
      setDataExpiracao(
        data.dataExpiracao ? new Date(data.dataExpiracao) : null,
      );
      setCartaoCredito((data.parcelasMax ?? 1) > 1);
      setDebito(data.aceitaDebito ?? true);
      setIsStandalone(data.isStandalone ?? true);
      setPix(true);
      setProdutos((prev) => {
        const first = prev[0] ?? createEmptyProdutoItem();
        const valor =
          data.valor != null
            ? formatCurrencyInput(String(Math.round(data.valor * 100)))
            : '0,00';
        return [
          {
            ...first,
            nome: data.titulo ?? '',
            preco: valor,
            quantidadeMin: 1,
            quantidadeMax: 1,
          },
        ];
      });
      const platform = data.plataformas?.[0] ?? null;
      if (platform) {
        setSelectedPlatform(platform);
      }
      setEmailBody(data.emailBody ?? '');
      // Carrega as taxas salvas no link (2x-12x)
      const nextJuros: Record<string, string> = {};
      for (let i = 1; i <= 12; i++) {
        const key = `platformFee${i}x` as keyof ApiLinkDetail;
        const saved = data[key] as number | undefined;
        nextJuros[`${i}x`] =
          saved !== undefined
            ? String(saved)
            : globalFees
              ? taxaToDisplay(
                  `MDR_LINK_${i}X` as PlataformaTaxaKey,
                  globalFees[`MDR_LINK_${i}X` as PlataformaTaxaKey] ?? 0,
                )
              : '0';
      }
      setJurosEditaveis(nextJuros);
      setExistingFiles(data.files ?? []);

      setOfferDrafts(offerDraftsFromApi(data.ofertas));
      setOffersTouched(false);
      return data;
    },
    enabled: Boolean(linkId),
    staleTime: 60 * 1000,
  });

  // Ofertas carregadas separadamente: o efeito acima reexecuta quando as taxas mudam
  // e não pode sobrescrever edições em andamento.

  function handleSave() {
    if (!titulo.trim()) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe o título do link.',
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
    const produtosPreenchidos = produtos.filter((item) => {
      const hasText = item.codigoExterno.trim() || item.nome.trim();
      const valor =
        Number(item.preco.replace(/\./g, '').replace(',', '.')) || 0;
      return Boolean(hasText) || valor > 0;
    });
    if (produtosPreenchidos.length === 0) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Adicione pelo menos um produto válido.',
      });
      return;
    }
    const produtoInvalido = produtosPreenchidos.find((item) => {
      const valor =
        Number(item.preco.replace(/\./g, '').replace(',', '.')) || 0;
      return (
        !item.nome.trim() ||
        valor <= 0 ||
        item.quantidadeMin > item.quantidadeMax
      );
    });
    if (produtoInvalido) {
      toast({
        type: 'error',
        title: 'Erro',
        description:
          'Preencha nome, valor e quantidades mín./máx. corretamente para os produtos.',
      });
      return;
    }

    const valor =
      Number(
        produtosPreenchidos[0].preco.replace(/\./g, '').replace(',', '.'),
      ) || 0;
    if (valor <= 0) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe um valor válido.',
      });
      return;
    }
    const offersError = validateOfferDrafts(offerDrafts);
    if (offersError) {
      toast({ type: 'error', title: 'Erro', description: offersError });
      return;
    }
    // Taxas por parcela não vão no payload: o backend resolve pela política da plataforma
    // e rejeita platformFeeNx (removidos do DTO).
    createMutation.mutate({
      titulo: titulo.trim(),
      descricao: descricao.trim() || undefined,
      valor,
      dataExpiracao: dataExpiracao ? dataExpiracao.toISOString() : undefined,
      parcelasMax: cartaoCredito ? 12 : 1,
      isStandalone,
      ...(isEditing
        ? {
            isActive: status === 'ativo',
            aceitaDebito: debito,
          }
        : {
            aceitaCartao: cartaoCredito,
            aceitaDebito: debito,
            aceitaPix: pix,
            redirectUrl: urlRedirecionamento.trim() || undefined,
            maxUses: limitePedidos > 0 ? limitePedidos : undefined,
          }),
      ...(!isEditing
        ? {
            ownerUserId: financialOwner?.id,
            plataformas: selectedPlatform ? [selectedPlatform] : [],
          }
        : {}),
      webhookUrl: webhookUrl.trim() || undefined,
      ...(selectedPlatform ? { emailBody: emailBody.trim() || null } : {}),
    });
  }

  const cardClass =
    'rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5';

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-16">
      {previewOpen && (
        <PaymentLinkPreviewModal
          draft={previewDraft}
          onClose={() => setPreviewOpen(false)}
        />
      )}
      {searchParams.get('legacyPreview') === '1' && (
        <p
          role="status"
          className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
        >
          A prévia mudou. Use o botão Pré visualizar para abrir o checkout com
          suas alterações atuais.
        </p>
      )}
      <nav className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Link
          href="/links-pagamento"
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          Link de pagamento
        </Link>
        <span className="mx-2 text-zinc-400">&gt;</span>
        <span className="text-zinc-400">
          {isEditing ? 'Editar link de pagamento' : 'Criar link de pagamento'}
        </span>
      </nav>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/links-pagamento')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-emerald-800 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/10 dark:text-emerald-300 dark:hover:bg-white/15"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
            {isEditing ? 'Editar link de pagamento' : 'Criar link de pagamento'}
          </h1>
        </div>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={loadingTaxas || (isEditing && detailQuery.isPending)}
          onClick={() => setPreviewOpen(true)}
        >
          <Scan className="h-4 w-4" />
          Pré visualizar
        </Button>
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
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  setLimitePedidosInput(digits);
                }}
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
            label="Título do link"
            placeholder="Máximo de caracteres (0/70)"
            value={titulo}
            onChange={setTitulo}
            theme={fieldTheme}
            variant="navbar"
          />
          {/* <div className="md:col-span-2">
            <div className="flex flex-col gap-1">
              <FieldLabel info="Valor devolvido ao comprador como cashback após a aprovação do pagamento.">Cashback</FieldLabel>
              <Dropdown
                theme={fieldTheme}
                variant="navbar"
                value={cashback}
                onChange={setCashback}
                options={[
                  { label: "Ativo", value: "ativo" },
                  { label: "Inativo", value: "inativo" },
                ]}
              />
            </div>
          </div> */}
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
              placeholder="https://… (abre em uma nova aba quando o pagamento for aprovado)"
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
              placeholder="https://… (notificado quando o pagamento for aprovado — ex: areaflix)"
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
              {!selectedPlatform && (
                <p className="text-xs text-zinc-500">
                  Sem plataforma, aplicam-se as taxas do titular financeiro.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {selectedPlatform && (
        <section className={cardClass}>
          <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Mensagem do e-mail ao comprador
          </h2>
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            Este texto será o corpo do e-mail enviado ao comprador quando o
            pagamento for aprovado. Você pode incluir o link de acesso ao
            produto. (Os PDFs anexados, se houver, continuam sendo enviados.)
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
            title={titulo}
            redirectUrl={urlRedirecionamento}
          />
        </section>
      )}

      <section className={cardClass}>
        <div className="overflow-x-auto rounded-xl border border-zinc-200/80 dark:border-white/10">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-zinc-200/80 bg-zinc-50 dark:border-white/10 dark:bg-white/5">
                {/* <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500">Código externo</th> */}
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500">
                  Nome
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500">
                  Preço
                </th>
                {/* <th className="px-3 py-2 text-center text-xs font-semibold uppercase text-zinc-500">Min.</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase text-zinc-500">Máx.</th> */}
              </tr>
            </thead>
            <tbody>
              {produtos.map((item) => (
                <tr key={item.id}>
                  {/* <td className="p-2">
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Código"
                      value={item.codigoExterno}
                      onChange={(value) => updateProduto(item.id, { codigoExterno: value })}
                    />
                  </td> */}
                  <td className="p-2">
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      placeholder="Nome"
                      value={item.nome}
                      onChange={(value) =>
                        updateProduto(item.id, { nome: value })
                      }
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      theme={fieldTheme}
                      variant="navbar"
                      prefix="R$"
                      value={item.preco}
                      onChange={(value) =>
                        updateProduto(item.id, {
                          preco: formatCurrencyInput(value),
                        })
                      }
                    />
                  </td>
                  {/* <td className="p-2">
                    <NumberStepper
                      value={item.quantidadeMin}
                      onChange={(value) =>
                        updateProduto(item.id, {
                          quantidadeMin: value,
                          quantidadeMax: Math.max(value, item.quantidadeMax),
                        })
                      }
                      min={1}
                      theme={fieldTheme}
                    />
                  </td>
                  <td className="p-2">
                    <NumberStepper
                      value={item.quantidadeMax}
                      onChange={(value) => updateProduto(item.id, { quantidadeMax: Math.max(value, item.quantidadeMin) })}
                      min={1}
                      theme={fieldTheme}
                    />
                  </td>
                  <td className="p-2 text-center">
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/10"
                      aria-label="Remover produto"
                      onClick={() => removeProduto(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td> */}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* <button
          type="button"
          onClick={addProduto}
          className="mt-2 w-full rounded-md border border-dashed border-zinc-300 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-white/20 dark:text-zinc-300 dark:hover:bg-white/5"
        >
          + Adicionar produto
        </button> */}
      </section>

      <div className="grid gap-4">
        <section className={cardClass}>
          <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Formas de pagamentos
          </h2>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>Cartão de crédito</FieldLabel>
              <FormSwitch checked={cartaoCredito} onChange={setCartaoCredito} />
            </div>
            <div className="flex flex-col gap-3 border-b border-zinc-200/80 pb-4 dark:border-white/10">
              <div className="flex items-center justify-between gap-3">
                <FieldLabel>Cartão de débito</FieldLabel>
                <FormSwitch checked={debito} onChange={setDebito} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>PIX</FieldLabel>
              <FormSwitch checked={pix} onChange={setPix} />
            </div>
          </div>
        </section>
      </div>

      <PaymentLinkOffersSection
        value={offerDrafts}
        onChange={(next) => {
          setOfferDrafts(next);
          setOffersTouched(true);
        }}
        theme={fieldTheme}
        onError={(message) =>
          toast({ type: 'error', title: 'Erro', description: message })
        }
      />

      <section className={cardClass}>
        <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Arquivos PDF
        </h2>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          Quem pagar este link receberá estes PDFs por e-mail. Opcional — você
          pode anexar de 0 a {MAX_PDF_FILES} arquivos (
          {existingFiles.length + pendingPdfFiles.length}/{MAX_PDF_FILES}), até
          25 MB cada.
        </p>

        {existingFiles.length > 0 && (
          <ul className="mb-4 flex flex-col gap-2">
            {existingFiles.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-white/10 dark:bg-white/5"
              >
                <div className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <Paperclip className="h-4 w-4 text-zinc-400" />
                  <span>{f.fileName}</span>
                  <span className="text-xs text-zinc-400">
                    ({(f.fileSize / 1024 / 1024).toFixed(1)} MB)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await deletePaymentLinkFile(api, linkId!, f.id);
                      setExistingFiles((prev) =>
                        prev.filter((x) => x.id !== f.id),
                      );
                    } catch {
                      toast({
                        type: 'error',
                        title: 'Erro',
                        description: 'Falha ao remover arquivo.',
                      });
                    }
                  }}
                  className="ml-2 text-red-400 transition-colors hover:text-red-600"
                  aria-label="Remover arquivo"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {pendingPdfFiles.length > 0 && (
          <ul className="mb-4 flex flex-col gap-2">
            {pendingPdfFiles.map((f, idx) => (
              <li
                key={`${f.name}-${idx}`}
                className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-800/30 dark:bg-emerald-900/10"
              >
                <div className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <Paperclip className="h-4 w-4 text-emerald-500" />
                  <span>{f.name}</span>
                  <span className="text-xs text-zinc-400">
                    ({(f.size / 1024 / 1024).toFixed(1)} MB)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPendingPdfFiles((prev) =>
                      prev.filter((_, i) => i !== idx),
                    )
                  }
                  className="ml-2 text-red-400 transition-colors hover:text-red-600"
                  aria-label="Remover arquivo"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <label
          className={`inline-flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors ${
            existingFiles.length + pendingPdfFiles.length >= MAX_PDF_FILES
              ? 'cursor-not-allowed border-zinc-200 text-zinc-300 dark:border-white/10 dark:text-zinc-600'
              : 'cursor-pointer border-zinc-300 text-zinc-600 hover:border-emerald-400 hover:text-emerald-600 dark:border-white/20 dark:text-zinc-400 dark:hover:border-emerald-500 dark:hover:text-emerald-400'
          }`}
        >
          <Paperclip className="h-4 w-4" />
          {existingFiles.length + pendingPdfFiles.length >= MAX_PDF_FILES
            ? 'Limite de PDFs atingido'
            : 'Adicionar PDF'}
          <input
            type="file"
            accept=".pdf,application/pdf"
            multiple
            disabled={
              existingFiles.length + pendingPdfFiles.length >= MAX_PDF_FILES
            }
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              const invalid = files.filter((f) => f.size > 25 * 1024 * 1024);
              const valid = files.filter((f) => f.size <= 25 * 1024 * 1024);

              const errors: string[] = [];
              if (invalid.length > 0) {
                errors.push(
                  `${invalid.map((f) => f.name).join(', ')} excedem 25 MB e não foram adicionados.`,
                );
              }

              // Respeita o teto total de PDFs por link (arquivos já salvos + pendentes).
              const usedSlots = existingFiles.length + pendingPdfFiles.length;
              const remainingSlots = Math.max(0, MAX_PDF_FILES - usedSlots);
              const toAdd = valid.slice(0, remainingSlots);
              if (valid.length > remainingSlots) {
                errors.push(
                  `Limite de ${MAX_PDF_FILES} PDFs por link atingido — alguns arquivos não foram adicionados.`,
                );
              }

              setPdfSizeError(errors.length > 0 ? errors.join(' ') : null);
              if (toAdd.length > 0) {
                setPendingPdfFiles((prev) => [...prev, ...toAdd]);
              }
              e.target.value = '';
            }}
          />
        </label>
        {pdfSizeError && (
          <p className="mt-2 text-xs font-medium text-red-500 dark:text-red-400">
            {pdfSizeError}
          </p>
        )}
      </section>

      <CoproductionButton
        product="links-pagamento"
        productId={linkId}
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
            detailQuery.isLoading ||
            (!isEditing &&
              (platformCatalog.isLoading ||
                platformCatalog.isError ||
                (selectedPlatform
                  ? !allPlatformTags.includes(selectedPlatform)
                  : platformCatalog.user?.isAdmin && !financialOwner)))
          }
        >
          {createMutation.isPending
            ? 'Salvando...'
            : isEditing
              ? 'Atualizar'
              : 'Salvar'}
        </Button>
      </div>

      {ajustesModalMounted ? (
        <div
          className={cn(
            'fixed inset-0 z-120 flex items-center justify-center p-4 backdrop-blur-sm transition-all duration-200',
            ajustesModalClosing ? 'bg-black/0' : 'bg-black/35',
          )}
          onClick={closeAjustesModal}
        >
          <div
            className={cn(
              'w-full max-w-5xl rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl transition-all duration-200 dark:border-white/10 dark:bg-zinc-900',
              ajustesModalClosing
                ? 'scale-95 opacity-0'
                : 'scale-100 opacity-100',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Simulador de Parcelamento
              </h3>
              <button
                type="button"
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/10"
                onClick={closeAjustesModal}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 overflow-hidden rounded-md border border-zinc-200 text-xs dark:border-white/10">
              {[
                { id: 'editar', label: 'Editar Juros' },
                { id: 'parcela', label: 'Juros por Parcela' },
                { id: 'mes', label: 'Juros ao Mês' },
                { id: 'liquido', label: '100% Líquido' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTabJuros(t.id as typeof tabJuros)}
                  className={cn(
                    'border-r border-zinc-200 px-3 py-2 text-center last:border-r-0 dark:border-white/10',
                    tabJuros === t.id
                      ? 'bg-emerald-700 text-white'
                      : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-white/5',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              {tabJuros === 'editar' &&
                'Edite os valores da coluna Juros ao Consumidor e veja o resultado atualizado automaticamente.'}
              {tabJuros === 'parcela' &&
                'Cada parcela tem uma taxa de juros fixa pré-definida de acordo com a sua negociação.'}
              {tabJuros === 'mes' &&
                'Os juros são calculados de forma composta com base na sua taxa UCM.'}
              {tabJuros === 'liquido' &&
                'O consumidor paga juros suficientes para que você receba exatamente o valor líquido.'}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Input
                label="Valor do link"
                value={`R$ ${preco}`}
                theme={fieldTheme}
                variant="navbar"
                readOnly
              />
              <Input
                label="Nº de parcelas"
                value="12"
                theme={fieldTheme}
                variant="navbar"
                readOnly
              />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Tipo de link
                </span>
                <Dropdown
                  theme={fieldTheme}
                  variant="navbar"
                  value={isStandalone ? 'avulso' : 'plataforma'}
                  onChange={(v) => setIsStandalone(v === 'avulso')}
                  options={[
                    { label: 'Avulso (1x sem juros)', value: 'avulso' },
                    {
                      label: 'Plataforma (sempre com juros)',
                      value: 'plataforma',
                    },
                  ]}
                />
              </div>
              {tabJuros === 'mes' ? (
                <Input
                  label="Juros ao mês (%)"
                  value="3,2"
                  theme={fieldTheme}
                  variant="navbar"
                  readOnly
                />
              ) : null}
              {tabJuros !== 'liquido' ? (
                <Dropdown
                  label="Assumir taxas de parcelamento"
                  value={assumirTaxas}
                  onChange={setAssumirTaxas}
                  theme={fieldTheme}
                  variant="navbar"
                  options={[
                    { label: 'Nenhuma', value: 'nenhuma' },
                    { label: 'Até 2x sem juros', value: '2x' },
                    { label: 'Até 3x sem juros', value: '3x' },
                    { label: 'Até 4x sem juros', value: '4x' },
                    { label: 'Até 5x sem juros', value: '5x' },
                    { label: 'Até 6x sem juros', value: '6x' },
                    { label: 'Até 7x sem juros', value: '7x' },
                    { label: 'Até 8x sem juros', value: '8x' },
                    { label: 'Até 9x sem juros', value: '9x' },
                    { label: 'Até 10x sem juros', value: '10x' },
                    { label: 'Até 11x sem juros', value: '11x' },
                    { label: 'Até 12x sem juros', value: '12x' },
                  ]}
                />
              ) : null}
            </div>

            <div className="mt-4 max-h-[340px] overflow-auto rounded-md border border-zinc-200 dark:border-white/10">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr className="sticky top-0 border-b border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-zinc-900">
                    {[
                      'Número de parcelas',
                      'Taxa Dom',
                      'Juros ao consumidor',
                      'Valor da Cobrança',
                      'Valor de juros',
                      'Valor da Parcela',
                      'Tarifa por transação',
                      'Líquido Cliente',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-300"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhasSimulador.map((row) => (
                    <tr
                      key={row.n}
                      className="border-b border-zinc-100 text-sm dark:border-white/10"
                    >
                      <td className="px-3 py-2 font-medium">{row.n}x</td>
                      <td className="px-3 py-2">
                        {(domLinkRates[row.n] * 100).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2">
                        {tabJuros === 'editar' ? (
                          <div className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-white/20 dark:bg-white/5">
                            <input
                              type="text"
                              value={jurosEditaveis[`${row.n}x`] ?? ''}
                              onChange={(e) => {
                                const value = e.target.value.replace(
                                  /[^0-9.,]/g,
                                  '',
                                );
                                setJurosEditaveis((prev) => ({
                                  ...prev,
                                  [`${row.n}x`]: value,
                                }));
                              }}
                              className="w-12 bg-transparent text-right text-sm outline-none"
                            />
                            <span className="text-zinc-500">%</span>
                          </div>
                        ) : (
                          <span>{`${jurosEditaveis[`${row.n}x`] ?? 0}%`}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{fmt(row.total)}</td>
                      <td className="px-3 py-2">{fmt(row.juros)}</td>
                      <td className="px-3 py-2">{fmt(row.parcela)}</td>
                      <td className="px-3 py-2">{fmt(row.domFee)}</td>
                      <td className="px-3 py-2">{fmt(row.liquido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                className="gap-2 bg-emerald-700 text-white hover:bg-emerald-800"
                onClick={closeAjustesModal}
              >
                <Send className="h-4 w-4" />
                Aplicar Taxas
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
