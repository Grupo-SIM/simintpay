import { endpoints } from '@/services/api/endpoints';
import {
  checkoutUrlAssinatura,
  checkoutUrlBoleto,
  checkoutUrlLinkPagamento,
  checkoutUrlPixPlan,
  checkoutUrlPlano,
} from './_shared';

export type ProductKind =
  'planos' | 'planos-pix' | 'links-pagamento' | 'links-assinatura' | 'boletos';
/** Coprodução do produto: coprodutores têm acesso somente leitura. */
export type ProductCoproduction = {
  role: 'OWNER' | 'COPRODUCER';
  readOnly: boolean;
  participantsCount: number;
  myPercentageBps: number | null;
};
export type ProductRow = {
  coproduction: ProductCoproduction | null;
  id: string;
  name: string;
  interval: string | null;
  amount: number;
  netAmount: number | null;
  active: boolean;
  status: 'Ativo' | 'Inativo' | 'Limite atingido';
  platforms: string[];
  url: string | null;
  createdAt: string | null;
};
export type RawProduct = Record<string, unknown> & { id: string };
export type ProductListResponse = {
  data?: RawProduct[];
  items?: RawProduct[];
  total?: number;
  meta?: { totalItems?: number; totalPages?: number };
};

export const productConfigs = {
  planos: {
    title: 'Planos',
    createLabel: 'Criar plano',
    queryKey: 'cliente-plans',
    endpoint: endpoints.planos,
    intervalLabel: 'Tipo',
  },
  'planos-pix': {
    title: 'Planos PIX',
    createLabel: 'Criar plano PIX',
    queryKey: 'cliente-pix-plans',
    endpoint: endpoints.planosPix,
    intervalLabel: 'Tipo',
  },
  'links-pagamento': {
    title: 'Links de Pagamento',
    createLabel: 'Adicionar novo link',
    queryKey: 'cliente-links-pagamento',
    endpoint: endpoints.linksPagamento,
    intervalLabel: null,
  },
  'links-assinatura': {
    title: 'Links de Assinatura',
    createLabel: 'Adicionar novo link',
    queryKey: 'cliente-links-assinatura',
    endpoint: endpoints.linksAssinatura,
    intervalLabel: 'Frequência',
  },
  boletos: {
    title: 'Boletos',
    createLabel: 'Adicionar novo boleto',
    queryKey: 'cliente-boletos',
    endpoint: endpoints.boletos,
    intervalLabel: 'Vencimento',
  },
} as const;

const intervalLabels: Record<string, string> = {
  SEMANAL: 'Semanal',
  WEEKLY: 'Semanal',
  WEEK: 'Semanal',
  MENSAL: 'Mensal',
  MONTHLY: 'Mensal',
  MONTH: 'Mensal',
  TRIMESTRAL: 'Trimestral',
  QUARTER: 'Trimestral',
  SEMESTRAL: 'Semestral',
  SEMESTER: 'Semestral',
  ANUAL: 'Anual',
  YEAR: 'Anual',
  YEARLY: 'Anual',
};
const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';
const numeric = (value: unknown): number =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

export function mapProduct(kind: ProductKind, raw: RawProduct): ProductRow {
  const interval = text(
    raw.tipo ?? raw.type ?? raw.frequencia ?? raw.frequencyType,
  );
  const amount = numeric(raw.preco ?? raw.price ?? raw.valor ?? raw.amount);
  const net = raw.precoLiquido ?? raw.valorLiquido ?? raw.netAmount;
  const explicitActive = raw.ativo ?? raw.isActive ?? raw.active;
  const active =
    explicitActive != null
      ? explicitActive !== false &&
        explicitActive !== 0 &&
        explicitActive !== 'false' &&
        explicitActive !== '0' &&
        !['inactive', 'inativo', 'disabled', 'off', 'no'].includes(
          text(explicitActive).toLowerCase(),
        )
      : raw.status != null
        ? ['ACTIVE', 'ATIVO', 'ENABLED'].includes(
            text(raw.status).toUpperCase(),
          )
        : true;
  const description = text(raw.description)
    .replace(/\s*\[(?:CPF_DONO|CPF|TENANT|NOME_DONO):[^\]]*\]/gi, '')
    .trim();
  const name =
    text(raw.nome ?? raw.name ?? raw.titulo ?? raw.title) ||
    (kind === 'planos-pix'
      ? description || `Plano ${intervalLabels[interval] ?? interval}`
      : text(raw.codigo ?? raw.code) || '—');
  const url =
    kind === 'planos'
      ? checkoutUrlPlano(raw.id)
      : kind === 'planos-pix'
        ? checkoutUrlPixPlan(text(raw.linkCode))
        : kind === 'links-pagamento'
          ? checkoutUrlLinkPagamento(raw.id)
          : kind === 'links-assinatura'
            ? checkoutUrlAssinatura(text(raw.code ?? raw.codigo))
            : checkoutUrlBoleto(raw.id);
  const days = numeric(raw.vencimentoDias);
  const platformValues = [
    raw.plataforma,
    raw.tenantTag,
    ...(Array.isArray(raw.plataformas) ? raw.plataformas : []),
  ];
  const platforms = [
    ...new Set(
      platformValues
        .filter(
          (value): value is string =>
            typeof value === 'string' && Boolean(value.trim()),
        )
        .map((value) => value.trim().toUpperCase()),
    ),
  ];
  const maxUses = raw.maxUsos ?? raw.maxUses;
  const limitReached =
    kind === 'links-assinatura' &&
    maxUses != null &&
    numeric(raw.usos ?? raw.currentUses) >= numeric(maxUses);
  const cop = raw.coproducao as Partial<ProductCoproduction> | null | undefined;
  const coproduction: ProductCoproduction | null =
    cop && (cop.role === 'OWNER' || cop.role === 'COPRODUCER')
      ? {
          role: cop.role,
          readOnly: cop.role === 'COPRODUCER' || cop.readOnly === true,
          participantsCount: numeric(cop.participantsCount),
          myPercentageBps:
            cop.myPercentageBps == null ? null : numeric(cop.myPercentageBps),
        }
      : null;
  return {
    coproduction,
    id: raw.id,
    name,
    amount,
    netAmount: net == null ? null : numeric(net),
    active,
    url,
    platforms,
    status: !active ? 'Inativo' : limitReached ? 'Limite atingido' : 'Ativo',
    interval:
      kind === 'boletos'
        ? days > 0
          ? `${days} ${days === 1 ? 'dia' : 'dias'}`
          : 'Sem vencimento'
        : (intervalLabels[interval] ?? (interval || null)),
    createdAt: text(raw.criadoEm ?? raw.createdAt) || null,
  };
}

export function filterProducts(
  rows: ProductRow[],
  filters: {
    search: string;
    status: string;
    start: string;
    end: string;
    platform?: string;
  },
) {
  const search = filters.search.trim().toLocaleLowerCase('pt-BR');
  return rows.filter((row) => {
    if (search && !row.name.toLocaleLowerCase('pt-BR').includes(search))
      return false;
    if (
      filters.platform &&
      filters.platform !== 'all' &&
      !row.platforms.includes(filters.platform.toUpperCase())
    )
      return false;
    if (
      (filters.status === 'active' && !row.active) ||
      (filters.status === 'inactive' && row.active)
    )
      return false;
    if (filters.start || filters.end) {
      if (!row.createdAt) return false;
      const timestamp = new Date(row.createdAt).getTime();
      if (!Number.isFinite(timestamp)) return false;
      if (
        filters.start &&
        timestamp < new Date(`${filters.start}T00:00:00`).getTime()
      )
        return false;
      if (
        filters.end &&
        timestamp > new Date(`${filters.end}T23:59:59.999`).getTime()
      )
        return false;
    }
    return true;
  });
}
