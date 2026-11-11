'use client';

import { PlatformFilterSelect } from '@/components/product-platforms/PlatformFilterSelect';

import { useMemo, useState, useEffect, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  Search,
  Eraser,
  CreditCard,
  QrCode,
  Barcode,
  Download,
  ChevronDown,
} from 'lucide-react';
import { useTheme } from 'next-themes';

import { Badge } from '@/components/ui/Badge';
import { MoneyCell } from '@/components/ui/MoneyCell';
import { DataTable } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { Spinner } from '@/components/ui/Loading';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';

import { ActionButton } from '../relatorio/components/ActionButton';
import { DateRangePickerField } from '../relatorio/components/DateRangePickerField';
import type { DateRange } from '../relatorio/types';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { useTransacoes } from '@/features/transacoes/hooks/use-transacoes';
import { listTransacoes } from '@/features/transacoes/services/transacoes.service';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import type { Transacao } from '@/features/transacoes/types/transacoes.types';
import { useCurrentUser } from '@/hooks/use-current-user';
import { isMasterAdminClient } from '@/lib/is-master-admin-client';
import {
  formatDocument,
  getPlatformBadgeClass,
  formatTransacaoDescricaoUi,
  transacaoPlataformaUi,
} from '@/lib/utils';

/** Valor líquido que ficou com o usuário atual (parte da coprodução, quando houver). */
function userNetAmount(row: Transacao) {
  const mine = row.coproducao?.myAmountCents;
  return mine == null ? row.netAmount : mine / 100;
}

/** Percentual do líquido que não ficou com o usuário atual, ou null sem coprodução. */
function coproductionSharedPercentage(row: Transacao) {
  const mine = row.coproducao?.myAmountCents;
  const net = Number(row.netAmount ?? 0) * 100;
  if (mine == null || !(net > 0)) return null;
  const pct = Math.min(100, Math.max(0, ((net - mine) / net) * 100));
  return pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatBRL(
  value: number | undefined | null,
  maximumFractionDigits = 2,
) {
  const v = Number(value ?? 0);
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits,
  });
}

function formatDateTime(value: string | undefined | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toLocalYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** A rota do ledger aceita histórico completo quando o intervalo não é informado. */
function domRangeForExport(range: DateRange): {
  begin_date?: string;
  end_date?: string;
} {
  return {
    begin_date: range.start ? toLocalYmd(range.start) : undefined,
    end_date: range.end ? toLocalYmd(range.end) : undefined,
  };
}

/** Retorna true se o intervalo excede 3 meses calendário. */
function exceedsTreseMeses(start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false;
  const limit = new Date(start);
  limit.setMonth(limit.getMonth() + 3);
  return end > limit;
}

const EXPORT_PAGE_SIZE = 100;

function mapStatusLabel(status: string | undefined | null) {
  const s = (status ?? '').toUpperCase();
  if (s === 'COMPLETED' || s === 'APPROVED' || s === 'APROVADA')
    return 'Aprovado';
  if (s === 'PENDING' || s === 'PENDENTE') return 'Pendente';
  if (s === 'FAILED' || s === 'REJECTED' || s === 'RECUSADA') return 'Recusado';
  if (s === 'REFUNDED' || s === 'ESTORNADA') return 'Estornado';
  if (s === 'DRAFT') return 'Rascunho';
  if (s === 'EXPIRED') return 'Expirado';
  if (s === 'IN_MEDIATION') return 'Em mediação';
  if (s === 'CHARGEBACK') return 'Chargeback';
  if (s === 'PENDING_REFUND') return 'Estorno pendente';
  return status ?? '-';
}

function PaymentMethodCell({ row }: { row: Transacao }) {
  const pm = String(row.paymentMethod ?? '').toUpperCase();
  const isPix = pm === 'PIX';
  const isBoleto = pm === 'BOLETO';
  return (
    <div className="flex items-center justify-center gap-2">
      {isPix ? (
        <QrCode className="h-4 w-4 text-emerald-700" />
      ) : isBoleto ? (
        <Barcode className="h-4 w-4 text-zinc-700 dark:text-zinc-400" />
      ) : (
        <CreditCard className="h-4 w-4 text-zinc-700" />
      )}
      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        {isPix ? 'Pix' : isBoleto ? 'Boleto' : 'Cartão'}
      </span>
    </div>
  );
}

const PLATFORM_DISPLAY: Record<string, string> = {
  areaflix: 'Áreaflix',
  ebook: 'EbookSim',
  ebooksim: 'EbookSim',
  atlas: 'AtlasHosting',
  'controle-motorista': 'Controle de Motorista',
  'controle-patrimonial': 'Controle Patrimonial',
  pagatg: 'PagaTG',
  betai: 'Betai',
  frendz: 'Frendz',
};

/**
 * Tags canônicas (tenant_tag) de todas as plataformas fixas.
 * O dropdown do admin não pode depender só das linhas da página atual da tabela —
 * plataforma sem transação na página sumia do filtro. Comunidades entram
 * dinamicamente via /admin/comunidades.
 */
const ADMIN_PLATFORM_TAGS = [
  'ATLAS',
  'AREAFLIX',
  'BETAI',
  'BOSQUE',
  'CONTROLE-MOTORISTA',
  'CONTROLE-PATRIMONIAL',
  'EBOOK',
  'FRENDZ',
  'PAGATG',
  'RENOVADA',
  'REVALIDA',
  'ZERO_GRAU',
];

function getPlatformLabel(plataforma: string): string {
  return PLATFORM_DISPLAY[plataforma.toLowerCase()] ?? plataforma;
}

function TransacoesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { platforms: catalogPlatforms } = useProductPlatforms();
  const { resolvedTheme } = useTheme();
  const { user, loading: loadingUser } = useCurrentUser();
  const isAdmin = user?.isAdmin ?? false;
  const showLegacyFilters = false;
  // Master (adminljl@simpay.com.br / módulo "master"): filtro lista TODAS as plataformas.
  const isMaster = isMasterAdminClient(user);
  const tenantSlug = (user?.tenantModule?.slug ?? '').toLowerCase();
  const userEmail = (user?.email ?? '').toLowerCase();
  const userName = (user?.name ?? '').toLowerCase();
  // Detecta pela slug do tenant, email ou nome — cobre contas Renovada e Renovada12
  const isRenovada =
    tenantSlug.includes('renovada') ||
    userEmail.includes('renovada') ||
    userName.includes('renovada');
  const isBosque = tenantSlug.includes('bosque') || tenantSlug.includes('ibb');
  const showMaquinetasTabs = isRenovada || isBosque;
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  // Local state for filter inputs (initialized from URL)
  const [pageSize] = useState(20);

  function parseQueryDate(s: string | null) {
    if (!s) return null;
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return new Date(s);
    return new Date(y, m - 1, d);
  }

  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    start: parseQueryDate(searchParams.get('dataInicio')),
    end: parseQueryDate(searchParams.get('dataFim')),
  }));

  const [codigoTransacao, setCodigoTransacao] = useState(
    () => searchParams.get('codigoTransacao') ?? '',
  );
  const [codigoReferencia, setCodigoReferencia] = useState(
    () => searchParams.get('codigoReferencia') ?? '',
  );
  const [status, setStatus] = useState(() => searchParams.get('status') ?? '');
  const [paymentMethod, setPaymentMethod] = useState(
    () => searchParams.get('paymentMethod') ?? '',
  );
  const [acquirer, setAcquirer] = useState(
    () => searchParams.get('acquirer') ?? '',
  );
  const [tipoTransacao, setTipoTransacao] = useState(
    () => searchParams.get('tipoTransacao') ?? '',
  );

  const [plataforma, setPlataforma] = useState(
    () => searchParams.get('plataforma') ?? '',
  );

  const [compradorNome, setCompradorNome] = useState(
    () => searchParams.get('compradorNome') ?? '',
  );
  const [compradorDocumento, setCompradorDocumento] = useState(
    () => searchParams.get('compradorDocumento') ?? '',
  );
  const [compradorEmail, setCompradorEmail] = useState(
    () => searchParams.get('compradorEmail') ?? '',
  );

  // Sync back button / external URL changes
  const searchKey = searchParams.toString();
  const [previousSearchKey, setPreviousSearchKey] = useState(searchKey);
  if (searchKey !== previousSearchKey) {
    setPreviousSearchKey(searchKey);
    setDateRange({
      start: parseQueryDate(searchParams.get('dataInicio')),
      end: parseQueryDate(searchParams.get('dataFim')),
    });

    setCodigoTransacao(searchParams.get('codigoTransacao') ?? '');
    setCodigoReferencia(searchParams.get('codigoReferencia') ?? '');
    setStatus(searchParams.get('status') ?? '');
    setPaymentMethod(searchParams.get('paymentMethod') ?? '');
    setAcquirer(searchParams.get('acquirer') ?? '');
    setTipoTransacao(searchParams.get('tipoTransacao') ?? '');
    setPlataforma(searchParams.get('plataforma') ?? '');
    setCompradorNome(searchParams.get('compradorNome') ?? '');
    setCompradorDocumento(searchParams.get('compradorDocumento') ?? '');
    setCompradorEmail(searchParams.get('compradorEmail') ?? '');
  }

  const updateUrl = useCallback(
    (newParams: Record<string, string | number | undefined | Date | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(newParams).forEach(([key, value]) => {
        if (value instanceof Date) {
          params.set(key, toLocalYmd(value));
        } else if (value) {
          params.set(key, String(value));
        } else {
          params.delete(key);
        }
      });

      // Reset to page 1 if any filter changed (except page itself)
      if (Object.keys(newParams).some((k) => k !== 'page')) {
        params.set('page', '1');
      }

      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  // Handle text input debouncing for URL update
  useEffect(() => {
    const timeout = setTimeout(() => {
      // Only update if values differ from URL to avoid infinite loops
      if (
        codigoTransacao !== (searchParams.get('codigoTransacao') ?? '') ||
        codigoReferencia !== (searchParams.get('codigoReferencia') ?? '') ||
        compradorNome !== (searchParams.get('compradorNome') ?? '') ||
        compradorDocumento !== (searchParams.get('compradorDocumento') ?? '') ||
        compradorEmail !== (searchParams.get('compradorEmail') ?? '')
      ) {
        updateUrl({
          codigoTransacao: codigoTransacao || undefined,
          codigoReferencia: codigoReferencia || undefined,
          compradorNome: compradorNome || undefined,
          compradorDocumento: compradorDocumento || undefined,
          compradorEmail: compradorEmail || undefined,
        });
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [
    codigoTransacao,
    codigoReferencia,
    compradorNome,
    compradorDocumento,
    compradorEmail,
    updateUrl,
    searchParams,
  ]);

  const queryParams = useMemo(() => {
    const dataInicio = searchParams.get('dataInicio') || undefined;
    const dataFim = searchParams.get('dataFim') || undefined;
    const startDate = dataInicio ? new Date(dataInicio) : null;
    const endDate = dataFim ? new Date(dataFim) : null;
    return {
      page: Math.max(1, Number(searchParams.get('page')) || 1),
      pageSize,
      status: searchParams.get('status') || undefined,
      paymentMethod: searchParams.get('paymentMethod') || undefined,
      acquirer: isAdmin ? searchParams.get('acquirer') || undefined : undefined,
      q: searchParams.get('codigoTransacao') || undefined,
      domTransactionId: searchParams.get('codigoReferencia') || undefined,
      customerName: searchParams.get('compradorNome') || undefined,
      customerDocument: searchParams.get('compradorDocumento') || undefined,
      customerEmail: searchParams.get('compradorEmail') || undefined,
      dataInicio: dataInicio?.slice(0, 10),
      dataFim: dataFim?.slice(0, 10),
      plataforma: searchParams.get('plataforma') || undefined,
      tipoTransacao: searchParams.get('tipoTransacao') || undefined,
      enabled: !loadingUser && !exceedsTreseMeses(startDate, endDate),
    };
  }, [searchParams, pageSize, isAdmin, loadingUser]);

  const { data, isPending, error } = useTransacoes(queryParams);

  // Corrige página fora do intervalo (ex.: URL apontando para página inexistente depois
  // que o total mudou/encolheu) — evita ficar preso em "página 2 de 1" vazia ao paginar
  // com filtros, incluindo plataforma.
  useEffect(() => {
    if (isPending || !data) return;
    const size = data.pageSize || pageSize || 20;
    const totalPages = Math.max(1, Math.ceil((data.total ?? 0) / size));
    const current = Number(searchParams.get('page') ?? 1);
    if (current > totalPages) {
      updateUrl({ page: totalPages });
    }
  }, [data, isPending, plataforma, pageSize, searchParams, updateUrl]);

  // Query separada apenas para descobrir quais plataformas o usuário tem — sem filtros de data/status
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token') ?? undefined,
      }),
    [],
  );

  const { data: platformDiscoveryData } = useQuery({
    queryKey: ['transacoes-platform-discovery', isAdmin],
    enabled: !isAdmin, // admin vê tudo via DOM, não precisa de discovery
    staleTime: 5 * 60_000,
    queryFn: () => listTransacoes(api, { page: 1, pageSize: 200 }),
  });

  // Comunidades (tags dinâmicas como MARKETING-RAIZ, IA-TECH) para completar o filtro do admin
  const { data: comunidadesData } = useQuery({
    queryKey: ['transacoes-comunidades', isAdmin],
    enabled: isAdmin,
    staleTime: 5 * 60_000,
    queryFn: () =>
      api.get<{ data: { slug: string }[] }>(
        `${endpoints.admin.comunidades.list}?pageSize=100`,
      ),
  });

  // Master: lista canônica de TODAS as plataformas (mesma fonte da tela de Taxas),
  // para o filtro do master não depender só das tags fixas / linhas da página atual.
  const { data: platformsListData } = useQuery({
    queryKey: ['transacoes-plataformas-list', isMaster],
    enabled: isMaster,
    staleTime: 5 * 60_000,
    queryFn: () =>
      api.get<{ data: { tag: string }[] }>(endpoints.admin.plataformas.list),
  });

  const platformNames = useMemo(
    () =>
      new Map(
        catalogPlatforms.map((p) => [p.tag.trim().toUpperCase(), p.name]),
      ),
    [catalogPlatforms],
  );
  const platformName = useCallback(
    (tag: string) =>
      platformNames.get(tag.trim().toUpperCase()) ?? getPlatformLabel(tag),
    [platformNames],
  );
  const assignPlatform = useCallback(
    async (id: string, tag: string) => {
      try {
        await api.patch(`/transacoes/${encodeURIComponent(id)}/plataforma`, {
          platformTag: tag || null,
        });
        await queryClient.invalidateQueries({ queryKey: ['transacoes'] });
      } catch {
        toast({
          type: 'error',
          title: 'Não foi possível associar a plataforma',
        });
      }
    },
    [api, queryClient, toast],
  );

  const uniquePlatforms = useMemo(() => {
    const seen = new Set<string>();
    // Admin: sempre oferece todas as plataformas fixas + comunidades, não só as da página atual
    if (isAdmin) {
      for (const t of ADMIN_PLATFORM_TAGS) seen.add(t);
      for (const c of comunidadesData?.data ?? []) {
        const slug = c.slug?.trim().toUpperCase();
        if (slug) seen.add(slug);
      }
      // Master: adiciona a lista canônica completa (/admin/plataformas) — todas as opções.
      if (isMaster) {
        for (const p of platformsListData?.data ?? []) {
          const tag = p.tag?.trim().toUpperCase();
          if (
            tag &&
            tag !== 'GLOBAL' &&
            tag !== 'COMUNIDADE' &&
            tag !== 'E-BOOKS-LP' &&
            !tag.startsWith('CLIENT:')
          ) {
            seen.add(tag);
          }
        }
      }
    }
    const rows = isAdmin
      ? (data?.data ?? [])
      : (platformDiscoveryData?.data ?? []);
    for (const row of rows) {
      const p = row.plataforma?.trim().toUpperCase();
      if (p) seen.add(p);
    }
    return [...seen].sort();
  }, [
    isAdmin,
    isMaster,
    data?.data,
    platformDiscoveryData?.data,
    comunidadesData?.data,
    platformsListData?.data,
  ]);

  // Admin sempre vê o filtro; usuário comum só se tem transações em 2+ plataformas
  const showPlataformaFilter = false;

  const filteredRows = data?.data ?? [];

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportDateRange, setExportDateRange] = useState<DateRange>({
    start: null,
    end: null,
  });

  const exportScope = `${isExportOpen}:${queryParams.dataInicio ?? ''}:${queryParams.dataFim ?? ''}`;
  const [previousExportScope, setPreviousExportScope] = useState(exportScope);
  if (exportScope !== previousExportScope) {
    setPreviousExportScope(exportScope);
    if (isExportOpen)
      setExportDateRange({
        start: parseQueryDate(queryParams.dataInicio ?? null),
        end: parseQueryDate(queryParams.dataFim ?? null),
      });
  }

  const handleExportCSV = async (
    exportTipoTransacao?: 'maquinetas' | 'online' | 'todos',
  ) => {
    try {
      setIsExporting(true);

      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token'),
      });

      const tipoParam =
        exportTipoTransacao === 'todos'
          ? undefined
          : (exportTipoTransacao ?? queryParams.tipoTransacao);

      const exportQuery = {
        ...queryParams,
        page: 1,
        pageSize: EXPORT_PAGE_SIZE,
        dataInicio: exportDateRange.start
          ? toLocalYmd(exportDateRange.start)
          : undefined,
        dataFim: exportDateRange.end
          ? toLocalYmd(exportDateRange.end)
          : undefined,
        tipoTransacao: tipoParam,
      };
      const firstPage = await listTransacoes(api, exportQuery);
      const pageCount = Math.ceil(firstPage.total / EXPORT_PAGE_SIZE);
      const remainingPages = await Promise.all(
        Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
          listTransacoes(api, { ...exportQuery, page: index + 2 }),
        ),
      );
      const res = {
        ...firstPage,
        data: [
          ...firstPage.data,
          ...remainingPages.flatMap((page) => page.data),
        ],
      };

      if (!res.data || res.data.length === 0) {
        toast({
          type: 'error',
          title: 'Erro',
          description: 'Nenhuma transação encontrada no período',
        });
        return;
      }

      // Headers CSV
      const headers = [
        'ID',
        'Comprador',
        'Documento',
        'E-mail',
        'Status',
        'Valor Bruto',
        'Lucro/Prejuízo',
        'Data',
      ];
      const csvRows = [headers.join(',')];

      for (const t of res.data) {
        const bruto = t.amount ?? 0;
        const lucroPrejuizo =
          t.lucroMaster ?? t.valorLiquidoVendedor ?? t.netAmount ?? 0;

        const row = [
          t.id,
          `"${(t.customerName || '').replace(/"/g, '""')}"`,
          formatDocument(t.customerDocument),
          t.customerEmail || '',
          mapStatusLabel(t.status),
          bruto.toString().replace('.', ','),
          lucroPrejuizo.toString().replace('.', ','),
          formatDateTime(t.createdAt).replace(',', ''), // Remove comma to not break CSV
        ];
        csvRows.push(row.join(','));
      }

      const csvContent = '\uFEFF' + csvRows.join('\n'); // UTF-8 BOM for Excel
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `transacoes_${new Date().getTime()}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        type: 'success',
        title: 'Sucesso',
        description: 'Exportação concluída',
      });
      setIsExportOpen(false);
    } catch (err) {
      toast({
        type: 'error',
        title: 'Erro na exportação',
        description: 'Ocorreu um erro ao gerar o arquivo',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const baseColumns = useMemo(
    () => [
      {
        key: 'id',
        header: 'Código da transação',
        className: 'whitespace-nowrap min-w-[300px]',
        headerClassName: 'min-w-[300px]',
        render: (row: Transacao) => (
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {row.id}
          </span>
        ),
      },
      {
        key: 'customerName',
        header: 'Comprador',
        className: 'text-left',
        headerClassName: 'text-left',
        render: (row: Transacao) => (
          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {row.customerName ?? '-'}
          </span>
        ),
      },
      {
        key: 'plataforma',
        header: 'Plataforma',
        className: 'text-left',
        headerClassName: 'text-left',
        render: (row: Transacao) =>
          row.plataforma ? (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase whitespace-nowrap ${getPlatformBadgeClass(row.plataforma)}`}
            >
              {getPlatformLabel(row.plataforma)}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">-</span>
          ),
      },
      {
        key: 'customerDocument',
        header: 'Documento',
        className: 'whitespace-nowrap min-w-[160px]',
        headerClassName: 'min-w-[160px]',
        render: (row: Transacao) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatDocument(row.customerDocument)}
          </span>
        ),
      },
      {
        key: 'customerEmail',
        header: 'E-mail',
        className: 'text-left',
        headerClassName: 'text-left',
        render: (row: Transacao) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {row.customerEmail ?? '-'}
          </span>
        ),
      },
      {
        key: 'paymentMethod',
        header: 'Forma de pagamento',
        render: (row: Transacao) => <PaymentMethodCell row={row} />,
      },
      {
        key: 'status',
        header: 'Status',
        render: (row: Transacao) => (
          <Badge value={String(row.status)}>
            {mapStatusLabel(String(row.status))}
          </Badge>
        ),
      },
    ],
    [],
  );

  const valorLiquidoColumn = useMemo(
    () => ({
      key: 'valor_liquido',
      header: 'Valor',
      className: 'text-right',
      headerClassName: 'text-right',
      render: (row: Transacao) => {
        // O backend já devolve valorLiquido com taxa_servico deduzida — exibir direto.
        const liquido = Number(row.netAmount ?? row.valorLiquidoVendedor ?? 0);
        return (
          <MoneyCell
            value={liquido}
            className="text-sm font-medium text-emerald-600 dark:text-emerald-400"
          />
        );
      },
    }),
    [],
  );

  const dateColumn = useMemo(
    () => ({
      key: 'createdAt',
      header: 'Data da venda',
      className: 'text-right whitespace-nowrap min-w-[180px]',
      headerClassName: 'text-right min-w-[180px]',
      render: (row: Transacao) => (
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {formatDateTime(row.createdAt)}
        </span>
      ),
    }),
    [],
  );

  const columns = useMemo(
    () => [
      ...(isAdmin
        ? [
            {
              key: 'acquirer',
              header: 'Adquirente',
              render: (row: Transacao) => (
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {row.acquirer ?? '-'}
                </span>
              ),
            },
          ]
        : []),
      {
        key: 'id',
        header: 'Código da transação',
        className: 'whitespace-nowrap min-w-[260px]',
        headerClassName: 'min-w-[260px]',
        render: (row: Transacao) => (
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {row.id}
          </span>
        ),
      },
      {
        key: 'platformAssign',
        header: 'Plataforma',
        className: 'whitespace-nowrap',
        render: (row: Transacao) => {
          const tag = transacaoPlataformaUi(row.plataforma, row.descricao);
          if (isAdmin)
            return (
              <div onClick={(e) => e.stopPropagation()}>
                <Dropdown
                  value={row.plataforma ?? ''}
                  onChange={(v) => void assignPlatform(row.id, v)}
                  theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                  variant="navbar"
                  searchable
                  searchPlaceholder="Buscar plataforma..."
                  options={[
                    { value: '', label: 'Sem plataforma' },
                    ...catalogPlatforms.map((p) => ({
                      value: p.tag,
                      label: p.name,
                    })),
                  ]}
                />
              </div>
            );
          return tag ? (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${getPlatformBadgeClass(tag)}`}
            >
              {platformName(tag)}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">-</span>
          );
        },
      },
      {
        key: 'descricao',
        header: 'Descrição',
        grow: true,
        className: 'text-left',
        headerClassName: 'text-left',
        render: (row: Transacao) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatTransacaoDescricaoUi(row.descricao) || '—'}
          </span>
        ),
      },
      {
        key: 'paymentMethod',
        header: 'Forma de pagamento',
        render: (row: Transacao) => <PaymentMethodCell row={row} />,
      },
      {
        key: 'status',
        header: 'Status',
        render: (row: Transacao) => (
          <Badge value={String(row.status)}>
            {mapStatusLabel(String(row.status))}
          </Badge>
        ),
      },
      {
        key: 'amount',
        header: 'Valor bruto',
        className: 'text-right whitespace-nowrap',
        headerClassName: 'text-right',
        render: (row: Transacao) => (
          <MoneyCell
            value={row.amount}
            className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
          />
        ),
      },
      {
        key: 'totalFee',
        header: 'Taxas',
        className: 'text-right whitespace-nowrap',
        headerClassName: 'text-right',
        render: (row: Transacao) => (
          <MoneyCell
            value={row.totalFee}
            className="text-sm text-red-500 dark:text-red-400"
          />
        ),
      },
      {
        key: 'coproducao',
        header: 'Coprodução',
        className: 'text-right whitespace-nowrap',
        headerClassName: 'text-right',
        render: (row: Transacao) => {
          const shared = coproductionSharedPercentage(row);
          return shared == null ? (
            <span className="text-xs text-zinc-400">-</span>
          ) : (
            <span className="text-sm font-medium text-violet-600 dark:text-violet-300">
              {shared}%
            </span>
          );
        },
      },
      {
        key: 'netAmount',
        header: 'Valor líquido',
        className: 'text-right whitespace-nowrap',
        headerClassName: 'text-right',
        render: (row: Transacao) => (
          <MoneyCell
            value={userNetAmount(row)}
            className="text-sm font-medium text-emerald-600 dark:text-emerald-400"
          />
        ),
      },
      dateColumn,
    ],
    [
      isAdmin,
      baseColumns,
      valorLiquidoColumn,
      dateColumn,
      catalogPlatforms,
      platformName,
      assignPlatform,
      resolvedTheme,
    ],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">Transações</h1>
        <div className="flex items-center gap-3">
          {showMaquinetasTabs && (
            <div className="flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-1 dark:border-white/10 dark:bg-white/5">
              {[
                { id: '', label: 'Todas' },
                { id: 'maquinetas', label: 'Maquinetas' },
                { id: 'online', label: 'App' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setTipoTransacao(tab.id);
                    updateUrl({ tipoTransacao: tab.id || undefined });
                  }}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                    tipoTransacao === tab.id
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-zinc-600 hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {showMaquinetasTabs ? (
            <div className="relative">
              <button
                type="button"
                disabled={isExporting}
                onClick={() => setIsExportOpen((v) => !v)}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10 disabled:opacity-50"
              >
                {isExporting ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Exportar
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </button>
              {isExportOpen && (
                <div className="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-900">
                  {[
                    {
                      tipo: 'maquinetas' as const,
                      label: 'Somente maquinetas',
                    },
                    { tipo: 'online' as const, label: 'Somente app' },
                    {
                      tipo: 'todos' as const,
                      label: 'Todas (app + maquinetas)',
                    },
                  ].map(({ tipo, label }) => (
                    <button
                      key={tipo}
                      type="button"
                      onClick={() => {
                        setIsExportOpen(false);
                        void handleExportCSV(tipo);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-white/5"
                    >
                      <Download className="h-3.5 w-3.5 opacity-50" />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <ActionButton className="h-9" onClick={() => setIsExportOpen(true)}>
              <Download className="h-4 w-4" />
              Exportar
            </ActionButton>
          )}
        </div>
      </div>

      <div className="relative z-30 rounded-3xl border border-white/40 bg-white/70 p-4 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        <div
          className={`grid gap-3 ${showPlataformaFilter ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}
        >
          {showPlataformaFilter && (
            <PlatformFilterSelect
              label="Plataforma:"
              value={plataforma}
              onChange={(v) => {
                setPlataforma(v);
                updateUrl({ plataforma: v || undefined });
              }}
              theme={fieldTheme}
              variant="navbar"
              searchable
              searchPlaceholder="Buscar plataforma..."
              options={[
                { value: '', label: 'Todas' },
                ...uniquePlatforms.map((p) => ({
                  value: p,
                  label: getPlatformLabel(p),
                })),
              ]}
            />
          )}
          <DateRangePickerField
            key={`${searchParams.get('dataInicio')}:${searchParams.get('dataFim')}`}
            label="Data inicial e final:"
            value={dateRange}
            onChange={(next) => {
              setDateRange(next);
              updateUrl({
                dataInicio: next.start,
                dataFim: next.end,
              });
            }}
            theme={fieldTheme}
          />
          <Dropdown
            label="Status da transação:"
            value={status}
            onChange={(v) => {
              setStatus(v);
              updateUrl({ status: v });
            }}
            theme={fieldTheme}
            variant="navbar"
            options={[
              { value: '', label: 'Todos' },
              { value: 'DRAFT', label: 'Rascunho' },
              { value: 'PENDING', label: 'Pendente' },
              { value: 'COMPLETED', label: 'Aprovado' },
              { value: 'FAILED', label: 'Recusado' },
              { value: 'REFUNDED', label: 'Estornado' },
              { value: 'EXPIRED', label: 'Expirado' },
              { value: 'IN_MEDIATION', label: 'Em mediação' },
              { value: 'CHARGEBACK', label: 'Chargeback' },
              { value: 'PENDING_REFUND', label: 'Estorno pendente' },
            ]}
          />
          {
            <Dropdown
              label="Forma de pagamento:"
              value={paymentMethod}
              onChange={(v) => {
                setPaymentMethod(v);
                updateUrl({ paymentMethod: v || undefined });
              }}
              theme={fieldTheme}
              variant="navbar"
              options={[
                { value: '', label: 'Todos' },
                { value: 'BOLETO', label: 'Boleto' },
                { value: 'CREDIT_CARD', label: 'Cartão de crédito' },
                { value: 'DEBIT_CARD', label: 'Cartão de débito' },
                { value: 'PIX', label: 'Pix' },
              ]}
            />
          }
          {isAdmin && (
            <Dropdown
              label="Adquirente:"
              value={acquirer}
              onChange={(v) => {
                setAcquirer(v);
                updateUrl({ acquirer: v || undefined });
              }}
              theme={fieldTheme}
              variant="navbar"
              options={[
                { value: '', label: 'Todas' },
                { value: 'DOM', label: 'DOM' },
                { value: 'FRENDZ', label: 'Frendz' },
              ]}
            />
          )}
          <Input
            label="Buscar transação:"
            placeholder="ID, referência ou descrição"
            value={codigoTransacao}
            onChange={setCodigoTransacao}
            theme={fieldTheme}
            variant="navbar"
          />
        </div>

        {showLegacyFilters && (
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <Input
              label="Código de referência:"
              placeholder="Opcional"
              value={codigoReferencia}
              onChange={setCodigoReferencia}
              theme={fieldTheme}
              variant="navbar"
            />
            <Input
              label="Nome do comprador:"
              placeholder="Nome"
              value={compradorNome}
              onChange={setCompradorNome}
              theme={fieldTheme}
              variant="navbar"
            />
            <Input
              label="Número de documento:"
              placeholder="CPF/CNPJ"
              value={compradorDocumento}
              onChange={setCompradorDocumento}
              theme={fieldTheme}
              variant="navbar"
            />
            <Input
              label="E-mail do comprador:"
              placeholder="email@exemplo.com"
              value={compradorEmail}
              onChange={setCompradorEmail}
              theme={fieldTheme}
              variant="navbar"
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <ActionButton
            variant="danger"
            onClick={() => {
              setDateRange({ start: null, end: null });
              setCodigoTransacao('');
              setCodigoReferencia('');
              setStatus('');
              setPaymentMethod('');
              setAcquirer('');
              setPlataforma('');
              setCompradorNome('');
              setCompradorDocumento('');
              setCompradorEmail('');
              router.push(pathname);
            }}
          >
            <Eraser className="h-4 w-4" />
            Limpar tudo
          </ActionButton>
          <ActionButton
            variant="primary"
            onClick={() => {
              updateUrl({
                codigoTransacao: codigoTransacao || undefined,
                codigoReferencia: codigoReferencia || undefined,
                compradorNome: compradorNome || undefined,
                compradorDocumento: compradorDocumento || undefined,
                compradorEmail: compradorEmail || undefined,
              });
            }}
          >
            <Search className="h-4 w-4" />
            {isPending ? 'Pesquisando...' : 'Pesquisar'}
          </ActionButton>
        </div>

        {exceedsTreseMeses(dateRange.start, dateRange.end) ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
            O intervalo máximo permitido é de 3 meses. Ajuste as datas para
            pesquisar.
          </div>
        ) : error ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-400">
            {error.message}
          </div>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={filteredRows}
        loading={isPending || loadingUser}
        page={data?.page ?? 1}
        pageSize={data?.pageSize ?? 20}
        total={data?.total ?? 0}
        onPageChange={(p) => updateUrl({ page: p })}
        onRowClick={(row) =>
          router.push(`/transacoes/${encodeURIComponent(row.id)}`)
        }
        emptyTitle="Nenhuma transação sincronizada"
        emptyDescription="O ledger local ainda não possui transações para estes filtros. Aguarde a próxima sincronização ou ajuste o período."
        minWidth="min-w-[1300px]"
      />

      <Modal
        open={isExportOpen && !showMaquinetasTabs}
        title="Exportar Transações"
        onClose={() => setIsExportOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-white/60 dark:hover:text-white"
              onClick={() => setIsExportOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isExporting}
              className="rounded-full bg-linear-to-r from-emerald-500 to-teal-500 px-6 py-2 text-sm font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 active:scale-95 disabled:opacity-50"
              onClick={() => void handleExportCSV()}
            >
              {isExporting ? 'Exportando...' : 'Confirmar Exportação'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-white/60">
            Selecione o período das transações que deseja exportar. O arquivo
            será gerado em formato .csv.
          </p>
          <DateRangePickerField
            key={`${searchParams.get('dataInicio')}:${searchParams.get('dataFim')}`}
            label="Data inicial e final"
            value={exportDateRange}
            onChange={setExportDateRange}
            theme={fieldTheme}
          />
        </div>
      </Modal>
    </div>
  );
}

export default function TransacoesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center">
          <Spinner size={40} />
        </div>
      }
    >
      <TransacoesContent />
    </Suspense>
  );
}
