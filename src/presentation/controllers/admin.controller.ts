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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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

type DomTransactionReportRow = DomTransactionItem & {
  tenant_tag: string;
  valor_bruto_venda: number;
  taxa_dom: number;
  taxa_vendedor: number;
  taxa_fixa_transacao: number;
  taxa_cashback: number;
};

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
import { ReconcilePendingTransactionsUseCase } from '../../application/use-cases/webhook/reconcile-pending-transactions.use-case';
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
import { SyncWithdrawalsDto } from '../../application/dtos/admin/sync-withdrawals.dto';
import { TestEbookEmailDto } from '../../application/dtos/admin/test-ebook-email.dto';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { EmailService } from '../../infrastructure/email/email.service';
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
import { computeBosqueAvailableSinceLastWithdrawal } from '../../application/helpers/bosque-available.helper';
import { PlatformTaxasService } from '../../application/services/platform-taxas.service';
import { getPlatformTaxaEffective, invalidatePlatformTaxaCache, buildClientTaxaTag, canonicalPlatformTaxaTag } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS, type PlataformaTaxaKey } from '../../modules/platform-taxas/platform-taxas.keys';
import { estimateDomFeeReais, estimatePhysicalDomFeeReais, resolveDomFeeReais } from '../../application/helpers/dom-fee-estimate.helper';
import { calculateBoletoFees } from '../../application/use-cases/boleto/boleto-fees.helper';
import { isMasterAdminUser } from '../../shared/utils/is-master-admin.util';
import { LinkExternalPlatformUserService } from '../../application/services/link-external-platform-user.service';
import { ScanPlatformOwnersUseCase } from '../../application/use-cases/admin/scan-platform-owners.use-case';
import { GetWalletCompositionUseCase } from '../../application/use-cases/admin/get-wallet-composition.use-case';
import { summarizeRefunds } from '../../application/helpers/refund-report.helper';
import { TENANT_EBOOK_TAG, TENANT_AREAFLIX_TAG, TENANT_RENOVADA_TAG, TENANT_CONTROLE_MOTORISTA_TAG, TENANT_CONTROLE_PATRIMONIAL_TAG, isMaquinetaDescription } from '../../application/utils/internal-tags.util';
import { PlatformReportingService } from '../../application/services/platform-reporting.service';

/** Extrai o serial do terminal a partir da descrição da transação */
function extractTerminal(description: string | null | undefined): string {
  if (!description) return '-';
  const m = description.match(/Terminal:\s*([A-Z0-9]+)/i);
  return m ? m[1] : '-';
}

const PLAN_PLATFORM_CPF_REGEX = /\[CPF:([^\]|]*)\|([^\]]+)\]/;

function normalizePlatformTag(tag: string): string {
  const upper = String(tag || '').toUpperCase();
  if (upper === 'EBOOKSIM' || upper === 'EBOOK') return 'EBOOK';
  if (upper === 'CONTROLE_MOTORISTA' || upper === 'CONTROLE-MOTORISTA') return 'CONTROLE-MOTORISTA';
  if (upper === 'CONTROLE_PATRIMONIAL' || upper === 'CONTROLE-PATRIMONIAL') return 'CONTROLE-PATRIMONIAL';
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
const REVALIDA_CONSOLIDADO_USER_ID =
  process.env.REVALIDA_USER_ID || '27598c29-0ace-4b5d-ad49-f5d399910854';

const AREAFLIX_CONSOLIDADO_FALLBACK_ID = 'f0000000-0000-4000-8000-000000000af1';

type ConsolidadoPlatformEntry = { tag: string; id: string };

async function resolveBySlugOrEnv(
  prisma: PrismaService,
  envKey: string,
  slugs: string[],
  fallback = '',
): Promise<string> {
  const envId = process.env[envKey]?.trim();
  if (envId) return envId;
  const u = await prisma.user.findFirst({
    where: {
      OR: slugs.map((s) => ({
        tenantModule: { slug: { equals: s, mode: 'insensitive' } },
      })),
    },
    select: { id: true },
  });
  return u?.id ?? fallback;
}

/** Resolve todos os user IDs das plataformas do consolidado em paralelo. */
async function resolveConsolidadoPlatforms(
  prisma: PrismaService,
): Promise<ConsolidadoPlatformEntry[]> {
  const [
    renovadaId, pagatgId, bosqueId, revalidaId,
    ebookId, areaflixId, atlasId, frendzId,
  ] = await Promise.all([
    resolveBySlugOrEnv(prisma, 'RENOVADA_USER_ID', ['renovada'], 'ba2b57d6-e3bf-4395-af31-58454f27207a'),
    resolveBySlugOrEnv(prisma, 'PAGATG_USER_ID', ['pagatg']),
    resolveBySlugOrEnv(prisma, 'BOSQUE_USER_ID', ['bosque', 'ibb'], 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c'),
    // Revalida tem conta técnica canônica. Resolver pelo primeiro usuário do módulo
    // incluía outra conta sem tag nos cards, enquanto tabela usa este mesmo ID.
    REVALIDA_CONSOLIDADO_USER_ID,
    resolveBySlugOrEnv(prisma, 'EBOOK_ID', ['ebooksim', 'ebook']),
    resolveBySlugOrEnv(prisma, 'AREAFLIX_USER_ID', ['areaflix'], AREAFLIX_CONSOLIDADO_FALLBACK_ID),
    resolveBySlugOrEnv(prisma, 'ATLAS_USER_ID', ['atlas']),
    resolveBySlugOrEnv(prisma, 'FRENDZ_USER_ID', ['frendz']),
  ]);

  const platforms: ConsolidadoPlatformEntry[] = [];
  const add = (tag: string, id: string) => { if (id) platforms.push({ tag, id }); };
  add('RENOVADA', renovadaId);
  add('PAGATG', pagatgId);
  add('BOSQUE', bosqueId);
  add('REVALIDA', revalidaId);
  add('EBOOK', ebookId);
  add('FRENDZ', frendzId);
  add('AREAFLIX', areaflixId);
  add('ATLAS', atlasId);
  return platforms;
}

/**
 * Busca ordens de assinatura de comunidade pagas no período, via CommunityLinkBinding.
 * Retorna rows no mesmo formato de txRowsLucro para serem mescladas no consolidado.
 */
async function getComunidadeOrderRows(
  prisma: PrismaService,
  dataInicio?: string,
  dataFim?: string,
): Promise<Array<{ id: string; userId: string; amount: unknown; netAmount: unknown; createdAt: Date; description: string; installments: number; paymentMethod: string | null }>> {
  const bindings = await prisma.communityLinkBinding.findMany({
    where: { subscriptionLinkId: { not: null } },
    select: {
      subscriptionLinkId: true,
      community: { select: { slug: true } },
    },
    distinct: ['subscriptionLinkId'],
  });
  // Map linkId → community slug (uppercased) for per-community tagging
  const linkIdToTag = new Map(
    bindings.map((b) => [b.subscriptionLinkId!, b.community.slug.toUpperCase()])
  );
  const linkIds = [...linkIdToTag.keys()].filter(Boolean);
  if (linkIds.length === 0) return [];

  const createdAt: Prisma.DateTimeFilter = {};
  if (dataInicio) {
    const d = dayjs.tz(dataInicio, TZ).startOf('day');
    if (d.isValid()) createdAt.gte = d.toDate();
  }
  if (dataFim) {
    const d = dayjs.tz(dataFim, TZ).endOf('day');
    if (d.isValid()) createdAt.lte = d.toDate();
  }

  const orders = await prisma.subscriptionLinkOrder.findMany({
    where: {
      subscriptionLinkId: { in: linkIds },
      status: 'paid',
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    },
    select: {
      id: true,
      amountCharged: true,
      platformFeeAmount: true,
      createdAt: true,
      paymentMethod: true,
      subscriptionLinkId: true,
      subscriptionLink: { select: { userId: true, name: true } },
    },
  });

  return orders.flatMap((o) => {
    const tag = linkIdToTag.get(o.subscriptionLinkId ?? '');
    if (!tag) return [];
    return [{
      id: `comunidade_order_${o.id}`,
      userId: o.subscriptionLink.userId,
      amount: o.amountCharged,
      netAmount: Number(o.amountCharged) - Number(o.platformFeeAmount),
      createdAt: o.createdAt,
      description: `${o.subscriptionLink.name} [TENANT:${tag}]`,
      installments: 1,
      paymentMethod: o.paymentMethod ?? null,
    }];
  });
}

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
function buildConsolidadoScopeOr(platformIds: string[]): Prisma.TransactionWhereInput {
  return {
    OR: [
      { userId: { in: platformIds } },
      { description: { contains: '[TENANT:', mode: 'insensitive' } },
      // Bosque legado: transações antigas sem tag, marcadas só pela palavra na descrição.
      { description: { contains: 'bosque', mode: 'insensitive' } },
    ],
  };
}

/** Prioridade Bosque pela descrição (alinha com /plataformas/bosque). */
function transacaoAtribuiBosquePorDescricao(description: string | null | undefined): boolean {
  if (!description) return false;
  if (/\[\s*TENANT\s*:\s*BOSQUE\s*\]/i.test(description)) return true;
  return description.toLowerCase().includes('bosque') || description.toLowerCase().includes('ibb');
}

function transacaoAtribuiAreaflixPorDescricao(description: string | null | undefined): boolean {
  if (!description) return false;
  return /\[\s*TENANT\s*:\s*AREAFLIX\s*\]/i.test(description);
}

function transacaoAtribuiPagatgPorDescricao(description: string | null | undefined): boolean {
  if (!description) return false;
  return /\[\s*TENANT\s*:\s*PAGATG\s*\]/i.test(description);
}

function transacaoAtribuiEbookPorDescricao(description: string | null | undefined): boolean {
  if (!description) return false;
  return description.includes(TENANT_EBOOK_TAG);
}

/** Tags de plataformas fixas — qualquer [TENANT:X] fora deste conjunto é uma comunidade individual. */
const FIXED_PLATFORM_TAGS = new Set([
  'RENOVADA', 'BOSQUE', 'AREAFLIX', 'PAGATG', 'EBOOK', 'EBOOKSIM',
  'ATLAS', 'CONTROLE-MOTORISTA', 'CONTROLE-PATRIMONIAL',
  'REVALIDA', 'FRENDZ', 'BETAI', 'GLOBAL',
]);

/** Tag sentinela para transações sem plataforma/produto atribuível — nada fica de fora do relatório. */
const TAG_NAO_IDENTIFICADA = 'NAO-IDENTIFICADA';

function consolidadoTagParaTransacao(
  tx: { userId: string; description: string | null },
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): string {
  // Tag explícita [TENANT:X] é a fonte mais precisa e vale para QUALQUER plataforma
  // (fixa ou dinâmica). Antes só as dinâmicas eram reconhecidas aqui: transação de
  // plataforma fixa (ATLAS, REVALIDA, BETAI…) com userId de outra conta caía no
  // fallback RENOVADA — sumia dos cards do produto e inflava a Renovada.
  if (tx.description) {
    const m = tx.description.match(/\[TENANT:([A-Z0-9_-]+)\]/i);
    if (m) {
      const t = m[1].toUpperCase();
      if (t !== 'GLOBAL') return t === 'EBOOKSIM' ? 'EBOOK' : t;
    }
  }
  if (transacaoAtribuiBosquePorDescricao(tx.description)) return 'BOSQUE';
  if (transacaoAtribuiAreaflixPorDescricao(tx.description)) return 'AREAFLIX';
  if (transacaoAtribuiPagatgPorDescricao(tx.description)) return 'PAGATG';
  if (transacaoAtribuiEbookPorDescricao(tx.description)) return 'EBOOK';
  if (tx.description?.includes(TENANT_CONTROLE_MOTORISTA_TAG)) return 'CONTROLE-MOTORISTA';
  if (tx.description?.includes(TENANT_CONTROLE_PATRIMONIAL_TAG)) return 'CONTROLE-PATRIMONIAL';
  const platform = platforms.find((p) => p.id === tx.userId);
  // Sem tag, sem keyword e sem conta conhecida → NÃO IDENTIFICADA. Antes o fallback
  // era 'RENOVADA', que inflava a Renovada e escondia transações órfãs — agora elas
  // aparecem no card "Transações não identificadas" do relatório para serem tratadas.
  return platform?.tag ?? TAG_NAO_IDENTIFICADA;
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

  const and: Prisma.TransactionWhereInput[] = [buildConsolidadoScopeOr(platformIds)];

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
    and.push({ customerName: { contains: input.customerName.trim(), mode: 'insensitive' } });
  }

  if (input.transactionId?.trim()) {
    and.push({
      OR: [{ id: input.transactionId.trim() }, { domTransactionId: input.transactionId.trim() }],
    });
  }

  if (input.paymentLink?.trim()) {
    and.push({ paymentLinkId: input.paymentLink.trim() });
  }

  if (input.planName?.trim()) {
    and.push({ description: { contains: input.planName.trim(), mode: 'insensitive' } });
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

type DomMethodBucket = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO';

function domPaymentMethodToBucket(method: string | undefined | null): DomMethodBucket {
  const m = String(method ?? 'pix').toLowerCase();
  if (m.includes('boleto') || m.includes('ticket') || m.includes('bank_slip') || m.includes('bankslip')) return 'BOLETO';
  if (m.includes('debit')) return 'DEBIT_CARD';
  if (m.includes('credit') || m.includes('cartao') || m.includes('card')) return 'CREDIT_CARD';
  return 'PIX';
}

const DOM_DIST_METHOD_LABEL: Record<DomMethodBucket, string> = {
  PIX: 'PIX',
  CREDIT_CARD: 'Cartão de Crédito',
  DEBIT_CARD: 'Débito',
  BOLETO: 'Boleto',
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

/**
 * Estornos registrados no produto. O período considera quando a transação virou
 * REFUNDED; sincronizações legadas sem histórico usam updatedAt como fallback.
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
    start: dataInicio ? parseYmdSp(dataInicio).startOf('day').toDate() : undefined,
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
const TAGS_SEM_TAXA_SERVICO = new Set<string>([]);
/** Transações anteriores a esta data não são cobradas a TAXA_SERVICO (fee retroativo não aplicado). */
const TAXA_SERVICO_EFFECTIVE_DATE = new Date('2026-05-18T03:00:00.000Z'); // 2026-05-18 meia-noite BRT
/** RENOVADA e BOSQUE: início do TAXA_SERVICO — mesma data dos internal-*-finance.controller.ts. */
const TAXA_SERVICO_EFFECTIVE_DATE_RENOVADA = new Date('2026-05-29T20:40:00.000Z');
/** Retorna a data efetiva do TAXA_SERVICO por plataforma (RENOVADA/BOSQUE migraram em 2026-05-29). */
function getTaxaServicoEffectiveDate(tag: string): Date {
  return tag === 'RENOVADA' || tag === 'BOSQUE' ? TAXA_SERVICO_EFFECTIVE_DATE_RENOVADA : TAXA_SERVICO_EFFECTIVE_DATE;
}

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
      { userId: tx.userId, description: tx.description ?? null },
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
    const taxaServicoRate = TAGS_SEM_TAXA_SERVICO.has(tag) ? 0 : getPlatformTaxaEffective(tag, 'TAXA_SERVICO', 4.0);
    const taxaServico = taxaServicoRate > 0 && tx.createdAt >= getTaxaServicoEffectiveDate(tag) ? taxaServicoRate : 0;

    const bruto = Number(tx.amount);
    const parteAdmin = bruto * (1 - liquidezLojista);
    const pm = String(tx.paymentMethod ?? 'PIX');
    const inst = Number(tx.installments ?? 1);
    const taxaMdr = mdrDomPct(pm, inst, bruto, tag);
    // taxaServico é receita (cobrado do vendedor); taxaFixa, taxaCashback e taxaMdr são custos DOM.
    const lucroTx = parteAdmin + taxaServico - taxaMdr - taxaFixa - taxaCashback;
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
    const formulaLucro = taxaServico > 0
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

  const plataformas: LucroSimpayPorPlataforma[] = platforms.map(
    (p) => {
      const hit = byTag.get(p.tag);
      const liquidezKey = `${p.tag}_LIQUIDEZ`;
      const fixaKey = `${p.tag}_TAXA_FIXA_TRANSACAO`;
      const cbKey = `${p.tag}_TAXA_CASHBACK`;
      const servicoKey = `${p.tag}_TAXA_SERVICO`;
      const L = getPlatformTaxaEffective(p.tag, 'LIQUIDEZ', 0.91);
      const tf = getPlatformTaxaEffective(p.tag, 'TAXA_FIXA_TRANSACAO', 1.0);
      const tc = getPlatformTaxaEffective(p.tag, 'TAXA_CASHBACK', 3.0);
      const ts = TAGS_SEM_TAXA_SERVICO.has(p.tag) ? 0 : getPlatformTaxaEffective(p.tag, 'TAXA_SERVICO', 4.0);

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
        subtotalDeducaoTaxaFixa: Number((hit.transacoes.length * hit.taxaFixa).toFixed(2)),
        subtotalDeducaoTaxaCashback: Number((hit.transacoes.length * hit.taxaCashback).toFixed(2)),
        subtotalDeducaoTaxaServico: Number(hit.subtotalTaxaServico.toFixed(2)),
        subtotalLucro: Number(hit.subtotalLucro.toFixed(2)),
        transacoes: hit.transacoes.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
      };
    },
  );

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
      subtotalDeducaoTaxaFixa: Number((hit.transacoes.length * hit.taxaFixa).toFixed(2)),
      subtotalDeducaoTaxaCashback: Number((hit.transacoes.length * hit.taxaCashback).toFixed(2)),
      subtotalDeducaoTaxaServico: Number((hit.transacoes.length * hit.taxaServico).toFixed(2)),
      subtotalLucro: Number(hit.subtotalLucro.toFixed(2)),
      transacoes: hit.transacoes.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    });
  }

  return {
    totalLucroSimpay: Number(totalLucroSimpay.toFixed(2)),
    plataformas,
  };
}

/** Plataformas cujo "repasse" não vai a lojista externo — o valor fica com a Simintpay. */
const SEM_REPASSE_TAGS = new Set(['ATLAS', 'AREAFLIX']);

/** Lucro Simpay de uma transação (mesma fórmula que buildLucroSimpayDetalhePorPlataforma). */
function lucroSimpayUmaTransacaoConsolidado(
  tx: {
    userId: string;
    amount: unknown;
    description?: string | null;
    installments?: number | null;
    createdAt?: Date;
    paymentMethod?: string | null;
  },
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): number {
  const tag = consolidadoTagParaTransacao(
    { userId: tx.userId, description: tx.description ?? null },
    platforms,
  );
  const liquidezLojista = getPlatformTaxaEffective(tag, 'LIQUIDEZ', 0.91);
  const taxaFixa = getPlatformTaxaEffective(tag, 'TAXA_FIXA_TRANSACAO', 1.0);
  const taxaCashback = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK', 3.0);
  const taxaServicoRate = TAGS_SEM_TAXA_SERVICO.has(tag) ? 0 : getPlatformTaxaEffective(tag, 'TAXA_SERVICO', 4.0);
  const taxaServico = taxaServicoRate > 0 && tx.createdAt != null && tx.createdAt >= getTaxaServicoEffectiveDate(tag)
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
  txRowsLucro: { userId: string; amount: unknown; createdAt: Date; description?: string | null }[],
  withdrawLogs: { createdAt: Date; amount: unknown; action: string }[],
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
  txRowsLucro: { userId: string; amount: unknown; createdAt: Date; description?: string | null }[],
  withdrawLogs: { createdAt: Date; amount: unknown; action: string }[],
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
  taxaAdquirente: number;
  taxaSaque: number;
  lucroSaque: number;
  taxaServico: number;
  taxaSaqueDom: number;
};

const DOM_CC_RATE_BY_INSTALLMENT_ADM: Record<number, number> = {
  1: 0.0399, 2: 0.083, 3: 0.0968, 4: 0.1104, 5: 0.1237,
  6: 0.1367, 7: 0.1495, 8: 0.1621, 9: 0.1744, 10: 0.1864,
  11: 0.1983, 12: 0.2099,
};

/** Taxa MDR que a DOM cobra (somente a parte percentual, sem taxas fixas). */
function mdrDomPct(paymentMethod: string, installments: number, amount: number, tag: string): number {
  const inst = Math.min(Math.max(installments || 1, 1), 12);
  if (String(paymentMethod).toUpperCase().includes('BOLETO')) {
    // Boleto: custo DOM é FIXO por boleto (TAXA_BOLETO_DOM + TAXA_BOLETO_DOM_FIXA), não % do valor.
    return calculateBoletoFees(amount, tag).domFeeAmount;
  }
  if (paymentMethod === 'DEBIT_CARD') return amount * 0.0349;
  if (paymentMethod === 'CREDIT_CARD') return amount * (DOM_CC_RATE_BY_INSTALLMENT_ADM[inst] ?? 0.0399);
  const mdrPix = getPlatformTaxaEffective(tag, 'MDR_PIX', PLATFORM_TAXA_DEFAULTS.MDR_PIX);
  return amount * mdrPix;
}

function accumTxFinancePorDia(
  txRowsLucro: {
    userId: string;
    amount: unknown;
    netAmount: unknown | null;
    createdAt: Date;
    description?: string | null;
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
      { userId: tx.userId, description: tx.description ?? null },
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
      taxaServicoRate > 0 && tx.createdAt >= getTaxaServicoEffectiveDate(tag) ? taxaServicoRate : 0;
    taxaServico.set(ymd, (taxaServico.get(ymd) ?? 0) + taxaServicoTx);
  }
  return { bruto, liquido, lucro, cashback, taxaAdquirente, taxaServico };
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
    description?: string | null;
    paymentMethod?: string | null;
    installments?: number | null;
  }[],
  withdrawLogs: { createdAt: Date; amount: unknown; action: string }[],
  dataInicio: string,
  dataFim: string,
  platforms: ReadonlyArray<ConsolidadoPlatformEntry>,
): DashboardFinanceHistoricoRow[] {
  const { bruto, liquido, lucro, cashback, taxaAdquirente, taxaServico } = accumTxFinancePorDia(txRowsLucro, platforms);
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
    paymentMethod?: string | null;
    installments?: number | null;
  }[],
  withdrawLogs: { createdAt: Date; amount: unknown; action: string }[],
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
      { userId: tx.userId, description: tx.description ?? null },
      platforms,
    );
    const b = Number(tx.amount);
    if (Number.isFinite(b)) {
      bruto.set(h, (bruto.get(h) ?? 0) + b);
    }
    liquido.set(h, (liquido.get(h) ?? 0) + valorLiquidoTransacaoConsolidado(tx, tag));
    lucro.set(h, (lucro.get(h) ?? 0) + lucroSimpayUmaTransacaoConsolidado(tx, platforms));
    const tc = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK', 3.0);
    cashback.set(h, (cashback.get(h) ?? 0) + tc);
    const tf = getPlatformTaxaEffective(tag, 'TAXA_FIXA_TRANSACAO', 1.0);
    taxaAdquirente.set(h, (taxaAdquirente.get(h) ?? 0) + tf + tc);
    const taxaServicoRate = TAGS_SEM_TAXA_SERVICO.has(tag)
      ? 0
      : getPlatformTaxaEffective(tag, 'TAXA_SERVICO', 4.0);
    const taxaServicoTx =
      taxaServicoRate > 0 && tx.createdAt >= getTaxaServicoEffectiveDate(tag) ? taxaServicoRate : 0;
    taxaServico.set(h, (taxaServico.get(h) ?? 0) + taxaServicoTx);
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
    private readonly reconcilePendingTransactions: ReconcilePendingTransactionsUseCase,
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
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    @Inject(HASH_SERVICE) private readonly hashService: IHashService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: IPaymentGateway,
    @Inject(WALLET_REPOSITORY) private readonly walletRepository: IWalletRepository,
    private readonly platformTaxas: PlatformTaxasService,
    private readonly linkExternal: LinkExternalPlatformUserService,
    private readonly scanPlatformOwners: ScanPlatformOwnersUseCase,
    private readonly getWalletComposition: GetWalletCompositionUseCase,
    private readonly platformReporting: PlatformReportingService,
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
    let userIds: string[] = [];
    if (tag === 'RENOVADA') {
      userIds = [process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a'];
    } else if (tag === 'REVALIDA') {
      userIds = [process.env.REVALIDA_USER_ID || REVALIDA_CONSOLIDADO_USER_ID];
    } else if (tag === 'EBOOK') {
      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { tenantModule: { slug: { equals: 'ebook', mode: 'insensitive' } } },
            { tenantModule: { slug: { equals: 'ebooksim', mode: 'insensitive' } } },
          ],
        },
        select: { id: true },
      });
      userIds = await expandUserIdsByCpf(this.prisma, users.map((user) => user.id));
    } else if (tag === 'BOSQUE') {
      userIds = [process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c'];
    } else if (!['PAGATG', 'CONTROLE-MOTORISTA', 'CONTROLE-PATRIMONIAL'].includes(tag)) {
      const plans = await this.prisma.pixCreditPlan.findMany({
        where: {
          OR: [
            { description: { contains: `|${tag}]`, mode: 'insensitive' } },
            { description: { contains: tag, mode: 'insensitive' } },
          ],
        },
        select: { userId: true, description: true },
      });
      userIds = await expandPlatformTransactionUserIds(this.prisma, plans);
    }

    const scope: Prisma.TransactionWhereInput = tag === 'BOSQUE'
      ? {
        OR: [
          { userId: { in: userIds } },
          { description: { contains: '[TENANT:BOSQUE]', mode: 'insensitive' } },
          { description: { contains: 'bosque', mode: 'insensitive' } },
          { description: { contains: 'ibb', mode: 'insensitive' } },
        ],
      }
      : {
        OR: [
          ...(userIds.length ? [{ userId: { in: userIds } }] : []),
          { description: { contains: `[TENANT:${tag}]`, mode: 'insensitive' } },
        ],
      };

    const createdAt: Prisma.DateTimeFilter = {
      gte: parseYmdSp(startDate).startOf('day').toDate(),
    };
    if (endDate) createdAt.lte = parseYmdSp(endDate).endOf('day').toDate();

    const and: Prisma.TransactionWhereInput[] = [];
    if (tag === 'RENOVADA') {
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

    return this.prisma.transaction.findMany({
      where: {
        AND: [
          scope,
          { status: 'COMPLETED' },
          { createdAt },
          ...(paymentMethod ? [{ paymentMethod: paymentMethod as any }] : []),
          ...and,
        ],
      },
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        installments: true,
        description: true,
        netAmount: true,
        domFee: true,
        platformFee: true,
        cardBrand: true,
        createdAt: true,
        acquirer: true,
      },
    });
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
  @ApiOperation({ summary: 'Criar conta diretamente (admin master) — suporta CPF ou CNPJ' })
  async criarConta(
    @Body() body: { email: string; password: string; cpf?: string; cnpj?: string },
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
      const existingCpf = await (this.prisma.user as any).findFirst({ where: { cpf: cpfClean } });
      if (existingCpf) throw new ConflictException('Já existe um usuário com este CPF');
    } else if (cnpj) {
      cnpjClean = cnpj.replace(/\D/g, '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingCnpj = await (this.prisma.user as any).findFirst({ where: { cnpj: cnpjClean } });
      if (existingCnpj) throw new ConflictException('Já existe um usuário com este CNPJ');
    }

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
        ...(cpfClean ? { cpf: cpfClean } : {}),
        ...(cnpjClean ? { cnpj: cnpjClean } : {}),
        domUserId: domUserId ?? undefined,
        domToken: domToken ?? undefined,
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
  @ApiOperation({ summary: 'Dispara varredura manual de donos de plataformas (extrai CPF_DONO das transações)' })
  async scanPlatformOwnersManual() {
    const result = await this.scanPlatformOwners.execute();
    return { data: result };
  }

  @Get('usuarios/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Exporta leads como JSON para geração de CSV no frontend' })
  @ApiQuery({ name: 'platform', required: false })
  @ApiQuery({ name: 'period', required: false, description: 'mensal | trimestral | semestral | anual' })
  async exportExternalUsers(
    @Query('platform') platform?: string,
    @Query('period') period?: string,
  ) {
    const now = new Date();
    let dateFrom: Date | undefined;
    if (period === 'mensal')     dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    if (period === 'trimestral') dateFrom = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    if (period === 'semestral')  dateFrom = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    if (period === 'anual')      dateFrom = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

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

    const sellerUserIds = items.filter((u) => u.userId && u.platform.toUpperCase() !== 'AREAFLIX').map((u) => u.userId!);
    const areaflixEmails = items.filter((u) => u.platform.toUpperCase() === 'AREAFLIX' && u.user?.email).map((u) => u.user!.email);

    const [activeTxUserIds, activeAreaflixEmails] = await Promise.all([
      sellerUserIds.length > 0
        ? this.prisma.transaction.findMany({
            where: { userId: { in: sellerUserIds }, status: TransactionStatus.COMPLETED, createdAt: { gte: startOfMonth } },
            select: { userId: true }, distinct: ['userId'],
          }).then((rows) => new Set(rows.map((r) => r.userId)))
        : Promise.resolve(new Set<string>()),
      areaflixEmails.length > 0
        ? this.prisma.subscriptionLink.findMany({
            where: { webhookUrl: { contains: 'areaflix', mode: 'insensitive' } }, select: { id: true },
          }).then((links) => {
            const ids = links.map((l) => l.id);
            if (ids.length === 0) return new Set<string>();
            return this.prisma.subscriptionLinkOrder.findMany({
              where: { subscriptionLinkId: { in: ids }, customerEmail: { in: areaflixEmails }, status: { in: ['paid', 'active', 'approved'] } },
              select: { customerEmail: true }, distinct: ['customerEmail'],
            }).then((rows) => new Set(rows.map((r) => r.customerEmail)));
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
        status: isAtivo === null ? 'Não determinado' : isAtivo ? 'Ativo' : 'Inativo',
        email: u.user?.email ?? '',
        cadastro: u.createdAt.toISOString().split('T')[0],
      };
    });
  }

  @Get('usuarios')
  @ApiOperation({ summary: 'Lista usuários externos agrupados por CPF com todas as plataformas' })
  @ApiQuery({ name: 'platform', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, example: 20 })
  @ApiQuery({ name: 'deleted', required: false, description: 'true = contas inativas' })
  @ApiQuery({ name: 'purged', required: false, description: 'true = contas excluídas permanentemente' })
  @ApiQuery({ name: 'search', required: false, description: 'Buscar por nome, CPF ou e-mail Simintpay' })
  async listExternalUsers(
    @Query('platform') platform?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('deleted') deleted?: string,
    @Query('purged') purged?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);
    // 3 abas: ativas | inativas (deleted, não purgadas) | excluídas permanentemente (purged).
    const showPurged = purged === 'true';
    const showDeleted = deleted === 'true' && !showPurged;
    const searchTerm = search?.trim() ?? '';
    const cpfDigits = searchTerm.replace(/\D/g, '');
    const platformLower = platform?.trim().toLowerCase();

    // ── 1. ExternalPlatformUser identities (CPF-tag-identified sellers) ──────
    const extSearchFilter = searchTerm
      ? {
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' as const } },
            // Documento: casa CPF **e** CNPJ — contas PJ só têm cnpj preenchido,
            // e olhar só cpf as tornava invisíveis na busca.
            ...(cpfDigits.length > 0
              ? [{ cpf: { contains: cpfDigits } }, { cnpj: { contains: cpfDigits } }]
              : []),
            { user: { email: { contains: searchTerm, mode: 'insensitive' as const } } },
          ],
        }
      : {};

    const extMatchWhere = {
      ...(platformLower ? { platform: { equals: platformLower, mode: 'insensitive' as const } } : {}),
      // Purgadas: aba própria. Inativas: isDeleted mas NÃO purgadas. Ativas: nenhum dos dois.
      ...(showPurged
        ? { isPurged: true }
        : { isDeleted: showDeleted, isPurged: false }),
      ...extSearchFilter,
    };

    const extAllRowsRaw = await this.prisma.externalPlatformUser.findMany({
      where: extMatchWhere,
      select: { cpf: true, cnpj: true, createdAt: true, userId: true },
      orderBy: { createdAt: 'desc' },
    });

    // userIds already represented in ExternalPlatformUser (skip them in module query)
    const linkedUserIds = new Set(extAllRowsRaw.filter((r) => r.userId).map((r) => r.userId!));

    // Deduplicate by document (cpf ?? cnpj) — keep latest createdAt row per owner
    const extDocSeen = new Set<string>();
    const extAllRows = extAllRowsRaw.filter((r) => {
      const doc = r.cpf ?? r.cnpj ?? '';
      if (!doc || extDocSeen.has(doc)) return false;
      extDocSeen.add(doc);
      return true;
    });

    // ── 2. Module users (tenantModule-based platforms: renovada, bosque, etc.) ─
    // Included when NOT on the "deleted" tab, since User records have no isDeleted concept.
    type ModuleUser = {
      id: string; name: string; cpf: string | null; cnpj: string | null; email: string;
      isActive: boolean;
      createdAt: Date; updatedAt: Date;
      wallet: { balance: any; lockedBalance: any } | null;
      tenantModule: { slug: string } | null;
    };

    // Known platform master accounts identified by env var or fallback UUID.
    // These users may not have tenantModuleId set (sync never assigns it) so the
    // tenantModule relation query alone won't find them.
    const KNOWN_PLATFORM_IDS: Record<string, string> = {
      renovada: (process.env.RENOVADA_USER_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a').trim(),
      bosque:   (process.env.BOSQUE_USER_ID   || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c').trim(),
      revalida: (process.env.REVALIDA_USER_ID  || '27598c29-0ace-4b5d-ad49-f5d399910854').trim(),
      ebook:    (process.env.EBOOK_ID          || '').trim(),
      atlas:    (process.env.ATLAS_USER_ID     || '').trim(),
      pagatg:   (process.env.PAGATG_USER_ID    || '').trim(),
    };

    // Map knownId → platformSlug so we can label entries found via this path.
    const knownIdToPlatform = new Map<string, string>(
      Object.entries(KNOWN_PLATFORM_IDS)
        .filter(([, id]) => id)
        .map(([slug, id]) => [id, slug]),
    );

    // Contas de módulo/plataforma (Renovada, Bosque…) só na aba de ativas —
    // elas não têm inativação por plataforma nem exclusão permanente.
    let moduleUsers: ModuleUser[] = [];
    if (!showDeleted && !showPurged) {
      const moduleSearchFilter = searchTerm
        ? {
            OR: [
              { name: { contains: searchTerm, mode: 'insensitive' as const } },
              // Documento: casa CPF **e** CNPJ (contas PJ só têm cnpj preenchido).
              ...(cpfDigits.length > 0
                ? [{ cpf: { contains: cpfDigits } }, { cnpj: { contains: cpfDigits } }]
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
          // tenantModule-linked users OR known platform accounts (without tenantModuleId)
          {
            OR: [
              {
                tenantModule: platformLower
                  ? { slug: { equals: platformLower, mode: 'insensitive' } }
                  : { isNot: null },
              },
              ...(knownIds.length > 0 ? [{ id: { in: knownIds } }] : []),
            ],
          },
          ...(linkedUserIds.size > 0 ? [{ id: { notIn: [...linkedUserIds] } }] : []),
          ...(moduleSearchFilter ? [moduleSearchFilter] : []),
        ],
      };

      moduleUsers = (await this.prisma.user.findMany({
        where: moduleWhere,
        select: {
          id: true, name: true, cpf: true, cnpj: true, email: true,
          isActive: true,
          createdAt: true, updatedAt: true,
          wallet: { select: { balance: true, lockedBalance: true } },
          tenantModule: { select: { slug: true } },
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
    // Cliente direto usa User.isActive (ativas/inativas). Nunca é "purgado" — a exclusão
    // permanente é só de conta de plataforma externa; por isso fica fora da aba de purgadas.
    const clientUserIds = new Set<string>();
    if (!showPurged && (!platformLower || platformLower === 'simintpay')) {
      const clientSearchFilter = searchTerm
        ? {
            OR: [
              { name: { contains: searchTerm, mode: 'insensitive' as const } },
              // Documento: casa CPF **e** CNPJ (contas PJ só têm cnpj preenchido).
              ...(cpfDigits.length > 0
                ? [{ cpf: { contains: cpfDigits } }, { cnpj: { contains: cpfDigits } }]
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
          { tenantModuleId: null },
          // Aba "excluídas" mostra os inativos; a aba normal, os ativos.
          { isActive: !showDeleted },
          ...(excludeIds.length > 0 ? [{ id: { notIn: excludeIds } }] : []),
          ...(clientSearchFilter ? [clientSearchFilter] : []),
        ],
      };

      const clientUsers = (await this.prisma.user.findMany({
        where: clientWhere,
        select: {
          id: true, name: true, cpf: true, cnpj: true, email: true,
          isActive: true,
          createdAt: true, updatedAt: true,
          wallet: { select: { balance: true, lockedBalance: true } },
          tenantModule: { select: { slug: true } },
        },
        orderBy: { createdAt: 'desc' },
      })) as ModuleUser[];

      for (const u of clientUsers) clientUserIds.add(u.id);
      moduleUsers = [...moduleUsers, ...clientUsers];
    }

    const moduleUserMap = new Map(moduleUsers.map((u) => [u.id, u]));

    // ── 3. Merge and sort by createdAt desc, then paginate ────────────────────
    type ExtId = { source: 'ext'; document: string; createdAt: Date };
    type ModId = { source: 'mod'; userId: string; createdAt: Date };
    type Identity = ExtId | ModId;

    const allIdentities: Identity[] = [
      ...extAllRows
        .map((e) => ({ source: 'ext' as const, document: e.cpf ?? e.cnpj ?? '', createdAt: e.createdAt }))
        .filter((e) => e.document !== ''),
      ...moduleUsers.map((u) => ({ source: 'mod' as const, userId: u.id, createdAt: u.createdAt })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const combinedTotal = allIdentities.length;
    const pagedIdentities = allIdentities.slice((pageNum - 1) * size, pageNum * size);

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

    const allExtRecords = pagedExtDocs.length > 0
      ? await this.prisma.externalPlatformUser.findMany({
          where: {
            OR: [
              ...(pagedExtCpfs.length > 0 ? [{ cpf: { in: pagedExtCpfs } }] : []),
              ...(pagedExtCnpjs.length > 0 ? [{ cnpj: { in: pagedExtCnpjs } }] : []),
            ],
            ...(showPurged
              ? { isPurged: true }
              : { isDeleted: showDeleted, isPurged: false }),
          },
          include: {
            wallet: true,
            user: { select: { id: true, name: true, email: true } },
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
              where: { webhookUrl: { contains: 'areaflix', mode: 'insensitive' } },
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

    // ── 6. Build response in paged order ─────────────────────────────────────
    const data = pagedIdentities
      .map((identity) => {
        if (identity.source === 'ext') {
          const records = byDoc.get(identity.document) ?? [];
          if (records.length === 0) return null;
          const primary = records.find((r) => !!r.userId) ?? records[records.length - 1];
          const simpayUser = primary?.user ?? null;

          const totalBalance = records.reduce((s, r) => s + Number(r.wallet?.balance ?? 0), 0);
          const totalLocked = records.reduce((s, r) => s + Number(r.wallet?.lockedBalance ?? 0), 0);

          let isAtivo: boolean | null = null;
          for (const r of records) {
            if (r.platform.toUpperCase() === 'AREAFLIX') {
              if (r.user?.email) {
                const active = activeAreaflixEmails.has(r.user.email);
                if (active) { isAtivo = true; break; }
                if (isAtivo === null) isAtivo = false;
              }
            } else if (r.userId) {
              const active = activeTxUserIds.has(r.userId);
              if (active) { isAtivo = true; break; }
              if (isAtivo === null) isAtivo = false;
            }
          }

          return {
            id: primary.id,
            cpf: primary.cpf ?? (identity.document ?? ''),
            cnpj: primary.cnpj ?? '',
            name: simpayUser?.name?.trim() || primary.name,
            platformEntries: records.map((r) => ({
              id: r.id,
              platform: r.platform,
              name: r.name,
              email: r.user?.email ?? null,
            })),
            balance: totalBalance,
            lockedBalance: totalLocked,
            vinculado: records.some((r) => !!r.userId),
            isAtivo,
            isDeleted: records.every((r) => r.isDeleted),
            deletedAt: primary.deletedAt,
            simpayUser: simpayUser
              ? { id: simpayUser.id, name: simpayUser.name, email: simpayUser.email }
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
          // Module user (tenantModule-based)
          const u = moduleUserMap.get(identity.userId);
          if (!u) return null;
          const moduleSlug = u.tenantModule?.slug?.toLowerCase()
            ?? knownIdToPlatform.get(u.id)
            ?? (clientUserIds.has(u.id) ? 'simintpay' : (platformLower ?? 'unknown'));
          return {
            id: u.id,
            cpf: u.cpf ?? '',
            cnpj: u.cnpj ?? '',
            name: u.name,
            platformEntries: [{ id: u.id, platform: moduleSlug, name: u.name, email: u.email }],
            balance: Number(u.wallet?.balance ?? 0),
            lockedBalance: Number(u.wallet?.lockedBalance ?? 0),
            vinculado: true,
            isAtivo: activeTxUserIds.has(u.id) ? true : (null as boolean | null),
            // Cliente direto não tem isDeleted próprio — quem marca é o User.isActive.
            isDeleted: !u.isActive,
            deletedAt: null,
            simpayUser: { id: u.id, name: u.name, email: u.email },
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
          };
        }
      })
      .filter(Boolean);

    return { data, total: combinedTotal, page: pageNum, pageSize: size };
  }

  @Patch('usuarios/:id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Edita dados de um usuário externo e propaga para a plataforma de origem' })
  async updateExternalUser(
    @Param('id') id: string,
    @Body() body: { name?: string; cpf?: string; email?: string },
    @CurrentUser() authUser?: JwtPayload,
  ) {
    if (authUser?.sub) {
      const requester = await this.prisma.user.findUnique({
        where: { id: authUser.sub },
        include: { tenantModule: true },
      });
      if (!requester || !isMasterAdminUser(requester)) {
        throw new ForbiddenException('Somente admin master pode editar leads');
      }
    }

    const externalUser = await this.prisma.externalPlatformUser.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!externalUser) throw new NotFoundException('Usuário não encontrado');

    const oldCpf = externalUser.cpf;
    const oldEmail = externalUser.user?.email;

    // Atualiza ExternalPlatformUser na api-machine
    const extData: Record<string, any> = {};
    if (body.name?.trim()) extData.name = body.name.trim();
    if (body.cpf) extData.cpf = body.cpf.replace(/\D/g, '');
    if (Object.keys(extData).length > 0) {
      await this.prisma.externalPlatformUser.update({ where: { id }, data: extData });
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

  @Delete('usuarios/:id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inativa uma conta — nesta plataforma ou em todas do mesmo CPF/CNPJ (reversível; não toca no saldo)' })
  @ApiQuery({ name: 'escopo', required: false, description: "'plataforma' (padrão) ou 'todas'", example: 'plataforma' })
  async deleteExternalUser(
    @Param('id') id: string,
    @Query('escopo') escopo = 'plataforma',
    @CurrentUser() authUser?: JwtPayload,
  ) {
    if (authUser?.sub) {
      const requester = await this.prisma.user.findUnique({
        where: { id: authUser.sub },
        include: { tenantModule: true },
      });
      if (!requester || !isMasterAdminUser(requester)) {
        throw new ForbiddenException('Somente admin master pode excluir contas');
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
      return { success: true, escopo: 'conta', inativadas: [], loginDesativado: true };
    }

    const alvos = await this.resolveEscopoEntries(externalUser, escopo, false);
    if (alvos.length === 0) throw new BadRequestException('Conta já está inativa neste escopo');

    await this.prisma.externalPlatformUser.updateMany({
      where: { id: { in: alvos.map((a) => a.id) } },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    // O login (User.isActive) só cai quando NENHUMA plataforma do usuário restar ativa.
    // Antes, inativar UMA plataforma derrubava o acesso a todas.
    const loginDesativado = await this.syncLoginAtivo(externalUser.userId);

    await Promise.all(alvos.map((a) => this.setPlatformUserState(a, 'deactivate')));

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
  @ApiOperation({ summary: 'Reativa uma conta inativa — nesta plataforma ou em todas do mesmo CPF/CNPJ' })
  @ApiQuery({ name: 'escopo', required: false, description: "'plataforma' (padrão) ou 'todas'", example: 'plataforma' })
  async reactivateExternalUser(
    @Param('id') id: string,
    @Query('escopo') escopo = 'plataforma',
    @CurrentUser() authUser?: JwtPayload,
  ) {
    if (authUser?.sub) {
      const requester = await this.prisma.user.findUnique({
        where: { id: authUser.sub },
        include: { tenantModule: true },
      });
      if (!requester || !isMasterAdminUser(requester)) {
        throw new ForbiddenException('Somente admin master pode reativar contas');
      }
    }

    const externalUser = await this.prisma.externalPlatformUser.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } } },
    });

    // Cliente direto (avulso): sem entrada de plataforma — reativa o acesso da conta.
    if (!externalUser) {
      await this.setContaDiretaAtiva(id, true);
      return { success: true, escopo: 'conta', reativadas: [], loginAtivo: true };
    }

    const alvos = await this.resolveEscopoEntries(externalUser, escopo, true);
    if (alvos.length === 0) throw new BadRequestException('Conta já está ativa neste escopo');

    await this.prisma.externalPlatformUser.updateMany({
      where: { id: { in: alvos.map((a) => a.id) } },
      data: { isDeleted: false, deletedAt: null },
    });

    // Voltou a ter plataforma ativa → o login volta. O saldo nunca foi tocado.
    const loginDesativado = await this.syncLoginAtivo(externalUser.userId);

    await Promise.all(alvos.map((a) => this.setPlatformUserState(a, 'activate')));

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
    summary: 'Exclui permanentemente (irreversível) — nesta plataforma ou em todas. O saldo é absorvido pelo master.',
  })
  @ApiQuery({ name: 'escopo', required: false, description: "'plataforma' (padrão) ou 'todas'", example: 'plataforma' })
  async purgeExternalUser(
    @Param('id') id: string,
    @Query('escopo') escopo = 'plataforma',
    @CurrentUser() authUser?: JwtPayload,
  ) {
    let requesterId: string | undefined;
    if (authUser?.sub) {
      const requester = await this.prisma.user.findUnique({
        where: { id: authUser.sub },
        include: { tenantModule: true },
      });
      if (!requester || !isMasterAdminUser(requester)) {
        throw new ForbiddenException('Somente admin master pode excluir contas permanentemente');
      }
      requesterId = requester.id;
    }

    const externalUser = await this.prisma.externalPlatformUser.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } }, wallet: true },
    });
    if (!externalUser) {
      throw new BadRequestException('Exclusão permanente só se aplica a contas de plataforma externa');
    }

    // Alvo: as entradas do escopo que já estão inativas e ainda não foram purgadas.
    const todas = String(escopo ?? '').toLowerCase() === 'todas';
    const docOr: Prisma.ExternalPlatformUserWhereInput[] = [];
    if (todas && externalUser.cpf) docOr.push({ cpf: externalUser.cpf });
    if (todas && externalUser.cnpj) docOr.push({ cnpj: externalUser.cnpj });
    const alvos = todas && docOr.length > 0
      ? await this.prisma.externalPlatformUser.findMany({
          where: { OR: docOr, isPurged: false },
          include: { user: { select: { id: true, email: true } }, wallet: true },
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
                amount: saldo,
                balanceBefore: saldo,
                balanceAfter: 0,
                lockedBefore: Number(alvo.wallet.lockedBalance ?? 0),
                lockedAfter: 0,
                source: 'MASTER_ADMIN_CONTROL',
                description: `Saldo absorvido pelo master ao excluir permanentemente a conta na plataforma ${alvo.platform}`,
                metadata: { platform: alvo.platform, externalUserId: alvo.id, purgedBy: requesterId ?? null },
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
    await Promise.all(alvos.map((a) => this.setPlatformUserState(a, 'deactivate')));

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
    base: { id: string; cpf: string | null; cnpj: string | null; isDeleted: boolean },
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
      throw new BadRequestException(ativa ? 'Conta já está ativa' : 'Conta já está inativa');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { isActive: ativa } });
    return user;
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
    extUser: { platform: string; cpf: string | null; user?: { email: string | null } | null },
    state: 'activate' | 'deactivate',
  ): Promise<void> {
    const internalToken = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '';
    const headers = { 'x-internal-token': internalToken, 'Content-Type': 'application/json' };
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
      calls.push(call(process.env.BACK_EBOOK_URL, '/internal/users', { cpf }));
    }
    if (platform === 'PAGATG' && cpf) {
      calls.push(call(process.env.API_PAGATG_URL, '/internal/users', { cpf }));
    }
    if (platform === 'AREAFLIX' && email) {
      calls.push(call(process.env.AREAFLIX_BACK_URL, '/internal/users', { email }));
    }
    if (platform === 'ATLAS' && email) {
      calls.push(call(process.env.ATLAS_HOSTING_URL, '/api/internal/users', { email }));
    }

    await Promise.all(calls.filter(Boolean));
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
    const baseWhere = {};
    const where = search.trim()
      ? {
        AND: [
          baseWhere,
          {
            OR: [
              { name: { contains: search.trim(), mode: 'insensitive' as const } },
              { slug: { contains: search.trim(), mode: 'insensitive' as const } },
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
          { userId: t.userId, description: t.description ?? null },
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
  @ApiQuery({ name: 'metodoPagamento', required: false, description: 'PIX | CREDIT_CARD | DEBIT_CARD' })
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
    const whereResumo = buildConsolidadoResumoWhere(dataInicio, dataFim, platforms);
    if (metodoPagamento) whereResumo.paymentMethod = metodoPagamento as Prisma.TransactionWhereInput['paymentMethod'];

    const [txRowsTodas, comunidadeRows] = await Promise.all([
      this.prisma.transaction.findMany({
        where: whereResumo,
        select: {
          id: true,
          userId: true,
          amount: true,
          netAmount: true,
          createdAt: true,
          description: true,
          installments: true,
          paymentMethod: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      // Comunidades: sem filtro de método aplicável (subscriptionLinkOrder não expõe
      // o mesmo campo paymentMethod usado aqui); omitidas do filtro quando ativo, para
      // não misturar dados não filtrados com os filtrados.
      metodoPagamento ? Promise.resolve([]) : getComunidadeOrderRows(this.prisma, dataInicio, dataFim),
    ]);

    const txRowsComComunidade = [...txRowsTodas, ...dedupeComunidadeRows(txRowsTodas, comunidadeRows)];

    const txRowsLucro = txRowsComComunidade.filter((t) =>
      transacaoEntraNoLucroSimpayConsolidado(t.amount, t.description),
    );

    const brutoTotal = Number(
      txRowsLucro.reduce((s, t) => s + Number(t.amount), 0).toFixed(2),
    );

    const { totalLucroSimpay, plataformas: plataformasLucroDetalhe } =
      buildLucroSimpayDetalhePorPlataforma(txRowsLucro, platforms);

    const totalTransacoes = txRowsLucro.length;
    // taxaSimInt = valorBruto − valorLiquido por transação (mesma fórmula do tooltip do gráfico no painel)
    // Usa netAmount quando disponível, senão bruto × LIQUIDEZ — idêntico ao acumulado diário do gráfico.
    const valorLiquidoTxBase = Number(
      txRowsLucro
        .reduce((s, tx) => {
          const tag = consolidadoTagParaTransacao(
            { userId: tx.userId, description: tx.description ?? null },
            platforms,
          );
          return s + valorLiquidoTransacaoConsolidado(tx, tag);
        }, 0)
        .toFixed(2),
    );
    const taxaSimInt = Number((brutoTotal - valorLiquidoTxBase).toFixed(2));
    const taxaDom = Number(
      plataformasLucroDetalhe
        .reduce((s, p) => s + p.subtotalDeducaoTaxaFixa + p.subtotalDeducaoTaxaCashback, 0)
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
            { userId: tx.userId, description: tx.description ?? null },
            platforms,
          );
          const pm = String((tx as { paymentMethod?: string }).paymentMethod ?? 'PIX');
          const inst = Number((tx as { installments?: number }).installments ?? 1);
          return sum + mdrDomPct(pm, inst, amount, tag);
        }, 0)
        .toFixed(4),
    );
    // Total de repasse = tudo que sobra após a retirada da taxa sim int (= valorBruto − taxaSimInt)
    const totalRepasseConsolidado = Number((brutoTotal - taxaSimInt).toFixed(2));

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

    const [feeIncAgg, profitIncAgg] = await Promise.all([
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

    // Plataformas sem repasse real: o valor de "repasse" fica com a Simintpay (não vai a lojista externo).
    const plataformasSemRepasse = plataformasLucroDetalhe.filter(
      (p) => SEM_REPASSE_TAGS.has(p.tag.toUpperCase()),
    );
    // Repasse retido dessas plataformas (~91%): bruto − parte do admin (taxa Sim Int bruta)
    const repasseRetidoSemRepasse = Number(
      plataformasSemRepasse
        .reduce((s, p) => s + (p.subtotalBruto - p.subtotalParteAdminMaster), 0)
        .toFixed(2),
    );
    // "Lucro de plataformas": repasse que fica com a Simintpay de Areaflix, Atlas e Comunidades
    const lucroPlataformasSemRepasse = repasseRetidoSemRepasse;
    // "Lucro líquido de taxas": lucro de taxa de TODAS as plataformas (taxa Sim Int − DOM)
    const lucroSimpayConRepasse = lucroSimpayNum;
    // Repasse real = total de repasse menos o valor retido pelas plataformas sem repasse
    const totalRepasseReal = Number((totalRepasseConsolidado - repasseRetidoSemRepasse).toFixed(2));

    // ── Saques: calcula direto na withdrawRequest para cobrir histórico sem BalanceLog ──
    // fee > 0: exclui registros importados pelo SyncDomWithdrawalsUseCase (fee=0, histórico DOM)
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
        user: {
          select: { tenantModule: { select: { slug: true } } },
        },
      },
    });

    const RENOVADA_USER_ID_WD = 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    const BOSQUE_USER_ID_WD = (process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c').toLowerCase();
    const EBOOK_USER_ID_WD = (process.env.EBOOK_ID || 'd4fbf80f-6f13-4bc6-8e15-ebook00000001').toLowerCase();
    const USER_ID_TAG_MAP: Record<string, string> = {
      [RENOVADA_USER_ID_WD]: 'RENOVADA',
      [BOSQUE_USER_ID_WD]: 'BOSQUE',
      [EBOOK_USER_ID_WD]: 'EBOOK',
    };

    const DOM_FEE_SAQUE = 1;
    let lucroSaqueAcum = 0;
    // saquesPorDia: lucro de saque agregado por dia (updatedAt SP) e tag da plataforma
    const saquesPorDiaMap = new Map<string, number>(); // key = `${ymd}|${tag}`
    for (const w of withdrawsAprovados) {
      const tagFromModule = w.user?.tenantModule?.slug;
      const tagFromUserId = w.userId ? USER_ID_TAG_MAP[w.userId.toLowerCase()] : undefined;
      // Multi-vendor platforms (EBOOK, PAGATG) tag by tenantModule; single-admin platforms
      // (RENOVADA, BOSQUE) tag only by userId — their subscribers also carry the module slug
      // but are not the platform's cash-out account.
      const moduleLower = (tagFromModule ?? '').toLowerCase();
      const isMultiVendorModule = moduleLower === 'ebook' || moduleLower === 'ebooksim' || moduleLower === 'pagatg';
      const platformTag = (tagFromUserId ?? (isMultiVendorModule ? tagFromModule : undefined) ?? 'GLOBAL').toUpperCase();
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
              { userId: tx.userId, description: tx.description ?? null },
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

    const estornos = await aggregateProductRefunds(
      this.prisma,
      platformIds,
      dataInicio,
      dataFim,
    );

    const chargebackDateWhere: Prisma.DateTimeFilter = {};
    if (dataInicio) chargebackDateWhere.gte = dayjs.tz(dataInicio, TZ).startOf('day').toDate();
    if (dataFim) chargebackDateWhere.lte = dayjs.tz(dataFim, TZ).endOf('day').toDate();
    const chargebackTxs = await this.prisma.transaction.findMany({
      where: {
        status: TransactionStatus.CHARGEBACK,
        ...buildConsolidadoScopeOr(platformIds),
        ...(Object.keys(chargebackDateWhere).length > 0 ? { createdAt: chargebackDateWhere } : {}),
      },
      select: { amount: true },
    });
    const chargebacks = {
      quantidade: chargebackTxs.length,
      valor: Math.round(chargebackTxs.reduce((acc, t) => acc + Number(t.amount ?? 0), 0) * 100) / 100,
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
        select: { createdAt: true, amount: true, action: true },
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
      const pm = String((tx as { paymentMethod?: string }).paymentMethod ?? '').toLowerCase();
      if (!pm.includes('credit')) continue;
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const inst = Math.min(Math.max(Number((tx as { installments?: number }).installments ?? 1) || 1, 1), 12);
      const tag = consolidadoTagParaTransacao(
        { userId: tx.userId, description: tx.description ?? null },
        platforms,
      );
      const domFee = estimateDomFeeReais({ amountReais: amount, paymentMethod: (tx as { paymentMethod?: string }).paymentMethod, installments: inst, tenantTag: tag });
      const masterKey = `MDR_CC_MASTER_${inst}X` as PlataformaTaxaKey;
      const masterRate = getPlatformTaxaEffective(tag, masterKey, (PLATFORM_TAXA_DEFAULTS as Record<string, number>)[masterKey] ?? 0);
      totalParcelamentoBruto += domFee + amount * masterRate;
      totalParcelamentoSimIntPay += amount * masterRate;
    }

    // Recorte só de boleto para os cards do relatório (quantidade, bruto, DOM, SimIntPay, lucro).
    const boletoRows = txRowsLucro.filter((tx) =>
      String((tx as { paymentMethod?: string | null }).paymentMethod ?? '').toUpperCase().includes('BOLETO'),
    );
    let boletoBruto = 0;
    let boletoDom = 0;
    let boletoSimIntPay = 0;
    for (const tx of boletoRows) {
      const amount = Number(tx.amount) || 0;
      if (amount <= 0) continue;
      const tag = consolidadoTagParaTransacao({ userId: tx.userId, description: tx.description ?? null }, platforms);
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
      valorBruto: brutoTotal,
      taxaSimInt,
      taxaDom,
      taxaDomMdr,
      boleto,
      taxaServico: taxaServicoConsolidado,
      custoCashback,
      taxaParcelamentoBruto: Math.round(totalParcelamentoBruto * 100) / 100,
      taxaParcelamentoSimIntPay: Math.round(totalParcelamentoSimIntPay * 100) / 100,
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
        const ni = plataformasLucroDetalhe.find((p) => p.tag === TAG_NAO_IDENTIFICADA);
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
          const { transacoes: _lista, ...semLista } = row;
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

  @Get('relatorios/mensal')
  @ApiOperation({ summary: 'Resultados mensais (últimos N meses ou intervalo YYYY-MM)' })
  @ApiQuery({ name: 'meses', required: false, example: '12' })
  @ApiQuery({ name: 'dataInicio', required: false, description: 'Mês inicial no formato YYYY-MM', example: '2026-01' })
  @ApiQuery({ name: 'dataFim', required: false, description: 'Mês final no formato YYYY-MM', example: '2026-04' })
  async getRelatorioMensal(
    @Query('meses') mesesParam?: string,
    @Query('dataInicio') dataInicioMes?: string,
    @Query('dataFim') dataFimMes?: string,
  ) {
    const platforms = await resolveConsolidadoPlatforms(this.prisma);
    const agora = dayjs().tz(TZ);

    let inicioJanela: dayjs.Dayjs;
    let fimJanela: dayjs.Dayjs;
    let meses: number;

    if (dataInicioMes?.match(/^\d{4}-\d{2}$/) && dataFimMes?.match(/^\d{4}-\d{2}$/)) {
      inicioJanela = dayjs.tz(`${dataInicioMes}-01`, TZ).startOf('month');
      fimJanela = dayjs.tz(`${dataFimMes}-01`, TZ).endOf('month');
      meses = fimJanela.diff(inicioJanela, 'month') + 1;
    } else {
      meses = Math.min(Math.max(Number(mesesParam) || 12, 1), 36);
      inicioJanela = agora.subtract(meses - 1, 'month').startOf('month');
      fimJanela = agora.endOf('month');
    }

    const where = buildConsolidadoResumoWhere(
      inicioJanela.format('YYYY-MM-DD'),
      fimJanela.format('YYYY-MM-DD'),
      platforms,
    );

    const [txRowsBase, comunidadeRowsMensal] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        select: {
          userId: true,
          amount: true,
          netAmount: true,
          createdAt: true,
          description: true,
          installments: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      getComunidadeOrderRows(this.prisma, inicioJanela.format('YYYY-MM-DD'), fimJanela.format('YYYY-MM-DD')),
    ]);

    const txRows = [...txRowsBase, ...dedupeComunidadeRows(txRowsBase, comunidadeRowsMensal)];

    type MesRow = {
      mes: string;
      valorBruto: number;
      taxaAdquirente: number;
      lucroLiquido: number;
      totalRepassado: number;
    };

    const taxaFixaUnit = getPlatformTaxaEffective('GLOBAL', 'TAXA_FIXA_TRANSACAO', 1.0);
    const taxaCashbackUnit = getPlatformTaxaEffective('GLOBAL', 'TAXA_CASHBACK', 3.0);
    const taxaDomUnit = taxaFixaUnit + taxaCashbackUnit;

    const byMonth = new Map<string, { bruto: number; lucro: number; liquido: number; count: number }>();

    for (const tx of txRows) {
      if (!transacaoEntraNoLucroSimpayConsolidado(tx.amount, tx.description)) continue;
      const mes = dayjs(tx.createdAt).tz(TZ).format('YYYY-MM');
      const bruto = Number(tx.amount);
      const lucro = lucroSimpayUmaTransacaoConsolidado(tx, platforms);
      const tag = consolidadoTagParaTransacao(
        { userId: tx.userId, description: tx.description ?? null },
        platforms,
      );
      // Plataformas sem repasse real não contribuem para totalRepassado
      const liquido = SEM_REPASSE_TAGS.has(tag.toUpperCase())
        ? 0
        : valorLiquidoTransacaoConsolidado(tx, tag);
      const prev = byMonth.get(mes) ?? { bruto: 0, lucro: 0, liquido: 0, count: 0 };
      byMonth.set(mes, {
        bruto: prev.bruto + bruto,
        lucro: prev.lucro + lucro,
        liquido: prev.liquido + liquido,
        count: prev.count + 1,
      });
    }

    // Mais recente primeiro (decrescente)
    const resultado: MesRow[] = [];
    for (let i = 0; i < meses; i++) {
      const mes = fimJanela.subtract(i, 'month').format('YYYY-MM');
      const agg = byMonth.get(mes) ?? { bruto: 0, lucro: 0, liquido: 0, count: 0 };
      resultado.push({
        mes,
        valorBruto: Number(agg.bruto.toFixed(2)),
        taxaAdquirente: Number((agg.count * taxaDomUnit).toFixed(2)),
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
    const whereResumo = buildConsolidadoResumoWhere(dataInicio, dataFim, platforms);

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
          installments: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      getComunidadeOrderRows(this.prisma, dataInicio, dataFim),
    ]);

    const txRowsAll = [...txRowsTodas, ...dedupeComunidadeRows(txRowsTodas, comunidadeRowsRepasse)];
    const txRowsLucro = txRowsAll.filter((t) =>
      transacaoEntraNoLucroSimpayConsolidado(t.amount, t.description),
    );

    const { totalLucroSimpay } = buildLucroSimpayDetalhePorPlataforma(txRowsLucro, platforms);
    const lucroSimpayNum = Number(totalLucroSimpay.toFixed(2));

    const temFiltroData = Boolean(dataInicio?.trim() || dataFim?.trim());
    let valorLiquidoPlataformas: number;
    let valorLiquidoCriterio: string;

    if (temFiltroData) {
      valorLiquidoPlataformas = Number(
        txRowsLucro
          .reduce((s, tx) => {
            const tag = consolidadoTagParaTransacao(
              { userId: tx.userId, description: tx.description ?? null },
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

  @Get('plataformas/saldos-resumo')
  @ApiOperation({
    summary: 'Saldo disponível (ao vivo) por plataforma — cards de "Saldos por Plataforma".',
  })
  async getPlataformasSaldosResumo() {
    // Cada TIPO de plataforma tem seu próprio modelo de "saldo disponível":
    // - bosque: líquido desde o último saque (bate com o painel admin-ibb)
    // - renovada/revalida/pagatg/frendz: computeUserNetBalance (ledger do dono)
    // - atlas/ebook/areaflix: soma das carteiras de vendedores externos
    // - comunidades: net das ordens pagas (valores que passaram pela comunidade)
    const AVAILABLE_SOURCE: Record<string, 'bosque' | 'owner' | 'sellers'> = {
      BOSQUE: 'bosque',
      RENOVADA: 'owner',
      REVALIDA: 'owner',
      PAGATG: 'owner',
      FRENDZ: 'owner',
      ATLAS: 'sellers',
      EBOOK: 'sellers',
      AREAFLIX: 'sellers',
    };

    const platforms = await resolveConsolidadoPlatforms(this.prisma);

    // Carteiras de vendedores externos agregadas por plataforma (fonte 'sellers').
    const epuRows = await this.prisma.externalPlatformUser.findMany({
      where: { isDeleted: false },
      select: { platform: true, wallet: { select: { balance: true, lockedBalance: true } } },
    });
    const sellersMap = new Map<string, { total: number; bloqueado: number; contas: number }>();
    for (const r of epuRows) {
      const key = (r.platform ?? '').toLowerCase();
      if (!key) continue;
      const cur = sellersMap.get(key) ?? { total: 0, bloqueado: 0, contas: 0 };
      cur.total += Number(r.wallet?.balance ?? 0);
      cur.bloqueado += Number(r.wallet?.lockedBalance ?? 0);
      cur.contas += 1;
      sellersMap.set(key, cur);
    }

    const moduleResumo = await Promise.all(
      platforms.map(async (p) => {
        const slug = p.tag.toLowerCase();
        const source = AVAILABLE_SOURCE[p.tag] ?? 'owner';
        let totalDisponivel = 0;
        let totalBloqueado = 0;
        let contas = 1;
        if (source === 'sellers') {
          const s = sellersMap.get(slug);
          totalDisponivel = s?.total ?? 0;
          totalBloqueado = s?.bloqueado ?? 0;
          contas = s?.contas ?? 0;
        } else if (source === 'bosque') {
          totalDisponivel = await computeBosqueAvailableSinceLastWithdrawal(this.prisma, [p.id]);
        } else {
          totalDisponivel = await computeUserNetBalance(this.prisma, p.id, slug);
        }
        return {
          platform: slug,
          totalDisponivel: Number(Math.max(0, totalDisponivel).toFixed(2)),
          totalBloqueado: Number(Math.max(0, totalBloqueado).toFixed(2)),
          contas,
        };
      }),
    );

    // Comunidades individuais (Marketing raiz etc.): net das ordens pagas, por comunidade.
    const comunidadeRows = await getComunidadeOrderRows(this.prisma);
    const comMap = new Map<string, { total: number; contas: number }>();
    for (const r of comunidadeRows) {
      const m = /\[TENANT:([^\]]+)\]/i.exec(r.description);
      const tag = (m?.[1] ?? '').toUpperCase();
      if (!tag || FIXED_PLATFORM_TAGS.has(tag)) continue;
      const key = tag.toLowerCase();
      const cur = comMap.get(key) ?? { total: 0, contas: 0 };
      cur.total += Number(r.netAmount ?? 0);
      cur.contas += 1;
      comMap.set(key, cur);
    }
    const comunidadeResumo = [...comMap.entries()].map(([platform, v]) => ({
      platform,
      totalDisponivel: Number(Math.max(0, v.total).toFixed(2)),
      totalBloqueado: 0,
      contas: v.contas,
    }));

    const resumo = [...moduleResumo, ...comunidadeResumo].sort(
      (a, b) => b.totalDisponivel - a.totalDisponivel,
    );
    return { resumo };
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
    const buckets: DomMethodBucket[] = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO'];
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
  @ApiOperation({ summary: 'Importar transações DOM do mês atual para o banco local' })
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
    const result = await this.reconcilePendingTransactions.execute({ sinceHours });
    return { data: result };
  }

  @Post('sync-withdrawals')
  @HttpCode(200)
  @ApiOperation({ summary: 'Importar saques da conta Dom para o banco local' })
  @ApiBody({ type: SyncWithdrawalsDto })
  async syncWithdrawalsRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() body: SyncWithdrawalsDto,
  ) {
    const userId = body?.userId ?? user?.sub ?? '';
    const result = await this.syncWithdrawalsUseCase.execute({ userId, domToken: body?.domToken });
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

  @Post('sync/backfill-comunidade')
  @HttpCode(200)
  @ApiOperation({ summary: 'Backfill: cria Transaction com [TENANT:SLUG] para ordens de assinatura de comunidade sem Transaction correspondente' })
  async backfillComunidadeTransactions() {
    const communityLinkIds = await this.prisma.communityLinkBinding.findMany({
      where: { subscriptionLinkId: { not: null } },
      select: { subscriptionLinkId: true, community: { select: { slug: true } } },
      distinct: ['subscriptionLinkId'],
    });
    const linkToSlug = new Map(
      communityLinkIds.map((b) => [b.subscriptionLinkId!, b.community.slug.toUpperCase()])
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
      const communityTag = linkToSlug.get(order.subscriptionLinkId ?? '') ?? 'UNKNOWN';
      const payId = order.domPixPaymentId?.trim() || `SL_${communityTag}_${order.id}`;
      const exists = await this.prisma.transaction.findFirst({
        where: { domPaymentId: payId },
        select: { id: true },
      });
      if (exists) { skipped++; continue; }

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

  @Post('sync/reparar-status-transacoes-dom')
  @HttpCode(200)
  @ApiOperation({ summary: 'Repara status histórico das réplicas locais usando a listagem DOM' })
  @ApiQuery({ name: 'dataInicio', required: true, example: '2026-05-01', description: 'yyyy-mm-dd' })
  @ApiQuery({ name: 'dataFim', required: true, example: '2026-06-30', description: 'yyyy-mm-dd' })
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
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.rejectWithdrawal.execute(id, body.motivo, user?.sub);
  }

  @Get('saques/:id/comprovante')
  @ApiOperation({ summary: 'Servir arquivo do comprovante via S3 (bucket privado)' })
  async serveComprovanteSaque(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({ where: { id } });
    if (!withdraw?.receiptImage) throw new NotFoundException('Comprovante não encontrado');
    try {
      const { buffer, contentType } = await this.storageService.getReceiptBufferByStoredUrl(withdraw.receiptImage);
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
  @ApiOperation({ summary: 'Adicionar ou trocar comprovante de saque (aceita arquivo ou URL)' })
  async atualizarComprovanteSaque(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('receiptImage') receiptImageUrl?: string,
  ) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({ where: { id } });
    if (!withdraw) throw new NotFoundException('Saque não encontrado');

    let finalUrl: string | null = receiptImageUrl ?? withdraw.receiptImage ?? null;
    if (file) {
      finalUrl = await this.storageService.uploadFile(file, 'comprovantes-saque');
    }

    await this.prisma.withdrawRequest.update({
      where: { id },
      data: { receiptImage: finalUrl },
    });

    return { success: true, comprovante: finalUrl };
  }

  @Patch('saques/:id/visibilidade')
  @HttpCode(200)
  @ApiOperation({ summary: 'Alternar visibilidade do comprovante para o cliente' })
  async toggleVisibilidadeSaque(
    @Param('id') id: string,
    @Body() body: { comprovanteVisivel: boolean },
  ) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({ where: { id } });
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
  @ApiOperation({ summary: 'Registrar manualmente taxa de saque DOM para uma plataforma (+R$1)' })
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
        amount: new Prisma.Decimal(domFee),
        balanceBefore: 0,
        balanceAfter: 0,
        lockedBefore: 0,
        lockedAfter: 0,
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
  @ApiOperation({ summary: 'Testar o envio do e-mail de ebook personalizado (admin)' })
  async testEbookEmail(@Body() body: TestEbookEmailDto) {
    if (!body?.to?.trim()) throw new BadRequestException('Informe "to" (e-mail de destino)');
    if (!body?.body?.trim()) throw new BadRequestException('Informe "body" (corpo do e-mail)');
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
  @ApiOperation({ summary: 'Desfazer taxa de saque DOM registrada manualmente (-R$1)' })
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
        amount: new Prisma.Decimal(-domFee),
        balanceBefore: 0,
        balanceAfter: 0,
        lockedBefore: 0,
        lockedAfter: 0,
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

  // ──────────── RENOVADA: RECALCULAR SALDO A PARTIR DE UMA DATA ────────────

  @Post('renovada/recalcular-saldo-por-data')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Recalcula o saldo da Renovada a partir de uma data e adiciona ao saldo atual',
    description:
      'Soma netAmount das transações COMPLETED (regulares + maquinetas) a partir da dataInicio informada, desconta saques aprovados/completos após essa data, e incrementa o saldo atual da wallet com esse delta.',
  })
  @ApiQuery({ name: 'dataInicio', required: true, description: 'Data de início no formato YYYY-MM-DD', example: '2026-01-01' })
  async recalcularSaldoRenovadaPorData(@Query('dataInicio') dataInicio: string) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    if (!dataInicio) {
      return { success: false, error: 'Parâmetro dataInicio obrigatório (formato YYYY-MM-DD)' };
    }

    const fromDate = new Date(`${dataInicio}T00:00:00.000Z`);
    if (isNaN(fromDate.getTime())) {
      return { success: false, error: 'dataInicio inválida. Use o formato YYYY-MM-DD' };
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId: RENOVADA_ID } });
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
      { description: { contains: TENANT_RENOVADA_TAG, mode: 'insensitive' as const } },
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

    await this.prisma.wallet.update({
      where: { userId: RENOVADA_ID },
      data: { balance: new Prisma.Decimal(newBalance), version: { increment: 1 } },
    });

    await this.prisma.balanceLog.create({
      data: {
        userId: RENOVADA_ID,
        action: 'WALLET_RECALCULATE',
        amount: newBalance - oldBalance,
        balanceBefore: oldBalance,
        balanceAfter: newBalance,
        lockedBefore: Number(wallet.lockedBalance),
        lockedAfter: Number(wallet.lockedBalance),
        source: 'ADMIN_RECALC',
        description: `Recálculo desde ${dataInicio}: txs=${totalTxs.toFixed(2)}, maquinetas=${totalMaquinetas.toFixed(2)}, saldoNovo=${newBalance.toFixed(2)}`,
      },
    });

    return {
      success: true,
      dataInicio,
      detalhes: {
        transacoesRegulares: { count: txsAgg._count, netAmount: totalTxs.toFixed(2) },
        maquinetas: { count: maquinetaAgg._count, netAmount: totalMaquinetas.toFixed(2) },
        saldoAntes: oldBalance.toFixed(2),
        saldoNovo: newBalance.toFixed(2),
      },
    };
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

  // ──────────── RENOVADA: CORRIGIR SALDO WALLET (ofertas + maquinetas, sem ajustes) ────────────

  @Post('renovada/fix-wallet-balance')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Recalcula o saldo da wallet da Renovada: ofertas/dízimos (31/03-06/04) usando amount + maquinetas (05/04-06/04) usando netAmount, excluindo ajustes',
  })
  async fixRenovadaWalletBalance() {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const periodoOfertasInicio = new Date('2026-03-31T00:00:00-03:00');
    const periodoFim           = new Date('2026-04-06T23:59:59-03:00');
    const periodoMaquinetasInicio = new Date('2026-04-05T00:00:00-03:00');

    const AJUSTES_NOT = {
      OR: [
        { description: { contains: 'sincronizacao de saldo', mode: 'insensitive' as const } },
        { description: { contains: 'sincronização de saldo', mode: 'insensitive' as const } },
        { description: { contains: 'ajuste administrativo', mode: 'insensitive' as const } },
        { description: { contains: 'balance sync', mode: 'insensitive' as const } },
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
          { OR: [
            { description: { contains: 'maquineta', mode: 'insensitive' } },
            { description: { contains: 'terminal:', mode: 'insensitive' } },
          ]},
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

    const totalOfertas   = Number(ofertasAgg._sum.netAmount ?? 0);
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
    const novoBalance = Math.max(0, totalOfertas + totalMaquinetas - totalSacado);

    const walletAntes = await this.prisma.wallet.findUnique({
      where: { userId: RENOVADA_ID },
      select: { balance: true, lockedBalance: true },
    });
    const balanceAntes = Number(walletAntes?.balance || 0);
    const lockedAntes = Number(walletAntes?.lockedBalance || 0);

    await this.prisma.wallet.update({
      where: { userId: RENOVADA_ID },
      data: { balance: novoBalance, version: { increment: 1 } },
    });

    await this.prisma.balanceLog.create({
      data: {
        userId: RENOVADA_ID,
        amount: novoBalance - balanceAntes,
        balanceBefore: balanceAntes,
        balanceAfter: novoBalance,
        lockedBefore: lockedAntes,
        lockedAfter: lockedAntes,
        action: 'WALLET_RECALCULATE',
        source: 'ADMIN_FIX_WALLET',
        description: `fix-wallet-balance 31/03-06/04/2026: ofertas=${totalOfertas.toFixed(2)} (${ofertasAgg._count.id}tx), maquinetas=${totalMaquinetas.toFixed(2)} (${maquinetasAgg._count.id}tx), saques=${totalSacado.toFixed(2)}`,
      },
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
  @ApiOperation({ summary: 'Registra retroativamente os logs de taxa e lucro de saque para um withdrawId já aprovado' })
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
      return { message: 'Logs já existem para este saque, nada foi alterado.', withdrawId };
    }

    const logDate = withdraw.updatedAt; // data da aprovação

    await this.prisma.$transaction(async (tx) => {
      await tx.balanceLog.create({
        data: {
          userId: withdraw.userId,
          action: 'ADMIN_WITHDRAW_FEE_INC',
          amount: new Prisma.Decimal(1),
          balanceBefore: 0,
          balanceAfter: 0,
          lockedBefore: 0,
          lockedAfter: 0,
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
          amount: new Prisma.Decimal(2),
          balanceBefore: 0,
          balanceAfter: 0,
          lockedBefore: 0,
          lockedAfter: 0,
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
    summary: 'Recalcula o saldo da wallet do Bosque somando netAmount das transações reais (15/03–06/04/2026), excluindo sincronizações e ajustes',
  })
  async fixBosqueWalletBalance() {
    const BOSQUE_ID = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';

    const periodoInicio = new Date('2026-03-15T00:00:00-03:00');
    const periodoFim    = new Date('2026-04-06T23:59:59-03:00');

    const txsAgg = await this.prisma.transaction.aggregate({
      where: {
        userId: BOSQUE_ID,
        status: TransactionStatus.COMPLETED,
        createdAt: { gte: periodoInicio, lte: periodoFim },
        NOT: {
          OR: [
            { description: { contains: 'Sincronização Bosque', mode: 'insensitive' } },
            { description: { contains: 'Sincronizacao Bosque', mode: 'insensitive' } },
            { description: { contains: 'Ajuste Administrativo', mode: 'insensitive' } },
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
    const lockedAntes  = Number(walletAntes?.lockedBalance ?? 0);

    await this.prisma.wallet.update({
      where: { userId: BOSQUE_ID },
      data: { balance: novoBalance, version: { increment: 1 } },
    });

    await this.prisma.balanceLog.create({
      data: {
        userId: BOSQUE_ID,
        amount: novoBalance - balanceAntes,
        balanceBefore: balanceAntes,
        balanceAfter: novoBalance,
        lockedBefore: lockedAntes,
        lockedAfter: lockedAntes,
        action: 'WALLET_RECALCULATE',
        source: 'ADMIN_FIX_WALLET',
        description: `fix-wallet-balance Bosque 15/03-06/04/2026: recebido=${totalRecebido.toFixed(2)}, saques=${totalSacado.toFixed(2)}, txs=${txsAgg._count.id} (sem sincronizações/ajustes)`,
      },
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
  @ApiOperation({
    summary: 'Taxas por plataforma (.env + overrides em storage)',
  })
  async listPlatformTaxas() {
    const communities = await this.prisma.community.findMany({
      where: { isActive: true, slug: { not: 'areaflix' } },
      select: { slug: true },
    });
    const communityTags = communities.map((c) => c.slug.toUpperCase());
    return this.platformTaxas.getTaxasResponse(communityTags);
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
  @ApiOperation({ summary: 'Buscar clientes (e-mail/nome) para taxa personalizada SIM INT PAY' })
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
      tenantModuleId: null,
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
  @ApiOperation({ summary: 'Lista contas (clientes) com saldo disponível para a tela de Cobranças' })
  async listCobrancaClientes(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const term = (search ?? '').trim();
    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(Math.max(1, Number(pageSize) || 20), 100);

    const where: Prisma.UserWhereInput = {
      wallet: { isNot: null },
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
        select: { id: true, name: true, email: true, wallet: { select: { balance: true, lockedBalance: true } } },
        orderBy: { name: 'asc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      data: users.map((u) => {
        const bal = Number(u.wallet?.balance ?? 0);
        const locked = Number(u.wallet?.lockedBalance ?? 0);
        return { id: u.id, name: u.name, email: u.email, saldoDisponivel: Number((bal - locked).toFixed(2)) };
      }),
      page: pageNum,
      pageSize: size,
      total,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  @Post('cobrancas/debitar')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Debita do saldo dos clientes selecionados (modo cobrança por débito). Permite saldo negativo.' })
  async debitarCobrancas(
    @Body() body: { itens?: { userId: string; amount: number }[]; descricao?: string },
    @CurrentUser() master?: JwtPayload,
  ) {
    const masterId = master?.sub ?? '';
    const itens = (body?.itens ?? []).filter(
      (i) => i?.userId && Number.isFinite(Number(i.amount)) && Number(i.amount) > 0,
    );
    if (itens.length === 0) throw new BadRequestException('Nenhum item de cobrança válido.');

    const descricao = body?.descricao?.trim() || 'Cobrança (débito do saldo)';
    const resultados: Array<{ userId: string; ok: boolean; amount: number; saldoDepois?: number; ficouNegativo?: boolean; erro?: string }> = [];

    for (const item of itens) {
      const amount = Number(Number(item.amount).toFixed(2));
      try {
        const res = await this.prisma.$transaction(async (tx) => {
          const wallet = await tx.wallet.findUnique({ where: { userId: item.userId } });
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
              amount: new Prisma.Decimal(-amount),
              balanceBefore: wallet.balance,
              balanceAfter: updated.balance,
              lockedBefore: wallet.lockedBalance,
              lockedAfter: updated.lockedBalance,
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
        resultados.push({ userId: item.userId, ok: true, amount, saldoDepois: res.after, ficouNegativo: res.ficouNegativo });
      } catch (e) {
        resultados.push({ userId: item.userId, ok: false, amount, erro: e instanceof Error ? e.message : 'Falha' });
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
  @ApiQuery({ name: 'search', required: false, description: 'Nome ou e-mail do cliente' })
  @ApiQuery({ name: 'status', required: false, description: 'PENDING | VENCIDA | PAID | CANCELED | APPLIED' })
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
      and.push({ status: 'PENDING', OR: [{ dueDate: null }, { dueDate: { gte: new Date() } }] });
    } else if (statusUpper === 'PAID' || statusUpper === 'CANCELED' || statusUpper === 'APPLIED') {
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
    @Body() body: { itens?: { userId: string; amount: number }[]; descricao?: string; dueDate?: string },
    @CurrentUser() master?: JwtPayload,
  ) {
    const masterId = master?.sub ?? '';
    const itens = (body?.itens ?? []).filter(
      (i) => i?.userId && Number.isFinite(Number(i.amount)) && Number(i.amount) > 0,
    );
    if (itens.length === 0) throw new BadRequestException('Nenhum item de cobrança válido.');
    const descricao = body?.descricao?.trim() || 'Cobrança';
    // Vencimento é obrigatório: é ele que define quando a cobrança vira "Vencida".
    const dueDate = body?.dueDate ? new Date(body.dueDate) : null;
    if (!dueDate || Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('Informe a data de vencimento da cobrança.');
    }

    // Nome/e-mail do cliente para o título do link (descrição sai correta no checkout).
    const clientesRows = await this.prisma.user.findMany({
      where: { id: { in: itens.map((i) => i.userId) } },
      select: { id: true, name: true, email: true },
    });
    const clienteById = new Map(clientesRows.map((c) => [c.id, c]));
    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY || '';

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
          const created = await this.paymentGateway.createPaymentLink(domToken, {
            title: titulo,
            description: titulo,
            amount,
            maxInstallments: 12,
            interestRateInstallment: 0,
            aceitaCartao: true,
            aceitaPix: true,
          });
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
  private async ensureCobrancaPaymentLinks(where: Prisma.CobrancaWhereInput = {}) {
    const semLink = await this.prisma.cobranca.findMany({
      where: { ...where, mode: 'PAYABLE', status: 'PENDING', paymentRef: null },
      include: { user: { select: { id: true, name: true, email: true } } },
      take: 20,
    });
    if (semLink.length === 0) return;

    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY || '';

    for (const cob of semLink) {
      const amount = Number(cob.amount);
      const titulo = `${cob.description || 'Cobrança'} — ${cob.user?.name || cob.user?.email || cob.userId}`;

      let domPaymentLinkId: string | null = null;
      if (domToken) {
        try {
          const created = await this.paymentGateway.createPaymentLink(domToken, {
            title: titulo,
            description: titulo,
            amount,
            maxInstallments: 12,
            interestRateInstallment: 0,
            aceitaCartao: true,
            aceitaPix: true,
          });
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
  private cobrancaVencida(c: { status: string; dueDate: Date | null }): boolean {
    return c.status === 'PENDING' && !!c.dueDate && c.dueDate.getTime() < Date.now();
  }

  /**
   * Baixa automática: marca como PAID as cobranças PAYABLE pendentes cujo link de
   * pagamento (paymentRef) já tem transação COMPLETED. Chamada nas listagens —
   * o pagamento do checkout reflete sem precisar de baixa manual.
   */
  private async reconcileCobrancasPagas(where: Prisma.CobrancaWhereInput = {}) {
    const pendentes = await this.prisma.cobranca.findMany({
      where: { ...where, mode: 'PAYABLE', status: 'PENDING', paymentRef: { not: null } },
      select: { id: true, paymentRef: true },
    });
    if (pendentes.length === 0) return;

    const refs = pendentes.map((p) => p.paymentRef!) ;
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
          data: { status: 'PAID', paidAt: pagoEm.get(p.paymentRef!) ?? new Date() },
        }),
      ),
    );
  }

  @Get('cobrancas/minhas')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cobranças a pagar do cliente logado (painel do cliente)' })
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
  @ApiOperation({ summary: 'Atualiza status de uma cobrança a pagar (marcar paga / cancelar)' })
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
  @ApiOperation({ summary: 'Taxas resolvidas de uma única tag (inclui clientes CLIENT:<email>)' })
  async getPlatformTaxasByTag(@Param('tag') tag: string) {
    return this.platformTaxas.getTaxasResponse([tag]);
  }

  @Get('plataformas/minhas-taxas')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Taxas resolvidas do cliente logado (somente leitura)' })
  async getMinhasTaxas(@CurrentUser() user: JwtPayload | undefined) {
    if (!user?.sub) throw new BadRequestException('Usuário não autenticado');

    const u = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: { tenantModule: true },
    });
    if (!u) throw new BadRequestException('Usuário não encontrado');

    // Plataforma (renovada/bosque/...) usa a tag do módulo; cliente SIM INT PAY
    // (sem módulo) usa CLIENT:<email>, que herda o GLOBAL e reflete o que o master
    // personalizou para ele na página de Taxas.
    const slug = u.tenantModule?.slug?.trim();
    const tag = slug ? canonicalPlatformTaxaTag(slug.toUpperCase()) : buildClientTaxaTag(u.email);

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
    const KNOWN_TAGS = ['PAGATG', 'CONTROLE-MOTORISTA', 'CONTROLE-PATRIMONIAL', 'RENOVADA', 'REVALIDA', 'BOSQUE', 'FRENDZ', 'EBOOKSIM', 'EBOOK', 'ATLAS', 'AREAFLIX'];

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

    // Garante que CONTROLE-MOTORISTA apareça (plataforma Controle de Motorista)
    if (!map.has('CONTROLE-MOTORISTA')) {
      const firstCmTx = await this.prisma.transaction.findFirst({
        where: { description: { contains: '[TENANT:CONTROLE-MOTORISTA]', mode: 'insensitive' } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      map.set('CONTROLE-MOTORISTA', {
        tag: 'CONTROLE-MOTORISTA',
        cpf: '',
        planRows: [],
        plansCount: 0,
        firstSeen: firstCmTx?.createdAt ?? new Date(),
      });
    }

    // Garante que CONTROLE-PATRIMONIAL apareça (plataforma Controle Patrimonial)
    if (!map.has('CONTROLE-PATRIMONIAL')) {
      const firstCpTx = await this.prisma.transaction.findFirst({
        where: { description: { contains: '[TENANT:CONTROLE-PATRIMONIAL]', mode: 'insensitive' } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      map.set('CONTROLE-PATRIMONIAL', {
        tag: 'CONTROLE-PATRIMONIAL',
        cpf: '',
        planRows: [],
        plansCount: 0,
        firstSeen: firstCpTx?.createdAt ?? new Date(),
      });
    }

    // Garante que ATLAS apareça com o mesmo userId do consolidado (env ou tenant atlas)
    const atlasConsolidadoId = await resolveBySlugOrEnv(this.prisma, 'ATLAS_USER_ID', ['atlas']);
    if (!map.has('ATLAS') && atlasConsolidadoId) {
      const firstAtlasTx = await this.prisma.transaction.findFirst({
        where: {
          OR: [
            { userId: atlasConsolidadoId },
            { description: { contains: '[TENANT:ATLAS]', mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      map.set('ATLAS', {
        tag: 'ATLAS',
        cpf: '',
        planRows: [{ userId: atlasConsolidadoId, description: 'Plataforma Atlas' }],
        plansCount: 0,
        firstSeen: firstAtlasTx?.createdAt ?? new Date(),
      });
    }

    // Garante que REVALIDA apareça (conta técnica / consolidado, como Atlas)
    const revalidaConsolidadoId = REVALIDA_CONSOLIDADO_USER_ID;
    if (!map.has('REVALIDA')) {
      const firstRevalidaTx = await this.prisma.transaction.findFirst({
        where: {
          OR: [
            { userId: revalidaConsolidadoId },
            { description: { contains: '[TENANT:REVALIDA]', mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      map.set('REVALIDA', {
        tag: 'REVALIDA',
        cpf: '',
        planRows: [{ userId: revalidaConsolidadoId, description: 'Plataforma Revalida' }],
        plansCount: 0,
        firstSeen: firstRevalidaTx?.createdAt ?? new Date(),
      });
    }

    // Garante que BOSQUE apareça (conta técnica + [TENANT:BOSQUE] / "bosque" na descrição)
    const bosqueConsolidadoId = await resolveBySlugOrEnv(this.prisma, 'BOSQUE_USER_ID', ['bosque', 'ibb'], 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c');
    if (!map.has('BOSQUE')) {
      const firstBosqueTx = await this.prisma.transaction.findFirst({
        where: {
          OR: [
            { userId: bosqueConsolidadoId },
            { description: { contains: '[TENANT:BOSQUE]', mode: 'insensitive' } },
            { description: { contains: 'bosque', mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      map.set('BOSQUE', {
        tag: 'BOSQUE',
        cpf: '',
        planRows: [{ userId: bosqueConsolidadoId, description: 'Plataforma Bosque' }],
        plansCount: 0,
        firstSeen: firstBosqueTx?.createdAt ?? new Date(),
      });
    }

    // Garante que AREAFLIX apareça sempre (ordens de subscription links)
    if (!map.has('AREAFLIX')) {
      const firstAreaflixOrder = await this.prisma.subscriptionLinkOrder.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      map.set('AREAFLIX', {
        tag: 'AREAFLIX',
        cpf: '',
        planRows: [],
        plansCount: 0,
        firstSeen: firstAreaflixOrder?.createdAt ?? new Date(),
      });
    }

    const result = [];
    for (const v of map.values()) {
      const expandedUserIds = await expandPlatformTransactionUserIds(this.prisma, v.planRows);
      const isTenantTaggedPlatform = v.tag === 'EBOOK' || v.tag === 'PAGATG';

      let whereTx: any =
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
      } else if (v.tag === 'BOSQUE') {
        whereTx = {
          OR: [
            ...(expandedUserIds.length > 0 ? [{ userId: { in: expandedUserIds } }] : []),
            { description: { contains: '[TENANT:BOSQUE]', mode: 'insensitive' } },
            { description: { contains: 'bosque', mode: 'insensitive' } },
          ],
        };
      }

      let totalTx = 0;
      if (v.tag === 'AREAFLIX') {
        totalTx = await this.prisma.subscriptionLinkOrder.count();
      } else if (isTenantTaggedPlatform) {
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

  @Get('plataformas/atlas/breakdown')
  @ApiOperation({ summary: 'Breakdown de receita Atlas: domínios vs hospedagem, por produto' })
  @ApiQuery({ name: 'dataInicio', required: false })
  @ApiQuery({ name: 'dataFim', required: false })
  async getAtlasBreakdown(
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    const atlasId = await resolveBySlugOrEnv(this.prisma, 'ATLAS_USER_ID', ['atlas']);

    // Mesmo escopo da listagem: userId OU [TENANT:ATLAS] — só userId deixava vendas
    // marcadas com a tag (criadas por outras contas) fora do breakdown.
    const where: any = {
      status: 'COMPLETED',
      OR: [
        ...(atlasId ? [{ userId: atlasId }] : []),
        { description: { contains: '[TENANT:ATLAS]', mode: 'insensitive' } },
      ],
    };
    if (dataInicio) where.createdAt = { ...where.createdAt, gte: parseYmdSp(dataInicio).startOf('day').toDate() };
    if (dataFim) where.createdAt = { ...where.createdAt, lte: parseYmdSp(dataFim).endOf('day').toDate() };

    const txs = await this.prisma.transaction.findMany({
      where,
      select: { amount: true, description: true, paymentMethod: true, customerEmail: true },
    });

    const liquidez = getPlatformTaxaEffective('ATLAS', 'LIQUIDEZ', 0.91);
    const taxaFixa = getPlatformTaxaEffective('ATLAS', 'TAXA_FIXA_TRANSACAO', 1.0);
    const taxaCashback = getPlatformTaxaEffective('ATLAS', 'TAXA_CASHBACK', 3.0);

    const isDomain = (desc: string | null | undefined) => {
      if (!desc) return false;
      const lower = desc.toLowerCase().trim();
      if (lower.startsWith('atlas hosting ')) {
        const ref = lower.slice('atlas hosting '.length).trim();
        return /\.[a-z]{2,10}$/.test(ref) && !/^[0-9a-f-]{32,}$/.test(ref);
      }
      return false;
    };

    const calcGroup = (group: typeof txs) => {
      let receita = 0, lucro = 0;
      const byMethod = new Map<string, { quantidade: number; valor: number }>();
      for (const t of group) {
        const bruto = Number(t.amount ?? 0);
        receita += bruto;
        lucro += bruto * (1 - liquidez) - taxaFixa - taxaCashback;
        const method = (t.paymentMethod ?? 'PIX').toUpperCase();
        const bucket = method === 'PIX' ? 'PIX' : method === 'DEBIT_CARD' ? 'DEBIT_CARD' : method === 'BOLETO' ? 'BOLETO' : 'CREDIT_CARD';
        const prev = byMethod.get(bucket) ?? { quantidade: 0, valor: 0 };
        byMethod.set(bucket, { quantidade: prev.quantidade + 1, valor: prev.valor + bruto });
      }
      const LABELS: Record<string, string> = { PIX: 'Pix', CREDIT_CARD: 'Crédito', DEBIT_CARD: 'Débito', BOLETO: 'Boleto' };
      const distribuicaoMetodo = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO']
        .map((c) => { const e = byMethod.get(c) ?? { quantidade: 0, valor: 0 }; return { codigo: c, nome: LABELS[c], quantidade: e.quantidade, valor: Number(e.valor.toFixed(2)), percentual: group.length > 0 ? Number(((e.quantidade / group.length) * 100).toFixed(2)) : 0 }; })
        .filter((r) => r.quantidade > 0);
      return { receita: Number(receita.toFixed(2)), lucro: Number(lucro.toFixed(2)), quantidade: group.length, distribuicaoMetodo };
    };

    const domainTxs = txs.filter((t) => isDomain(t.description));
    const hostTxs = txs.filter((t) => !isDomain(t.description));

    const byProduct = new Map<string, { receita: number; lucro: number; quantidade: number }>();
    for (const t of hostTxs) {
      const nome = (t.description?.trim() || 'Produto Atlas');
      const e = byProduct.get(nome) ?? { receita: 0, lucro: 0, quantidade: 0 };
      const bruto = Number(t.amount ?? 0);
      byProduct.set(nome, { receita: Number((e.receita + bruto).toFixed(2)), lucro: Number((e.lucro + bruto * (1 - liquidez) - taxaFixa - taxaCashback).toFixed(2)), quantidade: e.quantidade + 1 });
    }

    const uniqueEmails = new Set(txs.map((t) => t.customerEmail).filter(Boolean));

    return {
      clientesUnicos: uniqueEmails.size,
      dominios: calcGroup(domainTxs),
      hospedagem: {
        ...calcGroup(hostTxs),
        porProduto: Array.from(byProduct.entries()).map(([nome, s]) => ({ nome, ...s })).sort((a, b) => b.receita - a.receita),
      },
    };
  }

  @Get('plataformas/:tag/distribuicao-metodo')
  @ApiOperation({ summary: 'Distribuição de pagamentos por método para uma plataforma (COMPLETED)' })
  @ApiQuery({ name: 'dataInicio', required: false })
  @ApiQuery({ name: 'dataFim', required: false })
  async getPlataformaDistribuicaoMetodo(
    @Param('tag') tag: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    const upperTag = normalizePlatformTag(tag);
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    // Community-specific tag: find by slug, return distribution from SubscriptionLinkOrder
    if (!FIXED_PLATFORM_TAGS.has(upperTag)) {
      const commDist = await this.prisma.community.findUnique({
        where: { slug: upperTag.toLowerCase() },
        select: { id: true },
      });
      if (commDist) {
        return this.platformReporting.getCommunityPaymentDistribution(
          upperTag,
          commDist.id,
          {
            start: dataInicio
              ? parseYmdSp(dataInicio).startOf('day').toDate()
              : undefined,
            end: dataFim
              ? parseYmdSp(dataFim).endOf('day').toDate()
              : undefined,
          },
        );
      }
    }

    let userIds: string[] = [];
    if (upperTag === 'RENOVADA') {
      userIds = [RENOVADA_ID];
    } else if (upperTag === 'REVALIDA') {
      const rid = process.env.REVALIDA_USER_ID || '27598c29-0ace-4b5d-ad49-f5d399910854';
      userIds = [rid];
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
    } else if (upperTag === 'BOSQUE') {
      const bid = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
      userIds = [bid];
    } else if (upperTag !== 'PAGATG' && upperTag !== 'CONTROLE-MOTORISTA' && upperTag !== 'CONTROLE-PATRIMONIAL' && upperTag !== 'ATLAS') {
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

    const isBosqueDescScope = upperTag === 'BOSQUE';

    const baseWhere: any = isBosqueDescScope
      ? {
          OR: [
            { userId: { in: userIds } },
            { description: { contains: '[TENANT:BOSQUE]', mode: 'insensitive' } },
            { description: { contains: 'bosque', mode: 'insensitive' } },
            { description: { contains: 'ibb', mode: 'insensitive' } },
          ],
        }
      : {
          OR: [
            ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
            { description: { contains: `[TENANT:${upperTag}]`, mode: 'insensitive' } },
          ],
        };

    baseWhere.status = 'COMPLETED';

    if (dataInicio || dataFim) {
      const tz = 'America/Sao_Paulo';
      if (dataInicio) baseWhere.createdAt = { ...baseWhere.createdAt, gte: parseYmdSp(dataInicio).startOf('day').toDate() };
      if (dataFim) baseWhere.createdAt = { ...baseWhere.createdAt, lte: parseYmdSp(dataFim).endOf('day').toDate() };
    }

    if (upperTag === 'RENOVADA') {
      baseWhere.AND = [{
        OR: [
          { description: { contains: 'dizimo', mode: 'insensitive' } },
          { description: { contains: 'dízimo', mode: 'insensitive' } },
          { description: { contains: 'primicia', mode: 'insensitive' } },
          { description: { contains: 'primícia', mode: 'insensitive' } },
          { description: { contains: 'oferta', mode: 'insensitive' } },
          { description: { contains: 'maquineta', mode: 'insensitive' } },
          { description: { contains: 'terminal', mode: 'insensitive' } },
        ],
      }];
    }

    const txs = await this.prisma.transaction.findMany({
      where: baseWhere,
      select: { paymentMethod: true, amount: true },
    });

    const mapCount = new Map<string, { count: number; total: number }>();
    for (const tx of txs) {
      const method = (tx.paymentMethod ?? 'UNKNOWN').toUpperCase();
      const bucket = method === 'PIX' ? 'PIX' : method === 'DEBIT_CARD' ? 'DEBIT_CARD' : 'CREDIT_CARD';
      const prev = mapCount.get(bucket) ?? { count: 0, total: 0 };
      mapCount.set(bucket, { count: prev.count + 1, total: prev.total + Number(tx.amount ?? 0) });
    }

    const total = txs.length;
    const LABELS: Record<string, string> = { PIX: 'Pix', CREDIT_CARD: 'Crédito', DEBIT_CARD: 'Débito' };
    const items = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD']
      .map((codigo) => {
        const entry = mapCount.get(codigo) ?? { count: 0, total: 0 };
        return {
          codigo,
          nome: LABELS[codigo],
          quantidade: entry.count,
          valor: Number(entry.total.toFixed(2)),
          percentual: total > 0 ? Number(((entry.count / total) * 100).toFixed(2)) : 0,
        };
      })
      .filter((row) => row.quantidade > 0)
      .sort((a, b) => b.quantidade - a.quantidade);

    return { total, items };
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
  @ApiQuery({ name: 'metodoPagamento', required: false, description: 'PIX | CREDIT_CARD | DEBIT_CARD' })
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
    const upperTag = normalizePlatformTag(tag);
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    // Community-specific tag: find by slug and return subscription link orders + tagged transactions
    if (!FIXED_PLATFORM_TAGS.has(upperTag)) {
      const community = await this.prisma.community.findUnique({
        where: { slug: upperTag.toLowerCase() },
        select: { id: true },
      });
      if (community) {
        const pageNum = Math.max(1, Number(page));
        const size = Math.min(Math.max(1, Number(pageSize)), 100);

        const liquidityFactor = getPlatformTaxaEffective(upperTag, 'LIQUIDEZ', 0.91);
        const fixedFee = getPlatformTaxaEffective(upperTag, 'TAXA_FIXA_TRANSACAO', 0.0);
        const adminMargin = 1 - liquidityFactor;
        const taxaServicoFixa = getPlatformTaxaEffective(upperTag, 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
        const taxaServicoCashback = getPlatformTaxaEffective(upperTag, 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
        const taxaServicoRate = getPlatformTaxaEffective(upperTag, 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);

        const dateFilter: any = {};
        if (dataInicio) {
          const d = dayjs.tz(`${dataInicio} 00:00:00`, TZ);
          if (d.isValid()) dateFilter.gte = d.toDate();
        }
        if (dataFim) {
          const d = dayjs.tz(`${dataFim} 23:59:59`, TZ);
          if (d.isValid()) dateFilter.lte = d.toDate();
        }

        // ── Subscription link orders ─────────────────────────────────────────
        const bindings = await this.prisma.communityLinkBinding.findMany({
          where: { communityId: community.id, subscriptionLinkId: { not: null } },
          select: { subscriptionLinkId: true },
          distinct: ['subscriptionLinkId'],
        });
        const linkIds = bindings.map((b) => b.subscriptionLinkId!).filter(Boolean);

        const slWhere: any = { subscriptionLinkId: { in: linkIds.length > 0 ? linkIds : ['__none__'] }, status: 'paid' };
        if (status) {
          const upper = status.toUpperCase();
          const statusMap: Record<string, string> = {
            PENDENTE: 'PENDING', COMPLETADA: 'paid', FALHADA: 'FAILED',
            REEMBOLSADA: 'REFUNDED', EXPIRADA: 'EXPIRED',
            APROVADA: 'paid', COMPLETED: 'paid',
          };
          slWhere.status = statusMap[upper] ?? upper.toLowerCase();
        }
        if (codigoTransacao) slWhere.id = codigoTransacao;
        if (compradorNome) slWhere.customerName = { contains: compradorNome, mode: 'insensitive' };
        if (compradorDocumento) slWhere.customerDocument = { contains: compradorDocumento.replace(/\D/g, '') };
        if (compradorEmail) slWhere.customerEmail = { contains: compradorEmail, mode: 'insensitive' };
        if (Object.keys(dateFilter).length > 0) slWhere.createdAt = dateFilter;

        const slOrders = await this.prisma.subscriptionLinkOrder.findMany({
          where: slWhere,
          orderBy: { createdAt: 'desc' },
          take: 500,
          include: { subscriptionLink: { select: { name: true, userId: true } } },
        });

        // ── Transaction rows tagged [TENANT:SLUG] (pix-plans, payment links) ─
        const txWhere: any = {
          description: { contains: `[TENANT:${upperTag}]`, mode: 'insensitive' },
        };
        if (Object.keys(dateFilter).length > 0) txWhere.createdAt = dateFilter;
        if (codigoTransacao) txWhere.id = codigoTransacao;
        if (compradorNome) txWhere.customerName = { contains: compradorNome, mode: 'insensitive' };
        if (compradorDocumento) txWhere.customerDocument = { contains: compradorDocumento.replace(/\D/g, '') };
        if (compradorEmail) txWhere.customerEmail = { contains: compradorEmail, mode: 'insensitive' };
        if (metodoPagamento) txWhere.paymentMethod = metodoPagamento;
        if (status) {
          const upper = status.toUpperCase();
          const txStatusMap: Record<string, string> = {
            PENDENTE: 'PENDING', COMPLETADA: 'COMPLETED', FALHADA: 'FAILED',
            REEMBOLSADA: 'REFUNDED', EXPIRADA: 'EXPIRED',
            APROVADA: 'COMPLETED', COMPLETED: 'COMPLETED',
          };
          txWhere.status = txStatusMap[upper] ?? upper;
        }

        const txRows = await this.prisma.transaction.findMany({
          where: txWhere,
          orderBy: { createdAt: 'desc' },
          take: 500,
        });

        // ── Dedup: um pedido de comunidade pago gera TANTO um SubscriptionLinkOrder
        // (id X) QUANTO uma Transaction real (descrição "... subOrder=X", criada pelo
        // webhook). Sem tratar isso, ambos entram na lista e a transação aparece
        // duplicada. Quando existe a transação real, descartamos o pedido sintético
        // (comunidade_order_X) e mantemos apenas a transação (fonte da verdade).
        const subOrderIdsComTransacao = new Set<string>();
        for (const t of txRows) {
          const m = (t.description ?? '').match(/subOrder=([^\s\]]+)/i);
          if (m) subOrderIdsComTransacao.add(m[1]);
        }

        // ── Normalize and merge ──────────────────────────────────────────────
        type CommunityRow = {
          id: string; valorBruto: number; valorLiquido: number; lucroAdmin: number;
          taxaDom: number; taxaSimIntPay: number; taxaFixa: number; taxaCashback: number;
          taxaServico: number; lucroPrejuizo: number; status: string;
          metodoPagamento: string | null; descricao: string;
          cliente: { nome: string | null; email: string | null; documento: string | null };
          taxas: { total: number; dom: number; plataforma: number };
          criadoEm: Date; atualizadoEm: Date;
        };

        const slFormatted: CommunityRow[] = slOrders
          .filter((o) => !subOrderIdsComTransacao.has(o.id))
          .map((o) => {
          const valorBruto = Number(o.amountCharged);
          const pf = Number(o.platformFeeAmount);
          const taxaServicoTotal = taxaServicoFixa + taxaServicoCashback;
          const valorLiquido = Number((valorBruto - pf - taxaServicoTotal).toFixed(2));
          const taxaSimIntPay = Number((valorBruto * adminMargin).toFixed(2));
          const pmStr = String(o.paymentMethod ?? 'pix').toLowerCase();
          const pmStrNorm = pmStr.includes('debit') ? 'debit_card' : pmStr.includes('card') || pmStr.includes('credit') ? 'credit_card' : 'pix';
          const taxaDom = Number(estimateDomFeeReais({ amountReais: valorBruto, paymentMethod: pmStrNorm, installments: 1, tenantTag: upperTag }).toFixed(2));
          const taxaServico = taxaServicoRate > 0 && o.createdAt >= getTaxaServicoEffectiveDate(upperTag) ? Number(taxaServicoRate.toFixed(2)) : 0;
          const lucroPrejuizo = Number((taxaSimIntPay - taxaDom - taxaServicoFixa - taxaServicoCashback).toFixed(2));
          return {
            id: `comunidade_order_${o.id}`,
            valorBruto,
            valorLiquido,
            lucroAdmin: Number((valorBruto * adminMargin - fixedFee).toFixed(2)),
            taxaDom,
            taxaSimIntPay,
            taxaFixa: taxaServicoFixa,
            taxaCashback: taxaServicoCashback,
            taxaServico,
            lucroPrejuizo,
            status: 'COMPLETED',
            metodoPagamento: o.paymentMethod ?? null,
            descricao: `${o.subscriptionLink.name} [TENANT:${upperTag}]`,
            cliente: { nome: o.customerName ?? null, email: o.customerEmail ?? null, documento: o.customerDocument ?? null },
            taxas: { total: pf, dom: 0, plataforma: pf },
            criadoEm: o.createdAt,
            atualizadoEm: o.updatedAt,
          };
        });

        const txFormatted: CommunityRow[] = txRows.map((t) => {
          const valorBruto = Number(t.amount);
          const isCompleted = t.status === 'COMPLETED';
          const installments = Math.min(Math.max(Number(t.installments ?? 1) || 1, 1), 12);
          const pmStr = t.paymentMethod === 'PIX' ? 'pix' : t.paymentMethod === 'DEBIT_CARD' ? 'debit_card' : t.paymentMethod === 'BOLETO' ? 'boleto' : 'credit_card';
          const taxaDom = isCompleted ? Number(estimateDomFeeReais({ amountReais: valorBruto, paymentMethod: pmStr, installments, tenantTag: upperTag }).toFixed(2)) : 0;
          let taxaSimIntPay = 0;
          if (isCompleted) {
            if (pmStr === 'boleto') {
              taxaSimIntPay = Number(calculateBoletoFees(valorBruto, upperTag).platformFeeTotal.toFixed(2));
            } else if (pmStr === 'credit_card') {
              const linkPct = getPlatformTaxaEffective(upperTag, 'TAXA_LINK_PERCENT', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT);
              const linkFixo = getPlatformTaxaEffective(upperTag, 'TAXA_LINK_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA);
              const domPct1x = getPlatformTaxaEffective(upperTag, 'MDR_CC_1X', PLATFORM_TAXA_DEFAULTS.MDR_CC_1X);
              const domFixo = getPlatformTaxaEffective(upperTag, 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
              const masterKey = `MDR_CC_MASTER_${installments}X` as PlataformaTaxaKey;
              const simBuyerPct = getPlatformTaxaEffective(upperTag, masterKey, (PLATFORM_TAXA_DEFAULTS as Record<string, number>)[masterKey] ?? 0);
              taxaSimIntPay = Number((valorBruto * (Math.max(0, linkPct - domPct1x) + simBuyerPct) + Math.max(0, linkFixo - domFixo)).toFixed(2));
            } else if (pmStr === 'debit_card') {
              const debPct = getPlatformTaxaEffective(upperTag, 'TAXA_DEBITO_PERCENT', PLATFORM_TAXA_DEFAULTS.TAXA_DEBITO_PERCENT);
              const debFixo = getPlatformTaxaEffective(upperTag, 'TAXA_DEBITO_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_DEBITO_FIXA);
              taxaSimIntPay = Number((valorBruto * debPct + debFixo).toFixed(2));
            } else {
              taxaSimIntPay = Number((valorBruto * adminMargin).toFixed(2));
            }
          }
          const taxaFixa = isCompleted ? Number(taxaServicoFixa.toFixed(2)) : 0;
          const taxaCashback = isCompleted ? Number(taxaServicoCashback.toFixed(2)) : 0;
          const taxaServico = isCompleted && taxaServicoRate > 0 && t.createdAt >= getTaxaServicoEffectiveDate(upperTag) ? Number(taxaServicoRate.toFixed(2)) : 0;
          const lucroPrejuizo = isCompleted ? Number((taxaSimIntPay - taxaDom - taxaFixa - taxaCashback).toFixed(2)) : 0;
          const netFromDb = t.netAmount != null ? Number(t.netAmount) : null;
          const cashbackDeduction = valorBruto * ((getPlatformTaxaEffective(upperTag, 'TAXA_CASHBACK', 0)) / 100);
          const fallbackNet = Number(((valorBruto * liquidityFactor) - fixedFee - cashbackDeduction).toFixed(2));
          const valorLiquidoBase = isCompleted && (netFromDb == null || netFromDb <= 0) ? fallbackNet : (netFromDb ?? fallbackNet);
          const valorLiquido = Number((valorLiquidoBase - taxaServicoFixa - taxaServicoCashback).toFixed(2));
          return {
            id: t.id,
            valorBruto,
            valorLiquido,
            lucroAdmin: isCompleted ? Number((taxaSimIntPay - (pmStr === 'boleto' ? taxaDom : fixedFee) - cashbackDeduction).toFixed(2)) : 0,
            taxaDom,
            taxaSimIntPay,
            taxaFixa,
            taxaCashback,
            taxaServico,
            lucroPrejuizo,
            status: t.status,
            metodoPagamento: t.paymentMethod ?? null,
            descricao: (t.description ?? '').replace(/\s*\[TENANT:[^\]]+\]/gi, '').trim(),
            cliente: { nome: t.customerName ?? null, email: t.customerEmail ?? null, documento: t.customerDocument ?? null },
            taxas: { total: Number(t.totalFee), dom: Number(t.domFee), plataforma: Number(t.platformFee) },
            criadoEm: t.createdAt,
            atualizadoEm: t.updatedAt,
          };
        });

        const combined = [...slFormatted, ...txFormatted]
          .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
        const total = combined.length;
        const data = combined.slice((pageNum - 1) * size, pageNum * size);

        return { data, page: pageNum, pageSize: size, total };
      }
    }

    let userIds: string[] = [];

    if (upperTag === 'RENOVADA') {
      userIds = [RENOVADA_ID];
    } else if (upperTag === 'REVALIDA') {
      const rid = process.env.REVALIDA_USER_ID || '27598c29-0ace-4b5d-ad49-f5d399910854';
      userIds = [rid];
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
    } else if (upperTag === 'BOSQUE') {
      const bid = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
      userIds = [bid];
    } else if (upperTag !== 'PAGATG' && upperTag !== 'CONTROLE-MOTORISTA' && upperTag !== 'CONTROLE-PATRIMONIAL' && upperTag !== 'ATLAS') {
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

    const isBosqueDescScope = upperTag === 'BOSQUE';

    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);

    // Todas as plataformas: combina userId (sistema legado) + [TENANT:TAG] (payment/subscription links)
    const where: any =
      isBosqueDescScope
        ? {
          OR: [
            { userId: { in: userIds } },
            { description: { contains: '[TENANT:BOSQUE]', mode: 'insensitive' } },
            { description: { contains: 'bosque', mode: 'insensitive' } },
            { description: { contains: 'ibb', mode: 'insensitive' } },
          ],
        }
        : {
          OR: [
            ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
            { description: { contains: `[TENANT:${upperTag}]`, mode: 'insensitive' } },
          ],
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
    if (metodoPagamento) where.paymentMethod = metodoPagamento;

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

    const liquidityFactor = getPlatformTaxaEffective(upperTag, 'LIQUIDEZ', 0.91);
    const fixedFee = getPlatformTaxaEffective(upperTag, 'TAXA_FIXA_TRANSACAO', 0.0);
    const cashbackFee = getPlatformTaxaEffective(upperTag, 'TAXA_CASHBACK', 0.0);

    const adminMargin = 1 - liquidityFactor;

    // DOM fee deductions (R$1+R$3): nenhuma plataforma é isenta, alinhado a
    // /relatorios/plataforma-consolidado. BOSQUE era isenta aqui, o que zerava as colunas
    // Cashback/Taxa Transação - DOM e inflava o Lucro/Prejuízo em R$4/tx — agora segue a RENOVADA.
    const TAXA_DOM_FEE_EXEMPT = new Set<string>([]);
    // TAXA_SERVICO (R$4 Sim Int Pay): RENOVADA e BOSQUE cobram a partir de 2026-05-29 (trava por getTaxaServicoEffectiveDate).
    const TAXA_SERVICO_RATE_EXEMPT = new Set<string>([]);
    const taxaServicoFixa = TAXA_DOM_FEE_EXEMPT.has(upperTag)
      ? 0
      : getPlatformTaxaEffective(upperTag, 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
    const taxaServicoCashback = TAXA_DOM_FEE_EXEMPT.has(upperTag)
      ? 0
      : getPlatformTaxaEffective(upperTag, 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
    const taxaServicoRate = TAXA_SERVICO_RATE_EXEMPT.has(upperTag)
      ? 0
      : getPlatformTaxaEffective(upperTag, 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);

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
      const pmStr = t.paymentMethod === 'PIX' ? 'pix' : t.paymentMethod === 'DEBIT_CARD' ? 'debit_card' : t.paymentMethod === 'BOLETO' ? 'boleto' : 'credit_card';
      const taxaFixa = isCompleted ? Number(taxaServicoFixa.toFixed(2)) : 0;
      const taxaCashback = isCompleted ? Number(taxaServicoCashback.toFixed(2)) : 0;
      // Snapshot imutável salvo quando a venda foi criada. Recalcular com a
      // tabela atual alterava linhas históricas e fazia tabela/cards divergirem.
      const taxaDom = isCompleted ? Number(t.domFee ?? 0) : 0;
      const taxaSimIntPay = isCompleted
        ? Number((Number(t.platformFee ?? 0) - taxaFixa - taxaCashback).toFixed(2))
        : 0;
      const taxaServico = isCompleted && taxaServicoRate > 0 && t.createdAt >= getTaxaServicoEffectiveDate(upperTag)
        ? Number(taxaServicoRate.toFixed(2))
        : 0;
      const lucroPrejuizo = isCompleted ? Number((taxaSimIntPay - taxaDom - taxaFixa - taxaCashback).toFixed(2)) : 0;

      const cashbackDeduction = valorBruto * (cashbackFee / 100);
      const fallbackNet = Number(((valorBruto * liquidityFactor) - fixedFee - cashbackDeduction).toFixed(2));
      // lucroAdmin = taxaSimIntPay (receita SimIntPay) - custo DOM - cashback repassado.
      // No boleto o custo DOM é o taxaDom (3,49+1), não o fixo do PIX.
      const custoDomLucro = pmStr === 'boleto' ? taxaDom : fixedFee;
      const lucroAdmin = isCompleted ? Number((taxaSimIntPay - custoDomLucro - cashbackDeduction).toFixed(2)) : 0;
      const netFromDb = t.netAmount != null ? Number(t.netAmount) : null;
      // Alguns registros antigos/com erro ficaram COMPLETED com netAmount=0.
      // Nesses casos, exibimos o líquido calculado pela liquidez da plataforma.
      const valorLiquidoBase = isCompleted && (netFromDb == null || netFromDb <= 0)
        ? fallbackNet
        : (netFromDb ?? fallbackNet);
      const taxaServicoTotal = taxaServicoFixa + taxaServicoCashback;
      const valorLiquido = Number((valorLiquidoBase - taxaServicoTotal).toFixed(2));

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
        taxaDom,
        taxaSimIntPay,
        taxaFixa,
        taxaCashback,
        taxaServico,
        lucroPrejuizo,
        calculos: {
          valorLiquido: (t.netAmount != null && Number(t.netAmount) > 0)
            ? `Salvo no BD: R$ ${valorLiquido.toFixed(2)}`
            : `(${valorBruto.toFixed(2)} * ${liquidityFactor.toFixed(2)}) - Fixo ${fixedFee.toFixed(2)} - Cb ${cashbackFee.toFixed(2)}% = ${valorLiquido.toFixed(2)}`,
          lucroAdmin: isCompleted
            ? pmStr === 'boleto'
              ? `Boleto SimIntPay(${taxaSimIntPay.toFixed(2)}) - DOM(${taxaDom.toFixed(2)}) - Cb(${cashbackDeduction.toFixed(2)}) = ${lucroAdmin.toFixed(2)}`
              : pmStr === 'credit_card'
              ? `CC SimIntPay(${taxaSimIntPay.toFixed(2)}) - DOM fixo(${fixedFee.toFixed(2)}) - Cb(${cashbackDeduction.toFixed(2)}) = ${lucroAdmin.toFixed(2)}`
              : pmStr === 'debit_card'
              ? `Débito SimIntPay(${taxaSimIntPay.toFixed(2)}) - Fixo(${fixedFee.toFixed(2)}) - Cb(${cashbackDeduction.toFixed(2)}) = ${lucroAdmin.toFixed(2)}`
              : `PIX(${valorBruto.toFixed(2)} × ${(1 - liquidityFactor).toFixed(4)}) - Fixo(${fixedFee.toFixed(2)}) - Cb(${cashbackDeduction.toFixed(2)}) = ${lucroAdmin.toFixed(2)}`
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
        balance: { type: 'number', example: 3238.84, description: 'Novo saldo líquido em reais' },
      },
    },
  })
  async setRenovadaWalletBalance(@Body() body: { balance: number }) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    const newBalance = Number(body.balance);
    if (!Number.isFinite(newBalance) || newBalance < 0) {
      throw new BadRequestException('balance deve ser um número positivo');
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId: RENOVADA_ID } });
    if (!wallet) throw new NotFoundException('Wallet não encontrada para Renovada');

    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: RENOVADA_ID },
        data: { balance: newBalance, version: { increment: 1 } },
      });
      await tx.balanceLog.create({
        data: {
          userId: RENOVADA_ID,
          action: 'WALLET_MANUAL_SET',
          amount: newBalance,
          balanceBefore: wallet.balance,
          balanceAfter: newBalance,
          lockedBefore: wallet.lockedBalance,
          lockedAfter: wallet.lockedBalance,
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
  @ApiOperation({ summary: 'Listar todas as ordens de subscription links (Areaflix)' })
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
    if (customerEmail) where.customerEmail = { contains: customerEmail, mode: 'insensitive' };
    if (customerName) where.customerName = { contains: customerName, mode: 'insensitive' };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.subscriptionLinkOrder.count({ where }),
      this.prisma.subscriptionLinkOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: ps,
        include: {
          subscriptionLink: { select: { name: true, amount: true, platformFee: true, frequencyType: true } },
        },
      }),
    ]);

    const areaflixPaidWhere = { subscriptionLinkId: { in: areaflixLinkIds }, status: { in: ['paid', 'active', 'approved'] } };
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

  private getSaasBaseUrl(tag: string): string | null {
    const upper = tag.toUpperCase();
    if (upper === 'CONTROLE-PATRIMONIAL') return String(process.env.CONTROLE_PATRIMONIAL_URL ?? '').replace(/\/+$/, '');
    if (upper === 'CONTROLE-MOTORISTA') return String(process.env.CONTROLE_MOTORISTA_URL ?? '').replace(/\/+$/, '');
    return null;
  }

  private calcRemainingDays(expiresAt: Date, frozenDays: number, isActive: boolean): number {
    if (!isActive) return frozenDays;
    const ms = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  @Get('plataformas/:tag/usuarios')
  @ApiOperation({ summary: 'Listar assinantes de uma plataforma SaaS com dias restantes' })
  @ApiQuery({ name: 'status', required: false, description: 'all | active | inactive' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listPlataformaUsuarios(
    @Param('tag') tag: string,
    @Query('status') status = 'all',
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const upper = tag.toUpperCase();
    const validTags = ['CONTROLE-MOTORISTA', 'CONTROLE-PATRIMONIAL'];
    if (!validTags.includes(upper)) throw new NotFoundException(`Plataforma ${tag} não suporta listagem de usuários`);

    const pageNum = Math.max(1, Number(page));
    const pageSize = Math.min(Math.max(1, Number(limit)), 100);

    const where: any = { platformTag: upper };
    if (status === 'active') where.isActive = true;
    else if (status === 'inactive') where.isActive = false;

    const [records, total] = await Promise.all([
      this.prisma.platformSubscriberAccess.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.platformSubscriberAccess.count({ where }),
    ]);

    const users = records.map((r) => ({
      id: r.id,
      email: r.customerEmail,
      name: r.customerName,
      cpf: r.customerCpf,
      phone: r.customerPhone,
      isActive: r.isActive,
      expiresAt: r.expiresAt,
      remainingDays: this.calcRemainingDays(r.expiresAt, r.frozenDays, r.isActive),
      frozenDays: r.frozenDays,
      totalDaysCredited: r.totalDaysCredited,
      lastPaymentMethod: r.lastPaymentMethod ?? null,
      createdAt: r.createdAt,
    }));

    return { users, total, page: pageNum, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  @Patch('plataformas/:tag/usuarios/:userId/toggle')
  @ApiOperation({ summary: 'Pausar/retomar acesso de assinante (freeze de dias + notifica SaaS backend)' })
  async togglePlataformaUsuario(
    @Param('tag') tag: string,
    @Param('userId') userId: string,
  ) {
    const upper = tag.toUpperCase();
    const validTags = ['CONTROLE-MOTORISTA', 'CONTROLE-PATRIMONIAL'];
    if (!validTags.includes(upper)) throw new NotFoundException(`Plataforma ${tag} não suporta toggle de usuários`);

    const record = await this.prisma.platformSubscriberAccess.findUnique({ where: { id: userId } });
    if (!record) throw new NotFoundException('Assinante não encontrado');

    const now = new Date();
    let updated: any;

    if (record.isActive) {
      // ── PAUSAR: congelar os dias restantes ───────────────────────────────────
      const remainingDays = this.calcRemainingDays(record.expiresAt, record.frozenDays, true);
      updated = await this.prisma.platformSubscriberAccess.update({
        where: { id: userId },
        data: { isActive: false, expiresAt: now, frozenDays: remainingDays },
      });
    } else {
      // ── RETOMAR: devolver os dias congelados ─────────────────────────────────
      const daysToReturn = record.frozenDays;
      if (daysToReturn <= 0) throw new Error('Não há dias guardados para retomar');
      const newExpiry = new Date(now.getTime() + daysToReturn * 24 * 60 * 60 * 1000);
      updated = await this.prisma.platformSubscriberAccess.update({
        where: { id: userId },
        data: { isActive: true, expiresAt: newExpiry, frozenDays: 0 },
      });
    }

    // Notifica o SaaS backend para sincronizar isActive do usuário
    const baseUrl = this.getSaasBaseUrl(upper);
    const token = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '';
    if (baseUrl && token) {
      fetch(`${baseUrl}/internal/users/toggle-by-email`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-internal-token': token },
        body: JSON.stringify({ email: record.customerEmail, isActive: updated.isActive }),
      }).catch(() => { /* não bloquear se o SaaS backend estiver indisponível */ });
    }

    return {
      toggled: true,
      isActive: updated.isActive,
      remainingDays: this.calcRemainingDays(updated.expiresAt, updated.frozenDays, updated.isActive),
      frozenDays: updated.frozenDays,
      expiresAt: updated.expiresAt,
    };
  }

  @Get('relatorios/atlas-consolidado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async getAtlasConsolidado(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const atlasUserId = await resolveBySlugOrEnv(this.prisma, 'ATLAS_USER_ID', ['atlas']);

    const effectiveStart = startDate ?? dayjs().tz(TZ).startOf('month').format('YYYY-MM-DD');
    // Mesmo escopo da listagem (/plataformas/atlas/transacoes): userId OU [TENANT:ATLAS].
    // Só userId deixava de fora vendas marcadas com a tag feitas por outras contas —
    // a listagem mostrava as transações e os cards ficavam zerados.
    const where: any = {
      status: 'COMPLETED',
      OR: [
        ...(atlasUserId ? [{ userId: atlasUserId }] : []),
        { description: { contains: '[TENANT:ATLAS]', mode: 'insensitive' } },
      ],
    };
    where.createdAt = { gte: parseYmdSp(effectiveStart).startOf('day').toDate() };
    if (endDate) {
      where.createdAt.lte = parseYmdSp(endDate).endOf('day').toDate();
    }

    const txs = await this.prisma.transaction.findMany({
      where,
      select: { amount: true, paymentMethod: true, installments: true, netAmount: true, createdAt: true },
    });

    const qtdTransacoes = txs.length;
    const receitaTotalAtlas = txs.reduce((s, t) => s + Number(t.amount), 0);

    // Repasse direto (igual aos demais painéis): Σ (netAmount − taxa de serviço). Atlas não tem maquineta.
    const ATLAS_SVC_RATE = TAGS_SEM_TAXA_SERVICO.has('ATLAS') ? 0 : getPlatformTaxaEffective('ATLAS', 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);
    const ATLAS_SVC_DATE = getTaxaServicoEffectiveDate('ATLAS');
    const totalRepasse = txs.reduce((s, t) => {
      const netBase = Number(t.netAmount ?? t.amount);
      const svc = ATLAS_SVC_RATE > 0 && t.createdAt != null && t.createdAt >= ATLAS_SVC_DATE ? ATLAS_SVC_RATE : 0;
      return s + (netBase - svc);
    }, 0);

    const LIQUIDEZ        = getPlatformTaxaEffective('ATLAS', 'LIQUIDEZ',           PLATFORM_TAXA_DEFAULTS.LIQUIDEZ);
    const TAXA_LINK_PCT   = getPlatformTaxaEffective('ATLAS', 'TAXA_LINK_PERCENT',   PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT);
    const TAXA_LINK_FIXA  = getPlatformTaxaEffective('ATLAS', 'TAXA_LINK_FIXA',      PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA);
    const TAXA_FIXA       = getPlatformTaxaEffective('ATLAS', 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
    const TAXA_CASHBACK   = getPlatformTaxaEffective('ATLAS', 'TAXA_CASHBACK',       PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
    const TAXA_SAQUE_FIXA = getPlatformTaxaEffective('ATLAS', 'TAXA_SAQUE_FIXA',     PLATFORM_TAXA_DEFAULTS.TAXA_SAQUE_FIXA);

    const isCardPm = (pm: string) => { const p = String(pm ?? '').toUpperCase(); return p.includes('CARD') || p.includes('CREDIT') || p.includes('DEBIT'); };

    // PIX: cobrado pelo % de liquidez + taxa fixa+cashback.
    // Cartão: vendedor paga TAXA_LINK_PERCENT+TAXA_LINK_FIXA (1x sem acréscimo ao comprador;
    //         para 2x+ o comprador absorve o custo de parcelas via surcharge configurado).
    const taxaSimInt = txs.reduce((s, t) => {
      const amount = Number(t.amount);
      return s + (isCardPm(t.paymentMethod)
        ? amount * TAXA_LINK_PCT + TAXA_LINK_FIXA
        : amount * (1 - LIQUIDEZ) + TAXA_FIXA + TAXA_CASHBACK);
    }, 0);

    const taxaMDRDom = txs.reduce((s, t) => s + estimateDomFeeReais({
      amountReais: Number(t.amount),
      paymentMethod: t.paymentMethod,
      installments: t.installments,
      tenantTag: 'ATLAS',
    }), 0);

    const taxaAdquirente = TAXA_FIXA * qtdTransacoes;
    const custoCashback  = TAXA_CASHBACK * qtdTransacoes;

    const atlasBaseUrl = String(process.env.ATLAS_HOSTING_URL ?? '').replace(/\/+$/, '');
    const internalToken = process.env.API_MACHINE_INTERNAL_TOKEN ?? '';

    let atlasData: {
      domains: { totalRevenue: number; totalNamecheapCost: number; count: number };
      vps: { totalRevenue: number; totalContaboCost: number; count: number };
      affiliates: { totalAvailable: number; totalWithdrawn: number; commissionGeneratedInPeriod: number };
      withdrawals: { pendingCount: number; approvedInPeriodCount: number; approvedInPeriodFeeSum: number };
    } | null = null;

    if (atlasBaseUrl) {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const resp = await fetch(`${atlasBaseUrl}/api/internal/report?${params.toString()}`, {
        headers: { 'x-internal-token': internalToken },
      }).catch(() => null);

      if (resp?.ok) {
        atlasData = await resp.json().catch(() => null);
      }
    }

    const custoDominio = atlasData?.domains.totalNamecheapCost ?? 0;
    const custoHospedagem = atlasData?.vps.totalContaboCost ?? 0;
    const lucroAfiliado = atlasData?.affiliates.totalWithdrawn ?? 0;
    const totalRepasseAfiliado = atlasData?.affiliates.totalAvailable ?? 0;
    const custoAfiliadoPeriodo = atlasData?.affiliates.commissionGeneratedInPeriod ?? 0;
    const saquePendente = atlasData?.withdrawals.pendingCount ?? 0;
    const qtdSaquesAprovados = atlasData?.withdrawals.approvedInPeriodCount ?? 0;
    const lucroSimpayDeSaque = qtdSaquesAprovados * TAXA_SAQUE_FIXA;

    const receitaLiquidaSimintpay = taxaSimInt - taxaAdquirente - custoCashback + lucroSimpayDeSaque - taxaMDRDom;
    const lucroLiquidoDominio = (atlasData?.domains.totalRevenue ?? 0) - custoDominio;
    const lucroLiquidoVps = (atlasData?.vps.totalRevenue ?? 0) - custoHospedagem;

    const receitaBrutaAtlas = (atlasData?.domains.totalRevenue ?? 0) + (atlasData?.vps.totalRevenue ?? 0);
    const receitaLiquidaAtlas = receitaBrutaAtlas - taxaSimInt - custoDominio - custoHospedagem - custoAfiliadoPeriodo;

    const roiSimintpay = receitaTotalAtlas > 0 ? (receitaLiquidaSimintpay / receitaTotalAtlas) * 100 : 0;
    const roiDominios = (atlasData?.domains.totalRevenue ?? 0) > 0 ? (lucroLiquidoDominio / atlasData!.domains.totalRevenue) * 100 : 0;
    const roiHospedagem = (atlasData?.vps.totalRevenue ?? 0) > 0 ? (lucroLiquidoVps / atlasData!.vps.totalRevenue) * 100 : 0;
    const roiAtlas = receitaBrutaAtlas > 0 ? (receitaLiquidaAtlas / receitaBrutaAtlas) * 100 : 0;

    const dateWhere: any = { gte: parseYmdSp(effectiveStart).startOf('day').toDate() };
    if (endDate) dateWhere.lte = parseYmdSp(endDate).endOf('day').toDate();

    const [estornoCount, chargebackCount] = await Promise.all([
      this.prisma.transaction.count({
        where: { userId: atlasUserId, status: 'REFUNDED', createdAt: dateWhere },
      }),
      this.prisma.transaction.count({
        where: { userId: atlasUserId, status: 'CHARGEBACK', createdAt: dateWhere },
      }),
    ]);

    const totalTaxasDom     = taxaMDRDom + taxaAdquirente + custoCashback;
    const taxaSimIntPctNet  = (taxaSimInt - TAXA_LINK_FIXA * qtdTransacoes) - taxaMDRDom;
    const taxaSimIntFixa    = TAXA_LINK_FIXA * qtdTransacoes;
    const totalTaxasSimInt  = taxaSimInt - taxaMDRDom;

    // Parcelamento: apenas transações de cartão de crédito (exclui débito e PIX)
    let atlasParcelamentoBruto = 0;
    let atlasParcelamentoSimIntPay = 0;
    for (const t of txs) {
      const pm = String(t.paymentMethod ?? '').toLowerCase();
      if (!pm.includes('credit')) continue;
      const amount = Number(t.amount);
      const inst = Math.min(Math.max(Number(t.installments ?? 1) || 1, 1), 12);
      const domFee = estimateDomFeeReais({ amountReais: amount, paymentMethod: t.paymentMethod, installments: inst, tenantTag: 'ATLAS' });
      const masterKey = `MDR_CC_MASTER_${inst}X` as PlataformaTaxaKey;
      const masterRate = getPlatformTaxaEffective('ATLAS', masterKey, (PLATFORM_TAXA_DEFAULTS as Record<string, number>)[masterKey] ?? 0);
      atlasParcelamentoBruto += domFee + amount * masterRate;
      atlasParcelamentoSimIntPay += amount * masterRate;
    }

    return {
      taxaDomPct: taxaMDRDom,
      taxaDomFixa: taxaAdquirente,
      taxaDomCashback: custoCashback,
      totalTaxasDom,
      taxaSimIntPctNet,
      taxaSimIntFixa,
      totalTaxasSimInt,
      taxaParcelamentoBruto: Math.round(atlasParcelamentoBruto * 100) / 100,
      taxaParcelamentoSimIntPay: Math.round(atlasParcelamentoSimIntPay * 100) / 100,
      taxaSimInt,
      taxaAdquirente,
      taxaMDRDom,
      custoCashback,
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
      receitaTotalAtlas,
      // Repasse correto (soma direta do líquido de cada tx) — o front deve usar ESTE campo.
      totalRepasse: Math.round(totalRepasse * 100) / 100,
      qtdTransacoes,
      domainCount: atlasData?.domains.count ?? 0,
      vpsCount: atlasData?.vps.count ?? 0,
      atlasApiAvailable: atlasData !== null,
    };
  }

  @Get('relatorios/plataforma-consolidado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Breakdown DOM/SimIntPay de uma plataforma (exceto ATLAS)' })
  @ApiQuery({ name: 'tag', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'metodoPagamento', required: false, description: 'PIX | CREDIT_CARD | DEBIT_CARD' })
  async getPlataformaConsolidado(
    @Query('tag') tagParam?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('metodoPagamento') metodoPagamento?: string,
  ) {
    const tag = normalizePlatformTag(tagParam ?? '');
    if (!tag || tag === 'ATLAS') {
      return { error: 'Use /admin/relatorios/atlas-consolidado for ATLAS' };
    }

    const effectiveStart = startDate ?? dayjs().tz(TZ).startOf('month').format('YYYY-MM-DD');

    // Nenhuma plataforma é isenta dos fees por transação. BOSQUE era isenta aqui, o que zerava
    // "Taxa por Transação - DOM", "Taxa Cashback - DOM" e deixava "Taxa - Sim Int Pay (%)" sem
    // descontar o MDR da DOM. Agora BOSQUE segue exatamente a mesma conta da RENOVADA:
    // DOM cobra R$1 fixo + R$3 cashback por transação e a SimInt repassa esses mesmos R$4.
    const TAXA_FIXA      = getPlatformTaxaEffective(tag, 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
    const TAXA_CASHBACK  = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK',       PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
    const LIQUIDEZ       = getPlatformTaxaEffective(tag, 'LIQUIDEZ',            PLATFORM_TAXA_DEFAULTS.LIQUIDEZ);
    // Taxa de serviço (R$4/tx) — usada no repasse direto (app: netAmount − taxaServico = amountWithoutAllFee).
    const TAXA_SERVICO_RATE = TAGS_SEM_TAXA_SERVICO.has(tag) ? 0 : getPlatformTaxaEffective(tag, 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);
    const TAXA_SERVICO_DATE = getTaxaServicoEffectiveDate(tag);

    const computeBreakdown = (txs: { amount: unknown; paymentMethod: string; installments: number; description?: string | null; netAmount?: unknown; domFee?: unknown; mdrValue?: unknown; platformFee?: unknown; createdAt?: Date | null; cardBrand?: string | null; acquirer?: string }[]) => {
      const qtd = txs.length;
      // Maquineta liquida por modelo próprio (netAmount = líquido pós-MDR × 0,91; 9% TAXA_MAQUINETA).
      // Recalcular como cartão-link infla o repasse ~9% (a maquineta aparecia quase pelo bruto cheio).
      // Solução: usar o netAmount REAL dessas transações — o mesmo que a carteira, a página de Máquinas
      // e o admin-renovada já usam. Assim o "Total de Repasse" bate com o admin.
      // Maquineta nem sempre tem a tag [ORIGEM:MAQUINETA] — a maioria é gravada só com "Terminal: XXX"
      // (sync-maquinetas, webhooks). Detecção canônica: isMaquinetaDescription (internal-tags.util).
      const isMaq = (t: { description?: string | null }) => isMaquinetaDescription(t.description);
      const normalTxs = txs.filter((t) => !isMaq(t));
      const maqTxs = txs.filter(isMaq);
      const qtdNormal = normalTxs.length;

      // ── Transações normais (app/link): fórmula por método de pagamento ──
      const taxaSimIntDaTransacao = (t: (typeof normalTxs)[number]) => {
        const amount = Number(t.amount);
        const reportedPlatformFee = Number(t.platformFee);
        if (Number.isFinite(reportedPlatformFee)) return Number(reportedPlatformFee.toFixed(2));
        // Mesma regra por linha de GET /admin/transacoes-dom. O valor bruto é
        // fornecido pela DOM; LIQUIDEZ é a fonte canônica da parcela percentual.
        return Number((amount * (1 - LIQUIDEZ) + TAXA_FIXA + TAXA_CASHBACK).toFixed(2));
      };
      // A tabela mostra cada taxa em centavos. Esta soma usa o mesmo valor.
      const taxaSimInt = normalTxs.reduce(
        (s, t) => s + taxaSimIntDaTransacao(t),
        0,
      );
      // Repasse usa a mesma taxa por transação exibida na tabela. `netAmount`
      // é um valor de liquidação legado e, nas comunidades, não inclui todos
      // os custos mostrados nos cards (MDR, fixo e cashback).
      const totalRepasseNormal = normalTxs.reduce(
        (s, t) => s + Number(t.amount) - taxaSimIntDaTransacao(t),
        0,
      );
      // Arredonda por transação, antes do acumulado. A tabela também mostra a
      // taxa de cada transação em centavos; arredondar apenas o total criava
      // divergência entre a soma visível (ex.: R$ 4,72) e o card (R$ 4,70).
      const taxaMDRDomNormal = normalTxs.reduce((s, t) => {
        // domFee é o snapshot da adquirente persistido junto da venda. Não
        // estime taxa DOM para uma venda Frendz (ou de adquirente futura).
        const fee = t.acquirer && t.acquirer !== 'DOM'
          ? Number(t.domFee ?? 0)
          : resolveDomFeeReais({
            amountReais: Number(t.amount),
            paymentMethod: t.paymentMethod,
            installments: t.installments,
            tenantTag: tag,
            mdrFromGateway: Number(t.mdrValue ?? 0),
            domFeeFromGateway: Number(t.domFee ?? 0),
          });
        return s + Number(fee.toFixed(2));
      }, 0);
      // Cashback (R$3): a DOM NÃO cobra em maquineta (o cliente não consegue registrar os dados
      // pra receber o bônus nesse fluxo) — só entra nas transações normais.
      const custoCashback  = TAXA_CASHBACK * qtdNormal;
      const taxaSimIntFixa = (TAXA_FIXA + TAXA_CASHBACK) * qtdNormal;
      const taxaSimIntPctNetNormal = (taxaSimInt - taxaSimIntFixa) - taxaMDRDomNormal;
      const totalTaxasSimIntNormal = taxaSimInt - taxaMDRDomNormal;

      // ── Maquineta (venda física / POS) ────────────────────────────────────────────────
      // Modelo: o cliente só perde a taxa Sim Int Pay; o custo DOM sai da margem da casa.
      //   repasse            = netAmount real  (= bruto − taxa Sim Int Pay nas transações novas)
      //   taxa Sim Int Pay   = bruto − netAmount  (exatamente o que o cliente pagou)
      //   custo DOM          = tabela POS (POS_MDR_*, + R$1 em débito/crédito; PIX físico não paga)
      //   lucro Sim Int Pay  = taxa Sim Int Pay − custo DOM
      const maqBruto = maqTxs.reduce((s, t) => s + Number(t.amount), 0);
      const maqNet   = maqTxs.reduce((s, t) => s + Number(t.netAmount ?? 0), 0);
      // Custo DOM da maquineta pela tabela FÍSICA, separado em % e fixo (R$1/transação),
      // para os cards de Taxas DOM. A tabela física é diferente da online (PIX 1%,
      // crédito 1x 3,49% etc.) e não cobra cashback.
      const maqDomSplit = maqTxs.reduce((acc, t) => {
        const f = estimatePhysicalDomFeeReais({
          amountReais: Number(t.amount),
          paymentMethod: t.paymentMethod,
          installments: t.installments,
          tenantTag: tag,
          // No POS a DOM manda payment_method='credit_card' também no débito;
          // a bandeira é o que distingue (VISA DEBITO, ELO DEBITO, MAESTRO…).
          cardBrand: t.cardBrand,
        });
        return { pct: acc.pct + f.pct, fixa: acc.fixa + f.fixa };
      }, { pct: 0, fixa: 0 });
      const maqDom = maqDomSplit.pct + maqDomSplit.fixa;
      const totalTaxasSimIntMaq = maqBruto - maqNet;
      const taxaSimIntPctNetMaq = totalTaxasSimIntMaq - maqDom;
      const totalRepasse = totalRepasseNormal + maqNet;

      // ── Combinado (normais + maquineta) ──
      // taxaAdquirente = R$1 por transação: nas normais é TAXA_FIXA; na maquineta vem da
      // tabela física (POS_TAXA_DOM_FIXA, cobrado só em débito/crédito — PIX físico não paga).
      const taxaAdquirente   = TAXA_FIXA * qtdNormal + maqDomSplit.fixa;
      const taxaMDRDom       = taxaMDRDomNormal + maqDomSplit.pct;
      const totalTaxasDom    = taxaMDRDom + taxaAdquirente + custoCashback;
      // Fonte explícita do card "Taxa Percentual". Antes o front tentava
      // reconstruí-la a partir de bruto e repasse, que vêm de consultas
      // diferentes nas comunidades. A coluna da tabela usa esta mesma
      // parcela (sem as taxas fixas por transação).
      const taxaSimIntPctBruta = taxaSimInt - taxaSimIntFixa + totalTaxasSimIntMaq;
      const totalTaxasSimInt = totalTaxasSimIntNormal + totalTaxasSimIntMaq;
      const taxaSimIntPctNet = taxaSimIntPctNetNormal + taxaSimIntPctNetMaq;

      // Parcelamento: cartão de crédito não-maquineta EM 2x OU MAIS (1x é à vista,
      // não é parcelamento — fica de fora desta seção mesmo tendo margem própria).
      let taxaParcelamentoBruto = 0;
      let taxaParcelamentoSimIntPay = 0;
      // Bruto e repasse das mesmas transações, para a seção "Parcelamento" fechar a conta.
      let parcBruto = 0;
      let parcRepasse = 0;
      for (const t of normalTxs) {
        const pm = String(t.paymentMethod ?? '').toLowerCase();
        if (!pm.includes('credit')) continue;
        const inst = Math.min(Math.max(Number(t.installments ?? 1) || 1, 1), 12);
        if (inst < 2) continue;
        const amount = Number(t.amount);
        parcBruto += amount;
        {
          const netBase = Number(t.netAmount ?? amount);
          const svc = TAXA_SERVICO_RATE > 0 && t.createdAt != null && t.createdAt >= TAXA_SERVICO_DATE ? TAXA_SERVICO_RATE : 0;
          parcRepasse += netBase - svc;
        }
        const domFee = estimateDomFeeReais({ amountReais: amount, paymentMethod: t.paymentMethod, installments: inst, tenantTag: tag });
        const masterKey = `MDR_CC_MASTER_${inst}X` as PlataformaTaxaKey;
        const masterRate = getPlatformTaxaEffective(tag, masterKey, (PLATFORM_TAXA_DEFAULTS as Record<string, number>)[masterKey] ?? 0);
        taxaParcelamentoBruto += domFee + amount * masterRate;
        taxaParcelamentoSimIntPay += amount * masterRate;
      }

      return {
        taxaDomPct: Math.round(taxaMDRDom * 100) / 100,
        taxaDomFixa: Math.round(taxaAdquirente * 100) / 100,
        taxaDomCashback: Math.round(custoCashback * 100) / 100,
        totalTaxasDom: Math.round(totalTaxasDom * 100) / 100,
        taxaSimIntPctBruta: Math.round(taxaSimIntPctBruta * 100) / 100,
        taxaSimIntPctNet: Math.round(taxaSimIntPctNet * 100) / 100,
        taxaSimIntFixa: Math.round(taxaSimIntFixa * 100) / 100,
        totalTaxasSimInt: Math.round(totalTaxasSimInt * 100) / 100,
        taxaParcelamentoBruto: Math.round(taxaParcelamentoBruto * 100) / 100,
        taxaParcelamentoSimIntPay: Math.round(taxaParcelamentoSimIntPay * 100) / 100,
        /** Bruto das vendas no crédito (base do parcelamento). */
        parcBruto: Math.round(parcBruto * 100) / 100,
        /** Repasse ao cliente nessas mesmas vendas. */
        parcRepasse: Math.round(parcRepasse * 100) / 100,
        qtdTransacoes: qtd,
        // Repasse correto (soma direta do líquido de cada tx) — o front deve usar ESTE campo.
        totalRepasse: Math.round(totalRepasse * 100) / 100,
        // ── Maquineta (venda física) — alimenta a seção "Maquinetas" do relatório ──
        // Identifica a versão do cálculo no payload para distinguir processos
        // ainda rodando código anterior após a atualização do backend.
        _v: 'dom-direct-v1',
        qtdMaquineta: maqTxs.length,
        /** Bruto que passou nas maquinetas. */
        maqBruto: Math.round(maqBruto * 100) / 100,
        /** Repasse ao cliente (netAmount real das transações de maquineta). */
        maqNet: Math.round(maqNet * 100) / 100,
        /** Custo DOM da venda física (tabela POS: MDR + R$1 em débito/crédito). */
        maqDom: Math.round(maqDom * 100) / 100,
        /** Taxa Sim Int Pay cobrada do cliente na maquineta (bruto − repasse). */
        maqSimInt: Math.round(totalTaxasSimIntMaq * 100) / 100,
      };
    };

    const localTransactions = await this.findLocalPlatformReportTransactions(
      tag,
      effectiveStart,
      endDate,
      metodoPagamento,
    );
    const txs: Parameters<typeof computeBreakdown>[0] = localTransactions.map((tx) => ({
      amount: tx.amount,
      paymentMethod: tx.paymentMethod,
      installments: tx.installments,
      createdAt: tx.createdAt,
      description: tx.description,
      netAmount: tx.netAmount,
      // Snapshot local imutável. A tabela de transações e os cards passam a
      // somar a mesma cópia, independente da adquirente de origem.
      domFee: tx.domFee,
      platformFee: tx.platformFee,
      cardBrand: tx.cardBrand,
      acquirer: tx.acquirer,
    }));

    // Assinaturas de comunidade anteriores ao webhook possuem somente a ordem
    // local. Incluí-las até a réplica Transaction existir; quando o webhook já
    // criou a réplica (subOrder=<id>), ela continua sendo a fonte única.
    const community = await this.prisma.community.findUnique({
      where: { slug: tag.toLowerCase() },
      select: { id: true },
    });
    if (community) {
      const bindings = await this.prisma.communityLinkBinding.findMany({
        where: { communityId: community.id, subscriptionLinkId: { not: null } },
        select: { subscriptionLinkId: true },
        distinct: ['subscriptionLinkId'],
      });
      const linkIds = bindings.flatMap((binding) => binding.subscriptionLinkId ? [binding.subscriptionLinkId] : []);
      const createdAt: Prisma.DateTimeFilter = {
        gte: parseYmdSp(effectiveStart).startOf('day').toDate(),
      };
      if (endDate) createdAt.lte = parseYmdSp(endDate).endOf('day').toDate();
      const orders = linkIds.length
        ? await this.prisma.subscriptionLinkOrder.findMany({
          where: {
            subscriptionLinkId: { in: linkIds },
            status: 'paid',
            createdAt,
            ...(metodoPagamento ? { paymentMethod: metodoPagamento as any } : {}),
          },
          select: { id: true, amountCharged: true, paymentMethod: true, createdAt: true },
        })
        : [];
      const replicatedOrderIds = new Set(
        localTransactions.flatMap((tx) => {
          const match = tx.description?.match(/subOrder=([^\s\]]+)/i);
          return match ? [match[1]] : [];
        }),
      );
      const percentual = 1 - LIQUIDEZ;
      for (const order of orders) {
        if (replicatedOrderIds.has(order.id)) continue;
        const amount = Number(order.amountCharged);
        txs.push({
          amount,
          paymentMethod: order.paymentMethod,
          installments: 1,
          createdAt: order.createdAt,
          description: `[TENANT:${tag}] subOrder=${order.id}`,
          netAmount: amount - (amount * percentual + TAXA_FIXA + TAXA_CASHBACK),
          domFee: estimateDomFeeReais({
            amountReais: amount,
            paymentMethod: order.paymentMethod,
            installments: 1,
            tenantTag: tag,
          }),
          platformFee: Number((amount * percentual + TAXA_FIXA + TAXA_CASHBACK).toFixed(2)),
          cardBrand: null,
          acquirer: 'DOM',
        });
      }
    }

    const breakdown = computeBreakdown(txs);

    return breakdown;
  }
}
