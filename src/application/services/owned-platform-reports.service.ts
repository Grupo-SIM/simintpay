import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, type PaymentMethod, type Acquirer } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { platformBalanceRules } from '../../modules/platform-core/platform-balance.adapter';
import { ownedReportSource, reportUnattributedSource } from './owned-report-source';
import { PlatformAttributedBalance } from '../../modules/platform-core/platform-attributed-balance';

type Filters = { platform?: string; startDate?: string; endDate?: string; paymentMethod?: string; page?: string; pageSize?: string; search?: string };
type Database = Prisma.TransactionClient;
type Scope = { id: string; tag: string; name: string; ownerUserId: string; isActive: boolean }[];
const platformSelect = { id: true, tag: true, name: true, ownerUserId: true, isActive: true } as const;
function validateFilters(filters: Filters) {
  for (const key of ['platform', 'startDate', 'endDate', 'paymentMethod', 'page', 'pageSize', 'search'] as const) {
    if (filters[key] !== undefined && typeof filters[key] !== 'string') throw new BadRequestException('Filtro inválido');
  }
  if (filters.platform !== undefined && !/^[A-Za-z][A-Za-z0-9_-]{1,49}$/.test(filters.platform)) throw new BadRequestException('Plataforma inválida');
}
export function reportPagination(filters: Filters, defaultSize = 20) {
  validateFilters(filters);
  const parse = (value: string | undefined, fallback: number) => {
    if (value === undefined) return fallback;
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new BadRequestException('Paginação inválida');
    return Number(value);
  };
  const page = parse(filters.page, 1), pageSize = parse(filters.pageSize, defaultSize);
  if (pageSize > 100 || !Number.isSafeInteger((page - 1) * pageSize)) throw new BadRequestException('Paginação inválida');
  return { page, pageSize, skip: (page - 1) * pageSize };
}
export function reportPeriod(filters: Filters) {
  validateFilters(filters);
  for (const value of [filters.startDate, filters.endDate]) {
    if (value !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) throw new BadRequestException('Data inválida');
  }
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) throw new BadRequestException('Intervalo inválido');
  if (filters.paymentMethod && !['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO'].includes(filters.paymentMethod)) throw new BadRequestException('Método inválido');
  return {
    start: filters.startDate ? new Date(`${filters.startDate}T00:00:00-03:00`) : undefined,
    end: filters.endDate ? new Date(new Date(`${filters.endDate}T00:00:00-03:00`).getTime() + 86400000) : undefined,
  };
}
const cents = (amount: Prisma.Decimal | number | string | null) => {
  const result = new Prisma.Decimal(amount ?? 0).mul(100).toDecimalPlaces(0).toNumber();
  if (!Number.isSafeInteger(result)) throw new BadRequestException('Valor fora do limite');
  return result;
};

@Injectable()
export class OwnedPlatformReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private snapshot<T>(read: (db: Database) => Promise<T>) {
    return this.prisma.$transaction(read, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }

  private async actor(db: Database, user: JwtPayload) {
    if (!user || user.authMode === 'integration') throw new ForbiddenException('Exige sessão de usuário');
    const actor = await db.user.findUnique({ where: { id: user.sub }, select: { id: true, role: true, isActive: true, isPurged: true } });
    if (!actor?.isActive || actor.isPurged) throw new UnauthorizedException('Conta inativa');
    return actor;
  }

  private async scope(db: Database, user: JwtPayload, tag?: string) {
    const actor = await this.actor(db, user);
    const normalized = tag?.toUpperCase().replaceAll('_', '-');
    const platforms = await db.platform.findMany({ where: {
      ...(actor.role === 'ADMIN' ? {} : { ownerUserId: actor.id }),
      ...(normalized ? { tag: normalized === 'EBOOKSIM' ? 'EBOOK' : normalized } : {}),
    }, select: platformSelect });
    if (tag && platforms.length === 0) throw new ForbiddenException('Plataforma indisponível para esta conta');
    return platforms;
  }

  private alphabetic(value: Prisma.Sql) {
    return Prisma.sql`translate(lower(${value}), 'ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn')`;
  }

  private async catalogPage(db: Database, ownerId: string | undefined, filters: Filters, defaultSize = 20) {
    const { page, pageSize, skip } = reportPagination(filters, defaultSize);
    const search = filters.search?.trim();
    if ((search?.length ?? 0) > 100) throw new BadRequestException('Pesquisa muito longa');
    const source = Prisma.sql`FROM "Platform" p JOIN "User" u ON u.id = p."ownerUserId"
      WHERE ${ownerId ? Prisma.sql`p."ownerUserId" = ${ownerId}` : Prisma.sql`true`}
      ${search ? Prisma.sql`AND strpos(${this.alphabetic(Prisma.sql`p.name || ' ' || p.tag`)}, ${this.alphabetic(Prisma.sql`${search}::text`)}) > 0` : Prisma.empty}`;
    const [data, counts] = await Promise.all([
      db.$queryRaw<(Scope[number] & { acquirer: Acquirer; ownerName: string; ownerEmail: string })[]>(Prisma.sql`
        SELECT p.id, p.tag, p.name, p."isActive", p."ownerUserId", p.acquirer, u.name AS "ownerName", u.email AS "ownerEmail" ${source}
        ORDER BY ${this.alphabetic(Prisma.sql`p.name`)} ASC, p.tag ASC LIMIT ${pageSize} OFFSET ${skip}`),
      db.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total ${source}`),
    ]);
    return { data, total: Number(counts[0].total), page, pageSize };
  }

  async catalog(user: JwtPayload, filters: Filters) {
    reportPagination(filters);
    return this.snapshot(async db => {
      const actor = await this.actor(db, user);
      const result = await this.catalogPage(db, actor.role === 'ADMIN' ? undefined : actor.id, filters);
      return { ...result, data: result.data.map(({ id, tag, name, isActive }) => ({ id, tag, name, isActive })) };
    });
  }

  private transactions(scope: Scope, filters: Filters) {
    return ownedReportSource(scope, { ...reportPeriod(filters), paymentMethod: filters.paymentMethod });
  }

  private async withdrawals(db: Database, scope: Scope, filters: Filters) {
    const { start, end } = reportPeriod(filters);
    return db.withdrawRequest.findMany({ where: {
      OR: scope.map(p => ({ userId: p.ownerUserId, platform: { in: platformBalanceRules(p.tag).withdrawalPlatforms, mode: 'insensitive' as const } })),
      ...(scope.length ? {} : { id: { in: [] } }),
      ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    }, select: { status: true, grossAmount: true } });
  }

  private async attributionGaps(db: Database, scope: Scope, filters: Filters) {
    const { start, end } = reportPeriod(filters);
    const owners = [...new Set(scope.map(p => p.ownerUserId))];
    const rows = await db.$queryRaw<{ count: bigint }[]>(reportUnattributedSource(scope, { start, end, paymentMethod: filters.paymentMethod }));
    const withdrawals = await db.withdrawRequest.count({ where: { userId: { in: owners }, platform: null,
      ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    } });
    return Number(rows[0].count) + withdrawals;
  }

  async summary(user: JwtPayload, filters: Filters) {
    reportPeriod(filters);
    return this.snapshot(async db => {
      const scope = await this.scope(db, user, filters.platform);
      const [rows, withdrawals, gaps] = await Promise.all([
        db.$queryRaw<{ count: bigint; gross: Prisma.Decimal; fees: Prisma.Decimal; net: Prisma.Decimal; refunds: Prisma.Decimal; refundCount: bigint; missing: bigint }[]>(Prisma.sql`
          SELECT count(*) FILTER (WHERE status = 'COMPLETED') AS count,
          coalesce(sum(amount) FILTER (WHERE status = 'COMPLETED'), 0) AS gross,
          coalesce(sum("totalFee") FILTER (WHERE status = 'COMPLETED'), 0) AS fees,
          coalesce(sum("netAmount") FILTER (WHERE status = 'COMPLETED'), 0) AS net,
          coalesce(sum("netAmount") FILTER (WHERE status IN ('REFUNDED', 'CHARGEBACK')), 0) AS refunds,
          count(*) FILTER (WHERE status IN ('REFUNDED', 'CHARGEBACK')) AS "refundCount",
          count(*) FILTER (WHERE "netAmount" IS NULL AND status IN ('COMPLETED', 'REFUNDED', 'CHARGEBACK')) AS missing
          FROM (${this.transactions(scope, filters)}) scoped`),
        this.withdrawals(db, scope, filters),
        this.attributionGaps(db, scope, filters),
      ]);
      const row = rows[0];
      const sum = (statuses: string[]) => withdrawals.filter(w => statuses.includes(w.status)).reduce((s, w) => s.plus(w.grossAmount), new Prisma.Decimal(0));
      return { unit: 'cents' as const, platformsCount: scope.length, summary: {
        salesCount: Number(row.count), grossCents: cents(row.gross), feesCents: cents(row.fees), netCents: cents(row.net),
        refundsCents: cents(row.refunds), refundsCount: Number(row.refundCount),
        withdrawalsCents: cents(sum(['APPROVED', 'COMPLETED'])), pendingWithdrawalsCents: cents(sum(['PENDING'])),
        missingNetSnapshots: Number(row.missing), unattributedEntries: gaps, historicalAttributionComplete: Number(row.missing) === 0 && gaps === 0,
      } };
    });
  }

  async series(user: JwtPayload, filters: Filters, group: 'monthly' | 'status' | 'method') {
    reportPeriod(filters);
    return this.snapshot(async db => {
      const scope = await this.scope(db, user, filters.platform);
      const key = group === 'monthly' ? Prisma.sql`to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')` : group === 'status' ? Prisma.sql`status::text` : Prisma.sql`"paymentMethod"::text`;
      const rows = await db.$queryRaw<{ key: string; count: bigint; gross: Prisma.Decimal; net: Prisma.Decimal }[]>(Prisma.sql`
        SELECT ${key} AS key, count(*) AS count, sum(amount) AS gross, sum("netAmount") AS net
        FROM (${this.transactions(scope, filters)}) scoped ${group === 'status' ? Prisma.empty : Prisma.sql`WHERE status = 'COMPLETED'`}
        GROUP BY 1 ORDER BY 1`);
      return { unit: 'cents' as const, data: rows.map(r => ({ key: r.key, count: Number(r.count), grossCents: cents(r.gross), netCents: cents(r.net) })) };
    });
  }

  async transactionDetails(user: JwtPayload, filters: Filters) {
    reportPeriod(filters);
    const { page, pageSize, skip } = reportPagination(filters);
    return this.snapshot(async db => {
      const scope = await this.scope(db, user, filters.platform);
      const source = this.transactions(scope, filters);
      const [rows, counts] = await Promise.all([
        db.$queryRaw<{ id: string; platformTag: string; createdAt: Date; status: string; paymentMethod: PaymentMethod; amount: Prisma.Decimal; totalFee: Prisma.Decimal; netAmount: Prisma.Decimal | null }[]>(Prisma.sql`
          SELECT id, "platformTag", "createdAt", status, "paymentMethod", amount, "totalFee", "netAmount" FROM (${source}) scoped ORDER BY "createdAt" DESC, id ASC LIMIT ${pageSize} OFFSET ${skip}`),
        db.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total FROM (${source}) scoped`),
      ]);
      return { unit: 'cents' as const, data: rows.map(r => ({ id: r.id, platformTag: r.platformTag, createdAt: r.createdAt, status: r.status,
        paymentMethod: r.paymentMethod, grossCents: cents(r.amount), feesCents: cents(r.totalFee), netCents: r.netAmount === null ? null : cents(r.netAmount) })), total: Number(counts[0].total), page, pageSize };
    });
  }

  async balances(user: JwtPayload, filters: Filters) {
    reportPagination(filters, 12);
    return this.snapshot(async db => {
      const actor = await this.actor(db, user);
      if (actor.role !== 'ADMIN') throw new ForbiddenException('Exige administrador');
      const catalog = await this.catalogPage(db, undefined, filters, 12);
      const reader = new PlatformAttributedBalance(this.prisma);
      const data = [];
      for (const p of catalog.data) {
        const balance = await reader.readSnapshot(db, { id: p.id, tag: p.tag, ownerUserId: p.ownerUserId, acquirer: p.acquirer }, true);
        data.push({ id: p.id, tag: p.tag, name: p.name, isActive: p.isActive, owner: { id: p.ownerUserId, name: p.ownerName, email: p.ownerEmail }, ...balance });
      }
      return { unit: 'cents' as const, ...catalog, data };
    });
  }
}
