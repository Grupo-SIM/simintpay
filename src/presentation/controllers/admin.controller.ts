import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LeadStatus, Prisma, Role, TransactionStatus, WithdrawStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
const TZ = 'America/Sao_Paulo';

/** dataInicio/dataFim no formato YYYY-MM-DD interpretados no fuso SP. */
function parseYmdSp(s: string): dayjs.Dayjs {
  const t = s.trim();
  const strict = dayjs.tz(t, 'YYYY-MM-DD', TZ);
  return strict.isValid() ? strict : dayjs.tz(t, TZ);
}
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { RolesGuard } from '../../infrastructure/security/guards/roles.guard';
import { Roles } from '../../infrastructure/security/decorators/roles.decorator';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListLeadsUseCase } from '../../application/use-cases/admin/list-leads.use-case';
import { ApproveLeadUseCase } from '../../application/use-cases/admin/approve-lead.use-case';
import { RejectLeadUseCase } from '../../application/use-cases/admin/reject-lead.use-case';
import { SyncDomTransactionsUseCase } from '../../application/use-cases/admin/sync-dom-transactions.use-case';
import { ListWithdrawalsAdminUseCase } from '../../application/use-cases/admin/list-withdrawals-admin.use-case';
import { ApproveWithdrawalUseCase } from '../../application/use-cases/admin/approve-withdrawal.use-case';
import { RejectWithdrawalUseCase } from '../../application/use-cases/admin/reject-withdrawal.use-case';
import { SyncDomWithdrawalsUseCase } from '../../application/use-cases/admin/sync-dom-withdrawals.use-case';
import { SyncFullRenovadaUseCase } from '../../application/use-cases/admin/sync-full-renovada.use-case';
import { SyncFullBosqueUseCase } from '../../application/use-cases/admin/sync-full-bosque.use-case';
import { SyncFullEbookUseCase } from '../../application/use-cases/admin/sync-full-ebook.use-case';
import { MigrateRenovadaTxsToAdminUseCase } from '../../application/use-cases/admin/migrate-renovada-txs-to-admin.use-case';
import { ListDomTransactionsDirectUseCase } from '../../application/use-cases/admin/list-dom-transactions-direct.use-case';
import { SyncMaquinetasUseCase } from '../../application/use-cases/admin/sync-maquinetas.use-case';
import { SyncDomTransactionsCron } from '../../infrastructure/cron/sync-dom-transactions.cron';
import { RejectLeadDto } from '../../application/dtos/admin/reject-lead.dto';
import { getModuleConfig } from '../../modules/module.registry';
import { RejectWithdrawalDto } from '../../application/dtos/admin/reject-withdrawal.dto';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { RevalidaSyncService } from '../../modules/revalida/services/revalida-sync.service';
import { HASH_SERVICE, type IHashService } from '../../core/services/hash.interface';
import {
  PAYMENT_GATEWAY,
  type DomTransactionItem,
  type IPaymentGateway,
} from '../../core/services/payment-gateway.interface';
import { WALLET_REPOSITORY, type IWalletRepository } from '../../core/repositories/wallet.repository.interface';
import { CommunityManagementService } from '../../application/services/community-management.service';
import { computeUserNetBalance } from '../../application/helpers/user-platform-net-balance.helper';
import { PlatformTaxasService } from '../../application/services/platform-taxas.service';
import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { isMasterAdminUser } from '../../shared/utils/is-master-admin.util';
import { LinkExternalPlatformUserService } from '../../application/services/link-external-platform-user.service';
import { ScanPlatformOwnersUseCase } from '../../application/use-cases/admin/scan-platform-owners.use-case';

/** Extrai o serial do terminal a partir da descrição da transação */
function extractTerminal(description: string | null | undefined): string {
  if (!description) return '-';
  const m = description.match(/Terminal:\s*([A-Z0-9]+)/i);
  return m ? m[1] : '-';
}

const PLAN_PLATFORM_CPF_REGEX = /\[CPF:([^\]|]*)\|([^\]]+)\]/;
const TENANT_EBOOK_TAG = '[TENANT:EBOOK]';

function normalizePlatformTag(tag: string): string {
  const upper = String(tag || '').toUpperCase();
  if (upper === 'EBOOKSIM' || upper === 'EBOOK') return 'EBOOK';
  return upper;
}

function extractOwnerDocDigitsFromPlanDescription(description: string | null | undefined): string | null {
  const m = (description ?? '').match(PLAN_PLATFORM_CPF_REGEX);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, '');
  if (digits.length < 11) return null;
  return digits;
}

/** userIds dos planos técnicos + contas Simpay (CPF) para listar todas as transações da plataforma */
/** Extrai todos os CPFs/CNPJs (11-14 dígitos) presentes em uma string */
function extractAllDocDigitsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = (text).match(/\d{11,14}/g) ?? [];
  return [...new Set(matches.filter(d => d.length >= 11 && d.length <= 14))];
}

function normalizeDocDigits(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '');
}

function docVariants(doc: string | null | undefined): string[] {
  const digits = normalizeDocDigits(doc);
  if (!digits) return [];
  if (digits.length === 11) {
    return [digits, digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')];
  }
  if (digits.length === 14) {
    return [digits, digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')];
  }
  return [digits];
}

async function expandPlatformTransactionUserIds(
  prisma: PrismaService,
  plans: { userId: string; description: string | null }[],
): Promise<string[]> {
  const ids = new Set(plans.map((p) => p.userId));
  if (plans.length === 0) return [];

  // Coleta todos os dígitos de documento presentes nas descrições dos planos
  // (tanto no formato [CPF:xxx|TAG] quanto em texto livre)
  const digitsToResolve = new Set<string>();

  for (const p of plans) {
    // Tenta o formato padrão primeiro
    const tagged = extractOwnerDocDigitsFromPlanDescription(p.description);
    if (tagged) {
      digitsToResolve.add(tagged);
      continue;
    }
    // Fallback: qualquer sequência de 11-14 dígitos na descrição
    for (const d of extractAllDocDigitsFromText(p.description)) {
      digitsToResolve.add(d);
    }
  }

  if (digitsToResolve.size === 0) return [...ids];

  const orClause = [...digitsToResolve].flatMap((d) => {
    const row: { cpf: string }[] = [{ cpf: d }];
    if (d.length === 11) {
      row.push({ cpf: d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') });
    } else if (d.length === 14) {
      row.push({ cpf: d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') });
    }
    return row;
  });

  const merchants = await prisma.user.findMany({
    where: { OR: orClause },
    select: { id: true },
  });
  for (const m of merchants) ids.add(m.id);
  return [...ids];
}

async function expandUserIdsByCpf(
  prisma: PrismaService,
  baseUserIds: string[],
): Promise<string[]> {
  const ids = new Set(baseUserIds);
  if (baseUserIds.length === 0) return [];

  const baseUsers = await prisma.user.findMany({
    where: { id: { in: baseUserIds } },
    select: { cpf: true },
  });
  const variants = [...new Set(baseUsers.flatMap((u) => docVariants(u.cpf ?? null)))];
  if (variants.length === 0) return [...ids];

  const relatedUsers = await prisma.user.findMany({
    where: { cpf: { in: variants } },
    select: { id: true },
  });
  for (const u of relatedUsers) ids.add(u.id);
  return [...ids];
}

/**
 * Conta técnica onde ficam as transações do checkout Ebook (`[TENANT:EBOOK]` no webhook/sync).
 * Mesmo default de `EBOOK_ID` nos endpoints de limpeza/sync do ebook.
 */
const EBOOK_CONSOLIDADO_USER_ID =
  process.env.EBOOK_ID || 'd4fbf80f-6f13-4bc6-8e15-ebook00000001';

/** Contas plataforma usadas no consolidado e no cálculo do Lucro Simpay (inclui Ebook). */
const CONSOLIDADO_PLATFORMS: ReadonlyArray<{ tag: string; id: string }> = [
  { tag: 'RENOVADA', id: 'ba2b57d6-e3bf-4395-af31-58454f27207a' },
  { tag: 'PAGATG', id: 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5d' },
  { tag: 'BOSQUE', id: 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c' },
  { tag: 'REVALIDA', id: '7929df01-a980-45e3-b3c7-1a8b8eb7850f' },
  { tag: 'EBOOK', id: EBOOK_CONSOLIDADO_USER_ID },
];

type ConsolidadoListQuery = {
  dataInicio?: string;
  dataFim?: string;
  customerName?: string;
  transactionId?: string;
  transactionType?: string;
  paymentLink?: string;
  planName?: string;
};

function buildConsolidadoTransactionWhere(input: ConsolidadoListQuery): Prisma.TransactionWhereInput {
  const platformIds = CONSOLIDADO_PLATFORMS.map((p) => p.id);

  const where: Prisma.TransactionWhereInput = {
    userId: { in: platformIds },
    status: 'COMPLETED',
  };

  if (input.transactionType === 'out') {
    where.status = { in: ['REFUNDED', 'CHARGEBACK'] };
  } else if (input.transactionType === 'all') {
    where.status = { in: ['COMPLETED', 'REFUNDED', 'CHARGEBACK'] };
  }

  if (input.dataInicio || input.dataFim) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (input.dataInicio) {
      const d = dayjs.tz(input.dataInicio, TZ).startOf('day');
      if (d.isValid()) createdAt.gte = d.toDate();
    }
    if (input.dataFim) {
      const d = dayjs.tz(input.dataFim, TZ).endOf('day');
      if (d.isValid()) createdAt.lte = d.toDate();
    }
    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }
  }

  if (input.customerName?.trim()) {
    where.customerName = { contains: input.customerName.trim(), mode: 'insensitive' };
  }

  if (input.transactionId?.trim()) {
    where.OR = [{ id: input.transactionId.trim() }, { domTransactionId: input.transactionId.trim() }];
  }

  if (input.paymentLink?.trim()) {
    where.paymentLinkId = input.paymentLink.trim();
  }

  if (input.planName?.trim()) {
    where.description = { contains: input.planName.trim(), mode: 'insensitive' };
  }

  return where;
}

/**
 * Transações COMPLETED que entram em valor bruto consolidado e lucro Simpay.
 * Exclui bruto ≤ 0 e lançamentos de ajuste/sincronização (não são venda).
 */
function transacaoEntraNoLucroSimpayConsolidado(
  amount: unknown,
  description: string | null,
): boolean {
  const bruto = Number(amount);
  if (!Number.isFinite(bruto) || bruto <= 0) return false;
  const d = (description ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (d.includes('sincronizacao de saldo')) return false;
  if (d.includes('ajuste administrativo')) return false;
  if (d.includes('balance sync')) return false;
  return true;
}

/** Líquido da transação para o consolidado: netAmount quando existir, senão bruto × LIQUIDEZ da plataforma. */
function valorLiquidoTransacaoConsolidado(
  tx: { amount: unknown; netAmount: unknown | null },
  tagPlataforma: string,
): number {
  const bruto = Number(tx.amount);
  const L = getPlatformTaxaEffective(tagPlataforma, 'LIQUIDEZ', 0.91);
  const rawNet = tx.netAmount;
  if (rawNet != null && rawNet !== undefined && String(rawNet) !== '') {
    const n = Number(rawNet);
    if (Number.isFinite(n)) return n;
  }
  return bruto * L;
}

/** Resumo dos cards: só plataformas + COMPLETED + intervalo (ignora filtros de tabela). */
function buildConsolidadoResumoWhere(
  dataInicio?: string,
  dataFim?: string,
): Prisma.TransactionWhereInput {
  const platformIds = CONSOLIDADO_PLATFORMS.map((p) => p.id);
  const where: Prisma.TransactionWhereInput = {
    userId: { in: platformIds },
    status: 'COMPLETED',
  };
  if (dataInicio || dataFim) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (dataInicio) {
      const d = dayjs.tz(dataInicio, TZ).startOf('day');
      if (d.isValid()) createdAt.gte = d.toDate();
    }
    if (dataFim) {
      const d = dayjs.tz(dataFim, TZ).endOf('day');
      if (d.isValid()) createdAt.lte = d.toDate();
    }
    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }
  }
  return where;
}

/**
 * Mesma regra que o front (`mapDomStatusToInternal` em transacoes.service.ts).
 * Garante que os cards de distribuição batam com a listagem admin (API DOM).
 */
type DomStatusBucket = 'PENDING' | 'COMPLETED' | 'REFUNDED' | 'FAILED';

function domRawStatusToBucket(status: string | undefined | null): DomStatusBucket {
  const s = String(status ?? 'pending').toLowerCase();
  if (s === 'paid' || s === 'approved' || s === 'completed' || s === 'revision_paid') {
    return 'COMPLETED';
  }
  if (s === 'refunded' || s === 'pending_refund') return 'REFUNDED';
  if (s === 'chargeback') return 'REFUNDED';
  if (s === 'failed' || s === 'not_authorized' || s === 'expired') return 'FAILED';
  return 'PENDING';
}

/** Rótulos alinhados à coluna Status em /transacoes (mapStatusLabel). */
const DOM_DIST_STATUS_LABEL: Record<DomStatusBucket, string> = {
  PENDING: 'Pendente',
  COMPLETED: 'Aprovado',
  REFUNDED: 'Estornado',
  FAILED: 'Recusado',
};

type DomMethodBucket = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD';

function domPaymentMethodToBucket(method: string | undefined | null): DomMethodBucket {
  const m = String(method ?? 'pix').toLowerCase();
  if (m.includes('debit')) return 'DEBIT_CARD';
  if (m.includes('credit') || m.includes('cartao') || m.includes('card')) return 'CREDIT_CARD';
  return 'PIX';
}

const DOM_DIST_METHOD_LABEL: Record<DomMethodBucket, string> = {
  PIX: 'PIX',
  CREDIT_CARD: 'Cartão de Crédito',
  DEBIT_CARD: 'Débito',
};

/** Mesmo padrão de datas que o hook admin em `use-transacoes` (listTransacoesAdmin). */
function relatorioDomDateRange(dataInicio?: string, dataFim?: string): { begin_date: string; end_date: string } {
  const endDay = dataFim?.trim() || dayjs().tz(TZ).format('YYYY-MM-DD');
  const beginDay = dataInicio?.trim() || dayjs().tz(TZ).subtract(90, 'day').format('YYYY-MM-DD');
  return {
    begin_date: dataInicio?.trim() ? `${dataInicio.trim()} 00:00:00` : beginDay,
    end_date: dataFim?.trim() ? `${dataFim.trim()} 23:59:59` : `${endDay} 23:59:59`,
  };
}

function masterLogDateFilter(
  dataInicio?: string,
  dataFim?: string,
): Prisma.DateTimeFilter | undefined {
  if (!dataInicio && !dataFim) return undefined;
  const createdAt: Prisma.DateTimeFilter = {};
  if (dataInicio) {
    const d = dayjs.tz(dataInicio, TZ).startOf('day');
    if (d.isValid()) createdAt.gte = d.toDate();
  }
  if (dataFim) {
    const d = dayjs.tz(dataFim, TZ).endOf('day');
    if (d.isValid()) createdAt.lte = d.toDate();
  }
  return Object.keys(createdAt).length > 0 ? createdAt : undefined;
}

function domStatusIsEstorno(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s.includes('refund') ||
    s.includes('chargeback') ||
    s.includes('dispute') ||
    s.includes('med') ||
    s.includes('contest')
  );
}

/**
 * Estornos na API DOM Pagamentos (DOM_REAL_API_URL / apiv3.dompagamentos.com.br), não api-dom.
 * Usa o domToken de cada conta plataforma; deduplica por id da transação; fallback no token master do .env.
 */
async function aggregateEstornosDomPagamentos(
  prisma: PrismaService,
  gateway: IPaymentGateway,
  platformUserIds: string[],
  dataInicio?: string,
  dataFim?: string,
): Promise<{ quantidade: number; valor: number }> {
  const end = dataFim
    ? dayjs.tz(dataFim, TZ).format('YYYY-MM-DD')
    : dayjs().tz(TZ).format('YYYY-MM-DD');
  const begin = dataInicio
    ? dayjs.tz(dataInicio, TZ).format('YYYY-MM-DD')
    : dayjs().tz(TZ).subtract(365, 'day').format('YYYY-MM-DD');

  const users = await prisma.user.findMany({
    where: { id: { in: platformUserIds } },
    select: { domToken: true },
  });
  const tokens = [
    ...new Set(
      users
        .map((u) => u.domToken)
        .filter((t): t is string => Boolean(t && String(t).trim())),
    ),
  ];
  const master = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
  if (tokens.length === 0 && master) tokens.push(String(master));

  if (tokens.length === 0) return { quantidade: 0, valor: 0 };

  const seenIds = new Set<string>();
  let quantidade = 0;
  let valor = 0;
  const limit = 100;
  const maxPages = 200;

  try {
    for (const domToken of tokens) {
      let page = 1;
      while (page <= maxPages) {
        const res = await gateway.listDomTransactions(domToken, {
          page,
          limit,
          begin_date: begin,
          end_date: end,
        });
        const txs = res.transactions ?? [];
        if (txs.length === 0) break;
        for (const tx of txs) {
          if (!tx.id || seenIds.has(tx.id)) continue;
          if (domStatusIsEstorno(tx.status)) {
            seenIds.add(tx.id);
            quantidade += 1;
            valor += Number(tx.amount ?? 0);
          }
        }
        if (txs.length < limit) break;
        page += 1;
      }
    }
  } catch {
    return { quantidade: 0, valor: 0 };
  }

  return { quantidade, valor: Number(valor.toFixed(2)) };
}

type LucroSimpayLinhaTx = {
  id: string;
  createdAt: string;
  descricao: string | null;
  bruto: number;
  liquidezLojista: number;
  parteAdminMasterBruto: number;
  formulaParteAdmin: string;
  taxaFixaTransacao: number;
  taxaCashback: number;
  lucroTransacao: number;
  formulaLucro: string;
};

type LucroSimpayPorPlataforma = {
  tag: string;
  userId: string;
  envLiquidez: string;
  envTaxaFixa: string;
  envTaxaCashback: string;
  liquidezLojista: number;
  taxaFixaTransacao: number;
  taxaCashback: number;
  quantidadeTransacoes: number;
  subtotalBruto: number;
  subtotalParteAdminMaster: number;
  subtotalDeducaoTaxaFixa: number;
  subtotalDeducaoTaxaCashback: number;
  subtotalLucro: number;
  transacoes: LucroSimpayLinhaTx[];
};

function buildLucroSimpayDetalhePorPlataforma(
  txs: {
    id: string;
    userId: string;
    amount: unknown;
    createdAt: Date;
    description: string | null;
  }[],
): { totalLucroSimpay: number; plataformas: LucroSimpayPorPlataforma[] } {
  const byTag = new Map<
    string,
    {
      userId: string;
      liquidezLojista: number;
      taxaFixa: number;
      taxaCashback: number;
      envLiquidez: string;
      envTaxaFixa: string;
      envCashback: string;
      transacoes: LucroSimpayLinhaTx[];
      subtotalBruto: number;
      subtotalParte: number;
      subtotalLucro: number;
    }
  >();

  let totalLucroSimpay = 0;

  for (const tx of txs) {
    const platform = CONSOLIDADO_PLATFORMS.find((p) => p.id === tx.userId);
    const tag = platform?.tag || 'RENOVADA';
    const liquidezKey = `${tag}_LIQUIDEZ`;
    const fixaKey = `${tag}_TAXA_FIXA_TRANSACAO`;
    const cbKey = `${tag}_TAXA_CASHBACK`;

    const liquidezLojista = getPlatformTaxaEffective(tag, 'LIQUIDEZ', 0.91);
    const taxaFixa = getPlatformTaxaEffective(tag, 'TAXA_FIXA_TRANSACAO', 1.0);
    const taxaCashback = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK', 3.0);

    const bruto = Number(tx.amount);
    const parteAdmin = bruto * (1 - liquidezLojista);
    const lucroTx = parteAdmin - taxaFixa - taxaCashback;
    totalLucroSimpay += lucroTx;

    if (!byTag.has(tag)) {
      byTag.set(tag, {
        userId: tx.userId,
        liquidezLojista,
        taxaFixa,
        taxaCashback,
        envLiquidez: liquidezKey,
        envTaxaFixa: fixaKey,
        envCashback: cbKey,
        transacoes: [],
        subtotalBruto: 0,
        subtotalParte: 0,
        subtotalLucro: 0,
      });
    }
    const agg = byTag.get(tag)!;

    const formulaParte = `${bruto.toFixed(2)} × (1 − ${liquidezLojista}) = ${parteAdmin.toFixed(2)}`;
    const formulaLucro = `${parteAdmin.toFixed(2)} − ${taxaFixa} − ${taxaCashback} = ${lucroTx.toFixed(2)}`;

    agg.transacoes.push({
      id: tx.id,
      createdAt: tx.createdAt.toISOString(),
      descricao: tx.description,
      bruto,
      liquidezLojista,
      parteAdminMasterBruto: Number(parteAdmin.toFixed(2)),
      formulaParteAdmin: formulaParte,
      taxaFixaTransacao: taxaFixa,
      taxaCashback,
      lucroTransacao: Number(lucroTx.toFixed(2)),
      formulaLucro,
    });
    agg.subtotalBruto += bruto;
    agg.subtotalParte += parteAdmin;
    agg.subtotalLucro += lucroTx;
  }

  const plataformas: LucroSimpayPorPlataforma[] = CONSOLIDADO_PLATFORMS.map(
    (p) => {
      const hit = byTag.get(p.tag);
      const liquidezKey = `${p.tag}_LIQUIDEZ`;
      const fixaKey = `${p.tag}_TAXA_FIXA_TRANSACAO`;
      const cbKey = `${p.tag}_TAXA_CASHBACK`;
      const L = getPlatformTaxaEffective(p.tag, 'LIQUIDEZ', 0.91);
      const tf = getPlatformTaxaEffective(p.tag, 'TAXA_FIXA_TRANSACAO', 1.0);
      const tc = getPlatformTaxaEffective(p.tag, 'TAXA_CASHBACK', 3.0);

      if (!hit) {
        return {
          tag: p.tag,
          userId: p.id,
          envLiquidez: liquidezKey,
          envTaxaFixa: fixaKey,
          envTaxaCashback: cbKey,
          liquidezLojista: L,
          taxaFixaTransacao: tf,
          taxaCashback: tc,
          quantidadeTransacoes: 0,
          subtotalBruto: 0,
          subtotalParteAdminMaster: 0,
          subtotalDeducaoTaxaFixa: 0,
          subtotalDeducaoTaxaCashback: 0,
          subtotalLucro: 0,
          transacoes: [],
        };
      }

      const n = hit.transacoes.length;
      return {
        tag: p.tag,
        userId: p.id,
        envLiquidez: liquidezKey,
        envTaxaFixa: fixaKey,
        envTaxaCashback: cbKey,
        liquidezLojista: hit.liquidezLojista,
        taxaFixaTransacao: hit.taxaFixa,
        taxaCashback: hit.taxaCashback,
        quantidadeTransacoes: n,
        subtotalBruto: Number(hit.subtotalBruto.toFixed(2)),
        subtotalParteAdminMaster: Number(hit.subtotalParte.toFixed(2)),
        subtotalDeducaoTaxaFixa: Number((n * hit.taxaFixa).toFixed(2)),
        subtotalDeducaoTaxaCashback: Number((n * hit.taxaCashback).toFixed(2)),
        subtotalLucro: Number(hit.subtotalLucro.toFixed(2)),
        transacoes: hit.transacoes.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
      };
    },
  );

  return {
    totalLucroSimpay: Number(totalLucroSimpay.toFixed(2)),
    plataformas,
  };
}

/** Lucro Simpay de uma transação (mesma fórmula que buildLucroSimpayDetalhePorPlataforma). */
function lucroSimpayUmaTransacaoConsolidado(tx: {
  userId: string;
  amount: unknown;
}): number {
  const platform = CONSOLIDADO_PLATFORMS.find((p) => p.id === tx.userId);
  const tag = platform?.tag || 'RENOVADA';
  const liquidezLojista = getPlatformTaxaEffective(tag, 'LIQUIDEZ', 0.91);
  const taxaFixa = getPlatformTaxaEffective(tag, 'TAXA_FIXA_TRANSACAO', 1.0);
  const taxaCashback = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK', 3.0);
  const bruto = Number(tx.amount);
  const parteAdmin = bruto * (1 - liquidezLojista);
  return parteAdmin - taxaFixa - taxaCashback;
}

function listYmdInclusiveSp(dataInicio: string, dataFim: string): string[] {
  const start = dayjs.tz(dataInicio, TZ).startOf('day');
  const end = dayjs.tz(dataFim, TZ).startOf('day');
  if (!start.isValid() || !end.isValid()) return [];
  if (end.isBefore(start)) return [];
  const out: string[] = [];
  let cur = start;
  while (!cur.isAfter(end, 'day')) {
    out.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(1, 'day');
  }
  return out;
}

/**
 * Série diária alinhada a lucroTotalMaster: lucro Simpay (por dia da transação) +
 * logs ADMIN_WITHDRAW_PROFIT_INC − ADMIN_WITHDRAW_FEE_INC (por dia do log), fuso America/Sao_Paulo.
 */
function buildLucroTotalMasterHistoricoDiario(
  txRowsLucro: { userId: string; amount: unknown; createdAt: Date }[],
  withdrawLogs: { createdAt: Date; amount: unknown; action: string }[],
  dataInicio: string,
  dataFim: string,
): Array<{ label: string; valor: number }> {
  const lucroPorDia = new Map<string, number>();
  for (const tx of txRowsLucro) {
    const ymd = dayjs(tx.createdAt).tz(TZ).format('YYYY-MM-DD');
    const l = lucroSimpayUmaTransacaoConsolidado(tx);
    lucroPorDia.set(ymd, (lucroPorDia.get(ymd) ?? 0) + l);
  }
  const feePorDia = new Map<string, number>();
  const profitPorDia = new Map<string, number>();
  for (const log of withdrawLogs) {
    const ymd = dayjs(log.createdAt).tz(TZ).format('YYYY-MM-DD');
    const amt = Number(log.amount);
    if (!Number.isFinite(amt)) continue;
    if (log.action === 'ADMIN_WITHDRAW_FEE_INC') {
      feePorDia.set(ymd, (feePorDia.get(ymd) ?? 0) + amt);
    } else if (log.action === 'ADMIN_WITHDRAW_PROFIT_INC') {
      profitPorDia.set(ymd, (profitPorDia.get(ymd) ?? 0) + amt);
    }
  }
  const dias = listYmdInclusiveSp(dataInicio, dataFim);
  return dias.map((ymd) => {
    const v =
      (lucroPorDia.get(ymd) ?? 0) +
      (profitPorDia.get(ymd) ?? 0) -
      (feePorDia.get(ymd) ?? 0);
    const label = dayjs.tz(ymd, TZ).format('DD/MM');
    return { label, valor: Number(v.toFixed(2)) };
  });
}

function isSingleCalendarDaySp(dataInicio: string, dataFim: string): boolean {
  const a = parseYmdSp(dataInicio).startOf('day');
  const b = parseYmdSp(dataFim).startOf('day');
  if (!a.isValid() || !b.isValid()) return false;
  return a.format('YYYY-MM-DD') === b.format('YYYY-MM-DD');
}

/**
 * Mesma fórmula do consolidado diário, mas com um ponto por hora (0–23) em America/Sao_Paulo.
 */
function buildLucroTotalMasterHistoricoPorHora(
  txRowsLucro: { userId: string; amount: unknown; createdAt: Date }[],
  withdrawLogs: { createdAt: Date; amount: unknown; action: string }[],
  dataInicio: string,
): Array<{ label: string; valor: number }> {
  const ymd = parseYmdSp(dataInicio).startOf('day').format('YYYY-MM-DD');
  const lucroPorHora = new Map<number, number>();
  for (const tx of txRowsLucro) {
    const d = dayjs(tx.createdAt).tz(TZ);
    if (d.format('YYYY-MM-DD') !== ymd) continue;
    const h = d.hour();
    const l = lucroSimpayUmaTransacaoConsolidado(tx);
    lucroPorHora.set(h, (lucroPorHora.get(h) ?? 0) + l);
  }
  const feePorHora = new Map<number, number>();
  const profitPorHora = new Map<number, number>();
  for (const log of withdrawLogs) {
    const d = dayjs(log.createdAt).tz(TZ);
    if (d.format('YYYY-MM-DD') !== ymd) continue;
    const h = d.hour();
    const amt = Number(log.amount);
    if (!Number.isFinite(amt)) continue;
    if (log.action === 'ADMIN_WITHDRAW_FEE_INC') {
      feePorHora.set(h, (feePorHora.get(h) ?? 0) + amt);
    } else if (log.action === 'ADMIN_WITHDRAW_PROFIT_INC') {
      profitPorHora.set(h, (profitPorHora.get(h) ?? 0) + amt);
    }
  }
  return Array.from({ length: 24 }, (_, h) => {
    const v =
      (lucroPorHora.get(h) ?? 0) +
      (profitPorHora.get(h) ?? 0) -
      (feePorHora.get(h) ?? 0);
    return {
      label: `${String(h).padStart(2, '0')}h`,
      valor: Number(v.toFixed(2)),
    };
  });
}

/** Série enriquecida para o dashboard admin (gráfico de resumo financeiro). */
type DashboardFinanceHistoricoRow = {
  label: string;
  valorBruto: number;
  valorLiquido: number;
  lucroSimpay: number;
  cashback: number;
  taxaSaque: number;
  lucroSaque: number;
};

function accumTxFinancePorDia(
  txRowsLucro: {
    userId: string;
    amount: unknown;
    netAmount: unknown | null;
    createdAt: Date;
  }[],
): {
  bruto: Map<string, number>;
  liquido: Map<string, number>;
  lucro: Map<string, number>;
  cashback: Map<string, number>;
} {
  const bruto = new Map<string, number>();
  const liquido = new Map<string, number>();
  const lucro = new Map<string, number>();
  const cashback = new Map<string, number>();
  for (const tx of txRowsLucro) {
    const ymd = dayjs(tx.createdAt).tz(TZ).format('YYYY-MM-DD');
    const platform = CONSOLIDADO_PLATFORMS.find((p) => p.id === tx.userId);
    const tag = platform?.tag || 'RENOVADA';
    const b = Number(tx.amount);
    if (Number.isFinite(b)) {
      bruto.set(ymd, (bruto.get(ymd) ?? 0) + b);
    }
    const liq = valorLiquidoTransacaoConsolidado(tx, tag);
    liquido.set(ymd, (liquido.get(ymd) ?? 0) + liq);
    const l = lucroSimpayUmaTransacaoConsolidado(tx);
    lucro.set(ymd, (lucro.get(ymd) ?? 0) + l);
    const tc = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK', 3.0);
    cashback.set(ymd, (cashback.get(ymd) ?? 0) + tc);
  }
  return { bruto, liquido, lucro, cashback };
}

function accumWithdrawPorDia(
  withdrawLogs: { createdAt: Date; amount: unknown; action: string }[],
): { fee: Map<string, number>; profit: Map<string, number> } {
  const fee = new Map<string, number>();
  const profit = new Map<string, number>();
  for (const log of withdrawLogs) {
    const ymd = dayjs(log.createdAt).tz(TZ).format('YYYY-MM-DD');
    const amt = Number(log.amount);
    if (!Number.isFinite(amt)) continue;
    if (log.action === 'ADMIN_WITHDRAW_FEE_INC') {
      fee.set(ymd, (fee.get(ymd) ?? 0) + amt);
    } else if (log.action === 'ADMIN_WITHDRAW_PROFIT_INC') {
      profit.set(ymd, (profit.get(ymd) ?? 0) + amt);
    }
  }
  return { fee, profit };
}

function buildDashboardFinanceHistoricoDiario(
  txRowsLucro: {
    userId: string;
    amount: unknown;
    netAmount: unknown | null;
    createdAt: Date;
  }[],
  withdrawLogs: { createdAt: Date; amount: unknown; action: string }[],
  dataInicio: string,
  dataFim: string,
): DashboardFinanceHistoricoRow[] {
  const { bruto, liquido, lucro, cashback } = accumTxFinancePorDia(txRowsLucro);
  const { fee, profit } = accumWithdrawPorDia(withdrawLogs);
  const dias = listYmdInclusiveSp(dataInicio, dataFim);
  return dias.map((ymd) => ({
    label: dayjs.tz(ymd, TZ).format('DD/MM'),
    valorBruto: Number((bruto.get(ymd) ?? 0).toFixed(2)),
    valorLiquido: Number((liquido.get(ymd) ?? 0).toFixed(2)),
    lucroSimpay: Number((lucro.get(ymd) ?? 0).toFixed(2)),
    cashback: Number((cashback.get(ymd) ?? 0).toFixed(2)),
    taxaSaque: Number((fee.get(ymd) ?? 0).toFixed(2)),
    lucroSaque: Number((profit.get(ymd) ?? 0).toFixed(2)),
  }));
}

function buildDashboardFinanceHistoricoPorHora(
  txRowsLucro: {
    userId: string;
    amount: unknown;
    netAmount: unknown | null;
    createdAt: Date;
  }[],
  withdrawLogs: { createdAt: Date; amount: unknown; action: string }[],
  dataInicio: string,
): DashboardFinanceHistoricoRow[] {
  const ymdTarget = parseYmdSp(dataInicio).startOf('day').format('YYYY-MM-DD');
  const bruto = new Map<number, number>();
  const liquido = new Map<number, number>();
  const lucro = new Map<number, number>();
  const cashback = new Map<number, number>();
  for (const tx of txRowsLucro) {
    const d = dayjs(tx.createdAt).tz(TZ);
    if (d.format('YYYY-MM-DD') !== ymdTarget) continue;
    const h = d.hour();
    const platform = CONSOLIDADO_PLATFORMS.find((p) => p.id === tx.userId);
    const tag = platform?.tag || 'RENOVADA';
    const b = Number(tx.amount);
    if (Number.isFinite(b)) {
      bruto.set(h, (bruto.get(h) ?? 0) + b);
    }
    liquido.set(h, (liquido.get(h) ?? 0) + valorLiquidoTransacaoConsolidado(tx, tag));
    lucro.set(h, (lucro.get(h) ?? 0) + lucroSimpayUmaTransacaoConsolidado(tx));
    const tc = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK', 3.0);
    cashback.set(h, (cashback.get(h) ?? 0) + tc);
  }
  const fee = new Map<number, number>();
  const profit = new Map<number, number>();
  for (const log of withdrawLogs) {
    const d = dayjs(log.createdAt).tz(TZ);
    if (d.format('YYYY-MM-DD') !== ymdTarget) continue;
    const h = d.hour();
    const amt = Number(log.amount);
    if (!Number.isFinite(amt)) continue;
    if (log.action === 'ADMIN_WITHDRAW_FEE_INC') {
      fee.set(h, (fee.get(h) ?? 0) + amt);
    } else if (log.action === 'ADMIN_WITHDRAW_PROFIT_INC') {
      profit.set(h, (profit.get(h) ?? 0) + amt);
    }
  }
  return Array.from({ length: 24 }, (_, h) => ({
    label: `${String(h).padStart(2, '0')}h`,
    valorBruto: Number((bruto.get(h) ?? 0).toFixed(2)),
    valorLiquido: Number((liquido.get(h) ?? 0).toFixed(2)),
    lucroSimpay: Number((lucro.get(h) ?? 0).toFixed(2)),
    cashback: Number((cashback.get(h) ?? 0).toFixed(2)),
    taxaSaque: Number((fee.get(h) ?? 0).toFixed(2)),
    lucroSaque: Number((profit.get(h) ?? 0).toFixed(2)),
  }));
}

function mapConsolidadoTxStatusToPt(
  status: TransactionStatus,
): 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'ESTORNADA' {
  switch (status) {
    case TransactionStatus.COMPLETED:
      return 'APROVADA';
    case TransactionStatus.PENDING:
    case TransactionStatus.DRAFT:
      return 'PENDENTE';
    case TransactionStatus.FAILED:
    case TransactionStatus.EXPIRED:
      return 'RECUSADA';
    case TransactionStatus.REFUNDED:
    case TransactionStatus.CHARGEBACK:
      return 'ESTORNADA';
    default:
      return 'PENDENTE';
  }
}

function formatConsolidadoDoc(doc: string | null | undefined): string | null {
  if (!doc) return null;
  const digits = doc.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return doc;
}

@ApiTags('Admin')
@Controller('admin')
//@UseGuards(JwtAuthGuard, RolesGuard)
//@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly listLeads: ListLeadsUseCase,
    private readonly approveLead: ApproveLeadUseCase,
    private readonly rejectLead: RejectLeadUseCase,
    private readonly syncTransactions: SyncDomTransactionsUseCase,
    private readonly listWithdrawalsAdmin: ListWithdrawalsAdminUseCase,
    private readonly approveWithdrawal: ApproveWithdrawalUseCase,
    private readonly rejectWithdrawal: RejectWithdrawalUseCase,
    private readonly syncWithdrawalsUseCase: SyncDomWithdrawalsUseCase,
    private readonly syncFullRenovadaUseCase: SyncFullRenovadaUseCase,
    private readonly syncFullBosqueUseCase: SyncFullBosqueUseCase,
    private readonly syncFullEbookUseCase: SyncFullEbookUseCase,
    private readonly migrateRenovadaTxsToAdmin: MigrateRenovadaTxsToAdminUseCase,
    private readonly listDomTransactionsDirect: ListDomTransactionsDirectUseCase,
    private readonly syncMaquinetasUseCase: SyncMaquinetasUseCase,
    private readonly syncDomTransactionsCron: SyncDomTransactionsCron,
    private readonly revalidaSyncService: RevalidaSyncService,
    private readonly communities: CommunityManagementService,
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
    @Inject(HASH_SERVICE) private readonly hashService: IHashService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: IPaymentGateway,
    @Inject(WALLET_REPOSITORY) private readonly walletRepository: IWalletRepository,
    private readonly platformTaxas: PlatformTaxasService,
    private readonly linkExternal: LinkExternalPlatformUserService,
    private readonly scanPlatformOwners: ScanPlatformOwnersUseCase,
  ) { }

  /**
   * Todas as páginas da listagem DOM no intervalo — mesma fonte que GET /admin/transacoes-dom.
   */
  private async fetchAllDomTransactionsForRelatorio(
    dataInicio?: string,
    dataFim?: string,
  ): Promise<DomTransactionItem[]> {
    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!domToken?.trim()) {
      throw new BadRequestException('DOM_TOKEN / API_DOM_MASTER_KEY não configurado');
    }
    const { begin_date, end_date } = relatorioDomDateRange(dataInicio, dataFim);
    const limit = 150;
    const maxPages = 400;
    const all: DomTransactionItem[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await this.paymentGateway.listDomTransactions(domToken, {
        page,
        limit,
        begin_date,
        end_date,
      });
      const batch = res.transactions ?? [];
      all.push(...batch);
      if (batch.length < limit) break;
    }
    return all;
  }

  private extractOrderNumberFromText(value: string | null | undefined): string | null {
    const raw = String(value ?? '');
    const match = raw.match(/\bORD-\d{4}-\d+\b/i);
    return match ? match[0].toUpperCase() : null;
  }

  private parseDomCreatedAt(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const normalized = String(raw).trim().replace(' ', 'T');
    const withTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)
      ? normalized
      : `${normalized}-03:00`;
    const date = new Date(withTimezone);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // ──────────── LEADS ────────────

  @Get('leads')
  @ApiOperation({ summary: 'Listar solicitações de cadastro' })
  async leads(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: LeadStatus,
  ) {
    const result = await this.listLeads.execute({
      page: Number(page),
      pageSize: Number(pageSize),
      status,
    });
    return {
      data: result.data,
      page: Number(page),
      pageSize: Number(pageSize),
      total: result.total,
    };
  }

  @Post('leads/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprovar solicitação e criar conta do usuário' })
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    const result = await this.approveLead.execute({
      leadId: id,
      adminUserId: user?.sub ?? '',
    });
    return { data: result };
  }

  @Post('leads/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rejeitar solicitação' })
  async reject(@Param('id') id: string, @Body() body: RejectLeadDto) {
    const lead = await this.rejectLead.execute({
      leadId: id,
      reason: body.reason,
    });
    return { data: lead };
  }

  // ──────────── CRIAR CONTA ────────────

  @Post('criar-conta')
  @HttpCode(201)
  @ApiOperation({ summary: 'Criar conta diretamente (admin master) — vincula ao módulo renovada e filtra transações pelo CPF' })
  async criarConta(
    @Body() body: { email: string; password: string; cpf: string },
  ) {
    const { email, password, cpf } = body;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Já existe um usuário com este e-mail');
    }

    const cpfClean = cpf.replace(/\D/g, '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingCpf = await (this.prisma.user as any).findFirst({ where: { cpf: cpfClean } });
    if (existingCpf) {
      throw new ConflictException('Já existe um usuário com este CPF');
    }

    const hashed = await this.hashService.hash(password);

    // Tentar registrar na DOM (falha silenciosa)
    let domUserId: string | null = null;
    let domToken: string | null = null;
    try {
      const name = email.split('@')[0];
      const domReg = await this.paymentGateway.register({ name, email, password });
      const domTok = await this.paymentGateway.generateToken(email, password);
      domUserId = domReg.domUserId ?? null;
      domToken = domTok.domToken ?? null;
    } catch (err: any) {
      // Segue sem conta DOM
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await (this.prisma.user as any).create({
      data: {
        name: email.split('@')[0],
        email,
        password: hashed,
        cpf: cpfClean,
        domUserId: domUserId ?? undefined,
        domToken: domToken ?? undefined,
      },
    });

    await this.walletRepository.createForUser(user.id);

    // Vincula ExternalPlatformUser se o CPF já foi identificado em transações
    await this.linkExternal.linkByCpf(user.id, cpfClean);

    return {
      data: {
        userId: user.id,
        email: user.email,
        cpf: cpfClean,
        modulo: null,
      },
      message: 'Conta do cliente criada com sucesso (Conta Avulsa)',
    };
  }

  // ──────────── USUÁRIOS DE PLATAFORMAS EXTERNAS ────────────

  @Post('usuarios/scan')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dispara varredura manual de donos de plataformas (extrai CPF_DONO das transações)' })
  async scanPlatformOwnersManual() {
    const result = await this.scanPlatformOwners.execute();
    return { data: result };
  }

  @Get('usuarios')
  @ApiOperation({ summary: 'Lista usuários externos por plataforma com saldo líquido' })
  @ApiQuery({ name: 'platform', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, example: 20 })
  async listExternalUsers(
    @Query('platform') platform?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);

    const where = platform ? { platform } : {};

    const [total, items] = await Promise.all([
      this.prisma.externalPlatformUser.count({ where }),
      this.prisma.externalPlatformUser.findMany({
        where,
        include: {
          wallet: true,
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      data: items.map((u) => ({
        id: u.id,
        cpf: u.cpf,
        name: u.name,
        platform: u.platform,
        balance: Number(u.wallet?.balance ?? 0),
        lockedBalance: Number(u.wallet?.lockedBalance ?? 0),
        vinculado: !!u.userId,
        simpayUser: u.user
          ? { id: u.user.id, name: u.user.name, email: u.user.email }
          : null,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      })),
      total,
      page: pageNum,
      pageSize: size,
    };
  }

  @Get('users')
  @ApiOperation({ summary: 'Listar usuários para autocomplete (admin master)' })
  @ApiQuery({ name: 'search', required: false, description: 'Prefixo do e-mail' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, example: 20 })
  async listUsers(
    @Query('search') search = '',
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @CurrentUser() authUser?: JwtPayload,
  ) {
    if (authUser?.sub) {
      const requester = await this.prisma.user.findUnique({
        where: { id: authUser.sub },
        include: { tenantModule: true },
      });
      const requesterIsAdmin = requester?.role === 'ADMIN';
      const requesterIsMaster = requester ? isMasterAdminUser(requester) : false;
      if (!requesterIsAdmin || !requesterIsMaster) {
        throw new ForbiddenException('Somente admin do módulo master pode consultar usuários');
      }
    }

    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 50);
    const term = (search ?? '').trim();

    const where = term
      ? {
        email: {
          startsWith: term,
          mode: 'insensitive' as const,
        },
      }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { email: 'asc' },
        skip: (pageNum - 1) * size,
        take: size,
        select: {
          id: true,
          email: true,
          cpf: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      page: pageNum,
      pageSize: size,
      total,
    };
  }

  // ──────────── COMUNIDADES ────────────

  @Get('comunidades')
  @ApiOperation({ summary: 'Listar comunidades (automáticas e manuais)' })
  async listComunidades(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('search') search = '',
  ) {
    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);
    const where = search.trim()
      ? {
        OR: [
          { name: { contains: search.trim(), mode: 'insensitive' as const } },
          { slug: { contains: search.trim(), mode: 'insensitive' as const } },
        ],
      }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.community.findMany({
        where,
        include: {
          _count: {
            select: { bindings: true, accesses: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
      this.prisma.community.count({ where }),
    ]);

    return { data: items, page: pageNum, pageSize: size, total };
  }

  @Get('relatorios/consolidado/transacoes')
  @ApiOperation({
    summary: 'Listar transações que entram no consolidado (base do cálculo do Lucro Simpay)',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  async listConsolidadoTransacoes(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
    @Query('customerName') customerName?: string,
    @Query('transactionId') transactionId?: string,
    @Query('transactionType') transactionType?: string,
    @Query('paymentLink') paymentLink?: string,
    @Query('planName') planName?: string,
  ) {
    const where = buildConsolidadoTransactionWhere({
      dataInicio,
      dataFim,
      customerName,
      transactionId,
      transactionType,
      paymentLink,
      planName,
    });
    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);
    const tagByUserId = new Map<string, string>(
      CONSOLIDADO_PLATFORMS.map((p) => [p.id, p.tag]),
    );

    const [total, items] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      data: items.map((t) => ({
        id: t.id,
        domTransactionId: t.domTransactionId,
        userId: t.userId,
        plataformaTag: tagByUserId.get(t.userId) ?? '—',
        valor: Number(t.amount),
        valorLiquido: t.netAmount != null ? Number(t.netAmount) : null,
        status: mapConsolidadoTxStatusToPt(t.status),
        metodo: t.paymentMethod,
        descricao: t.description ?? null,
        parcelas: t.installments,
        cliente: {
          nome: t.customerName ?? null,
          email: t.customerEmail ?? null,
          documento: formatConsolidadoDoc(t.customerDocument),
        },
        taxas: {
          total: Number(t.totalFee),
          dom: Number(t.domFee),
          plataforma: Number(t.platformFee),
        },
        criadoEm: t.createdAt.toISOString(),
      })),
      page: pageNum,
      pageSize: size,
      total,
    };
  }

  @Get('relatorios/consolidado')
  @ApiOperation({
    summary: 'Obter resumo financeiro consolidado de todas as plataformas',
    description:
      'Inclui lucroTotalMaster = lucroSimpay + totalLucroSaque − totalTaxaSaque (logs master no mesmo intervalo de data dos saques).',
  })
  @ApiQuery({
    name: 'detalharLucro',
    required: false,
    description:
      'Se true/1: inclui lucroSimpayDetalhe (por plataforma e por transação, com fórmulas).',
  })
  @ApiQuery({
    name: 'detalharLucroSoloResumo',
    required: false,
    description:
      'Com detalharLucro: se true, omite a lista de transações e mantém só subtotais por plataforma.',
  })
  async getConsolidado(
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
    @Query('customerName') customerName?: string,
    @Query('transactionId') transactionId?: string,
    @Query('transactionType') transactionType?: string,
    @Query('paymentLink') paymentLink?: string,
    @Query('planName') planName?: string,
    @Query('detalharLucro') detalharLucro?: string,
    @Query('detalharLucroSoloResumo') detalharLucroSoloResumo?: string,
  ) {
    const platformIds = CONSOLIDADO_PLATFORMS.map((p) => p.id);
    const whereResumo = buildConsolidadoResumoWhere(dataInicio, dataFim);

    const txRowsTodas = await this.prisma.transaction.findMany({
      where: whereResumo,
      select: {
        id: true,
        userId: true,
        amount: true,
        netAmount: true,
        createdAt: true,
        description: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const txRowsLucro = txRowsTodas.filter((t) =>
      transacaoEntraNoLucroSimpayConsolidado(t.amount, t.description),
    );

    const brutoTotal = Number(
      txRowsLucro.reduce((s, t) => s + Number(t.amount), 0).toFixed(2),
    );

    const { totalLucroSimpay, plataformas: plataformasLucroDetalhe } =
      buildLucroSimpayDetalhePorPlataforma(txRowsLucro);

    const querDetalhe =
      detalharLucro === '1' ||
      detalharLucro === 'true' ||
      detalharLucro?.toLowerCase() === 'sim';
    const soloResumo =
      detalharLucroSoloResumo === '1' ||
      detalharLucroSoloResumo === 'true';

    const logDt = masterLogDateFilter(dataInicio, dataFim);
    const masterWithdrawLogBase: Prisma.BalanceLogWhereInput = {
      source: 'MASTER_ADMIN_CONTROL',
      ...(logDt ? { createdAt: logDt } : {}),
    };

    const [feeLogs, feeIncAgg, profitIncAgg] = await Promise.all([
      this.prisma.balanceLog.findMany({
        where: { ...masterWithdrawLogBase, action: 'ADMIN_WITHDRAW_FEE_INC' },
        select: { metadata: true },
      }),
      this.prisma.balanceLog.aggregate({
        where: { ...masterWithdrawLogBase, action: 'ADMIN_WITHDRAW_FEE_INC' },
        _sum: { amount: true },
      }),
      this.prisma.balanceLog.aggregate({
        where: { ...masterWithdrawLogBase, action: 'ADMIN_WITHDRAW_PROFIT_INC' },
        _sum: { amount: true },
      }),
    ]);

    const totalTaxaSaque = Number(feeIncAgg._sum.amount || 0);
    const totalLucroSaque = Number(profitIncAgg._sum.amount || 0);
    const lucroSimpayNum = Number(totalLucroSimpay.toFixed(2));
    const lucroTotalMaster = Number(
      (lucroSimpayNum + totalLucroSaque - totalTaxaSaque).toFixed(2),
    );
    const withdrawIds = [
      ...new Set(
        feeLogs
          .map((l) => (l.metadata as { withdrawId?: string } | null)?.withdrawId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const saquesStats =
      withdrawIds.length === 0
        ? null
        : await this.prisma.withdrawRequest.aggregate({
            where: { id: { in: withdrawIds } },
            _sum: { amount: true },
          });

    const temFiltroData = Boolean(dataInicio?.trim() || dataFim?.trim());

    let valorLiquidoPlataformas: number;
    let valorLiquidoCriterio: string;

    if (temFiltroData) {
      valorLiquidoPlataformas = Number(
        txRowsLucro
          .reduce((s, tx) => {
            const platform = CONSOLIDADO_PLATFORMS.find((p) => p.id === tx.userId);
            const tag = platform?.tag || 'RENOVADA';
            return s + valorLiquidoTransacaoConsolidado(tx, tag);
          }, 0)
          .toFixed(2),
      );
      valorLiquidoCriterio =
        'Com dataInicio/dataFim: soma do líquido das transações elegíveis no período (campo netAmount; se vazio, bruto × *_LIQUIDEZ da plataforma). Alinhado ao valor bruto e ao lucro Simpay do período.';
    } else {
      const platformUsers = await this.prisma.user.findMany({
        where: { id: { in: platformIds } },
        include: { tenantModule: true },
      });
      let snap = 0;
      for (const u of platformUsers) {
        snap += await computeUserNetBalance(
          this.prisma,
          u.id,
          u.tenantModule?.slug,
        );
      }
      valorLiquidoPlataformas = Number(snap.toFixed(2));
      valorLiquidoCriterio =
        'Sem dataInicio/dataFim: soma dos saldos líquidos atuais (netBalance) das contas plataforma no Simpay — não é soma de transações.';
    }

    const estornos = await aggregateEstornosDomPagamentos(
      this.prisma,
      this.paymentGateway,
      platformIds,
      dataInicio,
      dataFim,
    );

    let lucroTotalMasterHistorico: Array<{ label: string; valor: number }> = [];
    let lucroTotalMasterHistoricoCriterio =
      'Com dataInicio/dataFim: um ponto por dia no fuso America/Sao_Paulo. valor = soma do lucro Simpay das transações COMPLETED elegíveis daquele dia + soma ADMIN_WITHDRAW_PROFIT_INC − soma ADMIN_WITHDRAW_FEE_INC nos logs daquele dia (mesma base do lucroTotalMaster agregado).';
    let dashboardFinanceHistorico: DashboardFinanceHistoricoRow[] | undefined;
    const dashboardFinanceHistoricoCriterio =
      'Mesmo recorte de data do consolidado (America/Sao_Paulo). Por dia ou por hora (24h) se um único dia: valorBruto e valorLiquido somam transações elegíveis ao lucro; lucroSimpay = fórmula por transação; cashback = soma da taxa cashback fixa por transação; taxaSaque e lucroSaque vêm dos BalanceLog ADMIN_WITHDRAW_FEE_INC e ADMIN_WITHDRAW_PROFIT_INC naquele dia/hora.';
    if (
      temFiltroData &&
      String(dataInicio ?? '').trim() &&
      String(dataFim ?? '').trim()
    ) {
      const di = String(dataInicio).trim();
      const df = String(dataFim).trim();
      const withdrawLogsHistorico = await this.prisma.balanceLog.findMany({
        where: {
          source: 'MASTER_ADMIN_CONTROL',
          ...(logDt ? { createdAt: logDt } : {}),
          action: {
            in: ['ADMIN_WITHDRAW_FEE_INC', 'ADMIN_WITHDRAW_PROFIT_INC'],
          },
        },
        select: { createdAt: true, amount: true, action: true },
      });
      if (isSingleCalendarDaySp(di, df)) {
        lucroTotalMasterHistorico = buildLucroTotalMasterHistoricoPorHora(
          txRowsLucro,
          withdrawLogsHistorico,
          di,
        );
        lucroTotalMasterHistoricoCriterio =
          'Quando dataInicio e dataFim são o mesmo dia (America/Sao_Paulo): 24 pontos (horas 00h–23h). Mesma fórmula do consolidado diário, agregada por hora do createdAt da transação ou do BalanceLog.';
        dashboardFinanceHistorico = buildDashboardFinanceHistoricoPorHora(
          txRowsLucro,
          withdrawLogsHistorico,
          di,
        );
      } else {
        lucroTotalMasterHistorico = buildLucroTotalMasterHistoricoDiario(
          txRowsLucro,
          withdrawLogsHistorico,
          di,
          df,
        );
        dashboardFinanceHistorico = buildDashboardFinanceHistoricoDiario(
          txRowsLucro,
          withdrawLogsHistorico,
          di,
          df,
        );
      }
    }

    const payload: Record<string, unknown> = {
      valorBruto: brutoTotal,
      valorLiquido: valorLiquidoPlataformas,
      valorLiquidoCriterio,
      lucroSimpay: lucroSimpayNum,
      totalTaxaSaque,
      totalLucroSaque,
      lucroTotalMaster,
      lucroTotalMasterHistorico,
      lucroTotalMasterHistoricoCriterio,
      lucroTotalMasterCriterio:
        'lucroSimpay + totalLucroSaque − totalTaxaSaque. totalTaxaSaque e totalLucroSaque vêm de BalanceLog (source MASTER_ADMIN_CONTROL, ações ADMIN_WITHDRAW_FEE_INC e ADMIN_WITHDRAW_PROFIT_INC), com o mesmo filtro de data que dataInicio/dataFim na URL (igual a GET /admin/relatorios/taxa-saque e /lucro-saque). Sem datas nos logs: soma de todos esses logs.',
      saquesAprovados: {
        quantidade: withdrawIds.length,
        valor: Number(saquesStats?._sum.amount || 0),
      },
      estornos: {
        quantidade: estornos.quantidade,
        valor: estornos.valor,
      },
      ...(dashboardFinanceHistorico && dashboardFinanceHistorico.length > 0
        ? {
            dashboardFinanceHistorico,
            dashboardFinanceHistoricoCriterio,
          }
        : {}),
    };

    if (querDetalhe) {
      const plats = soloResumo
        ? plataformasLucroDetalhe.map((row) => {
            const { transacoes: _lista, ...semLista } = row;
            return semLista;
          })
        : plataformasLucroDetalhe;

      const excluidas = txRowsTodas.filter(
        (t) => !transacaoEntraNoLucroSimpayConsolidado(t.amount, t.description),
      );

      payload.lucroSimpayDetalhe = {
        formula:
          'Por transação: lucro = bruto × (1 − LIQUIDEZ_LOJISTA) − TAXA_FIXA_TRANSACAO − TAXA_CASHBACK. LIQUIDEZ_LOJISTA vem do .env (*_LIQUIDEZ, ex. 0,91 → 9% do bruto para o master).',
        exclusoesDoCalculo: {
          regra:
            'Não entram: bruto ≤ 0; ou descrição contendo "Sincronização de Saldo", "Ajuste Administrativo" ou "balance sync" (ajustes internos, não venda).',
          quantidadeExcluidas: excluidas.length,
          exemplos: excluidas.slice(0, 30).map((t) => ({
            id: t.id,
            createdAt: t.createdAt.toISOString(),
            bruto: Number(t.amount),
            descricao: t.description,
            motivo:
              Number(t.amount) <= 0 || !Number.isFinite(Number(t.amount))
                ? 'bruto_zero_ou_invalido'
                : 'ajuste_ou_sincronizacao',
          })),
        },
        periodo: {
          dataInicio: dataInicio ?? null,
          dataFim: dataFim ?? null,
          fuso: TZ,
          observacao:
            dataInicio || dataFim
              ? 'Somente transações com createdAt nesse intervalo (início/fim do dia em America/Sao_Paulo). Valor líquido total = soma do líquido dessas transações elegíveis (ver valorLiquidoCriterio na raiz da resposta).'
              : 'Sem dataInicio/dataFim na URL: entram todas as transações COMPLETED das contas do consolidado (sem limite de data). Para ver só um dia (ex. 31/03), envie dataInicio=2026-03-31&dataFim=2026-03-31.',
        },
        valorLiquidoCriterio,
        transacoesConsideradas: txRowsLucro.length,
        lucroSimpayTotal: Number(totalLucroSimpay.toFixed(2)),
        plataformas: plats,
        soloResumoPlataforma: soloResumo,
      };
    }

    return payload;
  }

  @Get('relatorios/taxa-saque')
  @ApiOperation({ summary: 'Obter total de taxa de saque (admin master)' })
  async getTaxaSaque(
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    const logDt = masterLogDateFilter(dataInicio, dataFim);
    const feeInc = await this.prisma.balanceLog.aggregate({
      where: {
        action: 'ADMIN_WITHDRAW_FEE_INC',
        source: 'MASTER_ADMIN_CONTROL',
        ...(logDt ? { createdAt: logDt } : {}),
      },
      _sum: { amount: true },
    });

    return {
      totalTaxaSaque: Number(feeInc._sum.amount || 0),
    };
  }

  @Get('relatorios/lucro-saque')
  @ApiOperation({ summary: 'Obter total de lucro de saque (admin master)' })
  async getLucroSaque(
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    const logDt = masterLogDateFilter(dataInicio, dataFim);
    const profitInc = await this.prisma.balanceLog.aggregate({
      where: {
        action: 'ADMIN_WITHDRAW_PROFIT_INC',
        source: 'MASTER_ADMIN_CONTROL',
        ...(logDt ? { createdAt: logDt } : {}),
      },
      _sum: { amount: true },
    });

    return {
      totalLucroSaque: Number(profitInc._sum.amount || 0),
    };
  }

  @Get('relatorios/quantidade-usuarios-externos')
  @ApiOperation({
    summary: 'Total de usuários de plataformas (cadastro externo)',
    description:
      'Mesmo total retornado em GET /admin/usuarios (`total`), contagem de registros em ExternalPlatformUser. Filtro opcional `platform` igual à listagem.',
  })
  @ApiQuery({ name: 'platform', required: false })
  async getQuantidadeUsuariosExternos(@Query('platform') platform?: string) {
    const where = platform ? { platform } : {};
    const total = await this.prisma.externalPlatformUser.count({ where });
    return { total };
  }

  @Get('relatorios/total-repasse')
  @ApiOperation({
    summary: 'Total de repasse (líquido consolidado − lucro Simpay)',
    description:
      'totalRepasse = valorLiquido − lucroSimpay, com a mesma base de transações e critérios de GET /admin/relatorios/consolidado.',
  })
  @ApiQuery({ name: 'dataInicio', required: false, example: '2026-03-01' })
  @ApiQuery({ name: 'dataFim', required: false, example: '2026-03-31' })
  async getTotalRepasse(
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    const platformIds = CONSOLIDADO_PLATFORMS.map((p) => p.id);
    const whereResumo = buildConsolidadoResumoWhere(dataInicio, dataFim);

    const txRowsTodas = await this.prisma.transaction.findMany({
      where: whereResumo,
      select: {
        id: true,
        userId: true,
        amount: true,
        netAmount: true,
        createdAt: true,
        description: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const txRowsLucro = txRowsTodas.filter((t) =>
      transacaoEntraNoLucroSimpayConsolidado(t.amount, t.description),
    );

    const { totalLucroSimpay } = buildLucroSimpayDetalhePorPlataforma(txRowsLucro);
    const lucroSimpayNum = Number(totalLucroSimpay.toFixed(2));

    const temFiltroData = Boolean(dataInicio?.trim() || dataFim?.trim());
    let valorLiquidoPlataformas: number;
    let valorLiquidoCriterio: string;

    if (temFiltroData) {
      valorLiquidoPlataformas = Number(
        txRowsLucro
          .reduce((s, tx) => {
            const platform = CONSOLIDADO_PLATFORMS.find((p) => p.id === tx.userId);
            const tag = platform?.tag || 'RENOVADA';
            return s + valorLiquidoTransacaoConsolidado(tx, tag);
          }, 0)
          .toFixed(2),
      );
      valorLiquidoCriterio =
        'Com dataInicio/dataFim: soma do líquido das transações elegíveis no período (netAmount ou bruto × *_LIQUIDEZ). Igual ao campo valorLiquido do consolidado.';
    } else {
      const platformUsers = await this.prisma.user.findMany({
        where: { id: { in: platformIds } },
        include: { tenantModule: true },
      });
      let snap = 0;
      for (const u of platformUsers) {
        snap += await computeUserNetBalance(
          this.prisma,
          u.id,
          u.tenantModule?.slug,
        );
      }
      valorLiquidoPlataformas = Number(snap.toFixed(2));
      valorLiquidoCriterio =
        'Sem dataInicio/dataFim: soma dos saldos líquidos atuais (netBalance) das contas plataforma — igual ao consolidado; combine com período explícito para repasse alinhado ao lucro Simpay do intervalo.';
    }

    const totalRepasse = Number((valorLiquidoPlataformas - lucroSimpayNum).toFixed(2));

    return {
      totalRepasse,
      valorLiquido: valorLiquidoPlataformas,
      lucroSimpay: lucroSimpayNum,
      valorLiquidoCriterio,
      totalRepasseCriterio:
        'totalRepasse = valorLiquido − lucroSimpay. Transações: COMPLETED das contas do consolidado; lucro exclui ajustes/sincronização (mesma regra do consolidado).',
    };
  }

  @Get('relatorios/transacoes-por-status')
  @ApiOperation({
    summary: 'Distribuição de transações por status (API DOM)',
    description:
      'Agrega a mesma listagem de GET /admin/transacoes-dom (token master). dataInicio/dataFim no formato YYYY-MM-DD, ' +
      'com início 00:00:00 e fim 23:59:59, como na tela de transações admin.',
  })
  @ApiQuery({ name: 'dataInicio', required: false, example: '2026-03-01' })
  @ApiQuery({ name: 'dataFim', required: false, example: '2026-03-31' })
  async getRelatorioTransacoesPorStatus(
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    const txs = await this.fetchAllDomTransactionsForRelatorio(dataInicio, dataFim);
    const mapCount = new Map<DomStatusBucket, number>();
    for (const tx of txs) {
      const bucket = domRawStatusToBucket(tx.status);
      mapCount.set(bucket, (mapCount.get(bucket) ?? 0) + 1);
    }
    const total = txs.length;
    const buckets: DomStatusBucket[] = ['PENDING', 'COMPLETED', 'REFUNDED', 'FAILED'];
    const items = buckets
      .map((codigo) => {
        const quantidade = mapCount.get(codigo) ?? 0;
        const percentual = total > 0 ? Number(((quantidade / total) * 100).toFixed(2)) : 0;
        return {
          codigo,
          nome: DOM_DIST_STATUS_LABEL[codigo],
          quantidade,
          percentual,
        };
      })
      .filter((row) => row.quantidade > 0)
      .sort((a, b) => b.quantidade - a.quantidade);
    return { total, items };
  }

  @Get('relatorios/transacoes-por-metodo')
  @ApiOperation({
    summary: 'Distribuição de transações por método de pagamento (API DOM)',
    description:
      'Mesma fonte que GET /admin/transacoes-dom. Intervalo de datas igual ao card de status.',
  })
  @ApiQuery({ name: 'dataInicio', required: false, example: '2026-03-01' })
  @ApiQuery({ name: 'dataFim', required: false, example: '2026-03-31' })
  async getRelatorioTransacoesPorMetodo(
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    const txs = await this.fetchAllDomTransactionsForRelatorio(dataInicio, dataFim);
    const mapCount = new Map<DomMethodBucket, number>();
    for (const tx of txs) {
      const bucket = domPaymentMethodToBucket(tx.payment_method);
      mapCount.set(bucket, (mapCount.get(bucket) ?? 0) + 1);
    }
    const total = txs.length;
    const buckets: DomMethodBucket[] = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD'];
    const items = buckets
      .map((codigo) => {
        const quantidade = mapCount.get(codigo) ?? 0;
        const percentual = total > 0 ? Number(((quantidade / total) * 100).toFixed(2)) : 0;
        return {
          codigo,
          nome: DOM_DIST_METHOD_LABEL[codigo],
          quantidade,
          percentual,
        };
      })
      .filter((row) => row.quantidade > 0)
      .sort((a, b) => b.quantidade - a.quantidade);
    return { total, items };
  }

  @Post('comunidades')
  @ApiOperation({ summary: 'Criar comunidade manualmente' })
  async createComunidade(
    @Body() body: { name: string; slug?: string; description?: string; isActive?: boolean },
  ) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('Nome da comunidade é obrigatório');
    const slugBase = (body.slug ?? name).trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slugBase) throw new BadRequestException('Slug inválido');

    const already = await this.prisma.community.findUnique({ where: { slug: slugBase } });
    if (already) {
      throw new ConflictException(`Já existe uma comunidade com slug "${slugBase}"`);
    }

    const created = await this.prisma.community.create({
      data: {
        name,
        slug: slugBase,
        description: body.description?.trim() || null,
        source: 'MANUAL',
        isActive: body.isActive ?? true,
      },
    });
    return { data: created };
  }

  @Put('comunidades/:id')
  @ApiOperation({ summary: 'Atualizar comunidade' })
  async updateComunidade(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; isActive?: boolean },
  ) {
    const existing = await this.prisma.community.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Comunidade não encontrada');
    const updated = await this.prisma.community.update({
      where: { id },
      data: {
        name: body.name?.trim() || existing.name,
        description: body.description?.trim() ?? existing.description,
        isActive: body.isActive ?? existing.isActive,
      },
    });
    return { data: updated };
  }

  @Delete('comunidades/:id')
  @ApiOperation({ summary: 'Excluir comunidade' })
  async deleteComunidade(@Param('id') id: string) {
    const existing = await this.prisma.community.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Comunidade não encontrada');
    await this.prisma.community.delete({ where: { id } });
    return { success: true };
  }

  @Get('comunidades/:id/resumo')
  @ApiOperation({ summary: 'Resumo da comunidade: status, dias e métricas' })
  async comunidadeResumo(@Param('id') id: string) {
    const community = await this.prisma.community.findUnique({
      where: { id },
      include: {
        bindings: true,
        accesses: true,
        _count: {
          select: {
            accesses: true,
            events: true,
          },
        },
      },
    });
    if (!community) throw new NotFoundException('Comunidade não encontrada');

    const now = new Date();
    const activeAccesses = community.accesses.filter(a => a.isActive && a.expiresAt > now);
    const expiredAccesses = community.accesses.filter(a => !a.isActive || a.expiresAt <= now);
    const minDays = activeAccesses.length
      ? Math.min(
        ...activeAccesses.map(a => Math.max(0, Math.floor((a.expiresAt.getTime() - now.getTime()) / 86400000))),
      )
      : 0;

    return {
      data: {
        id: community.id,
        name: community.name,
        slug: community.slug,
        source: community.source,
        isActive: community.isActive,
        bindings: community.bindings.length,
        accessesTotal: community._count.accesses,
        accessesActive: activeAccesses.length,
        accessesExpired: expiredAccesses.length,
        minDaysRemaining: minDays,
      },
    };
  }

  @Get('comunidades/:id/assinantes')
  @ApiOperation({ summary: 'Listar assinantes/acessos da comunidade' })
  async comunidadeAssinantes(
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('nome') nome?: string,
    @Query('cpf') cpf?: string,
    @Query('email') email?: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);

    const community = await this.prisma.community.findUnique({
      where: { id },
      include: {
        bindings: {
          where: { subscriptionLinkId: { not: null } },
          include: {
            subscriptionLink: {
              include: {
                subscriptions: {
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
        },
      },
    });
    if (!community) throw new NotFoundException('Comunidade não encontrada');

    const mapFrequencyToDays = (frequencyType: string) => {
      if (frequencyType === 'TRIMESTRAL') return 90;
      if (frequencyType === 'SEMESTRAL') return 180;
      if (frequencyType === 'ANUAL') return 365;
      return 30;
    };

    const allRows = community.bindings.flatMap((binding) => {
      const link = binding.subscriptionLink;
      if (!link) return [];
      return link.subscriptions.map((sub) => {
        const createdAt = sub.createdAt;
        const normalized = (sub.status ?? '').toLowerCase();
        const isPaidOrActive = ['active', 'completed', 'approved', 'paid', 'success', 'trial'].includes(normalized);
        const isPending = ['pending', 'waiting', 'waiting_payment', 'processing', 'pix_pending'].includes(normalized);
        const renewAt = isPaidOrActive
          ? new Date(createdAt.getTime() + mapFrequencyToDays(link.frequencyType) * 86400000)
          : null;

        const statusLabel = isPaidOrActive ? 'Ativo' : isPending ? 'Pendente' : 'Inativo';
        return {
          id: sub.id,
          nome: sub.customerName,
          email: sub.customerEmail,
          cpf: sub.customerDocument,
          telefone: sub.customerPhone,
          dataAssinatura: createdAt,
          dataRenovacao: renewAt,
          status: statusLabel,
        };
      });
    });

    const filtered = allRows.filter((row) => {
      const nomeMatch = !nome?.trim() || row.nome?.toLowerCase().includes(nome.trim().toLowerCase());
      const emailMatch = !email?.trim() || row.email?.toLowerCase().includes(email.trim().toLowerCase());
      const cpfDigits = (cpf ?? "").replace(/\D/g, "");
      const rowCpfDigits = (row.cpf ?? "").replace(/\D/g, "");
      const cpfMatch = !cpfDigits || rowCpfDigits.includes(cpfDigits);

      const start = dataInicio ? new Date(`${dataInicio}T00:00:00`) : null;
      const end = dataFim ? new Date(`${dataFim}T23:59:59`) : null;
      const assinaturaDate = row.dataAssinatura ? new Date(row.dataAssinatura) : null;
      const dateMatch = !assinaturaDate
        ? true
        : (!start || assinaturaDate >= start) && (!end || assinaturaDate <= end);

      return Boolean(nomeMatch && emailMatch && cpfMatch && dateMatch);
    });

    const total = filtered.length;
    const rows = filtered.slice((pageNum - 1) * size, pageNum * size);

    return {
      data: rows,
      page: pageNum,
      pageSize: size,
      total,
    };
  }

  @Post('comunidades/:id/vinculos')
  @ApiOperation({ summary: 'Vincular link manualmente a uma comunidade' })
  async bindComunidade(
    @Param('id') communityId: string,
    @Body() body: { type: 'SUBSCRIPTION_LINK' | 'PAYMENT_LINK'; linkId: string },
  ) {
    const community = await this.prisma.community.findUnique({ where: { id: communityId } });
    if (!community) throw new NotFoundException('Comunidade não encontrada');
    if (!body?.linkId) throw new BadRequestException('linkId é obrigatório');

    if (body.type === 'SUBSCRIPTION_LINK') {
      const rawLinkId = body.linkId.trim();
      const link = await this.prisma.subscriptionLink.findFirst({
        where: {
          OR: [
            { id: rawLinkId },
            { code: rawLinkId },
            { domPlanId: rawLinkId },
          ],
        },
        select: { id: true },
      });
      if (!link) {
        throw new BadRequestException(
          'Link de assinatura não encontrado. Informe o ID interno, código do link ou domPlanId.',
        );
      }

      const result = await this.communities.bindSubscriptionLinkManually({
        communityId,
        subscriptionLinkId: link.id,
      });
      return { data: result };
    }

    const result = await this.communities.bindPaymentLinkManually({
      communityId,
      paymentLinkId: body.linkId,
    });
    return { data: result };
  }

  @Delete('comunidades/:id/vinculos/:bindingId')
  @ApiOperation({ summary: 'Remover vínculo de comunidade' })
  async unbindComunidade(
    @Param('id') communityId: string,
    @Param('bindingId') bindingId: string,
  ) {
    const binding = await this.prisma.communityLinkBinding.findFirst({
      where: { id: bindingId, communityId },
    });
    if (!binding) throw new NotFoundException('Vínculo não encontrado');
    await this.communities.unbind(bindingId);
    return { success: true };
  }

  @Post('sync-transactions')
  @HttpCode(200)
  @ApiOperation({ summary: 'Importar transações da conta Dom para o banco local' })
  async syncTransactionsRoute(@CurrentUser() user: JwtPayload | undefined) {
    const result = await this.syncTransactions.execute({ userId: user?.sub ?? '' });
    return { data: result };
  }

  @Post('sync-withdrawals')
  @HttpCode(200)
  @ApiOperation({ summary: 'Importar saques da conta Dom para o banco local' })
  async syncWithdrawalsRoute(@CurrentUser() user: JwtPayload | undefined) {
    const result = await this.syncWithdrawalsUseCase.execute({ userId: user?.sub ?? '' });
    return { data: result };
  }

  @Post('sync/cleanup-renovada')
  @HttpCode(200)
  @ApiOperation({ summary: 'Limpar transações incorretas da Renovada (vindas do master token) antes de re-sincronizar' })
  async cleanupRenovada() {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    // Contar antes
    const countBefore = await this.prisma.transaction.count({ where: { userId: RENOVADA_ID } });

    // Limpar domToken do user (era master token, causava sync de TODAS plataformas)
    await this.prisma.user.update({
      where: { id: RENOVADA_ID },
      data: { domToken: null },
    }).catch(() => { /* user pode não existir ainda */ });

    // Deletar histórico de status dessas transações
    const renovadaTxIds = await this.prisma.transaction.findMany({
      where: { userId: RENOVADA_ID },
      select: { id: true },
    });

    if (renovadaTxIds.length > 0) {
      await this.prisma.transactionStatusHistory.deleteMany({
        where: { transactionId: { in: renovadaTxIds.map(t => t.id) } },
      });
    }

    // Deletar todas as transações da Renovada
    const deleted = await this.prisma.transaction.deleteMany({
      where: { userId: RENOVADA_ID },
    });

    // Zerar carteira
    await this.prisma.wallet.update({
      where: { userId: RENOVADA_ID },
      data: { balance: 0, lockedBalance: 0, version: { increment: 1 } },
    }).catch(() => { /* wallet pode não existir */ });

    return {
      message: `Limpeza concluída. ${deleted.count} transações removidas. domToken zerado. Execute /admin/sync/full-renovada para re-sincronizar.`,
      deletedCount: deleted.count,
      countBefore,
    };
  }

  @Post('sync/cleanup-ebook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remover transações do EBOOK importadas via legado api-dom' })
  async cleanupEbook() {
    const EBOOK_ID = process.env.EBOOK_ID || 'd4fbf80f-6f13-4bc6-8e15-ebook00000001';

    const whereEbookImported: Prisma.TransactionWhereInput = {
      AND: [
        {
          OR: [
            { userId: EBOOK_ID },
            { description: { contains: '[TENANT:EBOOK]', mode: 'insensitive' } },
          ],
        },
        {
          OR: [
            { domPaymentId: { not: null } },
            { domTransactionId: { not: null } },
          ],
        },
      ],
    };

    const txBefore = await this.prisma.transaction.count({ where: whereEbookImported });
    const wdBefore = await this.prisma.withdrawRequest.count({
      where: { userId: EBOOK_ID, domWithdrawId: { not: null } },
    });

    const txRows = await this.prisma.transaction.findMany({
      where: whereEbookImported,
      select: { id: true },
    });
    const txIds = txRows.map((t) => t.id);

    if (txIds.length > 0) {
      await this.prisma.transactionStatusHistory.deleteMany({
        where: { transactionId: { in: txIds } },
      });
      await this.prisma.pixPlanOrder.deleteMany({
        where: { transactionId: { in: txIds } },
      });
    }

    const deletedTx = await this.prisma.transaction.deleteMany({
      where: whereEbookImported,
    });

    const deletedWd = await this.prisma.withdrawRequest.deleteMany({
      where: { userId: EBOOK_ID, domWithdrawId: { not: null } },
    });

    await this.prisma.wallet.update({
      where: { userId: EBOOK_ID },
      data: { balance: 0, lockedBalance: 0, version: { increment: 1 } },
    }).catch(() => { /* wallet pode não existir */ });

    return {
      message: `Limpeza EBOOK concluída. ${deletedTx.count} transações e ${deletedWd.count} saques removidos.`,
      ebookId: EBOOK_ID,
      transactionsBefore: txBefore,
      withdrawalsBefore: wdBefore,
      transactionsDeleted: deletedTx.count,
      withdrawalsDeleted: deletedWd.count,
      nextStep: 'Execute /admin/sync/full-ebook para sincronizar novamente com os tokens corretos.',
    };
  }

  @Post('sync/full-renovada')
  @ApiOperation({ summary: 'Sincronização completa de histórico (Renovada 12) - puxa do api-dom' })
  async syncFullRenovada() {
    return this.syncFullRenovadaUseCase.execute();
  }

  @Post('sync/full-bosque')
  @ApiOperation({ summary: 'Sincronização completa de histórico (Bosque) - puxa da DOM Pagamentos' })
  async syncFullBosque() {
    return this.syncFullBosqueUseCase.execute();
  }

  @Post('sync/full-ebook')
  @ApiOperation({ summary: 'Sincronização completa de histórico (EBOOK) - legado api-dom' })
  async syncFullEbook() {
    return this.syncFullEbookUseCase.execute();
  }

  @Post('sync/full-revalida')
  @ApiOperation({ summary: 'Sincronização completa de histórico (Revalida) - puxa da DOM Pagamentos' })
  async syncFullRevalida() {
    return this.revalidaSyncService.syncFull();
  }

  @Post('sync/sync-wallet-renovada')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Definir saldo base da carteira Renovada (execução única para inicializar o saldo correto)',
    description:
      'Define wallet em bruto = balance/fator. Remove saques APPROVED/COMPLETED antigos para não distorcer o /auth/me (fórmula com debitedBruto). Saques PENDING são mantidos.',
  })
  @ApiQuery({ name: 'balance', required: true, description: 'Saldo base a definir (ex: 3840.70)', example: 3840.70 })
  async syncWalletRenovada(@Query('balance') balanceParam?: string) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    try {
      const wallet = await this.prisma.wallet.findUnique({ where: { userId: RENOVADA_ID } });
      if (!wallet) {
        return { message: 'Wallet da Renovada não encontrada no simpay' };
      }

      const oldBalance = Number(wallet.balance);

      if (!balanceParam) {
        return {
          message: 'Forneça o saldo base via query: ?balance=3840.70. Este endpoint define o saldo inicial; a partir daí o saldo é gerenciado incrementalmente.',
          currentBalance: oldBalance,
        };
      }

      // O valor informado é o netBalance desejado (saldo líquido exibido).
      // wallet.balance armazena o valor bruto: netBalance / fatorLiquidez.
      const fatorLiquidez = Number(process.env.RENOVADA_LIQUIDEZ || 0.91);
      const netBalance = Number(balanceParam);
      const grossBalance = netBalance / fatorLiquidez;

      const removedWithdraws = await this.prisma.$transaction(async (tx) => {
        const del = await tx.withdrawRequest.deleteMany({
          where: {
            userId: RENOVADA_ID,
            status: { in: [WithdrawStatus.APPROVED, WithdrawStatus.COMPLETED] },
          },
        });

        await tx.wallet.update({
          where: { userId: RENOVADA_ID },
          data: { balance: String(grossBalance), version: { increment: 1 } },
        });

        await tx.balanceLog.create({
          data: {
            userId: RENOVADA_ID,
            action: 'WALLET_RECALCULATE',
            amount: grossBalance - oldBalance,
            balanceBefore: oldBalance,
            balanceAfter: grossBalance,
            lockedBefore: wallet.lockedBalance,
            lockedAfter: wallet.lockedBalance,
            description: `Saldo base definido manualmente. netBalance: R$ ${netBalance.toFixed(2)}, bruto armazenado: R$ ${grossBalance.toFixed(2)}`,
            source: 'ADMIN_SYNC',
            metadata: {
              oldBalance,
              netBalance,
              grossBalance,
              fatorLiquidez,
              setManually: true,
              removedApprovedOrCompletedWithdraws: del.count,
            },
          },
        });

        return del.count;
      });

      return {
        message: 'Saldo base definido com sucesso. A partir de agora o saldo é atualizado incrementalmente (novas transações e saques).',
        before: { balance: oldBalance },
        after: { grossBalance, netBalance },
        removedApprovedOrCompletedWithdraws: removedWithdraws,
      };
    } catch (error: any) {
      return { message: `Erro ao definir saldo: ${error.message}` };
    }
  }

  @Post('sync/sync-wallet-bosque')
  @HttpCode(200)
  @ApiOperation({ summary: 'Definir saldo base da carteira Bosque (execução única para inicializar o saldo correto)' })
  @ApiQuery({ name: 'balance', required: true, description: 'Saldo líquido (netBalance) a exibir (ex: 554.08). Será convertido para bruto internamente.', example: 554.08 })
  async syncWalletBosque(@Query('balance') balanceParam?: string) {
    const BOSQUE_ID = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';

    try {
      const wallet = await this.prisma.wallet.findUnique({ where: { userId: BOSQUE_ID } });
      if (!wallet) {
        return { message: 'Wallet do Bosque não encontrada no simpay' };
      }

      const oldBalance = Number(wallet.balance);

      if (!balanceParam) {
        return {
          message: 'Forneça o saldo líquido via query: ?balance=554.08. Será convertido para bruto (netBalance / fatorLiquidez).',
          currentBalance: oldBalance,
        };
      }

      // O valor informado é o netBalance desejado (saldo líquido exibido).
      // wallet.balance armazena o valor bruto: netBalance / fatorLiquidez.
      const fatorLiquidez = Number(process.env.BOSQUE_LIQUIDEZ || 0.91);
      const netBalance = Number(balanceParam);
      const grossBalance = netBalance / fatorLiquidez;

      await this.prisma.wallet.update({
        where: { userId: BOSQUE_ID },
        data: { balance: String(grossBalance), version: { increment: 1 } },
      });

      await this.prisma.balanceLog.create({
        data: {
          userId: BOSQUE_ID,
          action: 'WALLET_RECALCULATE',
          amount: grossBalance - oldBalance,
          balanceBefore: oldBalance,
          balanceAfter: grossBalance,
          lockedBefore: wallet.lockedBalance,
          lockedAfter: wallet.lockedBalance,
          description: `Saldo base Bosque definido manualmente. netBalance: R$ ${netBalance.toFixed(2)}, bruto armazenado: R$ ${grossBalance.toFixed(2)}`,
          source: 'ADMIN_SYNC',
          metadata: { oldBalance, netBalance, grossBalance, fatorLiquidez, setManually: true },
        },
      });

      return {
        message: 'Saldo base do Bosque definido com sucesso. A partir de agora o saldo é atualizado incrementalmente.',
        before: { balance: oldBalance },
        after: { grossBalance, netBalance },
      };
    } catch (error: any) {
      return { message: `Erro ao definir saldo: ${error.message}` };
    }
  }

  @Post('sync/sync-wallet-revalida')
  @HttpCode(200)
  @ApiOperation({ summary: 'Definir saldo base da carteira Revalida (execução única)' })
  @ApiQuery({ name: 'balance', required: true, description: 'Saldo líquido (ex: 1200.50)', example: 1200.50 })
  async syncWalletRevalida(@Query('balance') balanceParam?: string) {
    if (!balanceParam) return { message: 'Informe o saldo via query ?balance=...' };
    return this.revalidaSyncService.setWalletBalance(Number(balanceParam));
  }

  @Post('migrar-transacoes-para-admin')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Migra transações incorretamente atribuídas à Renovada para o Admin (executa uma vez)',
  })
  async migrarTransacoesParaAdmin() {
    const result = await this.migrateRenovadaTxsToAdmin.execute();
    return { data: result };
  }

  @Get('transacoes-dom')
  @ApiOperation({ summary: 'Lista transações diretamente da API DOM (conta master) sem passar pelo banco' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'begin_date', required: false, example: '2025-01-01', description: 'yyyy-mm-dd' })
  @ApiQuery({ name: 'end_date', required: false, example: '2025-12-31', description: 'yyyy-mm-dd' })
  @ApiQuery({ name: 'status', required: false, description: 'paid | pending | failed | refunded | expired' })
  @ApiQuery({ name: 'payment_method', required: false, description: 'pix | credit_card' })
  async transacoesDom(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('begin_date') begin_date?: string,
    @Query('end_date') end_date?: string,
    @Query('status') status?: string,
    @Query('payment_method') payment_method?: string,
  ) {
    const result = await this.listDomTransactionsDirect.execute({
      page: Number(page),
      limit: Number(limit),
      begin_date,
      end_date,
      status,
      payment_method,
    });
    return { data: result };
  }

  @Post('sync/test-cron')
  @HttpCode(200)
  @ApiOperation({ summary: 'Testar sincronização automática do cron (executa mesma lógica do cron)' })
  async testCronSync() {
    try {
      await this.syncDomTransactionsCron.handleSync();
      return {
        success: true,
        message: 'Sincronização do cron executada com sucesso'
      };
    } catch (error) {
      return {
        success: false,
        message: 'Erro na sincronização',
        error: error.message
      };
    }
  }

  // ──────────── SAQUES ────────────

  @Get('saques')
  @ApiOperation({ summary: 'Listar todos os saques (admin)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, example: 20 })
  @ApiQuery({ name: 'status', required: false, enum: WithdrawStatus })
  @ApiQuery({ name: 'modulo', required: false, description: 'Slug do módulo (ex: revalida)' })
  @ApiQuery({ name: 'search', required: false, description: 'Buscar por id, nome ou email do usuário' })
  async saques(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: WithdrawStatus,
    @Query('modulo') modulo?: string,
    @Query('userId') userId?: string,
    @Query('search') search?: string,
  ) {
    return this.listWithdrawalsAdmin.execute({
      page: Number(page),
      pageSize: Number(pageSize),
      status,
      moduleSlug: modulo,
      userId,
      search,
    });
  }

  @Get('saques/user')
  @ApiOperation({ summary: 'Listar saques de um específico usuário (conforme API DOM)' })
  async saquesUser(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('status') status?: WithdrawStatus,
    @Query('userId') userId?: string,
  ) {
    return this.listWithdrawalsAdmin.execute({
      page: Number(page),
      pageSize: Number(limit),
      status,
      userId,
    });
  }

  @Post('saques/:id/aprovar')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Aprovar saque com upload de comprovante' })
  async aprovarSaque(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('receiptImage') receiptImageUrl?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    let finalUrl = receiptImageUrl;

    if (file) {
      finalUrl = await this.storageService.uploadFile(file, 'comprovantes-saque');
    }

    return this.approveWithdrawal.execute(id, finalUrl, user?.sub);
  }

  @Post('saques/:id/rejeitar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rejeitar saque e desbloquear saldo' })
  async rejeitarSaque(
    @Param('id') id: string,
    @Body() body: RejectWithdrawalDto,
  ) {
    return this.rejectWithdrawal.execute(id, body.motivo);
  }

  // ──────────── RENOVADA: TRANSAÇÕES & RESUMO ────────────
  // Equivalente ao api-dom GET /payments/history

  @Get('renovada/transactions')
  @ApiOperation({ summary: 'Listar transações da Renovada (equivalente ao api-dom /payments/history)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'EXPIRED'] })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'description', required: false })
  async renovadaTransactions(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('description') description?: string,
  ) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      userId: RENOVADA_ID,
      ...(status ? { status: status as TransactionStatus } : {}),
      ...(description && description !== 'ALL' ? { description: { contains: description, mode: 'insensitive' } } : {}),
      ...(startDate || endDate
        ? {
          createdAt: {
            ...(startDate ? { gte: dayjs(startDate).startOf('day').toDate() } : {}),
            ...(endDate ? { lte: dayjs(endDate).endOf('day').toDate() } : {}),
          },
        }
        : {}),
    };

    const [transactions, totalCount] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    // Mapear para formato compatível com admin-renovada12
    const mapped = transactions.map((tx) => ({
      id: tx.id,
      userId: tx.userId,
      amount: Number(tx.amount),
      name: tx.customerName,
      email: tx.customerEmail,
      status: tx.status,
      description: tx.description,
      appliedGlobalFee: false,
      fee: Number(tx.totalFee),
      dom_fee: Number(tx.domFee),
      payment_method: tx.paymentMethod,
      amountWithoutAllFee: Number(tx.netAmount || tx.amount),
      walletId: '',
      createdAt: tx.createdAt.toISOString(),
      paymentId: tx.domPaymentId,
      updatedAt: tx.updatedAt.toISOString(),
    }));

    return {
      transactions: mapped,
      meta: {
        currentPage: pageNum,
        itemsPerPage: limitNum,
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    };
  }

  @Get('renovada/transactions/export')
  @ApiOperation({ summary: 'Exportar todas as transações da Renovada (sem paginação)' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'description', required: false })
  async renovadaTransactionsExport(
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('description') description?: string,
  ) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const where: any = {
      userId: RENOVADA_ID,
      ...(status && status !== 'ALL' ? { status: status as TransactionStatus } : {}),
      ...(description && description !== 'ALL' ? { description: { contains: description, mode: 'insensitive' } } : {}),
      ...(startDate || endDate
        ? {
          createdAt: {
            ...(startDate ? { gte: dayjs(startDate).startOf('day').toDate() } : {}),
            ...(endDate ? { lte: dayjs(endDate).endOf('day').toDate() } : {}),
          },
        }
        : {}),
    };

    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return transactions.map((tx) => ({
      nome: tx.customerName || '',
      data: tx.createdAt.toISOString(),
      tipo: tx.description || '',
      email: tx.customerEmail || '',
      'número de telefone': tx.customerPhone || '',
      documento: tx.customerDocument || '',
      'tipo do documento': 'CPF',
      'método de pagamento': tx.paymentMethod,
      valor: Number(tx.netAmount || tx.amount),
      status: tx.status,
      createdAt: tx.createdAt.toISOString(),
      amountWithoutAllFee: Number(tx.netAmount || tx.amount),
    }));
  }

  // Equivalente ao api-dom GET /payments/summary
  @Get('renovada/summary')
  @ApiOperation({ summary: 'Resumo financeiro da Renovada (equivalente ao api-dom /payments/summary)' })
  async renovadaSummary() {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const [wallet, pendingWithdraws] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId: RENOVADA_ID } }),
      this.prisma.withdrawRequest.findMany({
        where: { userId: RENOVADA_ID, status: 'PENDING' },
      }),
    ]);

    const pendingAmount = pendingWithdraws.reduce(
      (sum, w) => sum + Number(w.amount),
      0,
    );

    const availableBalance = Number(wallet?.balance || 0);
    const lockedBalance = Number(wallet?.lockedBalance || 0);

    return {
      availableBalance,
      pendingWithdraws: pendingAmount,
      lockedBalance,
    };
  }

  // ──────────── MAQUINETAS ────────────

  @Post('sync/maquinetas')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sincronizar transações históricas de maquinetas direto da DOM Pagamentos' })
  async syncMaquinetas() {
    return this.syncMaquinetasUseCase.execute();
  }

  @Post('sync/recalcular-balance-maquinetas')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Recalcular balance da Renovada do zero baseado nas transações de maquineta (amount - domFee)',
    description:
      'Soma amount - domFee de todas as transações COMPLETED de maquineta, desconta saques aprovados/completos e define o wallet.balance correto.',
  })
  async recalcularBalanceMaquinetas() {
    const RENOVADA_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const wallet = await this.prisma.wallet.findUnique({ where: { userId: RENOVADA_ID } });
    if (!wallet) {
      return { message: 'Wallet da Renovada não encontrada' };
    }

    // wallet.balance = netBalance: soma de netAmount de todas as transações COMPLETED
    const aggTxs = await this.prisma.transaction.aggregate({
      where: { userId: RENOVADA_ID, status: TransactionStatus.COMPLETED },
      _sum: { netAmount: true },
      _count: true,
    });

    const totalNet = Number(aggTxs._sum.netAmount ?? 0);

    // Desconta saques aprovados/concluídos
    const saques = await this.prisma.withdrawRequest.aggregate({
      where: {
        userId: RENOVADA_ID,
        status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] },
      },
      _sum: { grossAmount: true },
    });
    const totalSaques = Number(saques._sum.grossAmount ?? 0);

    const newBalance = Math.max(0, totalNet - totalSaques);
    const oldBalance = Number(wallet.balance);

    await this.prisma.wallet.update({
      where: { userId: RENOVADA_ID },
      data: { balance: newBalance, version: { increment: 1 } },
    });

    await this.prisma.balanceLog.create({
      data: {
        userId: RENOVADA_ID,
        action: 'WALLET_RECALCULATE',
        amount: newBalance - oldBalance,
        balanceBefore: oldBalance,
        balanceAfter: newBalance,
        lockedBefore: wallet.lockedBalance,
        lockedAfter: wallet.lockedBalance,
        source: 'ADMIN_RECALC',
        description: `Recálculo: netTotal=${totalNet.toFixed(2)}, saques=${totalSaques.toFixed(2)}`,
      },
    });

    return {
      message: 'Balance recalculado com sucesso',
      details: {
        totalTransacoes: aggTxs._count,
        totalNet: totalNet.toFixed(2),
        totalSaques: totalSaques.toFixed(2),
        balanceAntes: oldBalance.toFixed(2),
        balanceNovo: newBalance.toFixed(2),
      },
    };
  }

  @Get('renovada/machines')
  @ApiOperation({ summary: 'Transações de maquinetas da Renovada (lê do banco local)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async renovadaMachines(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.getMaquinetasFromDb(page, limit, startDate, endDate);
  }

  @Get('maquinetas')
  @ApiOperation({ summary: 'Transações de maquinetas centralizadas (lê do banco local)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getMaquinetas(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.getMaquinetasFromDb(page, limit, startDate, endDate);
  }

  private async getMaquinetasFromDb(
    page: string,
    limit: string,
    startDate?: string,
    endDate?: string,
  ) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    const pageNum = Number(page);
    const limitNum = Math.max(1, Math.min(Number(limit) || 20, 100));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      userId: RENOVADA_ID,
      OR: [
        { description: { contains: 'Terminal:', mode: 'insensitive' } },
        { description: { contains: 'Maquineta', mode: 'insensitive' } },
      ],
      ...(startDate || endDate
        ? {
          createdAt: {
            ...(startDate ? { gte: dayjs(startDate).startOf('day').toDate() } : {}),
            ...(endDate ? { lte: dayjs(endDate).endOf('day').toDate() } : {}),
          },
        }
        : {}),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const mapped = transactions.map((tx) => {
      const netAmt = Number(tx.netAmount);
      const amt = Number(tx.amount);
      const sLabel = tx.status === 'COMPLETED' ? 'Aprovado'
        : tx.status === 'PENDING' ? 'Pendente'
          : tx.status === 'FAILED' ? 'Falhou'
            : tx.status === 'REFUNDED' ? 'Estornado'
              : tx.status;

      return {
        // Camel case
        id: tx.domPaymentId || tx.id,
        domPaymentId: tx.domPaymentId,
        domTransactionId: tx.domTransactionId || null,
        terminal: extractTerminal(tx.description),
        amount: amt,
        liquidAmount: amt,
        netAmount: netAmt,
        netbalancemachine: netAmt,
        status: tx.status.toLowerCase(),
        statusDetails: sLabel,
        paymentMethod: tx.paymentMethod.toLowerCase(),
        installments: tx.installments,
        cardBrand: tx.cardBrand,
        cardBin: tx.cardBin,
        customerName: tx.customerName,
        customerDocument: tx.customerDocument,
        customerEmail: tx.customerEmail,
        customerPhone: tx.customerPhone,
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),

        // Legacy snake_case
        type_operation: 'fisical',
        created_at: tx.createdAt.toISOString(),
        updated_at: tx.updatedAt.toISOString(),
        cod_external: tx.domTransactionId || null,
        liquid_amount: amt,
        profit_minus_tax: netAmt,
        status_details: sLabel,
        payment_method: tx.paymentMethod.toLowerCase(),
        card_brand: tx.cardBrand,
        card_bin: tx.cardBin,
        customer_name: tx.customerName,
        customer_document: tx.customerDocument,
        customer_email: tx.customerEmail,
        customer_phone: tx.customerPhone,
        description: tx.description,
      };
    });

    return {
      transactions: mapped,
      meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    };
  }

  @Delete('renovada/transactions/cleanup-plan-txs')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deletar transações PIX_PLAN_CODE incorretamente atribuídas à Renovada' })
  async cleanupRenovadaPlanTxs() {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const txs = await this.prisma.transaction.findMany({
      where: {
        userId: RENOVADA_ID,
        description: { startsWith: 'PIX_PLAN_CODE:', mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (txs.length === 0) {
      return { success: true, deletedCount: 0, message: 'Nenhuma transação PIX_PLAN_CODE encontrada' };
    }

    const ids = txs.map(t => t.id);

    await this.prisma.transactionStatusHistory.deleteMany({
      where: { transactionId: { in: ids } },
    });

    const deleted = await this.prisma.transaction.deleteMany({
      where: { id: { in: ids } },
    });

    return {
      success: true,
      deletedCount: deleted.count,
      message: `${deleted.count} transações PIX_PLAN_CODE removidas da Renovada`,
    };
  }

  @Delete('renovada/transactions/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deletar uma transação da Renovada' })
  async deleteRenovadaTransaction(@Param('id') id: string) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const tx = await this.prisma.transaction.findFirst({
      where: { id, userId: RENOVADA_ID },
    });

    if (!tx) {
      return { success: false, message: 'Transação não encontrada' };
    }

    // Deletar histórico de status primeiro (FK)
    await this.prisma.transactionStatusHistory.deleteMany({
      where: { transactionId: id },
    });

    await this.prisma.transaction.delete({ where: { id } });

    return { success: true, message: 'Transação deletada com sucesso' };
  }

  // ──────────── RENOVADA: LIMPAR TRANSAÇÕES + RECALCULAR SALDO ────────────

  @Post('renovada/recalcular')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove transações sem dízimo/primícia/oferta do pool Renovada e recalcula o saldo' })
  async renovadaRecalcular() {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const keywordOr = [
      { description: { contains: 'dizimo', mode: 'insensitive' as const } },
      { description: { contains: 'dízimo', mode: 'insensitive' as const } },
      { description: { contains: 'primicia', mode: 'insensitive' as const } },
      { description: { contains: 'primícia', mode: 'insensitive' as const } },
      { description: { contains: 'oferta', mode: 'insensitive' as const } },
    ];

    const whereToDelete = { userId: RENOVADA_ID, NOT: { OR: keywordOr } };

    // 1. Antes de deletar as transações, deletar o histórico de status para evitar violação de FK
    const txsToDelete = await this.prisma.transaction.findMany({
      where: whereToDelete,
      select: { id: true },
    });

    if (txsToDelete.length > 0) {
      await this.prisma.transactionStatusHistory.deleteMany({
        where: { transactionId: { in: txsToDelete.map(t => t.id) } },
      });
    }

    // Agora deletar as transações
    const deleted = await this.prisma.transaction.deleteMany({
      where: whereToDelete,
    });

    // 2. Recalcular saldo com as transações COMPLETED restantes
    // IMPORTANTE: wallet.balance armazena o valor BRUTO (amount).
    const completedTxs = await this.prisma.transaction.aggregate({
      where: { userId: RENOVADA_ID, status: TransactionStatus.COMPLETED, OR: keywordOr },
      _sum: { amount: true },
    });

    const completedWithdraws = await this.prisma.withdrawRequest.aggregate({
      where: {
        userId: RENOVADA_ID,
        status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] },
      },
      _sum: { amount: true },
    });

    const totalReceived = Number(completedTxs._sum.amount || 0);
    const totalWithdrawn = Number(completedWithdraws._sum.amount || 0);
    const calculatedBalance = Math.max(0, totalReceived - totalWithdrawn);
    const netEquivalent = calculatedBalance * 0.91; // Só informativo

    await this.prisma.wallet.update({
      where: { userId: RENOVADA_ID },
      data: { balance: calculatedBalance },
    });

    return {
      message: 'Transações limpas e saldo recalculado (usando valores brutos)',
      transacoesRemovidas: deleted.count,
      grossBalanceRecalculado: calculatedBalance,
      netEquivalent,
      totalRecebidoBruto: totalReceived,
      totalSacado: totalWithdrawn,
    };
  }

  // ──────────── PLATAFORMAS ────────────

  @Get('plataformas/taxas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Taxas por plataforma (.env + overrides em storage) — administradores',
  })
  async listPlatformTaxas() {
    return this.platformTaxas.getTaxasResponse();
  }

  @Patch('plataformas/taxas/:tag')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Persistir overrides de taxas de uma plataforma — administradores',
  })
  async patchPlatformTaxas(
    @Param('tag') tag: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.platformTaxas.patchPlatform(tag, body);
  }

  @Get('plataformas')
  @ApiOperation({ summary: 'Listar plataformas detectadas (via tag [CPF:xxx|TAG] nos planos)' })
  async listPlataformas() {
    const plans = await this.prisma.pixCreditPlan.findMany({
      select: { description: true, userId: true, createdAt: true },
    });

    const map = new Map<
      string,
      {
        tag: string;
        cpf: string;
        planRows: { userId: string; description: string | null }[];
        plansCount: number;
        firstSeen: Date;
      }
    >();

    // Plataformas conhecidas para detecção por texto livre (fallback sem formato padrão)
    const KNOWN_TAGS = ['PAGATG', 'RENOVADA', 'REVALIDA', 'BOSQUE', 'FRENDZ', 'EBOOKSIM', 'EBOOK'];

    for (const p of plans) {
      const desc = p.description ?? '';
      const row = { userId: p.userId, description: p.description };

      // Tenta formato padrão [CPF:xxx|TAG]
      const m = desc.match(PLAN_PLATFORM_CPF_REGEX);
      if (m) {
        const [, cpf, tag] = m;
        const key = normalizePlatformTag(tag);
        const existing = map.get(key);
        if (existing) {
          existing.planRows.push(row);
          existing.plansCount++;
          if (p.createdAt < existing.firstSeen) existing.firstSeen = p.createdAt;
        } else {
          map.set(key, { tag: key, cpf, planRows: [row], plansCount: 1, firstSeen: p.createdAt });
        }
        continue;
      }

      // Fallback: detecta tag conhecida em texto livre e CPF como sequência de dígitos
      const upperDesc = desc.toUpperCase();
      const matchedTag = KNOWN_TAGS.find(t => upperDesc.includes(t));
      if (!matchedTag) continue;
      const cpfDigits = (desc.match(/\d{11,14}/g) ?? []).find(d => d.length >= 11) ?? '';
      if (!cpfDigits) continue;
      const normalizedTag = normalizePlatformTag(matchedTag);

      const existing = map.get(normalizedTag);
      if (existing) {
        existing.planRows.push(row);
        existing.plansCount++;
        if (p.createdAt < existing.firstSeen) existing.firstSeen = p.createdAt;
      } else {
        map.set(normalizedTag, { tag: normalizedTag, cpf: cpfDigits, planRows: [row], plansCount: 1, firstSeen: p.createdAt });
      }
    }

    // Garante que a plataforma RENOVADA apareça na listagem mesmo sem planos tagueados
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    if (!map.has('RENOVADA')) {
      const firstTx = await this.prisma.transaction.findFirst({
        where: { userId: RENOVADA_ID },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      if (firstTx) {
        map.set('RENOVADA', {
          tag: 'RENOVADA',
          cpf: '',
          planRows: [{ userId: RENOVADA_ID, description: 'Plataforma Renovada' }],
          plansCount: 0,
          firstSeen: firstTx.createdAt,
        });
      }
    }

    // Garante que EBOOK apareça quando houver transações tagueadas ou contas do módulo ebook
    if (!map.has('EBOOK')) {
      const ebookModuleUsers = await this.prisma.user.findMany({
        where: {
          OR: [
            { tenantModule: { slug: { equals: 'ebook', mode: 'insensitive' } } },
            { tenantModule: { slug: { equals: 'ebooksim', mode: 'insensitive' } } },
          ],
        },
        select: { id: true },
      });
      const ebookUserIds = ebookModuleUsers.map((u) => u.id);
      const ebookExpandedUserIds = await expandUserIdsByCpf(this.prisma, ebookUserIds);

      const firstEbookTx = await this.prisma.transaction.findFirst({
        where: {
          OR: [
            { description: { contains: TENANT_EBOOK_TAG, mode: 'insensitive' } },
            ...(ebookExpandedUserIds.length > 0 ? [{ userId: { in: ebookExpandedUserIds } }] : []),
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });

      if (firstEbookTx) {
        map.set('EBOOK', {
          tag: 'EBOOK',
          cpf: '',
          planRows: ebookExpandedUserIds.map((id) => ({ userId: id, description: 'Plataforma Ebook' })),
          plansCount: 0,
          firstSeen: firstEbookTx.createdAt,
        });
      } else {
        // Mantém o card de EBOOK visível no módulo master, mesmo antes da primeira transação.
        map.set('EBOOK', {
          tag: 'EBOOK',
          cpf: '',
          planRows: ebookExpandedUserIds.map((id) => ({ userId: id, description: 'Plataforma Ebook' })),
          plansCount: 0,
          firstSeen: new Date(),
        });
      }
    }

    // Garante que PAGATG apareça quando houver transações [TENANT:PAGATG]
    if (!map.has('PAGATG')) {
      const firstPagatgTx = await this.prisma.transaction.findFirst({
        where: { description: { contains: '[TENANT:PAGATG]', mode: 'insensitive' } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      map.set('PAGATG', {
        tag: 'PAGATG',
        cpf: '',
        planRows: [],
        plansCount: 0,
        firstSeen: firstPagatgTx?.createdAt ?? new Date(),
      });
    }

    const result = [];
    for (const v of map.values()) {
      const expandedUserIds = await expandPlatformTransactionUserIds(this.prisma, v.planRows);
      const isTenantTaggedPlatform = v.tag === 'EBOOK' || v.tag === 'PAGATG';

      const whereTx: any =
        isTenantTaggedPlatform
          ? {
              OR: [
                { description: { contains: `[TENANT:${v.tag}]`, mode: 'insensitive' } },
                ...(v.tag === 'EBOOK' && expandedUserIds.length > 0 ? [{ userId: { in: expandedUserIds } }] : []),
              ],
            }
          : { userId: { in: expandedUserIds } };
      if (v.tag === 'RENOVADA') {
        whereTx.OR = [
          { description: { contains: 'dizimo', mode: 'insensitive' } },
          { description: { contains: 'dízimo', mode: 'insensitive' } },
          { description: { contains: 'primicia', mode: 'insensitive' } },
          { description: { contains: 'primícia', mode: 'insensitive' } },
          { description: { contains: 'oferta', mode: 'insensitive' } },
        ];
      } else if (v.tag === 'EBOOK') {
        whereTx.OR = [
          { description: { contains: TENANT_EBOOK_TAG, mode: 'insensitive' } },
          ...(expandedUserIds.length > 0 ? [{ userId: { in: expandedUserIds } }] : []),
          { description: { contains: 'ebook', mode: 'insensitive' } },
        ];
      }

      let totalTx = 0;
      if (isTenantTaggedPlatform) {
        totalTx = await this.prisma.transaction.count({ where: whereTx });
      } else if (expandedUserIds.length > 0) {
        const txCounts = await this.prisma.transaction.groupBy({
          by: ['userId'],
          where: whereTx,
          _count: true,
        });
        const txMap = new Map(txCounts.map((t) => [t.userId, t._count]));
        totalTx = expandedUserIds.reduce((sum, uid) => sum + (txMap.get(uid) ?? 0), 0);
      }
      result.push({
        tag: v.tag,
        cpf: v.cpf,
        plansCount: v.plansCount,
        transactionsCount: totalTx,
        firstSeen: v.firstSeen,
      });
    }

    return { data: result };
  }

  @Get('plataformas/:tag/comunidades')
  @ApiOperation({ summary: 'Listar comunidades vinculadas a links de assinatura de uma plataforma' })
  async listPlataformaComunidades(@Param('tag') tag: string) {
    const slug = tag.toLowerCase();

    // Busca usuários do módulo que corresponde à tag
    const moduleUsers = await this.prisma.user.findMany({
      where: {
        tenantModule: { slug: { contains: slug, mode: 'insensitive' } },
      },
      select: { id: true },
    });
    const userIds = moduleUsers.map((u) => u.id);

    // Busca links de assinatura desses usuários
    const links = await this.prisma.subscriptionLink.findMany({
      where: userIds.length > 0 ? { userId: { in: userIds } } : { id: 'none' },
      select: { id: true, name: true, code: true, isActive: true, amount: true, frequencyType: true, currentUses: true },
    });
    const linkIds = links.map((l) => l.id);

    if (linkIds.length === 0) return { data: [] };

    // Busca comunidades vinculadas
    const bindings = await this.prisma.communityLinkBinding.findMany({
      where: { subscriptionLinkId: { in: linkIds } },
      include: {
        community: {
          include: {
            accesses: {
              select: { isActive: true, expiresAt: true },
            },
          },
        },
        subscriptionLink: {
          select: { id: true, name: true, code: true, amount: true, frequencyType: true, currentUses: true, isActive: true },
        },
      },
    });

    // Agrupa por comunidade
    const communityMap = new Map<string, {
      id: string; name: string; slug: string; isActive: boolean;
      accessesActive: number; accessesExpired: number; minDaysRemaining: number;
      links: { id: string; name: string; code: string; amount: string; frequencyType: string; currentUses: number; isActive: boolean }[];
    }>();

    const now = new Date();
    for (const b of bindings) {
      const c = b.community;
      if (!communityMap.has(c.id)) {
        const active = c.accesses.filter((a) => a.isActive && a.expiresAt > now);
        const expired = c.accesses.filter((a) => !a.isActive || a.expiresAt <= now);
        const minDays = active.length
          ? Math.min(...active.map((a) => Math.max(0, Math.floor((a.expiresAt.getTime() - now.getTime()) / 86400000))))
          : 0;
        communityMap.set(c.id, {
          id: c.id, name: c.name, slug: c.slug, isActive: c.isActive,
          accessesActive: active.length, accessesExpired: expired.length, minDaysRemaining: minDays,
          links: [],
        });
      }
      if (b.subscriptionLink) {
        communityMap.get(c.id)!.links.push({
          id: b.subscriptionLink.id,
          name: b.subscriptionLink.name,
          code: b.subscriptionLink.code,
          amount: String(b.subscriptionLink.amount),
          frequencyType: b.subscriptionLink.frequencyType,
          currentUses: b.subscriptionLink.currentUses,
          isActive: b.subscriptionLink.isActive,
        });
      }
    }

    return { data: Array.from(communityMap.values()) };
  }

  @Get('plataformas/:tag/transacoes')
  @ApiOperation({ summary: 'Listar transações de uma plataforma (por tag)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'dataInicio', required: false })
  @ApiQuery({ name: 'dataFim', required: false })
  @ApiQuery({ name: 'codigoTransacao', required: false })
  @ApiQuery({ name: 'codigoReferencia', required: false })
  @ApiQuery({ name: 'compradorNome', required: false })
  @ApiQuery({ name: 'compradorDocumento', required: false })
  @ApiQuery({ name: 'compradorEmail', required: false })
  @ApiQuery({ name: 'periodType', required: false })
  async listPlataformaTransacoes(
    @Param('tag') tag: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
    @Query('codigoTransacao') codigoTransacao?: string,
    @Query('codigoReferencia') codigoReferencia?: string,
    @Query('compradorNome') compradorNome?: string,
    @Query('compradorDocumento') compradorDocumento?: string,
    @Query('compradorEmail') compradorEmail?: string,
    @Query('periodType') periodType?: string,
    @Query('tipoTransacao') tipoTransacao?: string,
  ) {
    const upperTag = normalizePlatformTag(tag);
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    let userIds: string[] = [];

    if (upperTag === 'RENOVADA') {
      userIds = [RENOVADA_ID];
    } else if (upperTag === 'EBOOK') {
      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { tenantModule: { slug: { equals: 'ebook', mode: 'insensitive' } } },
            { tenantModule: { slug: { equals: 'ebooksim', mode: 'insensitive' } } },
          ],
        },
        select: { id: true },
      });
      userIds = await expandUserIdsByCpf(this.prisma, users.map((u) => u.id));
    } else if (upperTag !== 'PAGATG') {
      const plans = await this.prisma.pixCreditPlan.findMany({
        where: {
          OR: [
            { description: { contains: `|${upperTag}]`, mode: 'insensitive' } },
            { description: { contains: upperTag, mode: 'insensitive' } },
          ],
        },
        select: { userId: true, description: true },
      });
      userIds = await expandPlatformTransactionUserIds(this.prisma, plans);
    }

    const isTenantTagged = upperTag === 'EBOOK' || upperTag === 'PAGATG';
    if (!isTenantTagged && userIds.length === 0) return { data: [], page: 1, pageSize: 20, total: 0 };

    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);

    const where: any =
      isTenantTagged
        ? {
            OR: [
              { description: { contains: `[TENANT:${upperTag}]`, mode: 'insensitive' } },
              ...(upperTag === 'EBOOK' && userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
            ],
          }
        : {
            userId: { in: userIds },
          };

    const and: any[] = [];

    if (upperTag === 'RENOVADA') {
      and.push({
        OR: [
          { description: { contains: 'dizimo', mode: 'insensitive' } },
          { description: { contains: 'dízimo', mode: 'insensitive' } },
          { description: { contains: 'primicia', mode: 'insensitive' } },
          { description: { contains: 'primícia', mode: 'insensitive' } },
          { description: { contains: 'oferta', mode: 'insensitive' } },
          { description: { contains: 'maquineta', mode: 'insensitive' } },
          { description: { contains: 'terminal', mode: 'insensitive' } },
        ],
      });
    }

    if (status) {
      const statusUpper = status.toUpperCase();
      const statusMap: Record<string, string> = {
        PENDENTE: 'PENDING', COMPLETADA: 'COMPLETED', FALHADA: 'FAILED',
        REEMBOLSADA: 'REFUNDED', EXPIRADA: 'EXPIRED', RASCUNHO: 'DRAFT',
        APROVADA: 'COMPLETED', RECUSADA: 'FAILED', ESTORNADA: 'REFUNDED',
      };
      where.status = statusMap[statusUpper] ?? statusUpper;
    }

    if (codigoTransacao) where.id = codigoTransacao;
    if (codigoReferencia) where.domTransactionId = codigoReferencia;
    if (compradorNome) where.customerName = { contains: compradorNome, mode: 'insensitive' };
    if (compradorDocumento) where.customerDocument = { contains: compradorDocumento.replace(/\D/g, '') };
    if (compradorEmail) where.customerEmail = { contains: compradorEmail, mode: 'insensitive' };

    if (tipoTransacao === 'maquinetas') {
      and.push({
        OR: [
          { description: { contains: 'maquineta', mode: 'insensitive' } },
          { description: { contains: 'terminal', mode: 'insensitive' } },
        ],
      });
    } else if (tipoTransacao === 'online') {
      and.push({
        NOT: {
          OR: [
            { description: { contains: 'maquineta', mode: 'insensitive' } },
            { description: { contains: 'terminal', mode: 'insensitive' } },
          ],
        },
      });
    }

    if (dataInicio || dataFim) {
      const dateFilter: any = {};
      if (dataInicio) {
        const d = dayjs.tz(`${dataInicio} 00:00:00`, TZ);
        if (d.isValid()) dateFilter.gte = d.toDate();
      }
      if (dataFim) {
        const d = dayjs.tz(`${dataFim} 23:59:59`, TZ);
        if (d.isValid()) dateFilter.lte = d.toDate();
      }
      if (Object.keys(dateFilter).length > 0) {
        where.createdAt = dateFilter;
      }
    }

    if (and.length > 0) {
      where.AND = and;
    }

    const total = await this.prisma.transaction.count({ where });
    const items = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * size,
      take: size,
      include: { pixPlanOrder: { select: { pixCreditPlanId: true, customerDocument: true } } },
    });

    const liquidityKey = `${upperTag}_LIQUIDEZ`;
    const fixedFeeKey = `${upperTag}_TAXA_FIXA_TRANSACAO`;
    const cashbackKey = `${upperTag}_TAXA_CASHBACK`;

    const liquidityFactor = Number(process.env[liquidityKey] || process.env.DEFAULT_LIQUIDITY_FACTOR || 0.91);
    const fixedFee = Number(process.env[fixedFeeKey] || 0);
    const cashbackFee = Number(process.env[cashbackKey] || 0);

    const adminMargin = 1 - liquidityFactor;

    let domByOrderNumber = new Map<string, DomTransactionItem[]>();
    if (upperTag === 'EBOOK' && items.length > 0) {
      const parsedDates = items
        .map((t) => t.createdAt)
        .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
      const minCreated = parsedDates.length > 0
        ? new Date(Math.min(...parsedDates.map((d) => d.getTime())))
        : new Date();
      const maxCreated = parsedDates.length > 0
        ? new Date(Math.max(...parsedDates.map((d) => d.getTime())))
        : new Date();
      const endMoment = dayjs(maxCreated).add(2, 'day');
      const beginCandidate = dayjs(minCreated).subtract(2, 'day');
      // API da DOM aceita no máximo 3 meses por consulta.
      const minAllowedBegin = dayjs(endMoment).subtract(3, 'month');
      const beginMoment = beginCandidate.isBefore(minAllowedBegin) ? minAllowedBegin : beginCandidate;
      const beginDate = beginMoment.format('YYYY-MM-DD');
      const endDate = endMoment.format('YYYY-MM-DD');
      const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
      if (domToken?.trim()) {
        const limit = 150;
        for (let domPage = 1; domPage <= 12; domPage += 1) {
          const res = await this.paymentGateway.listDomTransactions(domToken, {
            page: domPage,
            limit,
            begin_date: beginDate,
            end_date: endDate,
          });
          const batch = res.transactions ?? [];
          for (const tx of batch) {
            const orderNumber = this.extractOrderNumberFromText(tx.product_first);
            if (!orderNumber) continue;
            const arr = domByOrderNumber.get(orderNumber) ?? [];
            arr.push(tx);
            domByOrderNumber.set(orderNumber, arr);
          }
          if (batch.length < limit) break;
        }
      }
    }

    const data = items.map(t => {
      const valorBruto = Number(t.amount);
      const isCompleted = t.status === 'COMPLETED';

      const lucroAdmin = isCompleted ? Number((valorBruto * adminMargin - fixedFee - cashbackFee).toFixed(2)) : 0;
      const netFromDb = t.netAmount != null ? Number(t.netAmount) : null;
      const fallbackNet = Number((valorBruto * liquidityFactor).toFixed(2));
      // Alguns registros antigos/com erro ficaram COMPLETED com netAmount=0.
      // Nesses casos, exibimos o líquido calculado pela liquidez da plataforma.
      const valorLiquido = isCompleted && (netFromDb == null || netFromDb <= 0)
        ? fallbackNet
        : (netFromDb ?? fallbackNet);

      let reconciledCustomerName = t.customerName ?? null;
      let reconciledCustomerEmail = t.customerEmail ?? null;
      let reconciledCustomerDocument = t.customerDocument ?? null;
      if (upperTag === 'EBOOK') {
        const orderNumber = this.extractOrderNumberFromText(t.description);
        const domCandidates = orderNumber ? domByOrderNumber.get(orderNumber) ?? [] : [];
        if (domCandidates.length > 0) {
          const txCreatedAt = t.createdAt instanceof Date ? t.createdAt.getTime() : Date.now();
          let best = domCandidates[0];
          let bestDistance = Number.MAX_SAFE_INTEGER;
          for (const candidate of domCandidates) {
            const candDate = this.parseDomCreatedAt(candidate.created_at);
            const dist = candDate ? Math.abs(candDate.getTime() - txCreatedAt) : Number.MAX_SAFE_INTEGER - 1;
            if (dist < bestDistance) {
              bestDistance = dist;
              best = candidate;
            }
          }
          reconciledCustomerName = best.customer_name ?? reconciledCustomerName;
          reconciledCustomerEmail = best.customer_email ?? reconciledCustomerEmail;
          reconciledCustomerDocument = best.customer_document ?? reconciledCustomerDocument;
        }
      }

      return {
        id: t.id,
        valorBruto: valorBruto,
        valorLiquido: valorLiquido,
        lucroAdmin: lucroAdmin,
        calculos: {
          valorLiquido: `${valorBruto.toFixed(2)} * ${liquidityFactor.toFixed(2)} = ${valorLiquido.toFixed(2)}`,
          lucroAdmin: isCompleted
            ? `(${valorBruto.toFixed(2)} * ${(1 - liquidityFactor).toFixed(2)}) - ${fixedFee.toFixed(2)} - ${cashbackFee.toFixed(2)} = ${lucroAdmin.toFixed(2)}`
            : "Aguardando confirmação do pagamento"
        },
        status: t.status,
        metodoPagamento: t.paymentMethod,
        descricao: (t.description ?? '').replace(/\s*\[CPF:[^\]]*\|[^\]]+\]/g, '').replace(/Terminal:\s*/gi, 'Maquineta '),
        cliente: {
          nome: reconciledCustomerName,
          email: reconciledCustomerEmail,
          documento: reconciledCustomerDocument,
        },
        taxas: {
          total: Number(t.totalFee),
          dom: Number(t.domFee),
          plataforma: Number(t.platformFee),
        },
        criadoEm: t.createdAt,
        atualizadoEm: t.updatedAt,
      };
    });

    return { data, page: pageNum, pageSize: size, total };
  }

  @Post('withdrawals/approve-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marcar todos os saques PENDENTES e APROVADOS como CONCLUÍDOS (Bulk Approval)' })
  async approveAllWithdrawals() {
    // 1. Saques PENDENTES (precisam debitar o saldo e desbloquear)
    const pendingWiths = await this.prisma.withdrawRequest.findMany({
      where: { status: WithdrawStatus.PENDING },
    });

    // 2. Saques APROVADOS (já debitaram o saldo, só precisam ser marcados como concluídos)
    const approvedWiths = await this.prisma.withdrawRequest.findMany({
      where: { status: WithdrawStatus.APPROVED },
    });

    let updated = 0;

    // Processar PENDENTES (precisa de transação por usuário para saldo)
    for (const w of pendingWiths) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.withdrawRequest.update({
            where: { id: w.id },
            data: { status: WithdrawStatus.COMPLETED, updatedAt: new Date() },
          });
          await tx.wallet.update({
            where: { userId: w.userId },
            data: {
              balance: { decrement: w.grossAmount },
              lockedBalance: { decrement: w.grossAmount },
              version: { increment: 1 },
            },
          });
        });
        updated++;
      } catch (err) {
        console.error(`Erro ao aprovar em massa saque ${w.id}:`, err);
      }
    }

    // Processar APROVADOS (apenas mudar status)
    const approvedUpdate = await this.prisma.withdrawRequest.updateMany({
      where: { id: { in: approvedWiths.map(aw => aw.id) } },
      data: { status: WithdrawStatus.COMPLETED, updatedAt: new Date() },
    });
    updated += approvedUpdate.count;

    return { success: true, count: updated, message: `${updated} saques marcados como concluídos.` };
  }

  @Post('renovada/reset-wallet')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Zerar saldo e bloqueios da carteira Renovada (sem saque sintético)',
    description:
      'Zera wallet, remove todos os saques. O /auth/me Renovada usa wallet + saques COMPLETED/APPROVED; um saque sintético COMPLETED quebrava o saldo (gross × (fator−1) ficava negativo). Transações permanecem no banco.',
  })
  async resetRenovadaWallet() {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: RENOVADA_ID },
        data: { balance: 0, lockedBalance: 0, version: { increment: 1 } },
      });

      await tx.withdrawRequest.deleteMany({
        where: { userId: RENOVADA_ID },
      });

      await tx.balanceLog.create({
        data: {
          userId: RENOVADA_ID,
          action: 'WALLET_RESET_FINAL',
          amount: 0,
          balanceBefore: 0,
          balanceAfter: 0,
          lockedBefore: 0,
          lockedAfter: 0,
          source: 'ADMIN_FORCE',
          description: 'Reset Renovada: wallet zerada e histórico de saques removido.',
        },
      });
    });

    return {
      success: true,
      message: 'Saldo zerado com sucesso (0,00). Histórico de transações mantido.',
    };
  }
}
