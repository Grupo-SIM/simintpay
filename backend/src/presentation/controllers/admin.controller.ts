import {
  transactionPlatformTag,
  transactionPlatformTagData,
  whereTransactionHasPlatform,
  whereTransactionPlatform,
} from '../../modules/platform-core/transaction-platform';
import { reportBuyerCpf } from '../../application/helpers/report-buyer.helper';
import { PlatformAttributedBalance } from '../../modules/platform-core/platform-attributed-balance';
import { PlatformAdministrationService } from '../../modules/platform-core/platform-administration.service';
import {
  resolveConsolidadoPlatforms,
  getComunidadeOrderRows,
  parseYmdSp,
  normalizePlatformTag,
  TZ,
  getTaxaServicoEffectiveDate,
  TAGS_SEM_TAXA_SERVICO,
  ConsolidadoPlatformEntry,
} from '../../modules/platform-core/platform-administration.helpers';
import { PlatformSaasAccessService } from '../../modules/platform-core/platform-saas-access.service';
import { getPlatformIntegrationValue } from '../../modules/platform-integrations/platform-integrations.store';
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
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  LeadStatus,
  PaymentMethod,
  Prisma,
  Role,
  TransactionStatus,
  WithdrawStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { ExternalPlatformDbService } from '../../modules/external-platform-db/external-platform-db.service';
import type { ExternalPlatformSlug } from '../../modules/external-platform-db/external-platform-db.types';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

/** dataInicio/dataFim no formato YYYY-MM-DD interpretados no fuso SP. */

import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { RolesGuard } from '../../infrastructure/security/guards/roles.guard';
import { Roles } from '../../infrastructure/security/decorators/roles.decorator';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListLeadsUseCase } from '../../application/use-cases/admin/list-leads.use-case';
import { ApproveLeadUseCase } from '../../application/use-cases/admin/approve-lead.use-case';
import { RejectLeadUseCase } from '../../application/use-cases/admin/reject-lead.use-case';
import { DeleteLeadsUseCase } from '../../application/use-cases/admin/delete-leads.use-case';
import { DeleteLeadsDto } from '../../application/dtos/admin/delete-leads.dto';
import { SyncDomTransactionsUseCase } from '../../application/use-cases/admin/sync-dom-transactions.use-case';
import { ReconcilePendingTransactionsUseCase } from '../../application/use-cases/webhook/reconcile-pending-transactions.use-case';
import { ListWithdrawalsAdminUseCase } from '../../application/use-cases/admin/list-withdrawals-admin.use-case';
import { ApproveWithdrawalUseCase } from '../../application/use-cases/admin/approve-withdrawal.use-case';
import { RejectWithdrawalUseCase } from '../../application/use-cases/admin/reject-withdrawal.use-case';
import { MigrateRenovadaTxsToAdminUseCase } from '../../application/use-cases/admin/migrate-renovada-txs-to-admin.use-case';
import { ListDomTransactionsDirectUseCase } from '../../application/use-cases/admin/list-dom-transactions-direct.use-case';
import { SyncMaquinetasUseCase } from '../../application/use-cases/admin/sync-maquinetas.use-case';
import { SyncDomTransactionsCron } from '../../infrastructure/cron/sync-dom-transactions.cron';
import { RejectLeadDto } from '../../application/dtos/admin/reject-lead.dto';
import { getPlatformOwnerId } from '../../modules/module.registry';
import { RejectWithdrawalDto } from '../../application/dtos/admin/reject-withdrawal.dto';
import { TestEbookEmailDto } from '../../application/dtos/admin/test-ebook-email.dto';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { RevalidaSyncService } from '../../modules/revalida/services/revalida-sync.service';
import {
  HASH_SERVICE,
  type IHashService,
} from '../../core/services/hash.interface';
import {
  PAYMENT_GATEWAY,
  type DomTransactionItem,
  type IPaymentGateway,
} from '../../core/services/payment-gateway.interface';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
} from '../../core/repositories/wallet.repository.interface';
import { CommunityManagementService } from '../../application/services/community-management.service';
import { computeUserNetBalance } from '../../application/helpers/user-platform-net-balance.helper';
import { PlatformTaxasService } from '../../application/services/platform-taxas.service';
import {
  getPlatformTaxaEffective,
  invalidatePlatformTaxaCache,
  buildUserTaxaTag,
  canonicalPlatformTaxaTag,
} from '../../modules/platform-taxas/platform-taxas.store';
import {
  PLATFORM_TAXA_DEFAULTS,
  type PlataformaTaxaKey,
} from '../../modules/platform-taxas/platform-taxas.keys';
import { estimateDomFeeReais } from '../../application/helpers/dom-fee-estimate.helper';
import { calculateBoletoFees } from '../../application/use-cases/boleto/boleto-fees.helper';
import { isMasterAdminUser } from '../../shared/utils/is-master-admin.util';
import { LinkExternalPlatformUserService } from '../../application/services/link-external-platform-user.service';
import { ScanPlatformOwnersUseCase } from '../../application/use-cases/admin/scan-platform-owners.use-case';
import { GetWalletCompositionUseCase } from '../../application/use-cases/admin/get-wallet-composition.use-case';
import { summarizeRefunds } from '../../application/helpers/refund-report.helper';
import { ORIGEM_MAQUINETA_TAG, TENANT_RENOVADA_TAG } from '../../application/utils/internal-tags.util';
import { PlatformReportingService } from '../../application/services/platform-reporting.service';

/** Extrai o serial do terminal a partir da descrição da transação */
function extractTerminal(description: string | null | undefined): string {
  if (!description) return '-';
  const m = description.match(/Terminal:\s*([^\s[]+)/i);
  return m ? m[1] : '-';
}

/**
 * Conta técnica onde ficam as transações do checkout Ebook (`[TENANT:EBOOK]` no webhook/sync).
 * Mesmo default de `EBOOK_ID` nos endpoints de limpeza/sync do ebook.
 */

async function resolveRegisteredOwner(
  prisma: PrismaService,
  _envKey: string,
  slugs: string[],
): Promise<string> {
  const tags = slugs.map((slug) => normalizePlatformTag(slug));
  const platform = await prisma.platform.findFirst({
    where: { tag: { in: tags }, isActive: true },
    select: { ownerUserId: true },
  });
  return platform?.ownerUserId ?? '';
}

/** Resolve todos os user IDs das plataformas do consolidado em paralelo. */

/**
 * Busca ordens de assinatura de comunidade pagas no período, via CommunityLinkBinding.
 * Retorna rows no mesmo formato de txRowsLucro para serem mescladas no consolidado.
 */

/**
 * Remove as ordens de comunidade sintéticas (`comunidade_order_<X>`) que JÁ possuem uma
 * transação real correspondente (descrição contém `subOrder=<X>`, criada pelo webhook).
 * Sem isso, o mesmo pagamento de comunidade entra duas vezes no consolidado (uma como
 * transação, outra como ordem) e infla bruto/líquido/lucro/contagem. Mantém a transação
 * (fonte da verdade) e descarta a ordem sintética. Ordens sem transação correspondente
 * (legado/edge) permanecem, para não perder pagamentos.
 */
function dedupeComunidadeRows<T extends { id: string }>(
  txRows: ReadonlyArray<{ description: string | null }>,
  comunidadeRows: ReadonlyArray<T>,
): T[] {
  const subOrderIds = new Set<string>();
  for (const t of txRows) {
    const m = (t.description ?? '').match(/subOrder=([^\s\]]+)/i);
    if (m) subOrderIds.add(m[1]);
  }
  if (subOrderIds.size === 0) return [...comunidadeRows];
  const PREFIX = 'comunidade_order_';
  return comunidadeRows.filter((r) => {
    if (!r.id.startsWith(PREFIX)) return true;
    return !subOrderIds.has(r.id.slice(PREFIX.length));
  });
}

/**
 * Escopo do consolidado: contas plataforma OU qualquer transação com tag de tenant.
 * A lista fixa de tags deixava de fora [TENANT:ATLAS]/[TENANT:REVALIDA]/[TENANT:BETAI]/
 * [TENANT:ZERO_GRAU]/[TENANT:SIMINTPAY]/comunidades quando o userId não era de conta
 * plataforma — as vendas apareciam na listagem do produto mas não nos cards/consolidado.
 */
function buildConsolidadoScopeOr(
  platformIds: string[],
): Prisma.TransactionWhereInput {
  return {
    OR: [
      { userId: { in: platformIds } },
      // Transação com plataforma atribuída (Transaction.platformTag é a única fonte).
      whereTransactionHasPlatform,
    ],
  };
}

/** Tags de plataformas fixas — qualquer [TENANT:X] fora deste conjunto é uma comunidade individual. */

/** Tag sentinela para transações sem plataforma/produto atribuível — nada fica de fora do relatório. */
const TAG_NAO_IDENTIFICADA = 'NAO-IDENTIFICADA';

function consolidadoTagParaTransacao(
  tx: { userId: string; platformTag: string | null },
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): string {
  const stored = transactionPlatformTag(tx);
  if (stored) {
    const tag = normalizePlatformTag(stored);
    return platforms.some((platform) => platform.tag === tag)
      ? tag
      : TAG_NAO_IDENTIFICADA;
  }
  return TAG_NAO_IDENTIFICADA;
}

type ConsolidadoListQuery = {
  dataInicio?: string;
  dataFim?: string;
  customerName?: string;
  transactionId?: string;
  transactionType?: string;
  paymentLink?: string;
  planName?: string;
};

function buildConsolidadoTransactionWhere(
  input: ConsolidadoListQuery,
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): Prisma.TransactionWhereInput {
  const platformIds = platforms.map((p) => p.id);

  const and: Prisma.TransactionWhereInput[] = [
    buildConsolidadoScopeOr(platformIds),
  ];

  let statusFilter: Prisma.TransactionWhereInput['status'] = 'COMPLETED';
  if (input.transactionType === 'out') {
    statusFilter = { in: ['REFUNDED', 'CHARGEBACK'] };
  } else if (input.transactionType === 'all') {
    statusFilter = { in: ['COMPLETED', 'REFUNDED', 'CHARGEBACK'] };
  }
  and.push({ status: statusFilter });

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
      and.push({ createdAt });
    }
  }

  if (input.customerName?.trim()) {
    and.push({
      customerName: {
        contains: input.customerName.trim(),
        mode: 'insensitive',
      },
    });
  }

  if (input.transactionId?.trim()) {
    and.push({
      OR: [
        { id: input.transactionId.trim() },
        { domTransactionId: input.transactionId.trim() },
      ],
    });
  }

  if (input.paymentLink?.trim()) {
    and.push({ paymentLinkId: input.paymentLink.trim() });
  }

  if (input.planName?.trim()) {
    and.push({
      description: { contains: input.planName.trim(), mode: 'insensitive' },
    });
  }

  return { AND: and };
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
  dataInicio: string | undefined,
  dataFim: string | undefined,
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): Prisma.TransactionWhereInput {
  const platformIds = platforms.map((p) => p.id);
  const where: Prisma.TransactionWhereInput = {
    status: 'COMPLETED',
    ...buildConsolidadoScopeOr(platformIds),
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

function domRawStatusToBucket(
  status: string | undefined | null,
): DomStatusBucket {
  const s = String(status ?? 'pending').toLowerCase();
  if (
    s === 'paid' ||
    s === 'approved' ||
    s === 'completed' ||
    s === 'revision_paid'
  ) {
    return 'COMPLETED';
  }
  if (s === 'refunded' || s === 'pending_refund') return 'REFUNDED';
  if (s === 'chargeback') return 'REFUNDED';
  if (s === 'failed' || s === 'not_authorized' || s === 'expired')
    return 'FAILED';
  return 'PENDING';
}

/** Rótulos alinhados à coluna Status em /transacoes (mapStatusLabel). */
const DOM_DIST_STATUS_LABEL: Record<DomStatusBucket, string> = {
  PENDING: 'Pendente',
  COMPLETED: 'Aprovado',
  REFUNDED: 'Estornado',
  FAILED: 'Recusado',
};

type DomMethodBucket = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO';

function domPaymentMethodToBucket(
  method: string | undefined | null,
): DomMethodBucket {
  const m = String(method ?? 'pix').toLowerCase();
  if (
    m.includes('boleto') ||
    m.includes('ticket') ||
    m.includes('bank_slip') ||
    m.includes('bankslip')
  )
    return 'BOLETO';
  if (m.includes('debit')) return 'DEBIT_CARD';
  if (m.includes('credit') || m.includes('cartao') || m.includes('card'))
    return 'CREDIT_CARD';
  return 'PIX';
}

const DOM_DIST_METHOD_LABEL: Record<DomMethodBucket, string> = {
  PIX: 'PIX',
  CREDIT_CARD: 'Cartão de Crédito',
  DEBIT_CARD: 'Débito',
  BOLETO: 'Boleto',
};

/** Mesmo padrão de datas que o hook admin em `use-transacoes` (listTransacoesAdmin). */
function relatorioDomDateRange(
  dataInicio?: string,
  dataFim?: string,
): { begin_date: string; end_date: string } {
  const endDay = dataFim?.trim() || dayjs().tz(TZ).format('YYYY-MM-DD');
  const beginDay =
    dataInicio?.trim() ||
    dayjs().tz(TZ).subtract(90, 'day').format('YYYY-MM-DD');
  return {
    begin_date: dataInicio?.trim() ? `${dataInicio.trim()} 00:00:00` : beginDay,
    end_date: dataFim?.trim()
      ? `${dataFim.trim()} 23:59:59`
      : `${endDay} 23:59:59`,
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

/**
 * Estornos registrados no produto. O período considera quando a transação virou
 * REFUNDED; registros sem histórico só entram no total sem filtro de datas.
 */
async function aggregateProductRefunds(
  prisma: PrismaService,
  platformUserIds: string[],
  dataInicio?: string,
  dataFim?: string,
): Promise<{ quantidade: number; valor: number }> {
  const transactions = await prisma.transaction.findMany({
    where: {
      status: TransactionStatus.REFUNDED,
      ...buildConsolidadoScopeOr(platformUserIds),
    },
    select: {
      amount: true,
      updatedAt: true,
      statusHistory: {
        where: { toStatus: TransactionStatus.REFUNDED },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  return summarizeRefunds(transactions, {
    start: dataInicio
      ? parseYmdSp(dataInicio).startOf('day').toDate()
      : undefined,
    end: dataFim ? parseYmdSp(dataFim).endOf('day').toDate() : undefined,
  });
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
  taxaServico: number;
  lucroTransacao: number;
  formulaLucro: string;
  installments: number;
};

/** Nenhuma plataforma isenta; RENOVADA e BOSQUE migraram para TAXA_SERVICO em 2026-05-29 (data abaixo). */

/** Transações anteriores a esta data não são cobradas a TAXA_SERVICO (fee retroativo não aplicado). */
// 2026-05-18 meia-noite BRT
/** RENOVADA e BOSQUE: início do TAXA_SERVICO — mesma data dos internal-*-finance.controller.ts. */

/** Retorna a data efetiva do TAXA_SERVICO por plataforma (RENOVADA/BOSQUE migraram em 2026-05-29). */

type LucroSimpayPorPlataforma = {
  tag: string;
  userId: string;
  envLiquidez: string;
  envTaxaFixa: string;
  envTaxaCashback: string;
  envTaxaServico: string;
  liquidezLojista: number;
  taxaFixaTransacao: number;
  taxaCashback: number;
  taxaServico: number;
  quantidadeTransacoes: number;
  subtotalBruto: number;
  subtotalParteAdminMaster: number;
  subtotalDeducaoTaxaFixa: number;
  subtotalDeducaoTaxaCashback: number;
  subtotalDeducaoTaxaServico: number;
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
    platformTag: string | null;
    installments: number | null;
    paymentMethod?: string | null;
  }[],
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): { totalLucroSimpay: number; plataformas: LucroSimpayPorPlataforma[] } {
  const byTag = new Map<
    string,
    {
      userId: string;
      liquidezLojista: number;
      taxaFixa: number;
      taxaCashback: number;
      taxaServico: number;
      envLiquidez: string;
      envTaxaFixa: string;
      envCashback: string;
      envServico: string;
      transacoes: LucroSimpayLinhaTx[];
      subtotalBruto: number;
      subtotalParte: number;
      subtotalLucro: number;
      subtotalTaxaServico: number;
    }
  >();

  let totalLucroSimpay = 0;

  for (const tx of txs) {
    const tag = consolidadoTagParaTransacao(
      { userId: tx.userId, platformTag: tx.platformTag ?? null },
      platforms,
    );
    const platformEntry = platforms.find((p) => p.tag === tag);
    const canonicalUserId = platformEntry?.id ?? tx.userId;
    const liquidezKey = `${tag}_LIQUIDEZ`;
    const fixaKey = `${tag}_TAXA_FIXA_TRANSACAO`;
    const cbKey = `${tag}_TAXA_CASHBACK`;
    const servicoKey = `${tag}_TAXA_SERVICO`;

    const liquidezLojista = getPlatformTaxaEffective(tag, 'LIQUIDEZ', 0.91);
    const taxaFixa = getPlatformTaxaEffective(tag, 'TAXA_FIXA_TRANSACAO', 1.0);
    const taxaCashback = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK', 3.0);
    const taxaServicoRate = TAGS_SEM_TAXA_SERVICO.has(tag)
      ? 0
      : getPlatformTaxaEffective(tag, 'TAXA_SERVICO', 4.0);
    const taxaServico =
      taxaServicoRate > 0 && tx.createdAt >= getTaxaServicoEffectiveDate(tag)
        ? taxaServicoRate
        : 0;

    const bruto = Number(tx.amount);
    const parteAdmin = bruto * (1 - liquidezLojista);
    const pm = String(tx.paymentMethod ?? 'PIX');
    const inst = Number(tx.installments ?? 1);
    const taxaMdr = mdrDomPct(pm, inst, bruto, tag);
    // taxaServico é receita (cobrado do vendedor); taxaFixa, taxaCashback e taxaMdr são custos DOM.
    const lucroTx =
      parteAdmin + taxaServico - taxaMdr - taxaFixa - taxaCashback;
    totalLucroSimpay += lucroTx;

    if (!byTag.has(tag)) {
      byTag.set(tag, {
        userId: canonicalUserId,
        liquidezLojista,
        taxaFixa,
        taxaCashback,
        taxaServico: taxaServicoRate,
        envLiquidez: liquidezKey,
        envTaxaFixa: fixaKey,
        envCashback: cbKey,
        envServico: servicoKey,
        transacoes: [],
        subtotalBruto: 0,
        subtotalParte: 0,
        subtotalLucro: 0,
        subtotalTaxaServico: 0,
      });
    }
    const agg = byTag.get(tag)!;

    const formulaParte = `${bruto.toFixed(2)} × (1 − ${liquidezLojista}) = ${parteAdmin.toFixed(2)}`;
    const mdrLabel = taxaMdr > 0 ? ` − ${taxaMdr.toFixed(4)}(MDR)` : '';
    const formulaLucro =
      taxaServico > 0
        ? `${parteAdmin.toFixed(2)} + ${taxaServico}(serv)${mdrLabel} − ${taxaFixa} − ${taxaCashback} = ${lucroTx.toFixed(2)}`
        : `${parteAdmin.toFixed(2)}${mdrLabel} − ${taxaFixa} − ${taxaCashback} = ${lucroTx.toFixed(2)}`;

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
      taxaServico,
      lucroTransacao: Number(lucroTx.toFixed(2)),
      formulaLucro,
      installments: Number(tx.installments ?? 1),
    });
    agg.subtotalBruto += bruto;
    agg.subtotalParte += parteAdmin;
    agg.subtotalLucro += lucroTx;
    agg.subtotalTaxaServico += taxaServico;
  }

  const platformTagsResolvidas = new Set(platforms.map((p) => p.tag));

  const plataformas: LucroSimpayPorPlataforma[] = platforms.map((p) => {
    const hit = byTag.get(p.tag);
    const liquidezKey = `${p.tag}_LIQUIDEZ`;
    const fixaKey = `${p.tag}_TAXA_FIXA_TRANSACAO`;
    const cbKey = `${p.tag}_TAXA_CASHBACK`;
    const servicoKey = `${p.tag}_TAXA_SERVICO`;
    const L = getPlatformTaxaEffective(p.tag, 'LIQUIDEZ', 0.91);
    const tf = getPlatformTaxaEffective(p.tag, 'TAXA_FIXA_TRANSACAO', 1.0);
    const tc = getPlatformTaxaEffective(p.tag, 'TAXA_CASHBACK', 3.0);
    const ts = TAGS_SEM_TAXA_SERVICO.has(p.tag)
      ? 0
      : getPlatformTaxaEffective(p.tag, 'TAXA_SERVICO', 4.0);

    if (!hit) {
      return {
        tag: p.tag,
        userId: p.id,
        envLiquidez: liquidezKey,
        envTaxaFixa: fixaKey,
        envTaxaCashback: cbKey,
        envTaxaServico: servicoKey,
        liquidezLojista: L,
        taxaFixaTransacao: tf,
        taxaCashback: tc,
        taxaServico: ts,
        quantidadeTransacoes: 0,
        subtotalBruto: 0,
        subtotalParteAdminMaster: 0,
        subtotalDeducaoTaxaFixa: 0,
        subtotalDeducaoTaxaCashback: 0,
        subtotalDeducaoTaxaServico: 0,
        subtotalLucro: 0,
        transacoes: [],
      };
    }

    return {
      tag: p.tag,
      userId: p.id,
      envLiquidez: liquidezKey,
      envTaxaFixa: fixaKey,
      envTaxaCashback: cbKey,
      envTaxaServico: servicoKey,
      liquidezLojista: hit.liquidezLojista,
      taxaFixaTransacao: hit.taxaFixa,
      taxaCashback: hit.taxaCashback,
      taxaServico: hit.taxaServico,
      quantidadeTransacoes: hit.transacoes.length,
      subtotalBruto: Number(hit.subtotalBruto.toFixed(2)),
      subtotalParteAdminMaster: Number(hit.subtotalParte.toFixed(2)),
      subtotalDeducaoTaxaFixa: Number(
        (hit.transacoes.length * hit.taxaFixa).toFixed(2),
      ),
      subtotalDeducaoTaxaCashback: Number(
        (hit.transacoes.length * hit.taxaCashback).toFixed(2),
      ),
      subtotalDeducaoTaxaServico: Number(hit.subtotalTaxaServico.toFixed(2)),
      subtotalLucro: Number(hit.subtotalLucro.toFixed(2)),
      transacoes: hit.transacoes.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    };
  });

  // Plataformas identificadas apenas por tag de descrição (sem userId resolvido) — ex.: PAGATG, COMUNIDADE
  for (const [tag, hit] of byTag.entries()) {
    if (platformTagsResolvidas.has(tag)) continue;
    const liquidezKey = `${tag}_LIQUIDEZ`;
    const fixaKey = `${tag}_TAXA_FIXA_TRANSACAO`;
    const cbKey = `${tag}_TAXA_CASHBACK`;
    const servicoKey = `${tag}_TAXA_SERVICO`;
    plataformas.push({
      tag,
      userId: hit.userId,
      envLiquidez: liquidezKey,
      envTaxaFixa: fixaKey,
      envTaxaCashback: cbKey,
      envTaxaServico: servicoKey,
      liquidezLojista: hit.liquidezLojista,
      taxaFixaTransacao: hit.taxaFixa,
      taxaCashback: hit.taxaCashback,
      taxaServico: hit.taxaServico,
      quantidadeTransacoes: hit.transacoes.length,
      subtotalBruto: Number(hit.subtotalBruto.toFixed(2)),
      subtotalParteAdminMaster: Number(hit.subtotalParte.toFixed(2)),
      subtotalDeducaoTaxaFixa: Number(
        (hit.transacoes.length * hit.taxaFixa).toFixed(2),
      ),
      subtotalDeducaoTaxaCashback: Number(
        (hit.transacoes.length * hit.taxaCashback).toFixed(2),
      ),
      subtotalDeducaoTaxaServico: Number(
        (hit.transacoes.length * hit.taxaServico).toFixed(2),
      ),
      subtotalLucro: Number(hit.subtotalLucro.toFixed(2)),
      transacoes: hit.transacoes.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    });
  }

  return {
    totalLucroSimpay: Number(totalLucroSimpay.toFixed(2)),
    plataformas,
  };
}

/** Lucro Simpay de uma transação (mesma fórmula que buildLucroSimpayDetalhePorPlataforma). */
function lucroSimpayUmaTransacaoConsolidado(
  tx: {
    userId: string;
    amount: unknown;
    description?: string | null;
    platformTag: string | null;
    installments?: number | null;
    createdAt?: Date;
    paymentMethod?: string | null;
  },
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): number {
  const tag = consolidadoTagParaTransacao(
    { userId: tx.userId, platformTag: tx.platformTag ?? null },
    platforms,
  );
  const liquidezLojista = getPlatformTaxaEffective(tag, 'LIQUIDEZ', 0.91);
  const taxaFixa = getPlatformTaxaEffective(tag, 'TAXA_FIXA_TRANSACAO', 1.0);
  const taxaCashback = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK', 3.0);
  const taxaServicoRate = TAGS_SEM_TAXA_SERVICO.has(tag)
    ? 0
    : getPlatformTaxaEffective(tag, 'TAXA_SERVICO', 4.0);
  const taxaServico =
    taxaServicoRate > 0 &&
    tx.createdAt != null &&
    tx.createdAt >= getTaxaServicoEffectiveDate(tag)
      ? taxaServicoRate
      : 0;
  const bruto = Number(tx.amount);
  const parteAdmin = bruto * (1 - liquidezLojista);
  const pm = String(tx.paymentMethod ?? 'PIX');
  const inst = Number(tx.installments ?? 1);
  const taxaMdr = mdrDomPct(pm, inst, bruto, tag);
  // taxaServico é receita (cobrado do vendedor); taxaFixa, taxaCashback e taxaMdr são custos DOM.
  return parteAdmin + taxaServico - taxaMdr - taxaFixa - taxaCashback;
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
  txRowsLucro: {
    userId: string;
    amount: unknown;
    createdAt: Date;
    description?: string | null;
    platformTag: string | null;
  }[],
  withdrawLogs: {
    createdAt: Date;
    bookkeepingAmount: unknown;
    action: string;
  }[],
  dataInicio: string,
  dataFim: string,
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): Array<{ label: string; valor: number }> {
  const lucroPorDia = new Map<string, number>();
  for (const tx of txRowsLucro) {
    const ymd = dayjs(tx.createdAt).tz(TZ).format('YYYY-MM-DD');
    const l = lucroSimpayUmaTransacaoConsolidado(tx, platforms);
    lucroPorDia.set(ymd, (lucroPorDia.get(ymd) ?? 0) + l);
  }
  const feePorDia = new Map<string, number>();
  const profitPorDia = new Map<string, number>();
  for (const log of withdrawLogs) {
    const ymd = dayjs(log.createdAt).tz(TZ).format('YYYY-MM-DD');
    const amt = Number(log.bookkeepingAmount);
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
  txRowsLucro: {
    userId: string;
    amount: unknown;
    createdAt: Date;
    description?: string | null;
    platformTag: string | null;
  }[],
  withdrawLogs: {
    createdAt: Date;
    bookkeepingAmount: unknown;
    action: string;
  }[],
  dataInicio: string,
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): Array<{ label: string; valor: number }> {
  const ymd = parseYmdSp(dataInicio).startOf('day').format('YYYY-MM-DD');
  const lucroPorHora = new Map<number, number>();
  for (const tx of txRowsLucro) {
    const d = dayjs(tx.createdAt).tz(TZ);
    if (d.format('YYYY-MM-DD') !== ymd) continue;
    const h = d.hour();
    const l = lucroSimpayUmaTransacaoConsolidado(tx, platforms);
    lucroPorHora.set(h, (lucroPorHora.get(h) ?? 0) + l);
  }
  const feePorHora = new Map<number, number>();
  const profitPorHora = new Map<number, number>();
  for (const log of withdrawLogs) {
    const d = dayjs(log.createdAt).tz(TZ);
    if (d.format('YYYY-MM-DD') !== ymd) continue;
    const h = d.hour();
    const amt = Number(log.bookkeepingAmount);
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
  taxaAdquirente: number;
  taxaSaque: number;
  lucroSaque: number;
  taxaServico: number;
  taxaSaqueDom: number;
};

/**
 * Tabela DOM de cartão por parcela. Usada apenas como fallback de `MDR_CC_{n}X`
 * quando a plataforma não tem override no admin nem variável de ambiente própria —
 * preserva o custo histórico em vez de cair no default 0 de PLATFORM_TAXA_DEFAULTS,
 * que zeraria o custo e inflaria o lucro.
 */
const DOM_CC_RATE_BY_INSTALLMENT_ADM: Record<number, number> = {
  1: 0.0399,
  2: 0.083,
  3: 0.0968,
  4: 0.1104,
  5: 0.1237,
  6: 0.1367,
  7: 0.1495,
  8: 0.1621,
  9: 0.1744,
  10: 0.1864,
  11: 0.1983,
  12: 0.2099,
};

/** Taxa MDR que a DOM cobra (somente a parte percentual, sem taxas fixas). */
function mdrDomPct(
  paymentMethod: string,
  installments: number,
  amount: number,
  tag: string,
): number {
  const inst = Math.min(Math.max(installments || 1, 1), 12);
  if (String(paymentMethod).toUpperCase().includes('BOLETO')) {
    // Boleto: custo DOM é FIXO por boleto (TAXA_BOLETO_DOM + TAXA_BOLETO_DOM_FIXA), não % do valor.
    return calculateBoletoFees(amount, tag).domFeeAmount;
  }
  if (paymentMethod === 'DEBIT_CARD') return amount * 0.0349;
  if (paymentMethod === 'CREDIT_CARD') {
    // Respeita a aba de taxas (override do admin → env da plataforma → global);
    // só cai na tabela fixa acima se nenhuma dessas fontes definir a parcela.
    const ccKey = `MDR_CC_${inst}X` as PlataformaTaxaKey;
    const ccFallback = DOM_CC_RATE_BY_INSTALLMENT_ADM[inst] ?? 0.0399;
    return amount * getPlatformTaxaEffective(tag, ccKey, ccFallback);
  }
  const mdrPix = getPlatformTaxaEffective(
    tag,
    'MDR_PIX',
    PLATFORM_TAXA_DEFAULTS.MDR_PIX,
  );
  return amount * mdrPix;
}

function accumTxFinancePorDia(
  txRowsLucro: {
    userId: string;
    amount: unknown;
    netAmount: unknown | null;
    createdAt: Date;
    description?: string | null;
    platformTag: string | null;
    paymentMethod?: string | null;
    installments?: number | null;
  }[],
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): {
  bruto: Map<string, number>;
  liquido: Map<string, number>;
  lucro: Map<string, number>;
  cashback: Map<string, number>;
  taxaAdquirente: Map<string, number>;
  taxaServico: Map<string, number>;
} {
  const bruto = new Map<string, number>();
  const liquido = new Map<string, number>();
  const lucro = new Map<string, number>();
  const cashback = new Map<string, number>();
  const taxaAdquirente = new Map<string, number>();
  const taxaServico = new Map<string, number>();
  for (const tx of txRowsLucro) {
    const ymd = dayjs(tx.createdAt).tz(TZ).format('YYYY-MM-DD');
    const tag = consolidadoTagParaTransacao(
      { userId: tx.userId, platformTag: tx.platformTag ?? null },
      platforms,
    );
    const b = Number(tx.amount);
    if (Number.isFinite(b)) {
      bruto.set(ymd, (bruto.get(ymd) ?? 0) + b);
    }
    const liq = valorLiquidoTransacaoConsolidado(tx, tag);
    liquido.set(ymd, (liquido.get(ymd) ?? 0) + liq);
    const l = lucroSimpayUmaTransacaoConsolidado(tx, platforms);
    lucro.set(ymd, (lucro.get(ymd) ?? 0) + l);
    const tc = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK', 3.0);
    cashback.set(ymd, (cashback.get(ymd) ?? 0) + tc);
    const tf = getPlatformTaxaEffective(tag, 'TAXA_FIXA_TRANSACAO', 1.0);
    taxaAdquirente.set(ymd, (taxaAdquirente.get(ymd) ?? 0) + tf + tc);
    const taxaServicoRate = TAGS_SEM_TAXA_SERVICO.has(tag)
      ? 0
      : getPlatformTaxaEffective(tag, 'TAXA_SERVICO', 4.0);
    const taxaServicoTx =
      taxaServicoRate > 0 && tx.createdAt >= getTaxaServicoEffectiveDate(tag)
        ? taxaServicoRate
        : 0;
    taxaServico.set(ymd, (taxaServico.get(ymd) ?? 0) + taxaServicoTx);
  }
  return { bruto, liquido, lucro, cashback, taxaAdquirente, taxaServico };
}

function accumWithdrawPorDia(
  withdrawLogs: {
    createdAt: Date;
    bookkeepingAmount: unknown;
    action: string;
  }[],
): { fee: Map<string, number>; profit: Map<string, number> } {
  const fee = new Map<string, number>();
  const profit = new Map<string, number>();
  for (const log of withdrawLogs) {
    const ymd = dayjs(log.createdAt).tz(TZ).format('YYYY-MM-DD');
    const amt = Number(log.bookkeepingAmount);
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
    description?: string | null;
    platformTag: string | null;
    paymentMethod?: string | null;
    installments?: number | null;
  }[],
  withdrawLogs: {
    createdAt: Date;
    bookkeepingAmount: unknown;
    action: string;
  }[],
  dataInicio: string,
  dataFim: string,
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): DashboardFinanceHistoricoRow[] {
  const { bruto, liquido, lucro, cashback, taxaAdquirente, taxaServico } =
    accumTxFinancePorDia(txRowsLucro, platforms);
  const { fee, profit } = accumWithdrawPorDia(withdrawLogs);
  const dias = listYmdInclusiveSp(dataInicio, dataFim);
  return dias.map((ymd) => {
    const taxaSaqueVal = Number((fee.get(ymd) ?? 0).toFixed(2));
    return {
      label: dayjs.tz(ymd, TZ).format('DD/MM'),
      valorBruto: Number((bruto.get(ymd) ?? 0).toFixed(2)),
      valorLiquido: Number((liquido.get(ymd) ?? 0).toFixed(2)),
      lucroSimpay: Number((lucro.get(ymd) ?? 0).toFixed(2)),
      cashback: Number((cashback.get(ymd) ?? 0).toFixed(2)),
      taxaAdquirente: Number((taxaAdquirente.get(ymd) ?? 0).toFixed(2)),
      taxaSaque: taxaSaqueVal,
      lucroSaque: Number((profit.get(ymd) ?? 0).toFixed(2)),
      taxaServico: Number((taxaServico.get(ymd) ?? 0).toFixed(2)),
      taxaSaqueDom: taxaSaqueVal,
    };
  });
}

function buildDashboardFinanceHistoricoPorHora(
  txRowsLucro: {
    userId: string;
    amount: unknown;
    netAmount: unknown | null;
    createdAt: Date;
    description?: string | null;
    platformTag: string | null;
    paymentMethod?: string | null;
    installments?: number | null;
  }[],
  withdrawLogs: {
    createdAt: Date;
    bookkeepingAmount: unknown;
    action: string;
  }[],
  dataInicio: string,
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): DashboardFinanceHistoricoRow[] {
  const ymdTarget = parseYmdSp(dataInicio).startOf('day').format('YYYY-MM-DD');
  const bruto = new Map<number, number>();
  const liquido = new Map<number, number>();
  const lucro = new Map<number, number>();
  const cashback = new Map<number, number>();
  const taxaAdquirente = new Map<number, number>();
  const taxaServico = new Map<number, number>();
  for (const tx of txRowsLucro) {
    const d = dayjs(tx.createdAt).tz(TZ);
    if (d.format('YYYY-MM-DD') !== ymdTarget) continue;
    const h = d.hour();
    const tag = consolidadoTagParaTransacao(
      { userId: tx.userId, platformTag: tx.platformTag ?? null },
      platforms,
    );
    const b = Number(tx.amount);
    if (Number.isFinite(b)) {
      bruto.set(h, (bruto.get(h) ?? 0) + b);
    }
    liquido.set(
      h,
      (liquido.get(h) ?? 0) + valorLiquidoTransacaoConsolidado(tx, tag),
    );
    lucro.set(
      h,
      (lucro.get(h) ?? 0) + lucroSimpayUmaTransacaoConsolidado(tx, platforms),
    );
    const tc = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK', 3.0);
    cashback.set(h, (cashback.get(h) ?? 0) + tc);
    const tf = getPlatformTaxaEffective(tag, 'TAXA_FIXA_TRANSACAO', 1.0);
    taxaAdquirente.set(h, (taxaAdquirente.get(h) ?? 0) + tf + tc);
    const taxaServicoRate = TAGS_SEM_TAXA_SERVICO.has(tag)
      ? 0
      : getPlatformTaxaEffective(tag, 'TAXA_SERVICO', 4.0);
    const taxaServicoTx =
      taxaServicoRate > 0 && tx.createdAt >= getTaxaServicoEffectiveDate(tag)
        ? taxaServicoRate
        : 0;
    taxaServico.set(h, (taxaServico.get(h) ?? 0) + taxaServicoTx);
  }
  const fee = new Map<number, number>();
  const profit = new Map<number, number>();
  for (const log of withdrawLogs) {
    const d = dayjs(log.createdAt).tz(TZ);
    if (d.format('YYYY-MM-DD') !== ymdTarget) continue;
    const h = d.hour();
    const amt = Number(log.bookkeepingAmount);
    if (!Number.isFinite(amt)) continue;
    if (log.action === 'ADMIN_WITHDRAW_FEE_INC') {
      fee.set(h, (fee.get(h) ?? 0) + amt);
    } else if (log.action === 'ADMIN_WITHDRAW_PROFIT_INC') {
      profit.set(h, (profit.get(h) ?? 0) + amt);
    }
  }
  return Array.from({ length: 24 }, (_, h) => {
    const taxaSaqueVal = Number((fee.get(h) ?? 0).toFixed(2));
    return {
      label: `${String(h).padStart(2, '0')}h`,
      valorBruto: Number((bruto.get(h) ?? 0).toFixed(2)),
      valorLiquido: Number((liquido.get(h) ?? 0).toFixed(2)),
      lucroSimpay: Number((lucro.get(h) ?? 0).toFixed(2)),
      cashback: Number((cashback.get(h) ?? 0).toFixed(2)),
      taxaAdquirente: Number((taxaAdquirente.get(h) ?? 0).toFixed(2)),
      taxaSaque: taxaSaqueVal,
      lucroSaque: Number((profit.get(h) ?? 0).toFixed(2)),
      taxaServico: Number((taxaServico.get(h) ?? 0).toFixed(2)),
      taxaSaqueDom: taxaSaqueVal,
    };
  });
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
    return digits.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      '$1.$2.$3/$4-$5',
    );
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
    private readonly deleteLeads: DeleteLeadsUseCase,
    private readonly syncTransactions: SyncDomTransactionsUseCase,
    private readonly reconcilePendingTransactions: ReconcilePendingTransactionsUseCase,
    private readonly listWithdrawalsAdmin: ListWithdrawalsAdminUseCase,
    private readonly approveWithdrawal: ApproveWithdrawalUseCase,
    private readonly rejectWithdrawal: RejectWithdrawalUseCase,
    private readonly migrateRenovadaTxsToAdmin: MigrateRenovadaTxsToAdminUseCase,
    private readonly listDomTransactionsDirect: ListDomTransactionsDirectUseCase,
    private readonly syncMaquinetasUseCase: SyncMaquinetasUseCase,
    private readonly syncDomTransactionsCron: SyncDomTransactionsCron,
    private readonly revalidaSyncService: RevalidaSyncService,
    private readonly communities: CommunityManagementService,
    private readonly storageService: StorageService,
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    @Inject(HASH_SERVICE) private readonly hashService: IHashService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: IPaymentGateway,
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepository: IWalletRepository,
    private readonly platformTaxas: PlatformTaxasService,
    private readonly linkExternal: LinkExternalPlatformUserService,
    private readonly scanPlatformOwners: ScanPlatformOwnersUseCase,
    private readonly getWalletComposition: GetWalletCompositionUseCase,
    private readonly platformReporting: PlatformReportingService,
    private readonly externalPlatformDb: ExternalPlatformDbService,
  ) {}

  /**
   * Todas as páginas da listagem DOM no intervalo — mesma fonte que GET /admin/transacoes-dom.
   */
  private async fetchAllDomTransactionsForRelatorio(
    dataInicio?: string,
    dataFim?: string,
  ): Promise<DomTransactionItem[]> {
    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!domToken?.trim()) {
      throw new BadRequestException(
        'DOM_TOKEN / API_DOM_MASTER_KEY não configurado',
      );
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

  /**
   * População canônica de transações de uma plataforma.
   *
   * Uma venda pode pertencer à conta técnica da plataforma ou ter sido criada
   * por outra conta com a tag [TENANT:TAG]. Relatórios, tabelas e breakdowns
   * devem sempre considerar ambas as origens.
   */
  private async requireExclusivePlatformWallet(tag: string): Promise<void> {
    const platform = await this.prisma.platform.findUnique({
      where: { tag },
      select: { ownerUserId: true },
    });
    if (!platform) throw new NotFoundException('Plataforma não cadastrada');
    const count = await this.prisma.platform.count({
      where: { ownerUserId: platform.ownerUserId },
    });
    if (count > 1)
      throw new BadRequestException(
        'Carteira compartilhada entre plataformas; manutenção por plataforma indisponível',
      );
  }

  private async getPlatformTransactionScope(
    tag: string,
  ): Promise<Prisma.TransactionWhereInput> {
    return new PlatformAdministrationService(
      this.prisma,
      this.paymentGateway,
      this.platformReporting,
    ).getPlatformTransactionScope(tag);
  }

  /**
   * Fonte única dos relatórios por produto: o ledger local.
   *
   * A listagem DOM é somente uma integração de adquirente. Usá-la nos cards
   * fazia a tela perder Frendz e qualquer adquirente futura, além de divergir
   * da tabela do produto, que já lê Transaction.
   */
  private async findLocalPlatformReportTransactions(
    tag: string,
    startDate: string,
    endDate?: string,
    paymentMethod?: string,
  ) {
    return new PlatformAdministrationService(
      this.prisma,
      this.paymentGateway,
      this.platformReporting,
    ).findLocalPlatformReportTransactions(
      tag,
      startDate,
      endDate,
      paymentMethod,
    );
  }

  private extractOrderNumberFromText(
    value: string | null | undefined,
  ): string | null {
    return new PlatformAdministrationService(
      this.prisma,
      this.paymentGateway,
      this.platformReporting,
    ).extractOrderNumberFromText(value);
  }

  private parseDomCreatedAt(raw: string | null | undefined): Date | null {
    return new PlatformAdministrationService(
      this.prisma,
      this.paymentGateway,
      this.platformReporting,
    ).parseDomCreatedAt(raw);
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

  @Delete('leads')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Excluir solicitações de cadastro aprovadas ou rejeitadas',
  })
  async deleteLeadsRoute(@Body() body: DeleteLeadsDto) {
    return this.deleteLeads.execute({ leadIds: body.ids });
  }

  // ──────────── CRIAR CONTA ────────────

  @Post('criar-conta')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Criar conta diretamente (admin master) — suporta CPF ou CNPJ',
  })
  async criarConta(
    @Body()
    body: {
      email: string;
      password: string;
      cpf?: string;
      cnpj?: string;
    },
  ) {
    const { email, password, cpf, cnpj } = body;

    if (!cpf && !cnpj) {
      throw new BadRequestException('Informe CPF ou CNPJ');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Já existe um usuário com este e-mail');
    }

    const hashed = await this.hashService.hash(password);

    let cpfClean: string | undefined;
    let cnpjClean: string | undefined;

    if (cpf) {
      cpfClean = cpf.replace(/\D/g, '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingCpf = await (this.prisma.user as any).findFirst({
        where: { cpf: cpfClean },
      });
      if (existingCpf)
        throw new ConflictException('Já existe um usuário com este CPF');
    } else if (cnpj) {
      cnpjClean = cnpj.replace(/\D/g, '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingCnpj = await (this.prisma.user as any).findFirst({
        where: { cnpj: cnpjClean },
      });
      if (existingCnpj)
        throw new ConflictException('Já existe um usuário com este CNPJ');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await (this.prisma.user as any).create({
      data: {
        wallet: { create: { balance: 0, lockedBalance: 0 } },
        name: email.split('@')[0],
        email,
        password: hashed,
        ...(cpfClean ? { cpf: cpfClean } : {}),
        ...(cnpjClean ? { cnpj: cnpjClean } : {}),
        // Conta criada pelo master já nasce cliente SimintPay APROVADO. Sem isso
        // (clientStatus null) a conta não é reconhecida como cliente e a taxa
        // individual (CLIENT:<email>) nunca é aplicada na cobrança.
        clientStatus: 'APPROVED',
        clientApprovedAt: new Date(),
      },
    });

    await this.walletRepository.createForUser(user.id);

    // Vincula ExternalPlatformUser pelo documento identificador
    if (cpfClean) {
      await this.linkExternal.linkByCpf(user.id, cpfClean);
    } else if (cnpjClean) {
      await this.linkExternal.linkByCnpj(user.id, cnpjClean);
    }

    return {
      data: {
        userId: user.id,
        email: user.email,
        cpf: cpfClean ?? null,
        cnpj: cnpjClean ?? null,
        modulo: null,
      },
      message: 'Conta do cliente criada com sucesso (Conta Avulsa)',
    };
  }

  // ──────────── USUÁRIOS DE PLATAFORMAS EXTERNAS ────────────

  @Post('usuarios/scan')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Dispara varredura manual de donos de plataformas (extrai CPF_DONO das transações)',
  })
  async scanPlatformOwnersManual() {
    const result = await this.scanPlatformOwners.execute();
    return { data: result };
  }

  @Get('usuarios/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Exporta leads como JSON para geração de CSV no frontend',
  })
  @ApiQuery({ name: 'platform', required: false })
  @ApiQuery({
    name: 'period',
    required: false,
    description: 'mensal | trimestral | semestral | anual',
  })
  async exportExternalUsers(
    @Query('platform') platform?: string,
    @Query('period') period?: string,
  ) {
    const now = new Date();
    let dateFrom: Date | undefined;
    if (period === 'mensal')
      dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    if (period === 'trimestral')
      dateFrom = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    if (period === 'semestral')
      dateFrom = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    if (period === 'anual')
      dateFrom = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

    const where: any = { isDeleted: false };
    if (platform) where.platform = platform;
    if (dateFrom) where.createdAt = { gte: dateFrom };

    const items = await this.prisma.externalPlatformUser.findMany({
      where,
      include: {
        wallet: true,
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const sellerUserIds = items
      .filter((u) => u.userId && u.platform.toUpperCase() !== 'AREAFLIX')
      .map((u) => u.userId!);
    const areaflixEmails = items
      .filter((u) => u.platform.toUpperCase() === 'AREAFLIX' && u.user?.email)
      .map((u) => u.user!.email);

    const [activeTxUserIds, activeAreaflixEmails] = await Promise.all([
      sellerUserIds.length > 0
        ? this.prisma.transaction
            .findMany({
              where: {
                userId: { in: sellerUserIds },
                status: TransactionStatus.COMPLETED,
                createdAt: { gte: startOfMonth },
              },
              select: { userId: true },
              distinct: ['userId'],
            })
            .then((rows) => new Set(rows.map((r) => r.userId)))
        : Promise.resolve(new Set<string>()),
      areaflixEmails.length > 0
        ? this.prisma.subscriptionLink
            .findMany({
              where: {
                webhookUrl: { contains: 'areaflix', mode: 'insensitive' },
              },
              select: { id: true },
            })
            .then((links) => {
              const ids = links.map((l) => l.id);
              if (ids.length === 0) return new Set<string>();
              return this.prisma.subscriptionLinkOrder
                .findMany({
                  where: {
                    subscriptionLinkId: { in: ids },
                    customerEmail: { in: areaflixEmails },
                    status: { in: ['paid', 'active', 'approved'] },
                  },
                  select: { customerEmail: true },
                  distinct: ['customerEmail'],
                })
                .then((rows) => new Set(rows.map((r) => r.customerEmail)));
            })
        : Promise.resolve(new Set<string>()),
    ]);

    return items.map((u) => {
      let isAtivo: boolean | null = null;
      if (u.platform.toUpperCase() === 'AREAFLIX') {
        if (u.user?.email) isAtivo = activeAreaflixEmails.has(u.user.email);
      } else {
        if (u.userId) isAtivo = activeTxUserIds.has(u.userId);
      }
      return {
        nome: u.user?.name?.trim() || u.name,
        cpf: u.cpf,
        plataforma: u.platform,
        saldo: Number(u.wallet?.balance ?? 0),
        saldoBloqueado: Number(u.wallet?.lockedBalance ?? 0),
        vinculado: !!u.userId,
        status:
          isAtivo === null ? 'Não determinado' : isAtivo ? 'Ativo' : 'Inativo',
        email: u.user?.email ?? '',
        cadastro: u.createdAt.toISOString().split('T')[0],
      };
    });
  }

  /**
   * Usuários lidos DIRETO do banco de cada SaaS externo (Atlas, EbookSim,
   * Revalida, Patrimonial, Pagatg, Areaflix) — não vêm do ExternalPlatformUser
   * do simpay. Separa vendedor/operador de usuário comum conforme a regra de
   * cada plataforma (ver ExternalPlatformDbService). Somente leitura.
   */
  @Get('plataformas-externas/usuarios')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary:
      'Lista usuários de cada plataforma externa, separados em vendedores/usuários comuns',
  })
  async listExternalPlatformDbUsers() {
    const data = await this.externalPlatformDb.listAll();
    return { data };
  }

  @Get('plataformas-externas/:slug/usuarios')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Lista usuários de uma plataforma externa específica',
  })
  async listExternalPlatformDbUsersBySlug(
    @Param('slug') slug: ExternalPlatformSlug,
  ) {
    const data = await this.externalPlatformDb.listUsers(slug);
    return { data };
  }

  private externalPeopleCache?: {
    at: number;
    data: {
      platform: string;
      name: string | null;
      email: string | null;
      doc: string | null;
    }[];
  };

  /**
   * Pessoas de todos os bancos de plataforma, reduzidas a e-mail/documento para o
   * cruzamento com `User`. Cache curto: a listagem de Contas é paginada e abriria
   * 6 conexões externas a cada página. Falha de uma plataforma só a omite.
   */
  private async listExternalPeopleCached() {
    const ttlMs = 60_000;
    if (
      this.externalPeopleCache &&
      Date.now() - this.externalPeopleCache.at < ttlMs
    ) {
      return this.externalPeopleCache.data;
    }
    const doc = (cpf?: string | null, cnpj?: string | null) => {
      const c = (cpf ?? '').replace(/\D/g, '');
      if (c.length === 11) return c;
      const j = (cnpj ?? '').replace(/\D/g, '');
      return j.length === 14 ? j : null;
    };
    const results = await this.externalPlatformDb.listAll();
    const data = results.flatMap((r) =>
      [...r.vendedores, ...r.usuariosComuns]
        .map((p) => ({
          platform: r.platform as string,
          name: p.name,
          email: p.email?.trim().toLowerCase() || null,
          doc: doc(p.cpf, p.cnpj),
        }))
        .filter((p) => p.email || p.doc),
    );
    // Só guarda se ao menos uma plataforma respondeu; senão tenta de novo na próxima.
    if (results.some((r) => r.state === 'available'))
      this.externalPeopleCache = { at: Date.now(), data };
    return data;
  }

  @Get('usuarios')
  @ApiOperation({
    summary:
      'Lista usuários externos agrupados por CPF com todas as plataformas',
  })
  @ApiQuery({ name: 'platform', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, example: 20 })
  @ApiQuery({
    name: 'deleted',
    required: false,
    description: 'true = contas inativas',
  })
  @ApiQuery({
    name: 'purged',
    required: false,
    description: 'true = contas excluídas permanentemente',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Buscar por nome, CPF ou e-mail Simintpay',
  })
  @ApiQuery({
    name: 'simintpayClients',
    required: false,
    description: 'true = só contas marcadas como cliente Simintpay',
  })
  async listExternalUsers(
    @Query('platform') platform?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('deleted') deleted?: string,
    @Query('purged') purged?: string,
    @Query('search') search?: string,
    @Query('simintpayClients') simintpayClients?: string,
  ) {
    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);
    // 3 abas: ativas | inativas (deleted, não purgadas) | excluídas permanentemente (purged).
    const showPurged = purged === 'true';
    const showDeleted = deleted === 'true' && !showPurged;
    const searchTerm = search?.trim() ?? '';
    const cpfDigits = searchTerm.replace(/\D/g, '');
    const platformLower = platform?.trim().toLowerCase();

    // Contas marcadas como cliente Simintpay (já listadas em "Clientes Simintpay")
    // saem da aba de ativos e ganham aba própria. Inativas/purgadas mostram todas.
    const simintpayClientMode: 'exclude' | 'only' | 'any' =
      simintpayClients === 'true'
        ? 'only'
        : simintpayClients === 'any' || showPurged || showDeleted
          ? 'any'
          : 'exclude';
    const userSimintpayClientFilter =
      simintpayClientMode === 'any'
        ? []
        : [{ isSimintpayClient: simintpayClientMode === 'only' }];
    const extSimintpayClientFilter: Prisma.ExternalPlatformUserWhereInput[] =
      simintpayClientMode === 'only'
        ? [{ user: { is: { isSimintpayClient: true } } }]
        : simintpayClientMode === 'exclude'
          ? [
              {
                OR: [
                  { userId: null },
                  { user: { is: { isSimintpayClient: false } } },
                ],
              },
            ]
          : [];

    // ── 1. ExternalPlatformUser identities (CPF-tag-identified sellers) ──────
    const extSearchFilter = searchTerm
      ? {
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' as const } },
            // Documento: casa CPF **e** CNPJ — contas PJ só têm cnpj preenchido,
            // e olhar só cpf as tornava invisíveis na busca.
            ...(cpfDigits.length > 0
              ? [
                  { cpf: { contains: cpfDigits } },
                  { cnpj: { contains: cpfDigits } },
                ]
              : []),
            {
              user: {
                email: { contains: searchTerm, mode: 'insensitive' as const },
              },
            },
          ],
        }
      : {};

    // Entradas externas sem conta Simintpay vinculada cujo nome é o placeholder
    // "Platform User" são registros técnicos da integração, não donos reais.
    const externalTechnicalUserFilter: Prisma.ExternalPlatformUserWhereInput = {
      NOT: {
        AND: [
          { name: { equals: 'Platform User', mode: 'insensitive' } },
          { userId: null },
        ],
      },
    };

    const extMatchWhere = {
      ...(platformLower
        ? { platform: { equals: platformLower, mode: 'insensitive' as const } }
        : {}),
      // Purgadas: aba própria. Inativas: isDeleted mas NÃO purgadas. Ativas: nenhum dos dois.
      ...(showPurged
        ? { isPurged: true }
        : { isDeleted: showDeleted, isPurged: false }),
      ...externalTechnicalUserFilter,
      ...extSearchFilter,
      AND: extSimintpayClientFilter,
    };

    const extAllRowsRaw = await this.prisma.externalPlatformUser.findMany({
      where: extMatchWhere,
      select: { cpf: true, cnpj: true, createdAt: true, userId: true },
      orderBy: { createdAt: 'desc' },
    });

    // userIds already represented in ExternalPlatformUser (skip them in module query)
    const linkedUserIds = new Set(
      extAllRowsRaw.filter((r) => r.userId).map((r) => r.userId!),
    );

    // Deduplicate by document (cpf ?? cnpj) — keep latest createdAt row per owner
    const extDocSeen = new Set<string>();
    const extAllRows = extAllRowsRaw.filter((r) => {
      const doc = r.cpf ?? r.cnpj ?? '';
      if (!doc || extDocSeen.has(doc)) return false;
      extDocSeen.add(doc);
      return true;
    });

    // ── 2. Module users (platform-based platforms: renovada, bosque, etc.) ─
    // Usuários de módulo usam User.isActive como estado reversível, então seguem a
    // mesma separação de abas das contas diretas: ativos na principal e inativos
    // em "Contas inativas".
    type ModuleUser = {
      id: string;
      name: string;
      cpf: string | null;
      cnpj: string | null;
      email: string;
      isActive: boolean;
      isCompany: boolean;
      clientStatus: string | null;
      createdAt: Date;
      updatedAt: Date;
      wallet: { balance: any; lockedBalance: any } | null;
      platform: { tag: string } | null;
    };

    // Known platform master accounts identified by env var or fallback UUID.
    // These users may not have platformId set (sync never assigns it) so the
    // platform relation query alone won't find them.
    const registered = await this.prisma.platform.findMany({
      select: {
        id: true,
        tag: true,
        ownerUserId: true,
        acquirer: true,
        isActive: true,
      },
    });
    const KNOWN_PLATFORM_IDS: Record<string, string> = Object.fromEntries(
      registered.map((platform) => [
        platform.tag.toLowerCase(),
        platform.ownerUserId,
      ]),
    );

    // Map knownId → platformSlug so we can label entries found via this path.
    const knownIdToPlatform = new Map<string, string>(
      Object.entries(KNOWN_PLATFORM_IDS)
        .filter(([, id]) => id)
        .map(([slug, id]) => [id, slug]),
    );

    // Contas de módulo/plataforma (Renovada, Bosque…) não têm exclusão
    // permanente, mas podem ser inativadas/reativadas pela própria conta.
    let moduleUsers: ModuleUser[] = [];
    {
      const moduleSearchFilter = searchTerm
        ? {
            OR: [
              { name: { contains: searchTerm, mode: 'insensitive' as const } },
              // Documento: casa CPF **e** CNPJ (contas PJ só têm cnpj preenchido).
              ...(cpfDigits.length > 0
                ? [
                    { cpf: { contains: cpfDigits } },
                    { cnpj: { contains: cpfDigits } },
                  ]
                : []),
              { email: { contains: searchTerm, mode: 'insensitive' as const } },
            ],
          }
        : undefined;

      // IDs to include via the known-platform fallback path
      const knownIds = platformLower
        ? [KNOWN_PLATFORM_IDS[platformLower]].filter(Boolean)
        : [...knownIdToPlatform.keys()];

      const moduleWhere: any = {
        AND: [
          // platform-linked users OR known platform accounts (without platformId)
          {
            OR: [
              {
                platform: platformLower
                  ? { tag: { equals: platformLower, mode: 'insensitive' } }
                  : { isNot: null },
              },
              ...(knownIds.length > 0 ? [{ id: { in: knownIds } }] : []),
            ],
          },
          // 3 abas: ativa (isActive, não purgada) | inativa (!isActive, não purgada) | purgada.
          ...(showPurged
            ? [{ isPurged: true }]
            : [{ isActive: !showDeleted }, { isPurged: false }]),
          ...(linkedUserIds.size > 0
            ? [{ id: { notIn: [...linkedUserIds] } }]
            : []),
          ...userSimintpayClientFilter,
          ...(moduleSearchFilter ? [moduleSearchFilter] : []),
        ],
      };

      moduleUsers = (await this.prisma.user.findMany({
        where: moduleWhere,
        select: {
          id: true,
          name: true,
          cpf: true,
          cnpj: true,
          email: true,
          isActive: true,
          isCompany: true,
          clientStatus: true,
          createdAt: true,
          updatedAt: true,
          wallet: { select: { balance: true, lockedBalance: true } },
          platform: { select: { tag: true } },
        },
        orderBy: { createdAt: 'desc' },
      })) as ModuleUser[];
    }

    // ── 2b. Clientes diretos (contas avulsas / auto-cadastro, sem plataforma) ──
    // Users role=USER criados em "Criar Conta" ou auto-cadastro que NÃO são
    // vendedores de plataforma externa nem contas operadoras de plataforma.
    // (A migration de backfill define "cliente direto" exatamente como role=USER.)
    // Rotulados como plataforma virtual "simintpay". Aparecem apenas na aba ativa
    // e quando não há filtro por plataforma externa (eles não têm plataforma) —
    // ou quando o filtro é justamente "simintpay".
    // Cliente direto não tem `ExternalPlatformUser`, então não tem `isDeleted`: o que
    // marca ativo/inativo nele é o `User.isActive`. Por isso ele entra nas DUAS abas
    // (ativa e excluídas), filtrado por isActive — senão, ao inativar, ele sumiria
    // sem aparecer em "excluídas" e não teria como ser reativado.
    // Cliente direto usa User.isActive (ativas/inativas) e também pode ser purgado
    // (isPurged) via exclusão permanente — mesmo tratamento de contas de plataforma externa.
    const clientUserIds = new Set<string>();
    if (!platformLower || platformLower === 'simintpay') {
      const clientSearchFilter = searchTerm
        ? {
            OR: [
              { name: { contains: searchTerm, mode: 'insensitive' as const } },
              // Documento: casa CPF **e** CNPJ (contas PJ só têm cnpj preenchido).
              ...(cpfDigits.length > 0
                ? [
                    { cpf: { contains: cpfDigits } },
                    { cnpj: { contains: cpfDigits } },
                  ]
                : []),
              { email: { contains: searchTerm, mode: 'insensitive' as const } },
            ],
          }
        : undefined;

      // Ids já representados pelas outras fontes (vendedores externos + plataformas)
      const excludeIds = [
        ...linkedUserIds,
        ...moduleUsers.map((u) => u.id),
        ...knownIdToPlatform.keys(),
      ];

      const clientWhere: any = {
        AND: [
          { role: 'USER' },
          { platformId: null },
          // Marcada como empresa pelo admin master: passa a viver só em /admin/clientes.
          { isCompany: false },
          // Contas-sombra de integrações são criadas pelo JwtAuthGuard e não
          // representam clientes reais; mantê-las fora da tela de Leads.
          {
            NOT: {
              email: { endsWith: '@auto.simpay.com', mode: 'insensitive' },
            },
          },
          // 3 abas: ativa (isActive, não purgada) | inativa (!isActive, não purgada) | purgada.
          ...(showPurged
            ? [{ isPurged: true }]
            : [{ isActive: !showDeleted }, { isPurged: false }]),
          ...(excludeIds.length > 0 ? [{ id: { notIn: excludeIds } }] : []),
          ...userSimintpayClientFilter,
          ...(clientSearchFilter ? [clientSearchFilter] : []),
        ],
      };

      const clientUsers = (await this.prisma.user.findMany({
        where: clientWhere,
        select: {
          id: true,
          name: true,
          cpf: true,
          cnpj: true,
          email: true,
          isActive: true,
          isCompany: true,
          clientStatus: true,
          createdAt: true,
          updatedAt: true,
          wallet: { select: { balance: true, lockedBalance: true } },
          platform: { select: { tag: true } },
        },
        orderBy: { createdAt: 'desc' },
      })) as ModuleUser[];

      for (const u of clientUsers) clientUserIds.add(u.id);
      moduleUsers = [...moduleUsers, ...clientUsers];
    }

    // ── 2c. Contas Simintpay que também existem no banco de alguma plataforma ──
    // Lê (somente leitura) os bancos das plataformas e cruza e-mail ou CPF/CNPJ com
    // `User`. Nada é gravado: o vínculo é calculado na hora. Só na aba de ativos.
    const externalMatches = new Map<
      string,
      { platform: string; name: string | null; email: string | null }[]
    >();
    if (!showPurged && !showDeleted) {
      const slugToPlatform: Record<string, string> = {
        ebooksim: 'ebook',
        patrimonial: 'controle-patrimonial',
      };
      const digits = (v?: string | null) => (v ?? '').replace(/\D/g, '');
      const people = (await this.listExternalPeopleCached())
        .map((p) => ({
          ...p,
          platform: slugToPlatform[p.platform] ?? p.platform,
        }))
        .filter((p) => !platformLower || p.platform === platformLower);

      const emails = [
        ...new Set(people.map((p) => p.email).filter((e): e is string => !!e)),
      ];
      const docs = [
        ...new Set(people.map((p) => p.doc).filter((d): d is string => !!d)),
      ];

      if (emails.length > 0 || docs.length > 0) {
        const alreadyIds = [
          ...linkedUserIds,
          ...moduleUsers
            .filter((u) => !clientUserIds.has(u.id))
            .map((u) => u.id),
          ...knownIdToPlatform.keys(),
        ];
        const matchedUsers = (await this.prisma.user.findMany({
          where: {
            AND: [
              {
                OR: [
                  ...(emails.length > 0
                    ? [{ email: { in: emails, mode: 'insensitive' as const } }]
                    : []),
                  ...(docs.length > 0
                    ? [{ cpf: { in: docs } }, { cnpj: { in: docs } }]
                    : []),
                ],
              },
              { isActive: true },
              { isPurged: false },
              {
                NOT: {
                  email: {
                    endsWith: '@auto.simpay.com',
                    mode: 'insensitive' as const,
                  },
                },
              },
              ...(alreadyIds.length > 0 ? [{ id: { notIn: alreadyIds } }] : []),
              ...userSimintpayClientFilter,
            ],
          },
          select: {
            id: true,
            name: true,
            cpf: true,
            cnpj: true,
            email: true,
            isActive: true,
            isCompany: true,
            clientStatus: true,
            createdAt: true,
            updatedAt: true,
            wallet: { select: { balance: true, lockedBalance: true } },
            platform: { select: { tag: true } },
          },
          orderBy: { createdAt: 'desc' },
        })) as ModuleUser[];

        const term = searchTerm.toLowerCase();
        for (const u of matchedUsers) {
          const uEmail = u.email.trim().toLowerCase();
          const uDocs = [digits(u.cpf), digits(u.cnpj)].filter(Boolean);
          const hits = people.filter(
            (p) =>
              p.email === uEmail || (p.doc !== null && uDocs.includes(p.doc)),
          );
          if (hits.length === 0) continue;
          // CPF já representado por uma linha ExternalPlatformUser (mesmo sem vínculo): não duplica.
          if (!clientUserIds.has(u.id) && uDocs.some((d) => extDocSeen.has(d)))
            continue;
          if (
            term &&
            !(
              u.name.toLowerCase().includes(term) ||
              uEmail.includes(term) ||
              (cpfDigits.length > 0 && uDocs.some((d) => d.includes(cpfDigits)))
            )
          )
            continue;

          const seen = new Set<string>();
          externalMatches.set(
            u.id,
            hits
              .filter((h) =>
                seen.has(h.platform) ? false : (seen.add(h.platform), true),
              )
              .map((h) => ({
                platform: h.platform,
                name: h.name,
                email: h.email,
              })),
          );
          // Cliente direto já está na lista (2b): só ganha as plataformas extras.
          if (!clientUserIds.has(u.id)) moduleUsers.push(u);
        }
      }
    }

    const moduleUserMap = new Map(moduleUsers.map((u) => [u.id, u]));

    // ── 3. Merge and sort by createdAt desc, then paginate ────────────────────
    type ExtId = { source: 'ext'; document: string; createdAt: Date };
    type ModId = { source: 'mod'; userId: string; createdAt: Date };
    type Identity = ExtId | ModId;

    const allIdentities: Identity[] = [
      ...extAllRows
        .map((e) => ({
          source: 'ext' as const,
          document: e.cpf ?? e.cnpj ?? '',
          createdAt: e.createdAt,
        }))
        .filter((e) => e.document !== ''),
      ...moduleUsers.map((u) => ({
        source: 'mod' as const,
        userId: u.id,
        createdAt: u.createdAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const combinedTotal = allIdentities.length;
    const pagedIdentities = allIdentities.slice(
      (pageNum - 1) * size,
      pageNum * size,
    );

    if (pagedIdentities.length === 0) {
      return { data: [], total: combinedTotal, page: pageNum, pageSize: size };
    }

    // ── 4. Fetch full ExternalPlatformUser records for paged documents ────────
    const pagedExtDocs = pagedIdentities
      .filter((i): i is ExtId => i.source === 'ext')
      .map((i) => i.document);

    const pagedModUserIds = pagedIdentities
      .filter((i): i is ModId => i.source === 'mod')
      .map((i) => i.userId);

    const pagedExtCpfs = pagedExtDocs.filter((d) => d.length === 11);
    const pagedExtCnpjs = pagedExtDocs.filter((d) => d.length === 14);

    const allExtRecords =
      pagedExtDocs.length > 0
        ? await this.prisma.externalPlatformUser.findMany({
            where: {
              OR: [
                ...(pagedExtCpfs.length > 0
                  ? [{ cpf: { in: pagedExtCpfs } }]
                  : []),
                ...(pagedExtCnpjs.length > 0
                  ? [{ cnpj: { in: pagedExtCnpjs } }]
                  : []),
              ],
              ...(showPurged
                ? { isPurged: true }
                : { isDeleted: showDeleted, isPurged: false }),
              ...externalTechnicalUserFilter,
              AND: extSimintpayClientFilter,
            },
            include: {
              wallet: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  isCompany: true,
                  clientStatus: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          })
        : [];

    const byDoc = new Map<string, typeof allExtRecords>();
    for (const r of allExtRecords) {
      const key = r.cpf ?? r.cnpj ?? '';
      if (!key) continue;
      if (!byDoc.has(key)) byDoc.set(key, []);
      byDoc.get(key)!.push(r);
    }

    // ── 5. Activity check ─────────────────────────────────────────────────────
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const sellerUserIds = [
      ...allExtRecords
        .filter((u) => u.userId && u.platform.toUpperCase() !== 'AREAFLIX')
        .map((u) => u.userId!),
      ...pagedModUserIds,
    ];

    const areaflixEmails = allExtRecords
      .filter((u) => u.platform.toUpperCase() === 'AREAFLIX' && u.user?.email)
      .map((u) => u.user!.email);

    const [activeTxUserIds, activeAreaflixEmails] = await Promise.all([
      sellerUserIds.length > 0
        ? this.prisma.transaction
            .findMany({
              where: {
                userId: { in: sellerUserIds },
                status: TransactionStatus.COMPLETED,
                createdAt: { gte: startOfMonth },
              },
              select: { userId: true },
              distinct: ['userId'],
            })
            .then((rows) => new Set(rows.map((r) => r.userId)))
        : Promise.resolve(new Set<string>()),

      areaflixEmails.length > 0
        ? this.prisma.subscriptionLink
            .findMany({
              where: {
                webhookUrl: { contains: 'areaflix', mode: 'insensitive' },
              },
              select: { id: true },
            })
            .then((links) => {
              const ids = links.map((l) => l.id);
              if (ids.length === 0) return new Set<string>();
              return this.prisma.subscriptionLinkOrder
                .findMany({
                  where: {
                    subscriptionLinkId: { in: ids },
                    customerEmail: { in: areaflixEmails },
                    status: { in: ['paid', 'active', 'approved'] },
                  },
                  select: { customerEmail: true },
                  distinct: ['customerEmail'],
                })
                .then((rows) => new Set(rows.map((r) => r.customerEmail)));
            })
        : Promise.resolve(new Set<string>()),
    ]);

    // Product projections reuse persisted snapshots and explicit ownership.
    const normPlatform = (p: string) =>
      p.toLowerCase() === 'ebooksim' ? 'ebook' : p.toLowerCase();
    const liveKey = (userId: string, tag: string) =>
      `${userId}:${normPlatform(tag)}`;
    const liveBalances = new Map<
      string,
      { balance: number; locked: number; attribution: unknown }
    >();
    const relevantUsers = new Set([
      ...pagedIdentities
        .filter((i): i is ModId => i.source === 'mod')
        .map((i) => i.userId),
      ...pagedIdentities
        .filter((i): i is ExtId => i.source === 'ext')
        .flatMap((i) => byDoc.get(i.document) ?? [])
        .flatMap((r) => (r.userId ? [r.userId] : [])),
    ]);
    for (const platform of registered) {
      if (
        !relevantUsers.has(platform.ownerUserId) ||
        platform.isActive === false
      )
        continue;
      const attribution = await new PlatformAttributedBalance(this.prisma).read(
        platform,
      );
      liveBalances.set(liveKey(platform.ownerUserId, platform.tag), {
        balance: attribution.balanceCents / 100,
        locked: attribution.pendingWithdrawalsGrossCents / 100,
        attribution,
      });
    }

    // ── 6. Build response in paged order ─────────────────────────────────────
    const data = pagedIdentities
      .map((identity) => {
        if (identity.source === 'ext') {
          // Uma pessoa pode ter várias platformEntries com status misto (ex.: EbookSim
          // ativa + PagaTG desativada). A aba "Contas Inativas" deve mostrar só as
          // entradas que de fato estão no status da aba — não a pessoa inteira com
          // todas as plataformas, incluindo as que continuam ativas.
          const allRecords = byDoc.get(identity.document) ?? [];
          const records = showPurged
            ? allRecords.filter((r) => r.isPurged)
            : allRecords.filter((r) => r.isDeleted === showDeleted);
          if (records.length === 0) return null;
          const primary =
            records.find((r) => !!r.userId) ?? records[records.length - 1];
          const simpayUser = primary?.user ?? null;

          const totalBalance = records.reduce((s, r) => {
            const live = r.userId
              ? liveBalances.get(liveKey(r.userId, r.platform))
              : undefined;
            return s + (live ? live.balance : Number(r.wallet?.balance ?? 0));
          }, 0);
          const totalLocked = records.reduce((s, r) => {
            const live = r.userId
              ? liveBalances.get(liveKey(r.userId, r.platform))
              : undefined;
            return (
              s + (live ? live.locked : Number(r.wallet?.lockedBalance ?? 0))
            );
          }, 0);

          let isAtivo: boolean | null = null;
          for (const r of records) {
            if (r.platform.toUpperCase() === 'AREAFLIX') {
              if (r.user?.email) {
                const active = activeAreaflixEmails.has(r.user.email);
                if (active) {
                  isAtivo = true;
                  break;
                }
                if (isAtivo === null) isAtivo = false;
              }
            } else if (r.userId) {
              const active = activeTxUserIds.has(r.userId);
              if (active) {
                isAtivo = true;
                break;
              }
              if (isAtivo === null) isAtivo = false;
            }
          }

          return {
            id: primary.id,
            cpf: primary.cpf ?? identity.document ?? '',
            cnpj: primary.cnpj ?? '',
            name: simpayUser?.name?.trim() || primary.name,
            platformEntries: records.map((r) => ({
              id: r.id,
              platform: r.platform,
              name: r.name,
              email: r.user?.email ?? null,
            })),
            balanceAttribution: records.map((r) =>
              r.userId
                ? (liveBalances.get(liveKey(r.userId, r.platform))
                    ?.attribution ?? { state: 'unidentified' })
                : { state: 'unidentified' },
            ),
            balance: totalBalance,
            lockedBalance: totalLocked,
            vinculado: records.some((r) => !!r.userId),
            isAtivo,
            isDeleted: records.every((r) => r.isDeleted),
            deletedAt: primary.deletedAt,
            simpayUser: simpayUser
              ? {
                  id: simpayUser.id,
                  name: simpayUser.name,
                  email: simpayUser.email,
                  isCompany: simpayUser.isCompany,
                  clientStatus: simpayUser.clientStatus,
                  taxaCartao: simpayUser.clientStatus
                    ? getPlatformTaxaEffective(
                        buildUserTaxaTag(simpayUser.id),
                        'MDR_CC_MASTER_1X',
                        PLATFORM_TAXA_DEFAULTS.MDR_CC_MASTER_1X,
                      )
                    : null,
                }
              : null,
            createdAt: records.reduce(
              (min, r) => (r.createdAt < min ? r.createdAt : min),
              records[0].createdAt,
            ),
            updatedAt: records.reduce(
              (max, r) => (r.updatedAt > max ? r.updatedAt : max),
              records[0].updatedAt,
            ),
          };
        } else {
          // Module user (platform-based)
          const u = moduleUserMap.get(identity.userId);
          if (!u) return null;
          const products = registered.filter(
            (p) =>
              p.ownerUserId === u.id &&
              (!platformLower ||
                normPlatform(p.tag) === normPlatform(platformLower)),
          );
          const matches = externalMatches.get(u.id) ?? [];
          // Conta que só entrou por existir em outra plataforma: o rótulo vem do banco dela.
          const moduleSlug =
            products[0]?.tag?.toLowerCase() ??
            u.platform?.tag?.toLowerCase() ??
            (clientUserIds.has(u.id)
              ? 'simintpay'
              : (matches[0]?.platform ?? 'unknown'));
          const projections = products
            .map((p) => liveBalances.get(liveKey(u.id, p.tag)))
            .filter((p): p is NonNullable<typeof p> => !!p);
          const baseEntries = products.length
            ? products.map((p) => ({
                id: p.id,
                platform: p.tag.toLowerCase(),
                name: u.name,
                email: u.email,
              }))
            : matches.length > 0 && !clientUserIds.has(u.id)
              ? []
              : [
                  {
                    id: u.id,
                    platform: moduleSlug,
                    name: u.name,
                    email: u.email,
                  },
                ];
          const extraEntries = matches
            .filter((m) => !baseEntries.some((e) => e.platform === m.platform))
            .map((m) => ({
              id: `${u.id}:${m.platform}`,
              platform: m.platform,
              name: m.name ?? u.name,
              email: m.email ?? u.email,
            }));
          return {
            id: u.id,
            cpf: u.cpf ?? '',
            cnpj: u.cnpj ?? '',
            name: u.name,
            platformEntries: [...baseEntries, ...extraEntries],
            walletScope:
              registered.filter((p) => p.ownerUserId === u.id).length > 1
                ? 'shared-owner'
                : 'owner',
            walletBalance: Number(u.wallet?.balance ?? 0),
            walletLockedBalance: Number(u.wallet?.lockedBalance ?? 0),
            balanceAttribution: projections.map((p) => p.attribution),
            balance: projections.length
              ? projections.reduce((sum, p) => sum + p.balance, 0)
              : Number(u.wallet?.balance ?? 0),
            lockedBalance: projections.length
              ? projections.reduce((sum, p) => sum + p.locked, 0)
              : Number(u.wallet?.lockedBalance ?? 0),
            vinculado: true,
            isAtivo: activeTxUserIds.has(u.id)
              ? true
              : (null as boolean | null),
            // Cliente direto não tem isDeleted próprio — quem marca é o User.isActive.
            isDeleted: !u.isActive,
            deletedAt: null,
            simpayUser: {
              id: u.id,
              name: u.name,
              email: u.email,
              isCompany: u.isCompany,
              clientStatus: u.clientStatus,
              taxaCartao: u.clientStatus
                ? getPlatformTaxaEffective(
                    buildUserTaxaTag(u.id),
                    'MDR_CC_MASTER_1X',
                    PLATFORM_TAXA_DEFAULTS.MDR_CC_MASTER_1X,
                  )
                : null,
            },
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
          };
        }
      })
      .filter(Boolean);

    // Registros "completos" (CPF preenchido + status de atividade conhecido +
    // vinculado a uma conta Simintpay) sobem para o topo da página atual.
    // Ordenação estável: dentro de cada grupo mantém a ordem original (createdAt desc).
    const isComplete = (row: any) =>
      !!row.cpf && row.isAtivo !== null && row.vinculado === true;
    const sortedData = [...data].sort(
      (a: any, b: any) => Number(isComplete(b)) - Number(isComplete(a)),
    );

    return {
      data: sortedData,
      total: combinedTotal,
      page: pageNum,
      pageSize: size,
    };
  }

  @Patch('usuarios/:id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary:
      'Edita dados de um usuário externo e propaga para a plataforma de origem',
  })
  async updateExternalUser(
    @Param('id') id: string,
    @Body() body: { name?: string; cpf?: string; email?: string },
    @CurrentUser() authUser?: JwtPayload,
  ) {
    if (authUser?.sub) {
      const requester = await this.prisma.user.findUnique({
        where: { id: authUser.sub },
        include: { platform: true },
      });
      if (!requester || !isMasterAdminUser(requester)) {
        throw new ForbiddenException('Somente admin master pode editar leads');
      }
    }

    const externalUser = await this.prisma.externalPlatformUser.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!externalUser) {
      // Conta de módulo / cliente direto: a linha da listagem usa o User.id e não
      // tem ExternalPlatformUser. A edição vale só para a conta Simintpay.
      const account = await this.prisma.user.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!account) throw new NotFoundException('Usuário não encontrado');
      const accountData: Record<string, any> = {};
      if (body.name?.trim()) accountData.name = body.name.trim();
      if (body.cpf) accountData.cpf = body.cpf.replace(/\D/g, '');
      if (Object.keys(accountData).length > 0) {
        await this.prisma.user.update({ where: { id }, data: accountData });
      }
      return { success: true };
    }

    // Atualiza ExternalPlatformUser na api-machine
    const extData: Record<string, any> = {};
    if (body.name?.trim()) extData.name = body.name.trim();
    if (body.cpf) extData.cpf = body.cpf.replace(/\D/g, '');
    if (Object.keys(extData).length > 0) {
      await this.prisma.externalPlatformUser.update({
        where: { id },
        data: extData,
      });
    }

    // CPF mudou → atualiza também no User vinculado para manter o vínculo íntegro
    if (body.cpf && externalUser.userId) {
      const newCpfClean = body.cpf.replace(/\D/g, '');
      await this.prisma.user.update({
        where: { id: externalUser.userId },
        data: { cpf: newCpfClean },
      });
    }

    // Edição é restrita ao Simintpay — nenhuma alteração é propagada para a plataforma de origem

    return { success: true };
  }

  @Patch('usuarios/:userId/marcar-empresa')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Marca/desmarca a conta Simintpay (User) como empresa cliente — move entre as listagens de usuários e clientes. Somente admin master.',
  })
  async setUserIsCompany(
    @Param('userId') userId: string,
    @Body() body: { isCompany: boolean },
    @CurrentUser() authUser?: JwtPayload,
  ) {
    if (authUser?.sub) {
      const requester = await this.prisma.user.findUnique({
        where: { id: authUser.sub },
        include: { platform: true },
      });
      if (!requester || !isMasterAdminUser(requester)) {
        throw new ForbiddenException(
          'Somente admin master pode marcar contas como empresa',
        );
      }
    }

    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target)
      throw new NotFoundException(
        'Conta Simintpay não encontrada para este usuário',
      );

    const isCompany = !!body.isCompany;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isCompany,
        // Vira empresa → precisa passar pela fila de aprovação/taxa como cliente.
        // Deixa de ser empresa → mantém histórico de clientStatus (não some da auditoria).
        ...(isCompany && target.clientStatus == null
          ? { clientStatus: 'PENDING' as const }
          : {}),
      },
    });

    return {
      success: true,
      id: updated.id,
      isCompany: updated.isCompany,
      clientStatus: updated.clientStatus,
    };
  }

  @Patch('usuarios/:userId/cliente-simintpay')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Marca/desmarca a conta Simintpay (User) como cliente Simintpay — tira/devolve da lista de usuários ativos.',
  })
  async setUserIsSimintpayClient(
    @Param('userId') userId: string,
    @Body() body: { isSimintpayClient: boolean },
  ) {
    if (typeof body?.isSimintpayClient !== 'boolean')
      throw new BadRequestException('isSimintpayClient deve ser booleano');
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!target)
      throw new NotFoundException(
        'Conta Simintpay não encontrada para este usuário',
      );

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isSimintpayClient: body.isSimintpayClient },
      select: { id: true, isSimintpayClient: true },
    });

    return { success: true, ...updated };
  }

  @Delete('usuarios/:id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Inativa uma conta — nesta plataforma ou em todas do mesmo CPF/CNPJ (reversível; não toca no saldo)',
  })
  @ApiQuery({
    name: 'escopo',
    required: false,
    description: "'plataforma' (padrão) ou 'todas'",
    example: 'plataforma',
  })
  async deleteExternalUser(
    @Param('id') id: string,
    @Query('escopo') escopo = 'plataforma',
    @CurrentUser() authUser?: JwtPayload,
  ) {
    if (authUser?.sub) {
      const requester = await this.prisma.user.findUnique({
        where: { id: authUser.sub },
        include: { platform: true },
      });
      if (!requester || !isMasterAdminUser(requester)) {
        throw new ForbiddenException(
          'Somente admin master pode excluir contas',
        );
      }
    }

    const externalUser = await this.prisma.externalPlatformUser.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } } },
    });

    // Cliente direto (avulso) não tem entrada de plataforma — a listagem devolve o
    // User.id nessas linhas. Aí "inativar" age direto no acesso da conta.
    if (!externalUser) {
      await this.setContaDiretaAtiva(id, false);
      return {
        success: true,
        escopo: 'conta',
        inativadas: [],
        loginDesativado: true,
      };
    }

    const alvos = await this.resolveEscopoEntries(externalUser, escopo, false);
    if (alvos.length === 0)
      throw new BadRequestException('Conta já está inativa neste escopo');

    await this.prisma.externalPlatformUser.updateMany({
      where: { id: { in: alvos.map((a) => a.id) } },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    // O login (User.isActive) só cai quando NENHUMA plataforma do usuário restar ativa.
    // Antes, inativar UMA plataforma derrubava o acesso a todas.
    const loginDesativado = await this.syncLoginAtivo(externalUser.userId);

    await Promise.all(
      alvos.map((a) => this.setPlatformUserState(a, 'deactivate')),
    );

    return {
      success: true,
      escopo: alvos.length > 1 ? 'todas' : 'plataforma',
      inativadas: alvos.map((a) => a.platform),
      loginDesativado,
    };
  }

  @Post('usuarios/:id/reativar')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Reativa uma conta inativa — nesta plataforma ou em todas do mesmo CPF/CNPJ',
  })
  @ApiQuery({
    name: 'escopo',
    required: false,
    description: "'plataforma' (padrão) ou 'todas'",
    example: 'plataforma',
  })
  async reactivateExternalUser(
    @Param('id') id: string,
    @Query('escopo') escopo = 'plataforma',
    @CurrentUser() authUser?: JwtPayload,
  ) {
    if (authUser?.sub) {
      const requester = await this.prisma.user.findUnique({
        where: { id: authUser.sub },
        include: { platform: true },
      });
      if (!requester || !isMasterAdminUser(requester)) {
        throw new ForbiddenException(
          'Somente admin master pode reativar contas',
        );
      }
    }

    const externalUser = await this.prisma.externalPlatformUser.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } } },
    });

    // Cliente direto (avulso): sem entrada de plataforma — reativa o acesso da conta.
    if (!externalUser) {
      await this.setContaDiretaAtiva(id, true);
      return {
        success: true,
        escopo: 'conta',
        reativadas: [],
        loginAtivo: true,
      };
    }

    const alvos = await this.resolveEscopoEntries(externalUser, escopo, true);
    if (alvos.length === 0)
      throw new BadRequestException('Conta já está ativa neste escopo');

    await this.prisma.externalPlatformUser.updateMany({
      where: { id: { in: alvos.map((a) => a.id) } },
      data: { isDeleted: false, deletedAt: null },
    });

    // Voltou a ter plataforma ativa → o login volta. O saldo nunca foi tocado.
    const loginDesativado = await this.syncLoginAtivo(externalUser.userId);

    await Promise.all(
      alvos.map((a) => this.setPlatformUserState(a, 'activate')),
    );

    return {
      success: true,
      escopo: alvos.length > 1 ? 'todas' : 'plataforma',
      reativadas: alvos.map((a) => a.platform),
      loginAtivo: !loginDesativado,
    };
  }

  @Delete('usuarios/:id/permanente')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Exclui permanentemente (irreversível) — nesta plataforma ou em todas. O saldo é absorvido pelo master.',
  })
  @ApiQuery({
    name: 'escopo',
    required: false,
    description: "'plataforma' (padrão) ou 'todas'",
    example: 'plataforma',
  })
  async purgeExternalUser(
    @Param('id') id: string,
    @Query('escopo') escopo = 'plataforma',
    @CurrentUser() authUser?: JwtPayload,
  ) {
    let requesterId: string | undefined;
    if (authUser?.sub) {
      const requester = await this.prisma.user.findUnique({
        where: { id: authUser.sub },
        include: { platform: true },
      });
      if (!requester || !isMasterAdminUser(requester)) {
        throw new ForbiddenException(
          'Somente admin master pode excluir contas permanentemente',
        );
      }
      requesterId = requester.id;
    }

    const externalUser = await this.prisma.externalPlatformUser.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } }, wallet: true },
    });
    if (!externalUser) {
      // Cliente direto (avulso) não tem `ExternalPlatformUser` — a listagem devolve
      // o `User.id` nessas linhas. Purga direto no `User`.
      return this.purgeContaDireta(id, requesterId);
    }

    // Alvo: as entradas do escopo que já estão inativas e ainda não foram purgadas.
    const todas = String(escopo ?? '').toLowerCase() === 'todas';
    const docOr: Prisma.ExternalPlatformUserWhereInput[] = [];
    if (todas && externalUser.cpf) docOr.push({ cpf: externalUser.cpf });
    if (todas && externalUser.cnpj) docOr.push({ cnpj: externalUser.cnpj });
    const alvos =
      todas && docOr.length > 0
        ? await this.prisma.externalPlatformUser.findMany({
            where: { OR: docOr, isPurged: false },
            include: {
              user: { select: { id: true, email: true } },
              wallet: true,
            },
          })
        : [externalUser];

    let totalAbsorvido = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const alvo of alvos) {
        const saldo = Number(alvo.wallet?.balance ?? 0);
        totalAbsorvido += saldo;

        // Zera a carteira (o valor vai para o master) e registra em BalanceLog para auditoria.
        if (alvo.wallet && saldo !== 0) {
          await tx.externalPlatformWallet.update({
            where: { id: alvo.wallet.id },
            data: { balance: 0, lockedBalance: 0 },
          });
          if (alvo.userId) {
            await tx.balanceLog.create({
              data: {
                userId: alvo.userId,
                action: 'PURGE_ABSORB',
                bookkeepingAmount: saldo,

                balanceDelta: new Prisma.Decimal(0).sub(saldo),

                lockedDelta: new Prisma.Decimal(0).sub(
                  Number(alvo.wallet.lockedBalance ?? 0),
                ),

                source: 'MASTER_ADMIN_CONTROL',
                description: `Saldo absorvido pelo master ao excluir permanentemente a conta na plataforma ${alvo.platform}`,
                metadata: {
                  platform: alvo.platform,
                  externalUserId: alvo.id,
                  purgedBy: requesterId ?? null,
                },
              },
            });
          }
        }

        await tx.externalPlatformUser.update({
          where: { id: alvo.id },
          data: {
            isPurged: true,
            purgedAt: new Date(),
            purgedAmount: saldo,
            isDeleted: true,
            deletedAt: alvo.deletedAt ?? new Date(),
          },
        });
      }
    });

    // Purgar é um caso de inativação — reavalia o login.
    const loginDesativado = await this.syncLoginAtivo(externalUser.userId);
    await Promise.all(
      alvos.map((a) => this.setPlatformUserState(a, 'deactivate')),
    );

    return {
      success: true,
      escopo: todas ? 'todas' : 'plataforma',
      purgadas: alvos.map((a) => a.platform),
      saldoAbsorvido: Number(totalAbsorvido.toFixed(2)),
      loginDesativado,
    };
  }

  /**
   * Resolve quais entradas de plataforma a ação atinge.
   * - escopo `plataforma` (padrão): só a entrada clicada.
   * - escopo `todas`: todas as entradas do mesmo CPF/CNPJ.
   * `alvoDeletado` filtra pelo estado atual (inativar pega as ativas; reativar, as inativas).
   */
  private async resolveEscopoEntries(
    base: {
      id: string;
      cpf: string | null;
      cnpj: string | null;
      isDeleted: boolean;
    },
    escopo: string,
    alvoDeletado: boolean,
  ) {
    const todas = String(escopo ?? '').toLowerCase() === 'todas';

    if (!todas) {
      const entry = await this.prisma.externalPlatformUser.findUnique({
        where: { id: base.id },
        include: { user: { select: { id: true, email: true } } },
      });
      return entry && entry.isDeleted === alvoDeletado ? [entry] : [];
    }

    const doc: Prisma.ExternalPlatformUserWhereInput[] = [];
    if (base.cpf) doc.push({ cpf: base.cpf });
    if (base.cnpj) doc.push({ cnpj: base.cnpj });
    if (doc.length === 0) doc.push({ id: base.id });

    return this.prisma.externalPlatformUser.findMany({
      where: { OR: doc, isDeleted: alvoDeletado },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  /**
   * Cliente direto (conta avulsa) não tem `ExternalPlatformUser` — a listagem devolve
   * o `User.id` nessas linhas. Para ele, inativar/reativar age direto no `isActive`.
   */
  private async setContaDiretaAtiva(userId: string, ativa: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.isActive === ativa) {
      throw new BadRequestException(
        ativa ? 'Conta já está ativa' : 'Conta já está inativa',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: ativa },
    });
    return user;
  }

  /**
   * Exclusão permanente (irreversível) de uma conta direta (avulsa). Zera a
   * carteira (saldo absorvido pelo master) e marca `isPurged` — espelha o que
   * `purgeExternalUser` faz para contas de plataforma externa.
   */
  private async purgeContaDireta(userId: string, requesterId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.isPurged)
      throw new BadRequestException('Conta já foi excluída permanentemente');

    const saldo = Number(user.wallet?.balance ?? 0);

    await this.prisma.$transaction(async (tx) => {
      if (user.wallet && saldo !== 0) {
        await tx.wallet.update({
          where: { id: user.wallet.id },
          data: { balance: 0, lockedBalance: 0 },
        });
        await tx.balanceLog.create({
          data: {
            userId: user.id,
            action: 'PURGE_ABSORB',
            bookkeepingAmount: saldo,

            balanceDelta: new Prisma.Decimal(0).sub(saldo),

            lockedDelta: new Prisma.Decimal(0).sub(
              Number(user.wallet.lockedBalance ?? 0),
            ),

            source: 'MASTER_ADMIN_CONTROL',
            description:
              'Saldo absorvido pelo master ao excluir permanentemente a conta direta',
            metadata: { userId: user.id, purgedBy: requesterId ?? null },
          },
        });
      }

      await tx.user.update({
        where: { id: user.id },
        data: {
          isPurged: true,
          purgedAt: new Date(),
          purgedAmount: saldo,
          isActive: false,
        },
      });
    });

    return {
      success: true,
      escopo: 'conta',
      purgadas: ['simintpay'],
      saldoAbsorvido: Number(saldo.toFixed(2)),
      loginDesativado: true,
    };
  }

  /**
   * Mantém o login coerente: ativo enquanto houver ao menos uma plataforma ativa.
   * Retorna true se o login ficou desativado.
   */
  private async syncLoginAtivo(userId: string | null): Promise<boolean> {
    if (!userId) return false;
    const ativas = await this.prisma.externalPlatformUser.count({
      where: { userId, isDeleted: false },
    });
    const desativar = ativas === 0;
    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: !desativar },
    });
    return desativar;
  }

  /** Chama o endpoint interno da plataforma para ativar/desativar (falha não bloqueia). */
  private async setPlatformUserState(
    extUser: {
      platform: string;
      cpf: string | null;
      user?: { email: string | null } | null;
    },
    state: 'activate' | 'deactivate',
  ): Promise<void> {
    const internalToken =
      process.env.API_MACHINE_INTERNAL_TOKEN ||
      process.env.INTERNAL_SERVICE_TOKEN ||
      '';
    const headers = {
      'x-internal-token': internalToken,
      'Content-Type': 'application/json',
    };
    const platform = extUser.platform.toUpperCase();
    const cpf = extUser.cpf;
    const email = extUser.user?.email;

    const call = (base: string | undefined, path: string, body: unknown) => {
      const url = String(base ?? '').replace(/\/+$/, '');
      if (!url) return null;
      return fetch(`${url}${path}/${state}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }).catch(() => null);
    };

    const calls: (Promise<unknown> | null)[] = [];
    if ((platform === 'EBOOK' || platform === 'EBOOKSIM') && cpf) {
      calls.push(
        call(
          getPlatformIntegrationValue('EBOOK', 'BACKEND_URL') ?? undefined,
          '/internal/users',
          { cpf },
        ),
      );
    }
    if (platform === 'PAGATG' && cpf) {
      calls.push(
        call(
          getPlatformIntegrationValue('PAGATG', 'BACKEND_URL') ?? undefined,
          '/internal/users',
          { cpf },
        ),
      );
    }
    if (platform === 'AREAFLIX' && email) {
      calls.push(
        call(
          getPlatformIntegrationValue('AREAFLIX', 'BACKEND_URL') ?? undefined,
          '/internal/users',
          { email },
        ),
      );
    }
    if (platform === 'ATLAS' && email) {
      calls.push(
        call(
          getPlatformIntegrationValue('ATLAS', 'BACKEND_URL') ?? undefined,
          '/api/internal/users',
          { email },
        ),
      );
    }

    await Promise.all(calls.filter(Boolean));
  }

  @Get('users')
  @ApiOperation({ summary: 'Listar usuários para autocomplete (admin master)' })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Prefixo do e-mail',
  })
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
        include: { platform: true },
      });
      const requesterIsAdmin = requester?.role === 'ADMIN';
      const requesterIsMaster = requester
        ? isMasterAdminUser(requester)
        : false;
      if (!requesterIsAdmin || !requesterIsMaster) {
        throw new ForbiddenException(
          'Somente admin do módulo master pode consultar usuários',
        );
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
    const baseWhere = {};
    const where = search.trim()
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                {
                  name: {
                    contains: search.trim(),
                    mode: 'insensitive' as const,
                  },
                },
                {
                  slug: {
                    contains: search.trim(),
                    mode: 'insensitive' as const,
                  },
                },
              ],
            },
          ],
        }
      : baseWhere;

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
    summary:
      'Listar transações que entram no consolidado (base do cálculo do Lucro Simpay)',
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
    @Query('metodoPagamento') metodoPagamento?: string,
  ) {
    const platforms = await resolveConsolidadoPlatforms(this.prisma);
    const where = buildConsolidadoTransactionWhere(
      {
        dataInicio,
        dataFim,
        customerName,
        transactionId,
        transactionType,
        paymentLink,
        planName,
      },
      platforms,
    );
    if (metodoPagamento) {
      if (
        !['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO'].includes(
          metodoPagamento,
        )
      )
        throw new BadRequestException('Método inválido');
      where.paymentMethod = metodoPagamento as PaymentMethod;
    }
    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);

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
        plataformaTag: consolidadoTagParaTransacao(
          { userId: t.userId, platformTag: t.platformTag ?? null },
          platforms,
        ),
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
  @ApiQuery({
    name: 'metodoPagamento',
    required: false,
    description: 'PIX | CREDIT_CARD | DEBIT_CARD',
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
    @Query('metodoPagamento') metodoPagamento?: string,
  ) {
    const platforms = await resolveConsolidadoPlatforms(this.prisma);
    const platformIds = platforms.map((p) => p.id);
    const whereResumo = buildConsolidadoResumoWhere(
      dataInicio,
      dataFim,
      platforms,
    );
    if (metodoPagamento)
      whereResumo.paymentMethod =
        metodoPagamento as Prisma.TransactionWhereInput['paymentMethod'];

    const [txRowsTodas, comunidadeRows] = await Promise.all([
      this.prisma.transaction.findMany({
        where: whereResumo,
        select: {
          id: true,
          customerDocument: true,
          userId: true,
          amount: true,
          netAmount: true,
          createdAt: true,
          description: true,
          platformTag: true,
          installments: true,
          paymentMethod: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      // Ordens sem réplica Transaction continuam fazendo parte do consolidado.
      // SubscriptionLinkOrder possui paymentMethod; filtrá-las na origem evita que
      // o filtro (por exemplo, PIX) transforme 8 linhas da tabela em 7 nos cards.
      getComunidadeOrderRows(this.prisma, dataInicio, dataFim, metodoPagamento),
    ]);

    const txRowsComComunidade = [
      ...txRowsTodas,
      ...dedupeComunidadeRows(txRowsTodas, comunidadeRows),
    ];

    const txRowsLucro = txRowsComComunidade.filter((t) =>
      transacaoEntraNoLucroSimpayConsolidado(t.amount, t.description),
    );

    const brutoTotal = Number(
      txRowsLucro.reduce((s, t) => s + Number(t.amount), 0).toFixed(2),
    );

    const { totalLucroSimpay, plataformas: plataformasLucroDetalhe } =
      buildLucroSimpayDetalhePorPlataforma(txRowsLucro, platforms);

    const totalTransacoes = txRowsLucro.length;
    const customersCount = new Set(
      txRowsLucro
        .map((t) => reportBuyerCpf(t.customerDocument))
        .filter((cpf): cpf is string => cpf !== null),
    ).size;
    // taxaSimInt = valorBruto − valorLiquido por transação (mesma fórmula do tooltip do gráfico no painel)
    // Usa netAmount quando disponível, senão bruto × LIQUIDEZ — idêntico ao acumulado diário do gráfico.
    const valorLiquidoTxBase = Number(
      txRowsLucro
        .reduce((s, tx) => {
          const tag = consolidadoTagParaTransacao(
            { userId: tx.userId, platformTag: tx.platformTag ?? null },
            platforms,
          );
          return s + valorLiquidoTransacaoConsolidado(tx, tag);
        }, 0)
        .toFixed(2),
    );
    const taxaSimInt = Number((brutoTotal - valorLiquidoTxBase).toFixed(2));
    const taxaDom = Number(
      plataformasLucroDetalhe
        .reduce(
          (s, p) =>
            s + p.subtotalDeducaoTaxaFixa + p.subtotalDeducaoTaxaCashback,
          0,
        )
        .toFixed(2),
    );
    // Custo cashback = soma da TAXA_CASHBACK por transação por plataforma (padrão R$3, configurável)
    const custoCashback = Number(
      plataformasLucroDetalhe
        .reduce((s, p) => s + p.subtotalDeducaoTaxaCashback, 0)
        .toFixed(2),
    );
    // taxaServico = TAXA_SERVICO × N transações elegíveis (exclui BOSQUE/RENOVADA; apenas após 2026-05-18)
    const taxaServicoConsolidado = Number(
      plataformasLucroDetalhe
        .reduce((s, p) => s + p.subtotalDeducaoTaxaServico, 0)
        .toFixed(2),
    );
    // taxaDomMdr = soma da taxa MDR (percentual) cobrada pela DOM por transação
    const taxaDomMdr = Number(
      txRowsLucro
        .reduce((sum, tx) => {
          const amount = Number(tx.amount);
          if (!Number.isFinite(amount) || amount <= 0) return sum;
          const tag = consolidadoTagParaTransacao(
            { userId: tx.userId, platformTag: tx.platformTag ?? null },
            platforms,
          );
          const pm = String(
            (tx as { paymentMethod?: string }).paymentMethod ?? 'PIX',
          );
          const inst = Number(
            (tx as { installments?: number }).installments ?? 1,
          );
          return sum + mdrDomPct(pm, inst, amount, tag);
        }, 0)
        .toFixed(4),
    );
    // Total de repasse = tudo que sobra após a retirada da taxa sim int (= valorBruto − taxaSimInt)
    const totalRepasseConsolidado = Number(
      (brutoTotal - taxaSimInt).toFixed(2),
    );

    const querDetalhe =
      detalharLucro === '1' ||
      detalharLucro === 'true' ||
      detalharLucro?.toLowerCase() === 'sim';
    const soloResumo =
      detalharLucroSoloResumo === '1' || detalharLucroSoloResumo === 'true';

    const logDt = masterLogDateFilter(dataInicio, dataFim);
    const masterWithdrawLogBase: Prisma.BalanceLogWhereInput = {
      source: 'MASTER_ADMIN_CONTROL',
      ...(logDt ? { createdAt: logDt } : {}),
    };

    const [feeIncAgg, profitIncAgg] = await Promise.all([
      this.prisma.balanceLog.aggregate({
        where: { ...masterWithdrawLogBase, action: 'ADMIN_WITHDRAW_FEE_INC' },
        _sum: { bookkeepingAmount: true },
      }),
      this.prisma.balanceLog.aggregate({
        where: {
          ...masterWithdrawLogBase,
          action: 'ADMIN_WITHDRAW_PROFIT_INC',
        },
        _sum: { bookkeepingAmount: true },
      }),
    ]);

    const totalTaxaSaque = Number(feeIncAgg._sum.bookkeepingAmount || 0);
    const totalLucroSaque = Number(profitIncAgg._sum.bookkeepingAmount || 0);
    const lucroSimpayNum = Number(totalLucroSimpay.toFixed(2));
    const lucroTotalMaster = Number(
      (lucroSimpayNum + totalLucroSaque - totalTaxaSaque).toFixed(2),
    );

    // Compatibilidade: SimIntPay não possui plataformas nem retém o líquido dos donos.
    // Atlas e Áreaflix pertencem à conta separada do Grupo SIM.
    const lucroPlataformasSemRepasse = 0;
    // "Lucro líquido de taxas": lucro de taxa de TODAS as plataformas (taxa Sim Int − DOM)
    const lucroSimpayConRepasse = lucroSimpayNum;
    const totalRepasseReal = totalRepasseConsolidado;

    // ── Saques: calcula direto na withdrawRequest para cobrir histórico sem BalanceLog ──
    // fee > 0: exclui registros importados do histórico DOM (fee=0)
    // que não representam saques com taxa Simintpay cobrada.
    const withdrawApprovalFilter: Prisma.WithdrawRequestWhereInput = {
      status: 'APPROVED',
      fee: { gt: 0 },
      ...(dataInicio || dataFim
        ? {
            updatedAt: {
              ...(dataInicio
                ? { gte: dayjs.tz(dataInicio, TZ).startOf('day').toDate() }
                : {}),
              ...(dataFim
                ? { lte: dayjs.tz(dataFim, TZ).endOf('day').toDate() }
                : {}),
            },
          }
        : {}),
    };

    const withdrawsAprovados = await this.prisma.withdrawRequest.findMany({
      where: withdrawApprovalFilter,
      select: {
        id: true,
        grossAmount: true,
        updatedAt: true,
        userId: true,
        platform: true,
        user: {
          select: { platform: { select: { tag: true } } },
        },
      },
    });

    const DOM_FEE_SAQUE = 1;
    let lucroSaqueAcum = 0;
    // saquesPorDia: lucro de saque agregado por dia (updatedAt SP) e tag da plataforma
    const saquesPorDiaMap = new Map<string, number>(); // key = `${ymd}|${tag}`
    for (const w of withdrawsAprovados) {
      const platformTag = normalizePlatformTag(
        w.platform ?? w.user?.platform?.tag ?? 'GLOBAL',
      );
      const taxaSaqueFixa = getPlatformTaxaEffective(
        platformTag,
        'TAXA_SAQUE_FIXA',
        PLATFORM_TAXA_DEFAULTS.TAXA_SAQUE_FIXA,
      );
      const lucroW = Math.max(0, taxaSaqueFixa - DOM_FEE_SAQUE);
      lucroSaqueAcum += lucroW;
      if (lucroW > 0) {
        const ymd = dayjs(w.updatedAt).tz(TZ).format('YYYY-MM-DD');
        const key = `${ymd}|${platformTag}`;
        saquesPorDiaMap.set(key, (saquesPorDiaMap.get(key) ?? 0) + lucroW);
      }
    }
    const lucroSaque = Number(lucroSaqueAcum.toFixed(2));
    const saquesPorDia = [...saquesPorDiaMap.entries()].map(([key, lucro]) => {
      const [ymd, platformTag] = key.split('|') as [string, string];
      return { ymd, platformTag, lucroSaque: Number(lucro.toFixed(2)) };
    });
    const taxaSaqueDOM = Number(totalTaxaSaque.toFixed(2));
    const saquesAprovadosQtd = withdrawsAprovados.length;
    const saquesAprovadosValor = Number(
      withdrawsAprovados
        .reduce((s, w) => s + Number(w.grossAmount), 0)
        .toFixed(2),
    );

    const temFiltroData = Boolean(dataInicio?.trim() || dataFim?.trim());

    let valorLiquidoPlataformas: number;
    let valorLiquidoCriterio: string;

    if (temFiltroData) {
      valorLiquidoPlataformas = Number(
        txRowsLucro
          .reduce((s, tx) => {
            const tag = consolidadoTagParaTransacao(
              { userId: tx.userId, platformTag: tx.platformTag ?? null },
              platforms,
            );
            return s + valorLiquidoTransacaoConsolidado(tx, tag);
          }, 0)
          .toFixed(2),
      );
      valorLiquidoCriterio =
        'Com dataInicio/dataFim: soma do líquido das transações elegíveis no período (campo netAmount; se vazio, bruto × *_LIQUIDEZ da plataforma). Alinhado ao valor bruto e ao lucro Simpay do período.';
    } else {
      const platformUsers = await this.prisma.user.findMany({
        where: { id: { in: platformIds } },
        include: { platform: true },
      });
      let snap = 0;
      for (const u of platformUsers) {
        snap += await computeUserNetBalance(this.prisma, u.id, u.platform?.tag);
      }
      valorLiquidoPlataformas = Number(snap.toFixed(2));
      valorLiquidoCriterio =
        'Sem dataInicio/dataFim: soma dos saldos líquidos atuais (netBalance) das contas plataforma no Simpay — não é soma de transações.';
    }

    const estornos = await aggregateProductRefunds(
      this.prisma,
      platformIds,
      dataInicio,
      dataFim,
    );

    const chargebackDateWhere: Prisma.DateTimeFilter = {};
    if (dataInicio)
      chargebackDateWhere.gte = dayjs
        .tz(dataInicio, TZ)
        .startOf('day')
        .toDate();
    if (dataFim)
      chargebackDateWhere.lte = dayjs.tz(dataFim, TZ).endOf('day').toDate();
    const chargebackTxs = await this.prisma.transaction.findMany({
      where: {
        status: TransactionStatus.CHARGEBACK,
        ...buildConsolidadoScopeOr(platformIds),
        ...(Object.keys(chargebackDateWhere).length > 0
          ? { createdAt: chargebackDateWhere }
          : {}),
      },
      select: { amount: true },
    });
    const chargebacks = {
      quantidade: chargebackTxs.length,
      valor:
        Math.round(
          chargebackTxs.reduce((acc, t) => acc + Number(t.amount ?? 0), 0) *
            100,
        ) / 100,
    };

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
        select: { createdAt: true, bookkeepingAmount: true, action: true },
      });
      if (isSingleCalendarDaySp(di, df)) {
        lucroTotalMasterHistorico = buildLucroTotalMasterHistoricoPorHora(
          txRowsLucro,
          withdrawLogsHistorico,
          di,
          platforms,
        );
        lucroTotalMasterHistoricoCriterio =
          'Quando dataInicio e dataFim são o mesmo dia (America/Sao_Paulo): 24 pontos (horas 00h–23h). Mesma fórmula do consolidado diário, agregada por hora do createdAt da transação ou do BalanceLog.';
        dashboardFinanceHistorico = buildDashboardFinanceHistoricoPorHora(
          txRowsLucro,
          withdrawLogsHistorico,
          di,
          platforms,
        );
      } else {
        lucroTotalMasterHistorico = buildLucroTotalMasterHistoricoDiario(
          txRowsLucro,
          withdrawLogsHistorico,
          di,
          df,
          platforms,
        );
        dashboardFinanceHistorico = buildDashboardFinanceHistoricoDiario(
          txRowsLucro,
          withdrawLogsHistorico,
          di,
          df,
          platforms,
        );
      }
    }

    // Parcelamento global: apenas transações de cartão de crédito (exclui débito e PIX)
    let totalParcelamentoBruto = 0;
    let totalParcelamentoSimIntPay = 0;
    for (const tx of txRowsLucro) {
      const pm = String(
        (tx as { paymentMethod?: string }).paymentMethod ?? '',
      ).toLowerCase();
      if (!pm.includes('credit')) continue;
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const inst = Math.min(
        Math.max(
          Number((tx as { installments?: number }).installments ?? 1) || 1,
          1,
        ),
        12,
      );
      const tag = consolidadoTagParaTransacao(
        { userId: tx.userId, platformTag: tx.platformTag ?? null },
        platforms,
      );
      const domFee = estimateDomFeeReais({
        amountReais: amount,
        paymentMethod: (tx as { paymentMethod?: string }).paymentMethod,
        installments: inst,
        tenantTag: tag,
      });
      const masterKey = `MDR_CC_MASTER_${inst}X` as PlataformaTaxaKey;
      const masterRate = getPlatformTaxaEffective(
        tag,
        masterKey,
        (PLATFORM_TAXA_DEFAULTS as Record<string, number>)[masterKey] ?? 0,
      );
      totalParcelamentoBruto += domFee + amount * masterRate;
      totalParcelamentoSimIntPay += amount * masterRate;
    }

    // Recorte só de boleto para os cards do relatório (quantidade, bruto, DOM, SimIntPay, lucro).
    const boletoRows = txRowsLucro.filter((tx) =>
      String((tx as { paymentMethod?: string | null }).paymentMethod ?? '')
        .toUpperCase()
        .includes('BOLETO'),
    );
    let boletoBruto = 0;
    let boletoDom = 0;
    let boletoSimIntPay = 0;
    for (const tx of boletoRows) {
      const amount = Number(tx.amount) || 0;
      if (amount <= 0) continue;
      const tag = consolidadoTagParaTransacao(
        { userId: tx.userId, platformTag: tx.platformTag ?? null },
        platforms,
      );
      const f = calculateBoletoFees(amount, tag);
      boletoBruto += amount;
      boletoDom += f.domFeeAmount;
      boletoSimIntPay += f.platformFeeTotal;
    }
    const boleto = {
      quantidade: boletoRows.length,
      valorBruto: Number(boletoBruto.toFixed(2)),
      taxaDom: Number(boletoDom.toFixed(2)),
      taxaSimIntPay: Number(boletoSimIntPay.toFixed(2)),
      lucro: Number((boletoSimIntPay - boletoDom).toFixed(2)),
    };

    const payload: Record<string, unknown> = {
      totalTransacoes,
      customersCount,
      valorBruto: brutoTotal,
      taxaSimInt,
      taxaDom,
      taxaDomMdr,
      boleto,
      taxaServico: taxaServicoConsolidado,
      custoCashback,
      taxaParcelamentoBruto: Math.round(totalParcelamentoBruto * 100) / 100,
      taxaParcelamentoSimIntPay:
        Math.round(totalParcelamentoSimIntPay * 100) / 100,
      totalRepasseConsolidado,
      totalRepasseReal,
      lucroPlataformasSemRepasse,
      lucroSimpayConRepasse,
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
      lucroSaque,
      taxaSaqueDOM,
      saquesAprovados: {
        quantidade: saquesAprovadosQtd,
        valor: saquesAprovadosValor,
      },
      estornos: {
        quantidade: estornos.quantidade,
        valor: estornos.valor,
      },
      chargebacks: {
        quantidade: chargebacks.quantidade,
        valor: chargebacks.valor,
      },
      // Transações sem plataforma/produto atribuível (tag NAO-IDENTIFICADA) — sempre
      // presente (0 quando tudo identificado), para o card do relatório nunca "esconder" nada.
      naoIdentificadas: (() => {
        const ni = plataformasLucroDetalhe.find(
          (p) => p.tag === TAG_NAO_IDENTIFICADA,
        );
        return {
          quantidade: ni?.quantidadeTransacoes ?? 0,
          valor: Number((ni?.subtotalBruto ?? 0).toFixed(2)),
        };
      })(),
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
            const semLista = Object.fromEntries(
              Object.entries(row).filter(([key]) => key !== 'transacoes'),
            );
            return semLista;
          })
        : plataformasLucroDetalhe;

      const excluidas = txRowsTodas.filter(
        (t) => !transacaoEntraNoLucroSimpayConsolidado(t.amount, t.description),
      );

      payload.lucroSimpayDetalhe = {
        formula:
          'Por transação: lucro = bruto × (1 − LIQUIDEZ_LOJISTA) + TAXA_SERVICO − TAXA_FIXA_TRANSACAO − TAXA_CASHBACK. TAXA_SERVICO é receita da Sim Int Pay cobrada do vendedor (R$4 padrão; 0 para BOSQUE/RENOVADA e antes de 2026-05-18). LIQUIDEZ_LOJISTA vem do .env (*_LIQUIDEZ, ex. 0,91 → 9% do bruto para o master).',
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
        saquesPorDia,
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
      _sum: { bookkeepingAmount: true },
    });

    return {
      totalTaxaSaque: Number(feeInc._sum.bookkeepingAmount || 0),
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
      _sum: { bookkeepingAmount: true },
    });

    return {
      totalLucroSaque: Number(profitInc._sum.bookkeepingAmount || 0),
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

  @Get('relatorios/mensal')
  @ApiOperation({
    summary: 'Resultados mensais (últimos N meses ou intervalo YYYY-MM)',
  })
  @ApiQuery({ name: 'meses', required: false, example: '12' })
  @ApiQuery({
    name: 'dataInicio',
    required: false,
    description: 'Mês inicial no formato YYYY-MM',
    example: '2026-01',
  })
  @ApiQuery({
    name: 'dataFim',
    required: false,
    description: 'Mês final no formato YYYY-MM',
    example: '2026-04',
  })
  async getRelatorioMensal(
    @Query('meses') mesesParam?: string,
    @Query('dataInicio') dataInicioMes?: string,
    @Query('dataFim') dataFimMes?: string,
    @Query('metodoPagamento') metodoPagamento?: string,
  ) {
    const platforms = await resolveConsolidadoPlatforms(this.prisma);
    const agora = dayjs().tz(TZ);

    let inicioJanela: dayjs.Dayjs;
    let fimJanela: dayjs.Dayjs;
    let meses: number;

    if (
      dataInicioMes?.match(/^\d{4}-\d{2}(-\d{2})?$/) &&
      dataFimMes?.match(/^\d{4}-\d{2}(-\d{2})?$/)
    ) {
      inicioJanela = dayjs
        .tz(`${dataInicioMes.slice(0, 7)}-01`, TZ)
        .startOf('month');
      fimJanela = dayjs.tz(`${dataFimMes.slice(0, 7)}-01`, TZ).endOf('month');
      meses = fimJanela.diff(inicioJanela, 'month') + 1;
    } else {
      meses = Math.min(Math.max(Number(mesesParam) || 12, 1), 36);
      inicioJanela = agora.subtract(meses - 1, 'month').startOf('month');
      fimJanela = agora.endOf('month');
    }

    const where = buildConsolidadoResumoWhere(
      dataInicioMes?.length === 10
        ? dataInicioMes
        : inicioJanela.format('YYYY-MM-DD'),
      dataFimMes?.length === 10 ? dataFimMes : fimJanela.format('YYYY-MM-DD'),
      platforms,
    );

    if (metodoPagamento) {
      if (
        !['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO'].includes(
          metodoPagamento,
        )
      )
        throw new BadRequestException('Método inválido');
      where.paymentMethod = metodoPagamento as PaymentMethod;
    }
    const [txRowsBase, comunidadeRowsMensal] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        select: {
          userId: true,
          amount: true,
          netAmount: true,
          createdAt: true,
          description: true,
          platformTag: true,
          installments: true,
          domFee: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      getComunidadeOrderRows(
        this.prisma,
        dataInicioMes?.length === 10
          ? dataInicioMes
          : inicioJanela.format('YYYY-MM-DD'),
        dataFimMes?.length === 10 ? dataFimMes : fimJanela.format('YYYY-MM-DD'),
        metodoPagamento,
      ),
    ]);

    const txRows = [
      ...txRowsBase,
      ...dedupeComunidadeRows(txRowsBase, comunidadeRowsMensal).filter(
        (tx) => !metodoPagamento || tx.paymentMethod === metodoPagamento,
      ),
    ];

    type MesRow = {
      mes: string;
      vendas: number;
      valorBruto: number;
      taxaAdquirente: number;
      lucroLiquido: number;
      totalRepassado: number;
    };

    const byMonth = new Map<
      string,
      {
        bruto: number;
        lucro: number;
        liquido: number;
        count: number;
        acquirerFees: number;
      }
    >();

    for (const tx of txRows) {
      if (!transacaoEntraNoLucroSimpayConsolidado(tx.amount, tx.description))
        continue;
      const mes = dayjs(tx.createdAt).tz(TZ).format('YYYY-MM');
      const bruto = Number(tx.amount);
      const lucro = lucroSimpayUmaTransacaoConsolidado(tx, platforms);
      const tag = consolidadoTagParaTransacao(
        { userId: tx.userId, platformTag: tx.platformTag ?? null },
        platforms,
      );
      const liquido = valorLiquidoTransacaoConsolidado(tx, tag);
      const prev = byMonth.get(mes) ?? {
        bruto: 0,
        lucro: 0,
        liquido: 0,
        count: 0,
        acquirerFees: 0,
      };
      byMonth.set(mes, {
        bruto: prev.bruto + bruto,
        lucro: prev.lucro + lucro,
        liquido: prev.liquido + liquido,
        count: prev.count + 1,
        acquirerFees:
          prev.acquirerFees + ('domFee' in tx ? Number(tx.domFee ?? 0) : 0),
      });
    }

    // Mais recente primeiro (decrescente)
    const resultado: MesRow[] = [];
    for (let i = 0; i < meses; i++) {
      const mes = fimJanela.subtract(i, 'month').format('YYYY-MM');
      const agg = byMonth.get(mes) ?? {
        bruto: 0,
        lucro: 0,
        liquido: 0,
        count: 0,
        acquirerFees: 0,
      };
      resultado.push({
        mes,
        vendas: agg.count,
        valorBruto: Number(agg.bruto.toFixed(2)),
        taxaAdquirente: Number(agg.acquirerFees.toFixed(2)),
        lucroLiquido: Number(agg.lucro.toFixed(2)),
        totalRepassado: Number(agg.liquido.toFixed(2)),
      });
    }

    return { meses: resultado };
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
    const platforms = await resolveConsolidadoPlatforms(this.prisma);
    const platformIds = platforms.map((p) => p.id);
    const whereResumo = buildConsolidadoResumoWhere(
      dataInicio,
      dataFim,
      platforms,
    );

    const [txRowsTodas, comunidadeRowsRepasse] = await Promise.all([
      this.prisma.transaction.findMany({
        where: whereResumo,
        select: {
          id: true,
          userId: true,
          amount: true,
          netAmount: true,
          createdAt: true,
          description: true,
          platformTag: true,
          installments: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      getComunidadeOrderRows(this.prisma, dataInicio, dataFim),
    ]);

    const txRowsAll = [
      ...txRowsTodas,
      ...dedupeComunidadeRows(txRowsTodas, comunidadeRowsRepasse),
    ];
    const txRowsLucro = txRowsAll.filter((t) =>
      transacaoEntraNoLucroSimpayConsolidado(t.amount, t.description),
    );

    const { totalLucroSimpay } = buildLucroSimpayDetalhePorPlataforma(
      txRowsLucro,
      platforms,
    );
    const lucroSimpayNum = Number(totalLucroSimpay.toFixed(2));

    const temFiltroData = Boolean(dataInicio?.trim() || dataFim?.trim());
    let valorLiquidoPlataformas: number;
    let valorLiquidoCriterio: string;

    if (temFiltroData) {
      valorLiquidoPlataformas = Number(
        txRowsLucro
          .reduce((s, tx) => {
            const tag = consolidadoTagParaTransacao(
              { userId: tx.userId, platformTag: tx.platformTag ?? null },
              platforms,
            );
            return s + valorLiquidoTransacaoConsolidado(tx, tag);
          }, 0)
          .toFixed(2),
      );
      valorLiquidoCriterio =
        'Com dataInicio/dataFim: soma do líquido das transações elegíveis no período (netAmount ou bruto × *_LIQUIDEZ). Igual ao campo valorLiquido do consolidado.';
    } else {
      const platformUsers = await this.prisma.user.findMany({
        where: { id: { in: platformIds } },
        include: { platform: true },
      });
      let snap = 0;
      for (const u of platformUsers) {
        snap += await computeUserNetBalance(this.prisma, u.id, u.platform?.tag);
      }
      valorLiquidoPlataformas = Number(snap.toFixed(2));
      valorLiquidoCriterio =
        'Sem dataInicio/dataFim: soma dos saldos líquidos atuais (netBalance) das contas plataforma — igual ao consolidado; combine com período explícito para repasse alinhado ao lucro Simpay do intervalo.';
    }

    const totalRepasse = Number(
      (valorLiquidoPlataformas - lucroSimpayNum).toFixed(2),
    );

    return {
      totalRepasse,
      valorLiquido: valorLiquidoPlataformas,
      lucroSimpay: lucroSimpayNum,
      valorLiquidoCriterio,
      totalRepasseCriterio:
        'totalRepasse = valorLiquido − lucroSimpay. Transações: COMPLETED das contas do consolidado; lucro exclui ajustes/sincronização (mesma regra do consolidado).',
    };
  }

  @Get('plataformas/saldos-resumo')
  @ApiOperation({
    summary:
      'Saldo disponível (ao vivo) por plataforma — cards de "Saldos por Plataforma".',
  })
  async getPlataformasSaldosResumo() {
    return new PlatformAdministrationService(
      this.prisma,
      this.paymentGateway,
      this.platformReporting,
    ).getPlataformasSaldosResumo();
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
    const txs = await this.fetchAllDomTransactionsForRelatorio(
      dataInicio,
      dataFim,
    );
    const mapCount = new Map<DomStatusBucket, number>();
    for (const tx of txs) {
      const bucket = domRawStatusToBucket(tx.status);
      mapCount.set(bucket, (mapCount.get(bucket) ?? 0) + 1);
    }
    const total = txs.length;
    const buckets: DomStatusBucket[] = [
      'PENDING',
      'COMPLETED',
      'REFUNDED',
      'FAILED',
    ];
    const items = buckets
      .map((codigo) => {
        const quantidade = mapCount.get(codigo) ?? 0;
        const percentual =
          total > 0 ? Number(((quantidade / total) * 100).toFixed(2)) : 0;
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
    const txs = await this.fetchAllDomTransactionsForRelatorio(
      dataInicio,
      dataFim,
    );
    const mapCount = new Map<DomMethodBucket, number>();
    for (const tx of txs) {
      const bucket = domPaymentMethodToBucket(tx.payment_method);
      mapCount.set(bucket, (mapCount.get(bucket) ?? 0) + 1);
    }
    const total = txs.length;
    const buckets: DomMethodBucket[] = [
      'PIX',
      'CREDIT_CARD',
      'DEBIT_CARD',
      'BOLETO',
    ];
    const items = buckets
      .map((codigo) => {
        const quantidade = mapCount.get(codigo) ?? 0;
        const percentual =
          total > 0 ? Number(((quantidade / total) * 100).toFixed(2)) : 0;
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
    @Body()
    body: {
      name: string;
      slug?: string;
      description?: string;
      isActive?: boolean;
    },
  ) {
    const name = body.name?.trim();
    if (!name)
      throw new BadRequestException('Nome da comunidade é obrigatório');
    const slugBase = (body.slug ?? name)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slugBase) throw new BadRequestException('Slug inválido');

    const already = await this.prisma.community.findUnique({
      where: { slug: slugBase },
    });
    if (already) {
      throw new ConflictException(
        `Já existe uma comunidade com slug "${slugBase}"`,
      );
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
    const tag = existing.slug.toUpperCase();
    await this.prisma.$transaction([
      this.prisma.platformTaxaOverride.deleteMany({ where: { tag } }),
      this.prisma.community.delete({ where: { id } }),
    ]);
    invalidatePlatformTaxaCache();
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
    const activeAccesses = community.accesses.filter(
      (a) => a.isActive && a.expiresAt > now,
    );
    const expiredAccesses = community.accesses.filter(
      (a) => !a.isActive || a.expiresAt <= now,
    );
    const minDays = activeAccesses.length
      ? Math.min(
          ...activeAccesses.map((a) =>
            Math.max(
              0,
              Math.floor((a.expiresAt.getTime() - now.getTime()) / 86400000),
            ),
          ),
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
        const isPaidOrActive = [
          'active',
          'completed',
          'approved',
          'paid',
          'success',
          'trial',
        ].includes(normalized);
        const isPending = [
          'pending',
          'waiting',
          'waiting_payment',
          'processing',
          'pix_pending',
        ].includes(normalized);
        const renewAt = isPaidOrActive
          ? new Date(
              createdAt.getTime() +
                mapFrequencyToDays(link.frequencyType) * 86400000,
            )
          : null;

        const statusLabel = isPaidOrActive
          ? 'Ativo'
          : isPending
            ? 'Pendente'
            : 'Inativo';
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
      const nomeMatch =
        !nome?.trim() ||
        row.nome?.toLowerCase().includes(nome.trim().toLowerCase());
      const emailMatch =
        !email?.trim() ||
        row.email?.toLowerCase().includes(email.trim().toLowerCase());
      const cpfDigits = (cpf ?? '').replace(/\D/g, '');
      const rowCpfDigits = (row.cpf ?? '').replace(/\D/g, '');
      const cpfMatch = !cpfDigits || rowCpfDigits.includes(cpfDigits);

      const start = dataInicio ? new Date(`${dataInicio}T00:00:00`) : null;
      const end = dataFim ? new Date(`${dataFim}T23:59:59`) : null;
      const assinaturaDate = row.dataAssinatura
        ? new Date(row.dataAssinatura)
        : null;
      const dateMatch = !assinaturaDate
        ? true
        : (!start || assinaturaDate >= start) &&
          (!end || assinaturaDate <= end);

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
    @Body()
    body: { type: 'SUBSCRIPTION_LINK' | 'PAYMENT_LINK'; linkId: string },
  ) {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
    });
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
  @ApiOperation({
    summary: 'Importar transações DOM do mês atual para o banco local',
  })
  async syncTransactionsRoute(@CurrentUser() user: JwtPayload | undefined) {
    const result = await this.syncTransactions.execute({
      userId: user?.sub ?? '',
      beginDate: dayjs().startOf('month').format('YYYY-MM-DD'),
      endDate: dayjs().format('YYYY-MM-DD'),
    });
    return { data: result };
  }

  @Post('reconciliar-pendentes')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Reconcilia transações PENDING contra a DOM (fonte da verdade): completa as que a DOM já aprovou (webhook perdido), creditando a carteira. Idempotente.',
  })
  async reconciliarPendentesRoute(@Query('horas') horas?: string) {
    const sinceHours = horas ? Math.max(1, Number(horas)) : undefined;
    const result = await this.reconcilePendingTransactions.execute({
      sinceHours,
    });
    return { data: result };
  }

  @Post('sync/cleanup-renovada')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Limpar transações incorretas da Renovada (vindas do master token) antes de re-sincronizar',
  })
  async cleanupRenovada() {
    await this.requireExclusivePlatformWallet('RENOVADA');
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';

    // Contar antes
    const countBefore = await this.prisma.transaction.count({
      where: { userId: RENOVADA_ID },
    });

    // Limpar domToken do user (era master token, causava sync de TODAS plataformas)
    await this.prisma.user
      .update({
        where: { id: RENOVADA_ID },
        data: { domToken: null },
      })
      .catch(() => {
        /* user pode não existir ainda */
      });

    // Deletar histórico de status dessas transações
    const renovadaTxIds = await this.prisma.transaction.findMany({
      where: { userId: RENOVADA_ID },
      select: { id: true },
    });

    if (renovadaTxIds.length > 0) {
      await this.prisma.transactionStatusHistory.deleteMany({
        where: { transactionId: { in: renovadaTxIds.map((t) => t.id) } },
      });
    }

    // Deletar todas as transações da Renovada
    const deleted = await this.prisma.transaction.deleteMany({
      where: { userId: RENOVADA_ID },
    });

    // Zerar carteira
    await this.prisma.wallet
      .update({
        where: { userId: RENOVADA_ID },
        data: { balance: 0, lockedBalance: 0, version: { increment: 1 } },
      })
      .catch(() => {
        /* wallet pode não existir */
      });

    return {
      message: `Limpeza concluída. ${deleted.count} transações removidas. domToken zerado.`,
      deletedCount: deleted.count,
      countBefore,
    };
  }

  @Post('sync/cleanup-ebook')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Remover transações do EBOOK importadas via legado api-dom',
  })
  async cleanupEbook() {
    await this.requireExclusivePlatformWallet('EBOOK');
    const EBOOK_ID = getPlatformOwnerId('EBOOK') ?? '';

    const whereEbookImported: Prisma.TransactionWhereInput = {
      AND: [
        {
          OR: [{ userId: EBOOK_ID }, whereTransactionPlatform('EBOOK')],
        },
        {
          OR: [
            { domPaymentId: { not: null } },
            { domTransactionId: { not: null } },
          ],
        },
      ],
    };

    const txBefore = await this.prisma.transaction.count({
      where: whereEbookImported,
    });
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

    await this.prisma.wallet
      .update({
        where: { userId: EBOOK_ID },
        data: { balance: 0, lockedBalance: 0, version: { increment: 1 } },
      })
      .catch(() => {
        /* wallet pode não existir */
      });

    return {
      message: `Limpeza EBOOK concluída. ${deletedTx.count} transações e ${deletedWd.count} saques removidos.`,
      ebookId: EBOOK_ID,
      transactionsBefore: txBefore,
      withdrawalsBefore: wdBefore,
      transactionsDeleted: deletedTx.count,
      withdrawalsDeleted: deletedWd.count,
    };
  }

  @Post('sync/full-revalida')
  @ApiOperation({
    summary:
      'Sincronização completa de histórico (Revalida) - puxa da DOM Pagamentos',
  })
  async syncFullRevalida() {
    return this.revalidaSyncService.syncFull();
  }

  @Post('sync/backfill-comunidade')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Backfill: cria Transaction com [TENANT:SLUG] para ordens de assinatura de comunidade sem Transaction correspondente',
  })
  async backfillComunidadeTransactions() {
    const communityLinkIds = await this.prisma.communityLinkBinding.findMany({
      where: { subscriptionLinkId: { not: null } },
      select: {
        subscriptionLinkId: true,
        community: { select: { slug: true } },
      },
      distinct: ['subscriptionLinkId'],
    });
    const linkToSlug = new Map(
      communityLinkIds.map((b) => [
        b.subscriptionLinkId!,
        b.community.slug.toUpperCase(),
      ]),
    );
    const subscriptionLinkIds = [...linkToSlug.keys()].filter(Boolean);

    if (subscriptionLinkIds.length === 0) return { created: 0, skipped: 0 };

    const orders = await this.prisma.subscriptionLinkOrder.findMany({
      where: {
        subscriptionLinkId: { in: subscriptionLinkIds },
        status: 'paid',
      },
      include: { subscriptionLink: { select: { name: true, userId: true } } },
      orderBy: { createdAt: 'asc' },
    });

    let created = 0;
    let skipped = 0;

    for (const order of orders) {
      const communityTag =
        linkToSlug.get(order.subscriptionLinkId ?? '') ?? 'UNKNOWN';
      const payId =
        order.domPixPaymentId?.trim() || `SL_${communityTag}_${order.id}`;
      const exists = await this.prisma.transaction.findFirst({
        where: { domPaymentId: payId },
        select: { id: true },
      });
      if (exists) {
        skipped++;
        continue;
      }

      const gross = Number(order.amountCharged);
      const pf = Number(order.platformFeeAmount);
      const netAmount = gross - pf;

      await this.prisma.transaction.create({
        data: {
          userId: order.subscriptionLink.userId,
          amount: gross,
          netAmount,
          totalFee: pf,
          domFee: 0,
          platformFee: pf,
          status: 'COMPLETED',
          paymentMethod: order.paymentMethod,
          description: `${order.subscriptionLink.name} [TENANT:${communityTag}] subOrder=${order.id}`,
          ...transactionPlatformTagData(communityTag),
          domPaymentId: payId,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          customerDocument: order.customerDocument,
          customerPhone: order.customerPhone ?? undefined,
          createdAt: order.createdAt,
        },
      });
      created++;
    }

    return { created, skipped };
  }

  @Post('sync/sync-wallet-renovada')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Definir saldo base da carteira Renovada (execução única para inicializar o saldo correto)',
    description:
      'Define wallet em bruto = balance/fator. Remove saques APPROVED/COMPLETED antigos para não distorcer o /auth/me (fórmula com debitedBruto). Saques PENDING são mantidos.',
  })
  @ApiQuery({
    name: 'balance',
    required: true,
    description: 'Saldo base a definir (ex: 3840.70)',
    example: 3840.7,
  })
  async syncWalletRenovada(@Query('balance') balanceParam?: string) {
    await this.requireExclusivePlatformWallet('RENOVADA');
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';

    try {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId: RENOVADA_ID },
      });
      if (!wallet) {
        return { message: 'Wallet da Renovada não encontrada no simpay' };
      }

      const oldBalance = Number(wallet.balance);

      if (!balanceParam) {
        return {
          message:
            'Forneça o saldo base via query: ?balance=3840.70. Este endpoint define o saldo inicial; a partir daí o saldo é gerenciado incrementalmente.',
          currentBalance: oldBalance,
        };
      }

      // O valor informado é o netBalance desejado (saldo líquido exibido).
      // wallet.balance armazena o valor bruto: netBalance / fatorLiquidez.
      const fatorLiquidez = getPlatformTaxaEffective(
        'RENOVADA',
        'LIQUIDEZ',
        PLATFORM_TAXA_DEFAULTS.LIQUIDEZ,
      );
      const netBalance = Number(balanceParam);
      const grossBalance = netBalance / fatorLiquidez;

      const removedWithdraws = await this.prisma.$transaction(async (tx) => {
        const del = await tx.withdrawRequest.deleteMany({
          where: {
            userId: RENOVADA_ID,
            status: { in: [WithdrawStatus.APPROVED, WithdrawStatus.COMPLETED] },
          },
        });

        const before = await tx.wallet.findUniqueOrThrow({
          where: { userId: RENOVADA_ID },
        });
        const after = await tx.wallet.update({
          where: { id: before.id, version: before.version },
          data: { balance: String(grossBalance), version: { increment: 1 } },
        });

        await tx.balanceLog.create({
          data: {
            userId: RENOVADA_ID,
            action: 'WALLET_RECALCULATE',

            balanceDelta: after.balance.sub(before.balance),

            lockedDelta: 0,

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
        message:
          'Saldo base definido com sucesso. A partir de agora o saldo é atualizado incrementalmente (novas transações e saques).',
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
  @ApiOperation({
    summary:
      'Definir saldo base da carteira Bosque (execução única para inicializar o saldo correto)',
  })
  @ApiQuery({
    name: 'balance',
    required: true,
    description:
      'Saldo líquido (netBalance) a exibir (ex: 554.08). Será convertido para bruto internamente.',
    example: 554.08,
  })
  async syncWalletBosque(@Query('balance') balanceParam?: string) {
    await this.requireExclusivePlatformWallet('BOSQUE');
    const BOSQUE_ID = getPlatformOwnerId('BOSQUE') ?? '';

    try {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId: BOSQUE_ID },
      });
      if (!wallet) {
        return { message: 'Wallet do Bosque não encontrada no simpay' };
      }

      const oldBalance = Number(wallet.balance);

      if (!balanceParam) {
        return {
          message:
            'Forneça o saldo líquido via query: ?balance=554.08. Será convertido para bruto (netBalance / fatorLiquidez).',
          currentBalance: oldBalance,
        };
      }

      // O valor informado é o netBalance desejado (saldo líquido exibido).
      // wallet.balance armazena o valor bruto: netBalance / fatorLiquidez.
      const fatorLiquidez = getPlatformTaxaEffective(
        'BOSQUE',
        'LIQUIDEZ',
        PLATFORM_TAXA_DEFAULTS.LIQUIDEZ,
      );
      const netBalance = Number(balanceParam);
      const grossBalance = netBalance / fatorLiquidez;

      await this.prisma.$transaction(async (tx) => {
        const before = await tx.wallet.findUniqueOrThrow({
          where: { userId: BOSQUE_ID },
        });
        const after = await tx.wallet.update({
          where: { id: before.id, version: before.version },
          data: { balance: String(grossBalance), version: { increment: 1 } },
        });
        await tx.balanceLog.create({
          data: {
            userId: BOSQUE_ID,
            action: 'WALLET_RECALCULATE',

            balanceDelta: after.balance.sub(before.balance),

            lockedDelta: 0,

            description: `Saldo base Bosque definido manualmente. netBalance: R$ ${netBalance.toFixed(2)}, bruto armazenado: R$ ${grossBalance.toFixed(2)}`,
            source: 'ADMIN_SYNC',
            metadata: {
              oldBalance,
              netBalance,
              grossBalance,
              fatorLiquidez,
              setManually: true,
            },
          },
        });
      });

      return {
        message:
          'Saldo base do Bosque definido com sucesso. A partir de agora o saldo é atualizado incrementalmente.',
        before: { balance: oldBalance },
        after: { grossBalance, netBalance },
      };
    } catch (error: any) {
      return { message: `Erro ao definir saldo: ${error.message}` };
    }
  }

  @Post('sync/sync-wallet-revalida')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Definir saldo base da carteira Revalida (execução única)',
  })
  @ApiQuery({
    name: 'balance',
    required: true,
    description: 'Saldo líquido (ex: 1200.50)',
    example: 1200.5,
  })
  async syncWalletRevalida(@Query('balance') balanceParam?: string) {
    if (!balanceParam)
      return { message: 'Informe o saldo via query ?balance=...' };
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
  @ApiOperation({
    summary:
      'Lista transações diretamente da API DOM (conta master) sem passar pelo banco',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({
    name: 'begin_date',
    required: false,
    example: '2025-01-01',
    description: 'yyyy-mm-dd',
  })
  @ApiQuery({
    name: 'end_date',
    required: false,
    example: '2025-12-31',
    description: 'yyyy-mm-dd',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'paid | pending | failed | refunded | expired',
  })
  @ApiQuery({
    name: 'payment_method',
    required: false,
    description: 'pix | credit_card',
  })
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

  @Post('sync/reparar-status-transacoes-dom')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Repara status histórico das réplicas locais usando a listagem DOM',
  })
  @ApiQuery({
    name: 'dataInicio',
    required: true,
    example: '2026-05-01',
    description: 'yyyy-mm-dd',
  })
  @ApiQuery({
    name: 'dataFim',
    required: true,
    example: '2026-06-30',
    description: 'yyyy-mm-dd',
  })
  async repararStatusTransacoesDom(
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    if (!dataInicio || !dataFim) {
      throw new BadRequestException('dataInicio e dataFim são obrigatórias');
    }
    return this.syncTransactions.repairHistoricalStatuses({
      beginDate: dataInicio,
      endDate: dataFim,
    });
  }

  @Post('sync/test-cron')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Testar sincronização automática do cron (executa mesma lógica do cron)',
  })
  async testCronSync() {
    try {
      await this.syncDomTransactionsCron.handleSync();
      return {
        success: true,
        message: 'Sincronização do cron executada com sucesso',
      };
    } catch (error) {
      return {
        success: false,
        message: 'Erro na sincronização',
        error: error.message,
      };
    }
  }

  // ──────────── SAQUES ────────────

  @Get('saques')
  @ApiOperation({ summary: 'Listar todos os saques (admin)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, example: 20 })
  @ApiQuery({ name: 'status', required: false, enum: WithdrawStatus })
  @ApiQuery({
    name: 'modulo',
    required: false,
    description: 'Slug do módulo (ex: revalida)',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Buscar por id, nome ou email do usuário',
  })
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
  @ApiOperation({
    summary: 'Listar saques de um específico usuário (conforme API DOM)',
  })
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
      finalUrl = await this.storageService.uploadFile(
        file,
        'comprovantes-saque',
      );
    }

    return this.approveWithdrawal.execute(id, finalUrl, user?.sub);
  }

  @Post('saques/:id/rejeitar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rejeitar saque e desbloquear saldo' })
  async rejeitarSaque(
    @Param('id') id: string,
    @Body() body: RejectWithdrawalDto,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.rejectWithdrawal.execute(id, body.motivo, user?.sub);
  }

  @Get('saques/:id/comprovante')
  @ApiOperation({
    summary: 'Servir arquivo do comprovante via S3 (bucket privado)',
  })
  async serveComprovanteSaque(@Param('id') id: string, @Res() res: Response) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id },
    });
    if (!withdraw?.receiptImage)
      throw new NotFoundException('Comprovante não encontrado');
    try {
      const { buffer, contentType } =
        await this.storageService.getReceiptBufferByStoredUrl(
          withdraw.receiptImage,
        );
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch {
      throw new NotFoundException('Comprovante não disponível');
    }
  }

  @Patch('saques/:id/comprovante')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Adicionar ou trocar comprovante de saque (aceita arquivo ou URL)',
  })
  async atualizarComprovanteSaque(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('receiptImage') receiptImageUrl?: string,
  ) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id },
    });
    if (!withdraw) throw new NotFoundException('Saque não encontrado');

    let finalUrl: string | null =
      receiptImageUrl ?? withdraw.receiptImage ?? null;
    if (file) {
      finalUrl = await this.storageService.uploadFile(
        file,
        'comprovantes-saque',
      );
    }

    await this.prisma.withdrawRequest.update({
      where: { id },
      data: { receiptImage: finalUrl },
    });

    return { success: true, comprovante: finalUrl };
  }

  @Patch('saques/:id/visibilidade')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Alternar visibilidade do comprovante para o cliente',
  })
  async toggleVisibilidadeSaque(
    @Param('id') id: string,
    @Body() body: { comprovanteVisivel: boolean },
  ) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id },
    });
    if (!withdraw) throw new NotFoundException('Saque não encontrado');

    await this.prisma.withdrawRequest.update({
      where: { id },
      data: { comprovanteVisivel: body.comprovanteVisivel },
    });

    return { success: true, comprovanteVisivel: body.comprovanteVisivel };
  }

  @Post('saques/dom-fee')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Registrar manualmente taxa de saque DOM para uma plataforma (+R$1)',
  })
  async applyDomFee(
    @Body() body: { platformTag?: string },
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    const platformTag = ((body?.platformTag ?? '') || 'GLOBAL').toUpperCase();
    const domFee = getPlatformTaxaEffective(platformTag, 'TAXA_SAQUE_DOM', 3.5);
    const adminUserId = user?.sub;
    if (!adminUserId) throw new BadRequestException('Usuário não identificado');
    await this.prisma.balanceLog.create({
      data: {
        userId: adminUserId,
        action: 'ADMIN_WITHDRAW_FEE_INC',
        bookkeepingAmount: new Prisma.Decimal(domFee),

        balanceDelta: 0,

        lockedDelta: 0,

        source: 'MASTER_ADMIN_CONTROL',
        description: `Taxa DOM manual — plataforma: ${platformTag}`,
        metadata: { platformTag, domFee, manual: true },
      },
    });
    return { amount: domFee, platformTag };
  }

  @Post('test-ebook-email')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiBody({ type: TestEbookEmailDto })
  @ApiOperation({
    summary: 'Testar o envio do e-mail de ebook personalizado (admin)',
  })
  async testEbookEmail(@Body() body: TestEbookEmailDto) {
    if (!body?.to?.trim())
      throw new BadRequestException('Informe "to" (e-mail de destino)');
    if (!body?.body?.trim())
      throw new BadRequestException('Informe "body" (corpo do e-mail)');
    await this.emailService.sendEbookAccessEmail({
      to: body.to.trim(),
      customerName: body.customerName?.trim() || 'Cliente',
      title: body.title?.trim() || 'Teste de e-mail',
      body: body.body,
      redirectUrl: body.redirectUrl?.trim() || null,
    });
    return { ok: true, sentTo: body.to.trim() };
  }

  @Post('saques/dom-fee/undo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Desfazer taxa de saque DOM registrada manualmente (-R$1)',
  })
  async undoDomFee(
    @Body() body: { platformTag?: string },
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    const platformTag = ((body?.platformTag ?? '') || 'GLOBAL').toUpperCase();
    const domFee = getPlatformTaxaEffective(platformTag, 'TAXA_SAQUE_DOM', 3.5);
    const adminUserId = user?.sub;
    if (!adminUserId) throw new BadRequestException('Usuário não identificado');
    await this.prisma.balanceLog.create({
      data: {
        userId: adminUserId,
        action: 'ADMIN_WITHDRAW_FEE_INC',
        bookkeepingAmount: new Prisma.Decimal(-domFee),

        balanceDelta: 0,

        lockedDelta: 0,

        source: 'MASTER_ADMIN_CONTROL',
        description: `Taxa DOM desfeita — plataforma: ${platformTag}`,
        metadata: { platformTag, domFee: -domFee, manual: true, undo: true },
      },
    });
    return { amount: -domFee, platformTag };
  }

  // ──────────── RENOVADA: TRANSAÇÕES & RESUMO ────────────
  // Equivalente ao api-dom GET /payments/history

  @Get('renovada/transactions')
  @ApiOperation({
    summary:
      'Listar transações da Renovada (equivalente ao api-dom /payments/history)',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'EXPIRED'],
  })
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
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      userId: RENOVADA_ID,
      ...(status ? { status: status as TransactionStatus } : {}),
      ...(description && description !== 'ALL'
        ? { description: { contains: description, mode: 'insensitive' } }
        : {}),
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate
                ? { gte: dayjs(startDate).startOf('day').toDate() }
                : {}),
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
  @ApiOperation({
    summary: 'Exportar todas as transações da Renovada (sem paginação)',
  })
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
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';

    const where: any = {
      userId: RENOVADA_ID,
      ...(status && status !== 'ALL'
        ? { status: status as TransactionStatus }
        : {}),
      ...(description && description !== 'ALL'
        ? { description: { contains: description, mode: 'insensitive' } }
        : {}),
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate
                ? { gte: dayjs(startDate).startOf('day').toDate() }
                : {}),
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
  @ApiOperation({
    summary:
      'Resumo financeiro da Renovada (equivalente ao api-dom /payments/summary)',
  })
  async renovadaSummary() {
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';

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

  @Get('wallet-composicao')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Composição do saldo líquido (netBalance): transações COMPLETED, saques e fórmula (Renovada vs padrão)',
  })
  @ApiQuery({
    name: 'email',
    required: false,
    description: 'E-mail exato do usuário no Simpay',
    example: 'contato@renovada.com.br',
  })
  @ApiQuery({ name: 'userId', required: false, description: 'UUID do usuário' })
  async walletComposicao(
    @Query('email') email?: string,
    @Query('userId') userId?: string,
  ) {
    return this.getWalletComposition.execute({ email, userId });
  }

  // ──────────── MAQUINETAS ────────────

  @Post('sync/maquinetas')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Sincronizar transações históricas de maquinetas direto da DOM Pagamentos',
  })
  async syncMaquinetas() {
    return this.syncMaquinetasUseCase.execute();
  }

  @Post('sync/recalcular-balance-maquinetas')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Recalcular balance da Renovada do zero baseado nas transações de maquineta (amount - domFee)',
    description:
      'Soma amount - domFee de todas as transações COMPLETED de maquineta, desconta saques aprovados/completos e define o wallet.balance correto.',
  })
  async recalcularBalanceMaquinetas() {
    await this.requireExclusivePlatformWallet('RENOVADA');
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: RENOVADA_ID },
    });
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

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.wallet.findUniqueOrThrow({
        where: { userId: RENOVADA_ID },
      });
      const after = await tx.wallet.update({
        where: { id: before.id, version: before.version },
        data: { balance: newBalance, version: { increment: 1 } },
      });
      await tx.balanceLog.create({
        data: {
          userId: RENOVADA_ID,
          action: 'WALLET_RECALCULATE',

          balanceDelta: after.balance.sub(before.balance),

          lockedDelta: 0,

          source: 'ADMIN_RECALC',
          description: `Recálculo: netTotal=${totalNet.toFixed(2)}, saques=${totalSaques.toFixed(2)}`,
        },
      });
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
  @ApiOperation({
    summary: 'Transações de maquinetas da Renovada (lê do banco local)',
  })
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
  @ApiOperation({
    summary: 'Transações de maquinetas centralizadas (lê do banco local)',
  })
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
    const platform = await this.prisma.platform.findUnique({
      where: { tag: 'RENOVADA' },
      select: {
        ownerUserId: true,
        isActive: true,
        owner: { select: { isActive: true, isPurged: true } },
      },
    });
    const pageNum = Math.max(1, Math.floor(Number(page) || 1));
    const limitNum = Math.max(1, Math.min(Number(limit) || 20, 100));
    const skip = (pageNum - 1) * limitNum;
    if (
      !platform?.isActive ||
      !platform.owner.isActive ||
      platform.owner.isPurged
    ) {
      return {
        transactions: [],
        meta: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 },
      };
    }

    const where: Prisma.TransactionWhereInput = {
      userId: platform.ownerUserId,
      OR: [
        {
          description: { contains: ORIGEM_MAQUINETA_TAG, mode: 'insensitive' },
        },
        { description: { contains: 'Terminal:', mode: 'insensitive' } },
        { description: { contains: 'Maquineta', mode: 'insensitive' } },
      ],
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate
                ? { gte: dayjs(startDate).startOf('day').toDate() }
                : {}),
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
      const sLabel =
        tx.status === 'COMPLETED'
          ? 'Aprovado'
          : tx.status === 'PENDING'
            ? 'Pendente'
            : tx.status === 'FAILED'
              ? 'Falhou'
              : tx.status === 'REFUNDED'
                ? 'Estornado'
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
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  @Delete('renovada/transactions/cleanup-plan-txs')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Deletar transações PIX_PLAN_CODE incorretamente atribuídas à Renovada',
  })
  async cleanupRenovadaPlanTxs() {
    await this.requireExclusivePlatformWallet('RENOVADA');
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';

    const txs = await this.prisma.transaction.findMany({
      where: {
        userId: RENOVADA_ID,
        description: { startsWith: 'PIX_PLAN_CODE:', mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (txs.length === 0) {
      return {
        success: true,
        deletedCount: 0,
        message: 'Nenhuma transação PIX_PLAN_CODE encontrada',
      };
    }

    const ids = txs.map((t) => t.id);

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
    await this.requireExclusivePlatformWallet('RENOVADA');
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';

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

  // ──────────── RENOVADA: RECALCULAR SALDO A PARTIR DE UMA DATA ────────────

  @Post('renovada/recalcular-saldo-por-data')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Recalcula o saldo da Renovada a partir de uma data e adiciona ao saldo atual',
    description:
      'Soma netAmount das transações COMPLETED (regulares + maquinetas) a partir da dataInicio informada, desconta saques aprovados/completos após essa data, e incrementa o saldo atual da wallet com esse delta.',
  })
  @ApiQuery({
    name: 'dataInicio',
    required: true,
    description: 'Data de início no formato YYYY-MM-DD',
    example: '2026-01-01',
  })
  async recalcularSaldoRenovadaPorData(
    @Query('dataInicio') dataInicio: string,
  ) {
    await this.requireExclusivePlatformWallet('RENOVADA');
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';

    if (!dataInicio) {
      return {
        success: false,
        error: 'Parâmetro dataInicio obrigatório (formato YYYY-MM-DD)',
      };
    }

    const fromDate = new Date(`${dataInicio}T00:00:00.000Z`);
    if (isNaN(fromDate.getTime())) {
      return {
        success: false,
        error: 'dataInicio inválida. Use o formato YYYY-MM-DD',
      };
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: RENOVADA_ID },
    });
    if (!wallet) {
      return { success: false, error: 'Wallet da Renovada não encontrada' };
    }

    // 1. Soma netAmount de transações regulares COMPLETED da Renovada a partir da dataInicio
    const renovadaKeywords = [
      { description: { contains: 'dizimo', mode: 'insensitive' as const } },
      { description: { contains: 'dízimo', mode: 'insensitive' as const } },
      { description: { contains: 'primicia', mode: 'insensitive' as const } },
      { description: { contains: 'primícia', mode: 'insensitive' as const } },
      { description: { contains: 'oferta', mode: 'insensitive' as const } },
      { description: { contains: 'fundacao', mode: 'insensitive' as const } },
      { description: { contains: 'fundação', mode: 'insensitive' as const } },
      {
        description: {
          contains: TENANT_RENOVADA_TAG,
          mode: 'insensitive' as const,
        },
      },
    ];

    const txsAgg = await this.prisma.transaction.aggregate({
      where: {
        userId: RENOVADA_ID,
        status: TransactionStatus.COMPLETED,
        createdAt: { gte: fromDate },
        OR: renovadaKeywords,
      },
      _sum: { netAmount: true },
      _count: true,
    });

    // 2. Soma netAmount de maquinetas COMPLETED a partir da dataInicio
    const maquinetaKeywords = [
      { description: { contains: 'maquineta', mode: 'insensitive' as const } },
      { description: { contains: 'terminal', mode: 'insensitive' as const } },
    ];

    const maquinetaAgg = await this.prisma.transaction.aggregate({
      where: {
        userId: RENOVADA_ID,
        status: TransactionStatus.COMPLETED,
        createdAt: { gte: fromDate },
        OR: maquinetaKeywords,
      },
      _sum: { netAmount: true },
      _count: true,
    });

    const totalTxs = Number(txsAgg._sum.netAmount ?? 0);
    const totalMaquinetas = Number(maquinetaAgg._sum.netAmount ?? 0);
    const newBalance = totalTxs + totalMaquinetas;

    const oldBalance = Number(wallet.balance);

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.wallet.findUniqueOrThrow({
        where: { userId: RENOVADA_ID },
      });
      const after = await tx.wallet.update({
        where: { id: before.id, version: before.version },
        data: {
          balance: new Prisma.Decimal(newBalance),
          version: { increment: 1 },
        },
      });
      await tx.balanceLog.create({
        data: {
          userId: RENOVADA_ID,
          action: 'WALLET_RECALCULATE',

          balanceDelta: after.balance.sub(before.balance),

          lockedDelta: 0,

          source: 'ADMIN_RECALC',
          description: `Recálculo desde ${dataInicio}: txs=${totalTxs.toFixed(2)}, maquinetas=${totalMaquinetas.toFixed(2)}, saldoNovo=${newBalance.toFixed(2)}`,
        },
      });
    });

    return {
      success: true,
      dataInicio,
      detalhes: {
        transacoesRegulares: {
          count: txsAgg._count,
          netAmount: totalTxs.toFixed(2),
        },
        maquinetas: {
          count: maquinetaAgg._count,
          netAmount: totalMaquinetas.toFixed(2),
        },
        saldoAntes: oldBalance.toFixed(2),
        saldoNovo: newBalance.toFixed(2),
      },
    };
  }

  // ──────────── RENOVADA: LIMPAR TRANSAÇÕES + RECALCULAR SALDO ────────────

  @Post('renovada/recalcular')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Remove transações sem dízimo/primícia/oferta do pool Renovada e recalcula o saldo',
  })
  async renovadaRecalcular() {
    await this.requireExclusivePlatformWallet('RENOVADA');
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';

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
        where: { transactionId: { in: txsToDelete.map((t) => t.id) } },
      });
    }

    // Agora deletar as transações
    const deleted = await this.prisma.transaction.deleteMany({
      where: whereToDelete,
    });

    // 2. Recalcular saldo com as transações COMPLETED restantes
    // IMPORTANTE: wallet.balance armazena o valor BRUTO (amount).
    const completedTxs = await this.prisma.transaction.aggregate({
      where: {
        userId: RENOVADA_ID,
        status: TransactionStatus.COMPLETED,
        OR: keywordOr,
      },
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

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.wallet.findUniqueOrThrow({
        where: { userId: RENOVADA_ID },
      });
      const after = await tx.wallet.update({
        where: { id: before.id, version: before.version },
        data: { balance: calculatedBalance, version: { increment: 1 } },
      });
      await tx.balanceLog.create({
        data: {
          userId: RENOVADA_ID,
          action: 'WALLET_RECALCULATE',
          source: 'ADMIN_SYNC',
          balanceDelta: after.balance.sub(before.balance),
          lockedDelta: 0,
          description: 'Saldo recalculado após limpeza explícita de transações',
        },
      });
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

  // ──────────── RENOVADA: CORRIGIR SALDO WALLET (ofertas + maquinetas, sem ajustes) ────────────

  @Post('renovada/fix-wallet-balance')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Recalcula o saldo da wallet da Renovada: ofertas/dízimos (31/03-06/04) usando amount + maquinetas (05/04-06/04) usando netAmount, excluindo ajustes',
  })
  async fixRenovadaWalletBalance() {
    await this.requireExclusivePlatformWallet('RENOVADA');
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';

    const periodoOfertasInicio = new Date('2026-03-31T00:00:00-03:00');
    const periodoFim = new Date('2026-04-06T23:59:59-03:00');
    const periodoMaquinetasInicio = new Date('2026-04-05T00:00:00-03:00');

    const AJUSTES_NOT = {
      OR: [
        {
          description: {
            contains: 'sincronizacao de saldo',
            mode: 'insensitive' as const,
          },
        },
        {
          description: {
            contains: 'sincronização de saldo',
            mode: 'insensitive' as const,
          },
        },
        {
          description: {
            contains: 'ajuste administrativo',
            mode: 'insensitive' as const,
          },
        },
        {
          description: {
            contains: 'balance sync',
            mode: 'insensitive' as const,
          },
        },
      ],
    };

    // 1. Ofertas/dízimos/primícias/fundação (31/03–06/04) — soma netAmount (líquido)
    const ofertasAgg = await this.prisma.transaction.aggregate({
      where: {
        userId: RENOVADA_ID,
        status: TransactionStatus.COMPLETED,
        createdAt: { gte: periodoOfertasInicio, lte: periodoFim },
        OR: [
          { description: { contains: 'dizimo', mode: 'insensitive' } },
          { description: { contains: 'dízimo', mode: 'insensitive' } },
          { description: { contains: 'primicia', mode: 'insensitive' } },
          { description: { contains: 'primícia', mode: 'insensitive' } },
          { description: { contains: 'oferta', mode: 'insensitive' } },
          { description: { contains: 'fundacao', mode: 'insensitive' } },
          { description: { contains: 'fundação', mode: 'insensitive' } },
        ],
        NOT: [
          AJUSTES_NOT,
          {
            OR: [
              { description: { contains: 'maquineta', mode: 'insensitive' } },
              { description: { contains: 'terminal:', mode: 'insensitive' } },
            ],
          },
        ],
      },
      _sum: { netAmount: true },
      _count: { id: true },
    });

    // 2. Maquinetas (05/04–06/04) — soma netAmount (líquido), igual ao sync-maquinetas
    const maquinetasAgg = await this.prisma.transaction.aggregate({
      where: {
        userId: RENOVADA_ID,
        status: TransactionStatus.COMPLETED,
        createdAt: { gte: periodoMaquinetasInicio, lte: periodoFim },
        OR: [
          { description: { contains: 'maquineta', mode: 'insensitive' } },
          { description: { contains: 'terminal:', mode: 'insensitive' } },
        ],
        NOT: AJUSTES_NOT,
      },
      _sum: { netAmount: true },
      _count: { id: true },
    });

    const totalOfertas = Number(ofertasAgg._sum.netAmount ?? 0);
    const totalMaquinetas = Number(maquinetasAgg._sum.netAmount ?? 0);

    const completedWithdraws = await this.prisma.withdrawRequest.aggregate({
      where: {
        userId: RENOVADA_ID,
        status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] },
        createdAt: { gte: periodoOfertasInicio, lte: periodoFim },
      },
      _sum: { amount: true },
    });

    const totalSacado = Number(completedWithdraws._sum.amount ?? 0);
    const novoBalance = Math.max(
      0,
      totalOfertas + totalMaquinetas - totalSacado,
    );

    const walletAntes = await this.prisma.wallet.findUnique({
      where: { userId: RENOVADA_ID },
      select: { balance: true, lockedBalance: true },
    });
    const balanceAntes = Number(walletAntes?.balance || 0);

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.wallet.findUniqueOrThrow({
        where: { userId: RENOVADA_ID },
      });
      const after = await tx.wallet.update({
        where: { id: before.id, version: before.version },
        data: { balance: novoBalance, version: { increment: 1 } },
      });
      await tx.balanceLog.create({
        data: {
          userId: RENOVADA_ID,

          balanceDelta: after.balance.sub(before.balance),

          lockedDelta: 0,

          action: 'WALLET_RECALCULATE',
          source: 'ADMIN_FIX_WALLET',
          description: `fix-wallet-balance 31/03-06/04/2026: ofertas=${totalOfertas.toFixed(2)} (${ofertasAgg._count.id}tx), maquinetas=${totalMaquinetas.toFixed(2)} (${maquinetasAgg._count.id}tx), saques=${totalSacado.toFixed(2)}`,
        },
      });
    });

    return {
      message: 'Saldo da wallet da Renovada corrigido com sucesso',
      balanceAntes: Number(balanceAntes.toFixed(2)),
      novoBalance: Number(novoBalance.toFixed(2)),
      totalOfertas: Number(totalOfertas.toFixed(2)),
      totalMaquinetas: Number(totalMaquinetas.toFixed(2)),
      totalSacado: Number(totalSacado.toFixed(2)),
      transacoesOfertas: ofertasAgg._count.id,
      transacoesMaquinetas: maquinetasAgg._count.id,
    };
  }

  // ──────────── RENOVADA: REGISTRAR LOGS DE SAQUE RETROATIVAMENTE ────────────

  @Post('renovada/fix-withdraw-logs')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Registra retroativamente os logs de taxa e lucro de saque para um withdrawId já aprovado',
  })
  async fixWithdrawLogs(@Query('withdrawId') withdrawId: string) {
    if (!withdrawId?.trim()) {
      throw new BadRequestException('withdrawId é obrigatório');
    }

    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id: withdrawId },
      select: { id: true, userId: true, status: true, updatedAt: true },
    });

    if (!withdraw) {
      throw new NotFoundException(`Saque ${withdrawId} não encontrado`);
    }

    // Verifica se já existem logs para esse saque (evitar duplicar)
    const existing = await this.prisma.balanceLog.findFirst({
      where: {
        source: 'MASTER_ADMIN_CONTROL',
        action: { in: ['ADMIN_WITHDRAW_FEE_INC', 'ADMIN_WITHDRAW_PROFIT_INC'] },
        metadata: { path: ['withdrawId'], equals: withdrawId },
      },
    });

    if (existing) {
      return {
        message: 'Logs já existem para este saque, nada foi alterado.',
        withdrawId,
      };
    }

    const logDate = withdraw.updatedAt; // data da aprovação

    await this.prisma.$transaction(async (tx) => {
      await tx.balanceLog.create({
        data: {
          userId: withdraw.userId,
          action: 'ADMIN_WITHDRAW_FEE_INC',
          bookkeepingAmount: new Prisma.Decimal(1),

          balanceDelta: 0,

          lockedDelta: 0,

          source: 'MASTER_ADMIN_CONTROL',
          description: `Taxa de saque (retroativo)`,
          metadata: { withdrawId },
          createdAt: logDate,
        },
      });

      await tx.balanceLog.create({
        data: {
          userId: withdraw.userId,
          action: 'ADMIN_WITHDRAW_PROFIT_INC',
          bookkeepingAmount: new Prisma.Decimal(2),

          balanceDelta: 0,

          lockedDelta: 0,

          source: 'MASTER_ADMIN_CONTROL',
          description: `Lucro de saque (retroativo)`,
          metadata: { withdrawId },
          createdAt: logDate,
        },
      });
    });

    return {
      message: 'Logs de taxa e lucro de saque registrados com sucesso',
      withdrawId,
      dataRegistrada: logDate.toISOString(),
      taxaSaque: 1,
      lucroSaque: 2,
    };
  }

  // ──────────── BOSQUE: CORRIGIR SALDO WALLET (sem sincronizações, sem ajustes) ────────────

  @Post('bosque/fix-wallet-balance')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Recalcula o saldo da wallet do Bosque somando netAmount das transações reais (15/03–06/04/2026), excluindo sincronizações e ajustes',
  })
  async fixBosqueWalletBalance() {
    const BOSQUE_ID = getPlatformOwnerId('BOSQUE') ?? '';

    const periodoInicio = new Date('2026-03-15T00:00:00-03:00');
    const periodoFim = new Date('2026-04-06T23:59:59-03:00');

    const txsAgg = await this.prisma.transaction.aggregate({
      where: {
        userId: BOSQUE_ID,
        status: TransactionStatus.COMPLETED,
        createdAt: { gte: periodoInicio, lte: periodoFim },
        NOT: {
          OR: [
            {
              description: {
                contains: 'Sincronização Bosque',
                mode: 'insensitive',
              },
            },
            {
              description: {
                contains: 'Sincronizacao Bosque',
                mode: 'insensitive',
              },
            },
            {
              description: {
                contains: 'Ajuste Administrativo',
                mode: 'insensitive',
              },
            },
            { description: { contains: 'balance sync', mode: 'insensitive' } },
          ],
        },
      },
      _sum: { netAmount: true },
      _count: { id: true },
    });

    const totalRecebido = Number(txsAgg._sum.netAmount ?? 0);

    const completedWithdraws = await this.prisma.withdrawRequest.aggregate({
      where: {
        userId: BOSQUE_ID,
        status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] },
        createdAt: { gte: periodoInicio, lte: periodoFim },
      },
      _sum: { amount: true },
    });

    const totalSacado = Number(completedWithdraws._sum.amount ?? 0);
    const novoBalance = Math.max(0, totalRecebido - totalSacado);

    const walletAntes = await this.prisma.wallet.findUnique({
      where: { userId: BOSQUE_ID },
      select: { balance: true, lockedBalance: true },
    });
    const balanceAntes = Number(walletAntes?.balance ?? 0);

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.wallet.findUniqueOrThrow({
        where: { userId: BOSQUE_ID },
      });
      const after = await tx.wallet.update({
        where: { id: before.id, version: before.version },
        data: { balance: novoBalance, version: { increment: 1 } },
      });
      await tx.balanceLog.create({
        data: {
          userId: BOSQUE_ID,

          balanceDelta: after.balance.sub(before.balance),

          lockedDelta: 0,

          action: 'WALLET_RECALCULATE',
          source: 'ADMIN_FIX_WALLET',
          description: `fix-wallet-balance Bosque 15/03-06/04/2026: recebido=${totalRecebido.toFixed(2)}, saques=${totalSacado.toFixed(2)}, txs=${txsAgg._count.id} (sem sincronizações/ajustes)`,
        },
      });
    });

    return {
      message: 'Saldo da wallet do Bosque corrigido com sucesso',
      balanceAntes: Number(balanceAntes.toFixed(2)),
      novoBalance: Number(novoBalance.toFixed(2)),
      totalRecebido: Number(totalRecebido.toFixed(2)),
      totalSacado: Number(totalSacado.toFixed(2)),
      transacoesConsideradas: txsAgg._count.id,
    };
  }

  // ──────────── PLATAFORMAS ────────────

  @Get('plataformas/taxas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary:
      'Custos SimIntPay por plataforma cadastrada (banco e padrão global)',
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

  @Get('plataformas/simintpay-clientes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Buscar clientes (e-mail/nome) para taxa personalizada SIM INT PAY',
  })
  async listSimIntPayClientes(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const term = (search ?? '').trim();
    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(Math.max(1, Number(pageSize) || 10), 50);
    const skip = (pageNum - 1) * size;

    // Clientes = CONTAS (vendedores/lojistas) que transacionam pela SIM INT PAY,
    // identificadas pelo e-mail da CONTA (User.email) — e NÃO pelo e-mail do
    // comprador da transação (customerEmail). É user.email que a taxa personalizada
    // usa como chave (CLIENT:<user.email>) e com o qual o cliente faz login; por isso
    // a lista antiga (comprador) mostrava e-mails que não batiam com a conta.
    // Clientes SIM INT PAY = contas avulsas (role USER, sem plataforma/módulo),
    // mesmo critério de "cliente direto" da tela de Leads. NÃO exige transação —
    // assim contas recém-criadas (manual/master ou auto-cadastro), que ainda não
    // transacionaram, já aparecem aqui pra receber taxa personalizada.
    // A busca aceita e-mail, nome e documento — CPF **e** CNPJ (contas PJ só têm
    // cnpj preenchido; olhar só cpf as tornava invisíveis).
    const termDigits = term.replace(/\D/g, '');
    const userWhere: Prisma.UserWhereInput = {
      role: Role.USER,
      platformId: null,
      ...(term
        ? {
            OR: [
              { email: { contains: term, mode: 'insensitive' } },
              { name: { contains: term, mode: 'insensitive' } },
              ...(termDigits.length >= 3
                ? [
                    { cpf: { contains: termDigits } },
                    { cnpj: { contains: termDigits } },
                  ]
                : []),
            ],
          }
        : {}),
    };

    const users = await this.prisma.user.findMany({
      where: userWhere,
      select: { email: true, name: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: size + 1, // +1 para saber se há próxima página
    });

    const hasMore = users.length > size;
    const data = users.slice(0, size).map((u) => ({
      email: u.email.toLowerCase(),
      name: u.name ?? null,
    }));

    return { data, page: pageNum, pageSize: size, hasMore };
  }

  // ──────────── COBRANÇAS (Master cobra clientes) ────────────

  @Get('cobrancas/clientes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Lista contas (clientes) com saldo disponível para a tela de Cobranças',
  })
  async listCobrancaClientes(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const term = (search ?? '').trim();
    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(Math.max(1, Number(pageSize) || 20), 100);

    const where: Prisma.UserWhereInput = {
      // Só clientes (donos de plataforma): mesma marcação do botão "empresa" em /admin/usuarios.
      isCompany: true,
      // Só quem tem saldo para cobrar — positivo (débito) ou negativo (já devendo).
      wallet: { is: { balance: { not: 0 } } },
      billingExcluded: false,
      NOT: { email: { endsWith: '@auto.simpay.com', mode: 'insensitive' } },
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          wallet: { select: { balance: true, lockedBalance: true } },
        },
        orderBy: { name: 'asc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      data: users.map((u) => {
        const bal = Number(u.wallet?.balance ?? 0);
        const locked = Number(u.wallet?.lockedBalance ?? 0);
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          saldoDisponivel: Number((bal - locked).toFixed(2)),
        };
      }),
      page: pageNum,
      pageSize: size,
      total,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  @Delete('cobrancas/clientes/:id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Remove uma conta da lista de cobranças sem apagar conta, saldo ou histórico',
  })
  async excludeCobrancaCliente(@Param('id') id: string) {
    await this.prisma.user.update({
      where: { id },
      data: { billingExcluded: true },
    });
    return { success: true };
  }

  /**
   * Cobrança só vale para clientes (donos de plataforma), isto é, contas marcadas
   * como empresa em /admin/usuarios. Usuários finais das plataformas vivem em
   * ExternalPlatformUser e nunca chegam aqui; o que bloqueamos são contas pessoais.
   */
  private async assertClientesCobraveis(userIds: string[]) {
    const ids = Array.from(new Set(userIds));
    const validos = await this.prisma.user.findMany({
      where: { id: { in: ids }, isCompany: true },
      select: { id: true },
    });
    if (validos.length !== ids.length) {
      const validSet = new Set(validos.map((u) => u.id));
      const invalidos = ids.filter((id) => !validSet.has(id));
      throw new BadRequestException(
        `Só é possível cobrar clientes marcados como empresa. Contas inválidas: ${invalidos.join(', ')}`,
      );
    }
  }

  @Post('cobrancas/debitar')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Debita do saldo dos clientes selecionados (modo cobrança por débito). Permite saldo negativo.',
  })
  async debitarCobrancas(
    @Body()
    body: { itens?: { userId: string; amount: number }[]; descricao?: string },
    @CurrentUser() master?: JwtPayload,
  ) {
    const masterId = master?.sub ?? '';
    const itens = (body?.itens ?? []).filter(
      (i) =>
        i?.userId && Number.isFinite(Number(i.amount)) && Number(i.amount) > 0,
    );
    if (itens.length === 0)
      throw new BadRequestException('Nenhum item de cobrança válido.');

    await this.assertClientesCobraveis(itens.map((i) => i.userId));

    const descricao = body?.descricao?.trim() || 'Cobrança (débito do saldo)';
    const resultados: Array<{
      userId: string;
      ok: boolean;
      amount: number;
      saldoDepois?: number;
      ficouNegativo?: boolean;
      erro?: string;
    }> = [];

    for (const item of itens) {
      const amount = Number(Number(item.amount).toFixed(2));
      try {
        const res = await this.prisma.$transaction(async (tx) => {
          const wallet = await tx.wallet.findUnique({
            where: { userId: item.userId },
          });
          if (!wallet) throw new Error('Carteira não encontrada');
          const locked = Number(wallet.lockedBalance);
          const after = Number((Number(wallet.balance) - amount).toFixed(2));
          const ficouNegativo = after - locked < 0;
          const updated = await tx.wallet.update({
            where: { id: wallet.id, version: wallet.version },
            data: { balance: after, version: { increment: 1 } },
          });
          await tx.balanceLog.create({
            data: {
              userId: item.userId,
              action: 'COBRANCA_DEBIT',

              balanceDelta: new Prisma.Decimal(updated.balance).sub(
                wallet.balance,
              ),

              lockedDelta: new Prisma.Decimal(updated.lockedBalance).sub(
                wallet.lockedBalance,
              ),

              source: 'MASTER_COBRANCA',
              description: descricao,
              metadata: { via: 'admin/cobrancas/debitar', masterId },
            },
          });
          await tx.cobranca.create({
            data: {
              userId: item.userId,
              amount,
              description: descricao,
              mode: 'DEBIT',
              status: 'APPLIED',
              createdByUserId: masterId,
              saldoAntes: wallet.balance,
              saldoDepois: updated.balance,
              ficouNegativo,
            },
          });
          return { after, ficouNegativo };
        });
        resultados.push({
          userId: item.userId,
          ok: true,
          amount,
          saldoDepois: res.after,
          ficouNegativo: res.ficouNegativo,
        });
      } catch (e) {
        resultados.push({
          userId: item.userId,
          ok: false,
          amount,
          erro: e instanceof Error ? e.message : 'Falha',
        });
      }
    }

    return {
      total: itens.length,
      sucesso: resultados.filter((r) => r.ok).length,
      negativos: resultados.filter((r) => r.ok && r.ficouNegativo).length,
      resultados,
    };
  }

  @Get('cobrancas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Histórico de cobranças lançadas pelo Master' })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Nome ou e-mail do cliente',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'PENDING | VENCIDA | PAID | CANCELED | APPLIED',
  })
  @ApiQuery({ name: 'dataInicio', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'dataFim', required: false, description: 'YYYY-MM-DD' })
  async listCobrancas(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(Math.max(1, Number(pageSize) || 20), 100);

    // Garante link de pagamento nas antigas + reflete pagamentos do checkout.
    await this.ensureCobrancaPaymentLinks();
    await this.reconcileCobrancasPagas();

    const term = search?.trim() ?? '';
    const statusUpper = (status ?? '').trim().toUpperCase();
    const and: Prisma.CobrancaWhereInput[] = [];

    if (term) {
      and.push({
        user: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
          ],
        },
      });
    }

    // "VENCIDA" é derivado: pendente com vencimento no passado. "PENDING" puro
    // exclui as vencidas para os dois filtros não se misturarem.
    if (statusUpper === 'VENCIDA') {
      and.push({ status: 'PENDING', dueDate: { lt: new Date() } });
    } else if (statusUpper === 'PENDING') {
      and.push({
        status: 'PENDING',
        OR: [{ dueDate: null }, { dueDate: { gte: new Date() } }],
      });
    } else if (
      statusUpper === 'PAID' ||
      statusUpper === 'CANCELED' ||
      statusUpper === 'APPLIED'
    ) {
      and.push({ status: statusUpper as any });
    }

    if (dataInicio || dataFim) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (dataInicio) {
        const d = new Date(`${dataInicio}T00:00:00.000-03:00`);
        if (!Number.isNaN(d.getTime())) createdAt.gte = d;
      }
      if (dataFim) {
        const d = new Date(`${dataFim}T23:59:59.999-03:00`);
        if (!Number.isNaN(d.getTime())) createdAt.lte = d;
      }
      if (Object.keys(createdAt).length > 0) and.push({ createdAt });
    }

    const where: Prisma.CobrancaWhereInput = and.length > 0 ? { AND: and } : {};

    const [total, items] = await Promise.all([
      this.prisma.cobranca.count({ where }),
      this.prisma.cobranca.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      data: items.map((c) => ({
        id: c.id,
        nome: c.user?.name ?? '-',
        email: c.user?.email ?? '-',
        amount: Number(c.amount),
        description: c.description,
        mode: c.mode,
        status: c.status,
        // Pendente com vencimento passado → exibida como "Vencida".
        vencida: this.cobrancaVencida(c),
        ficouNegativo: c.ficouNegativo,
        saldoDepois: c.saldoDepois != null ? Number(c.saldoDepois) : null,
        dueDate: c.dueDate,
        paidAt: c.paidAt,
        createdAt: c.createdAt,
        // id do PaymentLink → checkout: /?simLinkCode=<paymentRef>
        paymentRef: c.paymentRef,
      })),
      page: pageNum,
      pageSize: size,
      total,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  @Post('cobrancas/gerar')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Gera cobranças a pagar (PIX/cartão) para os clientes selecionados. ' +
      'Cria automaticamente um link de pagamento (checkout) por cliente, dono = master, plataforma SIMINTPAY.',
  })
  async gerarCobrancas(
    @Body()
    body: {
      itens?: { userId: string; amount: number }[];
      descricao?: string;
      dueDate?: string;
    },
    @CurrentUser() master?: JwtPayload,
  ) {
    const masterId = master?.sub ?? '';
    const itens = (body?.itens ?? []).filter(
      (i) =>
        i?.userId && Number.isFinite(Number(i.amount)) && Number(i.amount) > 0,
    );
    if (itens.length === 0)
      throw new BadRequestException('Nenhum item de cobrança válido.');
    const descricao = body?.descricao?.trim() || 'Cobrança';
    // Vencimento é obrigatório: é ele que define quando a cobrança vira "Vencida".
    const dueDate = body?.dueDate ? new Date(body.dueDate) : null;
    if (!dueDate || Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException(
        'Informe a data de vencimento da cobrança.',
      );
    }

    await this.assertClientesCobraveis(itens.map((i) => i.userId));

    // Nome/e-mail do cliente para o título do link (descrição sai correta no checkout).
    const clientesRows = await this.prisma.user.findMany({
      where: { id: { in: itens.map((i) => i.userId) } },
      select: { id: true, name: true, email: true },
    });
    const clienteById = new Map(clientesRows.map((c) => [c.id, c]));
    const domToken =
      process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY || '';

    const cobrancas: Array<{
      userId: string;
      cliente: string | null;
      cobrancaId: string;
      paymentLinkId: string;
      amount: number;
    }> = [];

    for (const item of itens) {
      const cliente = clienteById.get(item.userId);
      const amount = Number(Number(item.amount).toFixed(2));
      const titulo = `${descricao} — ${cliente?.name || cliente?.email || item.userId}`;

      // Registra o link na DOM (cartão). Falha não bloqueia: o checkout PIX usa o link local.
      let domPaymentLinkId: string | null = null;
      if (domToken) {
        try {
          const created = await this.paymentGateway.createPaymentLink(
            domToken,
            {
              title: titulo,
              description: titulo,
              amount,
              maxInstallments: 12,
              interestRateInstallment: 0,
              aceitaCartao: true,
              aceitaPix: true,
            },
          );
          domPaymentLinkId = created?.id ?? null;
        } catch {
          // segue sem registro DOM
        }
      }

      // Link de pagamento automático: dono = MASTER (o valor pago cai para o master),
      // plataforma SIMINTPAY (agrupamento/relatórios), um link por cliente.
      const link = await this.prisma.paymentLink.create({
        data: {
          userId: masterId,
          title: titulo,
          description: titulo,
          amount,
          maxInstallments: 12,
          plataformas: ['SIMINTPAY'],
          domPaymentLinkId,
        },
        select: { id: true },
      });

      const cob = await this.prisma.cobranca.create({
        data: {
          userId: item.userId,
          amount,
          description: descricao,
          mode: 'PAYABLE',
          status: 'PENDING',
          createdByUserId: masterId,
          dueDate,
          // paymentRef = id do PaymentLink → checkout: /?simLinkCode=<paymentRef>
          paymentRef: link.id,
        },
        select: { id: true },
      });

      cobrancas.push({
        userId: item.userId,
        cliente: cliente?.name ?? cliente?.email ?? null,
        cobrancaId: cob.id,
        paymentLinkId: link.id,
        amount,
      });
    }

    return { total: itens.length, criadas: cobrancas.length, cobrancas };
  }

  /**
   * Garante o link de pagamento das cobranças PAYABLE pendentes que ainda não têm
   * (ex.: geradas antes do link automático existir). Cria o PaymentLink com dono =
   * master que lançou a cobrança, plataforma SIMINTPAY, e grava o paymentRef.
   */
  private async ensureCobrancaPaymentLinks(
    where: Prisma.CobrancaWhereInput = {},
  ) {
    const semLink = await this.prisma.cobranca.findMany({
      where: { ...where, mode: 'PAYABLE', status: 'PENDING', paymentRef: null },
      include: { user: { select: { id: true, name: true, email: true } } },
      take: 20,
    });
    if (semLink.length === 0) return;

    const domToken =
      process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY || '';

    for (const cob of semLink) {
      const amount = Number(cob.amount);
      const titulo = `${cob.description || 'Cobrança'} — ${cob.user?.name || cob.user?.email || cob.userId}`;

      let domPaymentLinkId: string | null = null;
      if (domToken) {
        try {
          const created = await this.paymentGateway.createPaymentLink(
            domToken,
            {
              title: titulo,
              description: titulo,
              amount,
              maxInstallments: 12,
              interestRateInstallment: 0,
              aceitaCartao: true,
              aceitaPix: true,
            },
          );
          domPaymentLinkId = created?.id ?? null;
        } catch {
          // segue sem registro DOM — o checkout PIX usa o link local
        }
      }

      try {
        const link = await this.prisma.paymentLink.create({
          data: {
            userId: cob.createdByUserId,
            title: titulo,
            description: titulo,
            amount,
            maxInstallments: 12,
            plataformas: ['SIMINTPAY'],
            domPaymentLinkId,
          },
          select: { id: true },
        });
        await this.prisma.cobranca.update({
          where: { id: cob.id },
          data: { paymentRef: link.id },
        });
      } catch {
        // não bloqueia a listagem — tenta de novo na próxima carga
      }
    }
  }

  /** true se a cobrança pendente já passou do vencimento (exibida como "Vencida"). */
  private cobrancaVencida(c: {
    status: string;
    dueDate: Date | null;
  }): boolean {
    return (
      c.status === 'PENDING' && !!c.dueDate && c.dueDate.getTime() < Date.now()
    );
  }

  /**
   * Baixa automática: marca como PAID as cobranças PAYABLE pendentes cujo link de
   * pagamento (paymentRef) já tem transação COMPLETED. Chamada nas listagens —
   * o pagamento do checkout reflete sem precisar de baixa manual.
   */
  private async reconcileCobrancasPagas(where: Prisma.CobrancaWhereInput = {}) {
    const pendentes = await this.prisma.cobranca.findMany({
      where: {
        ...where,
        mode: 'PAYABLE',
        status: 'PENDING',
        paymentRef: { not: null },
      },
      select: { id: true, paymentRef: true },
    });
    if (pendentes.length === 0) return;

    const refs = pendentes.map((p) => p.paymentRef!);
    const pagas = await this.prisma.transaction.findMany({
      where: { paymentLinkId: { in: refs }, status: 'COMPLETED' },
      select: { paymentLinkId: true, createdAt: true },
    });
    if (pagas.length === 0) return;

    const pagoEm = new Map(pagas.map((t) => [t.paymentLinkId!, t.createdAt]));
    const quitadas = pendentes.filter((p) => pagoEm.has(p.paymentRef!));
    if (quitadas.length === 0) return;

    await this.prisma.$transaction(
      quitadas.map((p) =>
        this.prisma.cobranca.update({
          where: { id: p.id },
          data: {
            status: 'PAID',
            paidAt: pagoEm.get(p.paymentRef!) ?? new Date(),
          },
        }),
      ),
    );
  }

  @Get('cobrancas/minhas')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cobranças a pagar do cliente logado (painel do cliente)',
  })
  async minhasCobrancas(@CurrentUser() user?: JwtPayload) {
    if (!user?.sub) throw new BadRequestException('Não autenticado');
    // Garante link de pagamento nas antigas + reflete pagamentos do checkout.
    await this.ensureCobrancaPaymentLinks({ userId: user.sub });
    await this.reconcileCobrancasPagas({ userId: user.sub });
    const items = await this.prisma.cobranca.findMany({
      where: { userId: user.sub, mode: 'PAYABLE' },
      orderBy: { createdAt: 'desc' },
    });
    return {
      data: items.map((c) => ({
        id: c.id,
        amount: Number(c.amount),
        description: c.description,
        status: c.status,
        // Pendente com vencimento passado → exibida como "Vencida".
        vencida: this.cobrancaVencida(c),
        dueDate: c.dueDate,
        paidAt: c.paidAt,
        createdAt: c.createdAt,
        // id do PaymentLink → checkout: /?simLinkCode=<paymentRef>
        paymentRef: c.paymentRef,
      })),
    };
  }

  @Post('cobrancas/:id/status')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Atualiza status de uma cobrança a pagar (marcar paga / cancelar)',
  })
  async atualizarStatusCobranca(
    @Param('id') id: string,
    @Body() body: { status?: 'PAID' | 'CANCELED' },
  ) {
    const status = body?.status;
    if (status !== 'PAID' && status !== 'CANCELED') {
      throw new BadRequestException('Status inválido (use PAID ou CANCELED).');
    }
    const cob = await this.prisma.cobranca.update({
      where: { id },
      data: { status, paidAt: status === 'PAID' ? new Date() : null },
      select: { id: true, status: true, paidAt: true },
    });
    return cob;
  }

  @Get('plataformas/taxas/:tag')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Taxas resolvidas de uma única tag (inclui clientes CLIENT:<email>)',
  })
  async getPlatformTaxasByTag(@Param('tag') tag: string) {
    return this.platformTaxas.getTaxasResponse([tag]);
  }

  @Get('plataformas/minhas-taxas')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Taxas resolvidas do cliente logado (somente leitura)',
  })
  async getMinhasTaxas(@CurrentUser() user: JwtPayload | undefined) {
    if (!user?.sub) throw new BadRequestException('Usuário não autenticado');

    const u = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: { platform: true },
    });
    if (!u) throw new BadRequestException('Usuário não encontrado');

    // Plataforma (renovada/bosque/...) usa a tag do módulo; cliente SIM INT PAY
    // (sem módulo) usa USER:<id>, que herda o GLOBAL e reflete o que o master
    // personalizou para ele na página de Taxas.
    const slug = u.platform?.tag?.trim();
    const tag = slug
      ? canonicalPlatformTaxaTag(slug.toUpperCase())
      : buildUserTaxaTag(u.id);

    const resolved = this.platformTaxas.getResolvedTaxaForTag(tag);

    // Não expomos isPersonalized/sources: o cliente não precisa saber se a taxa
    // é padrão ou personalizada — apenas o valor aplicado.
    return {
      email: u.email,
      platform: slug ? slug.toUpperCase() : 'SIM INT PAY',
      data: resolved.data,
    };
  }

  @Get('plataformas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Listar plataformas cadastradas e seus donos' })
  async listPlataformas() {
    return new PlatformAdministrationService(
      this.prisma,
      this.paymentGateway,
      this.platformReporting,
    ).listPlataformas();
  }

  @Get('plataformas/:tag/comunidades')
  @ApiOperation({
    summary:
      'Listar comunidades vinculadas a links de assinatura de uma plataforma',
  })
  async listPlataformaComunidades(@Param('tag') tag: string) {
    return new PlatformAdministrationService(
      this.prisma,
      this.paymentGateway,
      this.platformReporting,
    ).listPlataformaComunidades(tag);
  }

  @Get('plataformas/atlas/breakdown')
  @ApiOperation({
    summary: 'Breakdown de receita Atlas: domínios vs hospedagem, por produto',
  })
  @ApiQuery({ name: 'dataInicio', required: false })
  @ApiQuery({ name: 'dataFim', required: false })
  async getAtlasBreakdown(
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    return new PlatformAdministrationService(
      this.prisma,
      this.paymentGateway,
      this.platformReporting,
    ).getAtlasBreakdown(dataInicio, dataFim);
  }

  @Get('plataformas/:tag/distribuicao-metodo')
  @ApiOperation({
    summary:
      'Distribuição de pagamentos por método para uma plataforma (COMPLETED)',
  })
  @ApiQuery({ name: 'dataInicio', required: false })
  @ApiQuery({ name: 'dataFim', required: false })
  async getPlataformaDistribuicaoMetodo(
    @Param('tag') tag: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    return new PlatformAdministrationService(
      this.prisma,
      this.paymentGateway,
      this.platformReporting,
    ).getPlataformaDistribuicaoMetodo(tag, dataInicio, dataFim);
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
  @ApiQuery({
    name: 'metodoPagamento',
    required: false,
    description: 'PIX | CREDIT_CARD | DEBIT_CARD',
  })
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
    @Query('metodoPagamento') metodoPagamento?: string,
  ) {
    return new PlatformAdministrationService(
      this.prisma,
      this.paymentGateway,
      this.platformReporting,
    ).listPlataformaTransacoes(
      tag,
      page,
      pageSize,
      status,
      dataInicio,
      dataFim,
      codigoTransacao,
      codigoReferencia,
      compradorNome,
      compradorDocumento,
      compradorEmail,
      periodType,
      tipoTransacao,
      metodoPagamento,
    );
  }

  @Post('withdrawals/approve-all')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Marcar todos os saques PENDENTES e APROVADOS como CONCLUÍDOS (Bulk Approval)',
  })
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
          const claimed = await tx.withdrawRequest.updateMany({
            where: { id: w.id, status: WithdrawStatus.PENDING },
            data: { status: WithdrawStatus.COMPLETED, updatedAt: new Date() },
          });
          if (claimed.count !== 1)
            throw new ConflictException('Saque alterado por outra operação');
          await tx.balanceLog.create({
            data: {
              userId: w.userId,
              action: 'WITHDRAW_APPROVED',
              source: 'ADMIN_BULK',
              balanceDelta: w.grossAmount.neg(),
              lockedDelta: w.grossAmount.neg(),
              metadata: { withdrawId: w.id },
            },
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
      where: {
        id: { in: approvedWiths.map((aw) => aw.id) },
        status: WithdrawStatus.APPROVED,
      },
      data: { status: WithdrawStatus.COMPLETED, updatedAt: new Date() },
    });
    updated += approvedUpdate.count;

    return {
      success: true,
      count: updated,
      message: `${updated} saques marcados como concluídos.`,
    };
  }

  @Post('renovada/reset-wallet')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Zerar saldo e bloqueios da carteira Renovada (sem saque sintético)',
    description:
      'Zera wallet, remove todos os saques. O /auth/me Renovada usa wallet + saques COMPLETED/APPROVED; um saque sintético COMPLETED quebrava o saldo (gross × (fator−1) ficava negativo). Transações permanecem no banco.',
  })
  async resetRenovadaWallet() {
    await this.requireExclusivePlatformWallet('RENOVADA');
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';

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

          balanceDelta: 0,

          lockedDelta: 0,

          source: 'ADMIN_FORCE',
          description:
            'Reset Renovada: wallet zerada e histórico de saques removido.',
        },
      });
    });

    return {
      success: true,
      message:
        'Saldo zerado com sucesso (0,00). Histórico de transações mantido.',
    };
  }

  @Post('renovada/set-wallet-balance')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Define manualmente o saldo líquido da carteira Renovada',
    description:
      'Permite corrigir o wallet.balance para o valor correto após migração para modelo net. Futuras transações somam DOM liquid_amount ao saldo definido.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['balance'],
      properties: {
        balance: {
          type: 'number',
          example: 3238.84,
          description: 'Novo saldo líquido em reais',
        },
      },
    },
  })
  async setRenovadaWalletBalance(@Body() body: { balance: number }) {
    const RENOVADA_ID = getPlatformOwnerId('RENOVADA') ?? '';
    const newBalance = Number(body.balance);
    if (!Number.isFinite(newBalance) || newBalance < 0) {
      throw new BadRequestException('balance deve ser um número positivo');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: RENOVADA_ID },
    });
    if (!wallet)
      throw new NotFoundException('Wallet não encontrada para Renovada');

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.wallet.findUniqueOrThrow({
        where: { userId: RENOVADA_ID },
      });
      const after = await tx.wallet.update({
        where: { id: before.id, version: before.version },
        data: { balance: newBalance, version: { increment: 1 } },
      });
      await tx.balanceLog.create({
        data: {
          userId: RENOVADA_ID,
          action: 'WALLET_MANUAL_SET',

          balanceDelta: after.balance.sub(before.balance),

          lockedDelta: 0,

          source: 'ADMIN_FORCE',
          description: `Ajuste manual de saldo: R$ ${newBalance.toFixed(2)}`,
        },
      });
    });

    return {
      success: true,
      balanceAnterior: Number(wallet.balance),
      balanceNovo: newBalance,
      message: `Saldo definido para R$ ${newBalance.toFixed(2)}`,
    };
  }

  // ── Areaflix ─────────────────────────────────────────────────────────────

  @Get('areaflix/orders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Listar todas as ordens de subscription links (Areaflix)',
  })
  async listAreaflixOrders(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('customerEmail') customerEmail?: string,
    @Query('customerName') customerName?: string,
  ) {
    const p = page ? Number(page) : 1;
    const ps = pageSize ? Number(pageSize) : 50;
    const skip = (p - 1) * ps;

    // Filtrar apenas links de assinatura que pertencem à Areaflix (webhookUrl contém "areaflix")
    const areaflixLinks = await this.prisma.subscriptionLink.findMany({
      where: { webhookUrl: { contains: 'areaflix', mode: 'insensitive' } },
      select: { id: true },
    });
    const areaflixLinkIds = areaflixLinks.map((l) => l.id);

    const where: any = { subscriptionLinkId: { in: areaflixLinkIds } };
    if (status) where.status = status;
    if (customerEmail)
      where.customerEmail = { contains: customerEmail, mode: 'insensitive' };
    if (customerName)
      where.customerName = { contains: customerName, mode: 'insensitive' };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.subscriptionLinkOrder.count({ where }),
      this.prisma.subscriptionLinkOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: ps,
        include: {
          subscriptionLink: {
            select: {
              name: true,
              amount: true,
              platformFee: true,
              frequencyType: true,
            },
          },
        },
      }),
    ]);

    const areaflixPaidWhere = {
      subscriptionLinkId: { in: areaflixLinkIds },
      status: { in: ['paid', 'active', 'approved'] },
    };
    const totalRevenue = await this.prisma.subscriptionLinkOrder.aggregate({
      where: areaflixPaidWhere,
      _sum: { amountCharged: true, platformFeeAmount: true },
    });

    return {
      total,
      page: p,
      pageSize: ps,
      totalRevenue: Number(totalRevenue._sum.amountCharged ?? 0),
      totalFee: Number(totalRevenue._sum.platformFeeAmount ?? 0),
      items,
    };
  }

  // ── Gestão de usuários das plataformas SaaS (PlatformSubscriberAccess) ───────

  @Get('plataformas/:tag/usuarios')
  @ApiOperation({
    summary: 'Listar assinantes de uma plataforma SaaS com dias restantes',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'all | active | inactive',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listPlataformaUsuarios(
    @Param('tag') tag: string,
    @Query('status') status = 'all',
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return new PlatformSaasAccessService(this.prisma).list(
      tag,
      status,
      page,
      limit,
    );
  }

  @Patch('plataformas/:tag/usuarios/:userId/toggle')
  @ApiOperation({
    summary:
      'Pausar/retomar acesso de assinante (freeze de dias + notifica SaaS backend)',
  })
  async togglePlataformaUsuario(
    @Param('tag') tag: string,
    @Param('userId') userId: string,
  ) {
    return new PlatformSaasAccessService(this.prisma).toggle(tag, userId);
  }

  @Get('relatorios/atlas-consolidado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async getAtlasConsolidado(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const atlasUserId = await resolveRegisteredOwner(
      this.prisma,
      'ATLAS_USER_ID',
      ['atlas'],
    );
    const effectiveStart =
      startDate ?? dayjs().tz(TZ).startOf('month').format('YYYY-MM-DD');
    // Os cards financeiros comuns são calculados pelo mesmo caminho de todas
    // as plataformas. Este endpoint só acrescenta dados próprios do Atlas.
    const cards = await this.getPlataformaConsolidado(
      'ATLAS',
      effectiveStart,
      endDate,
      undefined,
      true,
    );
    if ('error' in cards) throw new Error(cards.error);

    const TAXA_SAQUE_FIXA = getPlatformTaxaEffective(
      'ATLAS',
      'TAXA_SAQUE_FIXA',
      PLATFORM_TAXA_DEFAULTS.TAXA_SAQUE_FIXA,
    );

    const atlasBaseUrl = String(
      getPlatformIntegrationValue('ATLAS', 'BACKEND_URL') ?? '',
    ).replace(/\/+$/, '');
    const internalToken = process.env.API_MACHINE_INTERNAL_TOKEN ?? '';

    let atlasData: {
      domains: {
        totalRevenue: number;
        totalNamecheapCost: number;
        count: number;
      };
      vps: { totalRevenue: number; totalContaboCost: number; count: number };
      affiliates: {
        totalAvailable: number;
        totalWithdrawn: number;
        commissionGeneratedInPeriod: number;
      };
      withdrawals: {
        pendingCount: number;
        approvedInPeriodCount: number;
        approvedInPeriodFeeSum: number;
      };
    } | null = null;

    if (atlasBaseUrl) {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const resp = await fetch(
        `${atlasBaseUrl}/api/internal/report?${params.toString()}`,
        {
          headers: { 'x-internal-token': internalToken },
        },
      ).catch(() => null);

      if (resp?.ok) {
        atlasData = await resp.json().catch(() => null);
      }
    }

    const custoDominio = atlasData?.domains.totalNamecheapCost ?? 0;
    const custoHospedagem = atlasData?.vps.totalContaboCost ?? 0;
    const lucroAfiliado = atlasData?.affiliates.totalWithdrawn ?? 0;
    const totalRepasseAfiliado = atlasData?.affiliates.totalAvailable ?? 0;
    const custoAfiliadoPeriodo =
      atlasData?.affiliates.commissionGeneratedInPeriod ?? 0;
    const saquePendente = atlasData?.withdrawals.pendingCount ?? 0;
    const qtdSaquesAprovados =
      atlasData?.withdrawals.approvedInPeriodCount ?? 0;
    const lucroSimpayDeSaque = qtdSaquesAprovados * TAXA_SAQUE_FIXA;

    const receitaLiquidaSimintpay = cards.taxaSimIntPctNet + lucroSimpayDeSaque;
    const lucroLiquidoDominio =
      (atlasData?.domains.totalRevenue ?? 0) - custoDominio;
    const lucroLiquidoVps =
      (atlasData?.vps.totalRevenue ?? 0) - custoHospedagem;

    const receitaBrutaAtlas =
      (atlasData?.domains.totalRevenue ?? 0) +
      (atlasData?.vps.totalRevenue ?? 0);
    const receitaLiquidaAtlas =
      receitaBrutaAtlas -
      cards.totalTaxasSimInt -
      custoDominio -
      custoHospedagem -
      custoAfiliadoPeriodo;

    const roiSimintpay =
      cards.receitaTotal > 0
        ? (receitaLiquidaSimintpay / cards.receitaTotal) * 100
        : 0;
    const roiDominios =
      (atlasData?.domains.totalRevenue ?? 0) > 0
        ? (lucroLiquidoDominio / atlasData!.domains.totalRevenue) * 100
        : 0;
    const roiHospedagem =
      (atlasData?.vps.totalRevenue ?? 0) > 0
        ? (lucroLiquidoVps / atlasData!.vps.totalRevenue) * 100
        : 0;
    const roiAtlas =
      receitaBrutaAtlas > 0
        ? (receitaLiquidaAtlas / receitaBrutaAtlas) * 100
        : 0;

    const dateWhere: any = {
      gte: parseYmdSp(effectiveStart).startOf('day').toDate(),
    };
    if (endDate) dateWhere.lte = parseYmdSp(endDate).endOf('day').toDate();

    const [estornoCount, chargebackCount] = await Promise.all([
      this.prisma.transaction.count({
        where: {
          userId: atlasUserId,
          status: 'REFUNDED',
          createdAt: dateWhere,
        },
      }),
      this.prisma.transaction.count({
        where: {
          userId: atlasUserId,
          status: 'CHARGEBACK',
          createdAt: dateWhere,
        },
      }),
    ]);

    return {
      ...cards,
      // Aliases legados consumidos pelos cards extras do Atlas.
      taxaSimInt: cards.taxaSimIntPctBruta,
      taxaAdquirente: cards.taxaDomFixa,
      taxaMDRDom: cards.taxaDomPct,
      custoCashback: cards.taxaDomCashback,
      custoDominio,
      custoHospedagem,
      receitaLiquidaSimintpay,
      lucroLiquidoDominio,
      lucroLiquidoVps,
      lucroAfiliado,
      totalRepasseAfiliado,
      lucroSimpayDeSaque,
      receitaLiquidaAtlas,
      saquePendente,
      roiSimintpay,
      roiDominios,
      roiHospedagem,
      roiAtlas,
      estornoCount,
      chargebackCount,
      receitaTotalAtlas: cards.receitaTotal,
      domainCount: atlasData?.domains.count ?? 0,
      vpsCount: atlasData?.vps.count ?? 0,
      atlasApiAvailable: atlasData !== null,
    };
  }

  @Get('relatorios/plataforma-consolidado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Breakdown DOM/SimIntPay de uma plataforma (exceto ATLAS)',
  })
  @ApiQuery({ name: 'tag', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({
    name: 'metodoPagamento',
    required: false,
    description: 'PIX | CREDIT_CARD | DEBIT_CARD',
  })
  async getPlataformaConsolidado(
    @Query('tag') tagParam?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('metodoPagamento') metodoPagamento?: string,
    allowAtlasInternally = false,
  ) {
    return new PlatformAdministrationService(
      this.prisma,
      this.paymentGateway,
      this.platformReporting,
    ).getPlataformaConsolidado(
      tagParam,
      startDate,
      endDate,
      metodoPagamento,
      allowAtlasInternally,
    );
  }
}
