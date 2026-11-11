import type { ApiClient } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import type { PaginatedResponse } from '@/services/api/types';

import type {
  ListTransacoesQuery,
  Transacao,
  TransacaoDetail,
} from '../types/transacoes.types';

/** Shape returned by GET /admin/transacoes-dom (ledger local). */
interface DomTransacao {
  id: string;
  amount: string;
  netAmount: string | null;
  status: string;
  paymentMethod: string;
  description: string | null;
  installments: number;
  totalFee: string | null;
  domFee: string | null;
  platformFee: string | null;
  domTransactionId: string | null;
  domPaymentId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerDocument: string | null;
  customerPhone: string | null;
  createdAt: string;
  updatedAt: string;
}

function platformFromText(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  // [TENANT:TAG] explicit tag takes priority
  const tenantMatch = text.match(/\[TENANT:([^\]]+)\]/i);
  if (tenantMatch) return tenantMatch[1].toUpperCase();
  if (
    t.includes('areaflix') ||
    t.includes('área flix') ||
    t.includes('area flix')
  )
    return 'AREAFLIX';
  if (t.includes('pagatg') || t.includes('paga tg')) return 'PAGATG';
  if (t.includes('ebooksim') || t.includes('ebook') || t.includes('e-book'))
    return 'EBOOKSIM';
  if (t.includes('renovada')) return 'RENOVADA';
  if (t.includes('bosque') || t.includes('ibb')) return 'BOSQUE';
  if (t.includes('revalida')) return 'REVALIDA';
  if (t.includes('marketing raiz') || t.includes('marketing-raiz'))
    return 'MARKETING-RAIZ';
  return undefined;
}

/* ---------- helpers to normalise the API response ---------- */

/** Shape returned by the BFF (Portuguese field names) */
interface ApiTransacao {
  id: string;
  valor?: number;
  valorLiquido?: number;
  status?: string;
  metodo?: string;
  descricao?: string;
  parcelas?: number;
  cliente?: {
    nome?: string;
    email?: string;
    documento?: string;
  };
  taxas?: {
    total?: number;
    dom?: number;
    plataforma?: number;
  };
  financeiro?: {
    valor_bruto_venda?: number;
    taxa_dom?: number;
    taxa_vendedor?: number;
    taxa_fixa_transacao?: number;
    taxa_cashback?: number;
    taxa_servico?: number;
    valor_liquido_vendedor?: number;
    lucro_master?: number;
  };
  criadoEm?: string;
  plataforma?: string | null;

  /* fallback — if the API ever returns English keys */
  amount?: number;
  netAmount?: number;
  paymentMethod?: string;
  customerName?: string;
  customerEmail?: string;
  customerDocument?: string;
  createdAt?: string;
  totalFee?: number;
  installments?: number;
}

interface LedgerTransactionsResponse {
  data: {
    transactions: Array<{
      id: string;
      amount: string;
      netAmount: string | null;
      totalFee: string | null;
      acquirerFee?: string | null;
      status: string;
      paymentMethod: string;
      acquirer: string;
      description: string | null;
      plataforma?: string | null;
      platformTag?: string | null;
      installments: number;
      customerName: string | null;
      customerEmail: string | null;
      customerDocument: string | null;
      coproducao?: Transacao['coproducao'];
      createdAt: string;
    }>;
    total: number;
  };
  page: number;
  limit: number;
}

function mapTransacao(raw: ApiTransacao): Transacao {
  const statusMap: Record<string, string> = {
    APROVADA: 'COMPLETED',
    RECUSADA: 'FAILED',
    PENDENTE: 'PENDING',
    ESTORNADA: 'REFUNDED',
  };
  const rawStatus = (raw.status ?? '').toUpperCase();

  return {
    id: raw.id,
    amount: raw.valor ?? raw.amount ?? 0,
    netAmount:
      raw.valorLiquido ??
      raw.financeiro?.valor_liquido_vendedor ??
      raw.netAmount,
    totalFee: raw.taxas?.total ?? raw.totalFee,
    valorBrutoVenda: raw.financeiro?.valor_bruto_venda,
    taxaDom: raw.financeiro?.taxa_dom,
    taxaVendedor: raw.financeiro?.taxa_vendedor,
    taxaFixaTransacao: raw.financeiro?.taxa_fixa_transacao,
    taxaCashback: raw.financeiro?.taxa_cashback,
    taxaServico: raw.financeiro?.taxa_servico,
    valorLiquidoVendedor: raw.financeiro?.valor_liquido_vendedor,
    lucroMaster: raw.financeiro?.lucro_master,
    paymentMethod: raw.metodo ?? raw.paymentMethod ?? 'PIX',
    installments: raw.parcelas ?? raw.installments ?? 1,
    customerName: raw.cliente?.nome ?? raw.customerName ?? null,
    customerEmail: raw.cliente?.email ?? raw.customerEmail ?? null,
    customerDocument: raw.cliente?.documento ?? raw.customerDocument ?? null,
    status: statusMap[rawStatus] ?? raw.status ?? 'PENDING',
    createdAt: raw.criadoEm ?? raw.createdAt ?? new Date().toISOString(),
    plataforma: raw.plataforma ?? platformFromText(raw.descricao),
  };
}

function mapDomTransacao(raw: DomTransacao): Transacao {
  return {
    id: raw.id,
    amount: raw.amount,
    netAmount: raw.netAmount,
    totalFee: raw.totalFee,
    acquirerFee: raw.domFee,
    acquirer: 'DOM',
    paymentMethod: raw.paymentMethod,
    installments: raw.installments,
    descricao: raw.description ?? undefined,
    customerName: raw.customerName,
    customerEmail: raw.customerEmail,
    customerDocument: raw.customerDocument,
    status: raw.status,
    createdAt: raw.createdAt,
  };
}

/* ---------- service functions ---------- */

export type AdminTransacoesDomQuery = {
  page?: number;
  limit?: number;
  begin_date?: string;
  end_date?: string;
  status?: string;
  payment_method?: 'pix' | 'credit_card';
};

export async function listTransacoesAdmin(
  api: ApiClient,
  query: AdminTransacoesDomQuery,
): Promise<PaginatedResponse<Transacao>> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.limit ?? 50));

  const apiQuery: Record<string, string | number | undefined> = {
    page,
    limit: pageSize,
    begin_date: query.begin_date,
    end_date: query.end_date,
    status: query.status,
    payment_method: query.payment_method,
  };

  const res = await api.get<{
    data: { transactions: DomTransacao[]; total?: number };
  }>(endpoints.admin.transacoesDom, { query: apiQuery });

  const raw = res.data?.transactions ?? [];

  return {
    data: raw.map(mapDomTransacao),
    total: res.data?.total ?? raw.length,
    page,
    pageSize,
  } as PaginatedResponse<Transacao>;
}

export async function listTransacoes(
  api: ApiClient,
  query: ListTransacoesQuery,
) {
  const {
    pageSize = 20,
    dataInicio,
    dataFim,
    id,
    q: qParam,
    paymentMethod,
    acquirer,
  } = query;
  const apiQuery: Record<string, string | number | undefined> = {
    page: query.page,
    limit: pageSize,
    begin_date: dataInicio?.slice(0, 10),
    end_date: dataFim?.slice(0, 10),
    status: query.status,
    id: query.id,
    domTransactionId: query.domTransactionId,
    customerName: query.customerName?.trim(),
    customerEmail: query.customerEmail?.trim(),
    customerDocument: query.customerDocument?.trim(),
    plataforma: query.plataforma,
    payment_method: paymentMethod,
    acquirer,
    tipoTransacao: query.tipoTransacao,
    q: qParam?.trim() || id?.trim(),
  };
  const res = await api.get<LedgerTransactionsResponse>(
    endpoints.transacoes.list,
    { query: apiQuery },
  );
  const raw = res.data?.transactions ?? [];

  return {
    data: raw.map((transaction) => ({
      id: transaction.id,
      amount: transaction.amount,
      netAmount: transaction.netAmount,
      totalFee: transaction.totalFee,
      acquirerFee: transaction.acquirerFee,
      status: transaction.status,
      paymentMethod: transaction.paymentMethod,
      acquirer: transaction.acquirer,
      descricao: transaction.description ?? undefined,
      plataforma:
        transaction.plataforma ?? transaction.platformTag ?? undefined,
      installments: transaction.installments,
      customerName: transaction.customerName,
      customerEmail: transaction.customerEmail,
      customerDocument: transaction.customerDocument,
      coproducao: transaction.coproducao ?? null,
      createdAt: transaction.createdAt,
    })),
    total: res.data?.total ?? 0,
    page: res.page,
    pageSize: res.limit,
  } as PaginatedResponse<Transacao>;
}

export async function getTransacaoDetail(api: ApiClient, id: string) {
  return api.get<TransacaoDetail>(endpoints.transacoes.detail(id));
}
