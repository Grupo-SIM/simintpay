import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Prisma, Role } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { parseDomWithdrawals } from './dom-withdrawals';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const TZ = 'America/Sao_Paulo';

function today() {
  return dayjs().tz(TZ).format('YYYY-MM-DD');
}

const SYNC_PAGE_SIZE = 50;
const SYNC_MAX_PAGES = 20;

function parseAmountCents(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isInteger(value) || (value as number) <= 0)
    throw new BadRequestException('Valor sacado inválido');
  return value as number;
}

function parseYmd(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !dayjs(value, 'YYYY-MM-DD', true).isValid()
  )
    throw new BadRequestException('Data inválida');
  if (value > today())
    throw new BadRequestException('A data não pode estar no futuro');
  return value;
}

/** Instant the cost enters the reports: noon in São Paulo, or now when the day is today. */
function reportInstant(ymd: string): Date {
  if (ymd === today()) return new Date();
  return dayjs.tz(`${ymd} 12:00:00`, TZ).toDate();
}

@Injectable()
export class AcquirerWithdrawalsService {
  private readonly logger = new Logger(AcquirerWithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
  ) {}

  private async admin(user: JwtPayload) {
    if (!user?.sub || user.authMode === 'integration')
      throw new ForbiddenException('Exige sessão de usuário');
    const actor = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { role: true, isActive: true, isPurged: true },
    });
    if (actor?.role !== Role.ADMIN || !actor.isActive || actor.isPurged)
      throw new ForbiddenException('Exige administrador');
  }

  private present(row: {
    id: string;
    acquirerCode: string;
    acquirer: { name: string };
    feeCents: number;
    amountCents: number | null;
    source: string;
    date: Date;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      acquirerCode: row.acquirerCode,
      acquirerName: row.acquirer.name,
      feeCents: row.feeCents,
      amountCents: row.amountCents,
      source: row.source,
      date: row.date.toISOString().slice(0, 10),
      createdAt: row.createdAt,
    };
  }

  async list(user: JwtPayload) {
    await this.admin(user);
    const rows = await this.prisma.acquirerWithdrawal.findMany({
      include: { acquirer: { select: { name: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return { data: rows.map((row) => this.present(row)) };
  }

  /** Records a withdrawal and the cost it carries into the financial reports. */
  private async record(input: {
    acquirerCode: string;
    feeCents: number;
    amountCents: number | null;
    date: string;
    actorId: string | null;
    source: 'MANUAL' | 'SYNC';
    externalId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const log =
        input.feeCents > 0
          ? await tx.balanceLog.create({
              data: {
                userId: input.actorId ?? (await this.systemUserId(tx)),
                action: 'ADMIN_WITHDRAW_FEE_INC',
                bookkeepingAmount: new Prisma.Decimal(input.feeCents).div(100),
                balanceDelta: 0,
                lockedDelta: 0,
                source: 'MASTER_ADMIN_CONTROL',
                description: `Saque de adquirente ${input.acquirerCode} — ${input.date}`,
                metadata: {
                  platformTag: 'GLOBAL',
                  acquirerCode: input.acquirerCode,
                  manual: input.source === 'MANUAL',
                  ...(input.externalId ? { externalId: input.externalId } : {}),
                },
                createdAt: reportInstant(input.date),
              },
            })
          : null;
      return tx.acquirerWithdrawal.create({
        data: {
          acquirerCode: input.acquirerCode,
          feeCents: input.feeCents,
          amountCents: input.amountCents,
          date: new Date(`${input.date}T00:00:00.000Z`),
          balanceLogId: log?.id,
          actorId: input.actorId,
          source: input.source,
          externalId: input.externalId,
        },
        include: { acquirer: { select: { name: true } } },
      });
    });
  }

  private async systemUserId(tx: Prisma.TransactionClient): Promise<string> {
    const admin = await tx.user.findFirst({
      where: { role: Role.ADMIN, isActive: true, isPurged: false },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!admin)
      throw new ServiceUnavailableException('Nenhum administrador ativo');
    return admin.id;
  }

  private async latestFeeCents(acquirerCode: string) {
    const latest = await this.prisma.acquirerWithdrawalFee.findFirst({
      where: { acquirerCode },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return latest?.feeCents ?? null;
  }

  async create(
    user: JwtPayload,
    input: { acquirerCode?: string; date?: string; amountCents?: number },
  ) {
    await this.admin(user);
    const date = parseYmd(input?.date ?? today());
    const amountCents = parseAmountCents(input?.amountCents);
    const acquirer = await this.prisma.acquirerCatalogue.findUnique({
      where: { code: String(input?.acquirerCode ?? '') },
    });
    if (!acquirer) throw new NotFoundException('Adquirente desconhecida');
    const feeCents = await this.latestFeeCents(acquirer.code);
    if (feeCents === null)
      throw new BadRequestException(
        'Adquirente sem valor de saque configurado',
      );
    const row = await this.record({
      acquirerCode: acquirer.code,
      feeCents,
      amountCents,
      date,
      actorId: user.sub,
      source: 'MANUAL',
    });
    return { data: this.present(row) };
  }

  /**
   * Imports paid DOM withdrawals not yet recorded. The cost is the withdrawal fee configured for
   * DOM when the transfer is imported, because the DOM response does not itemise it.
   */
  async syncDomAsAdmin(user: JwtPayload) {
    await this.admin(user);
    return this.syncDom();
  }

  async syncDom() {
    const token = process.env.DOM_TOKEN;
    if (!token)
      throw new ServiceUnavailableException('Credencial DOM não configurada');
    const acquirer = await this.prisma.acquirerCatalogue.findUnique({
      where: { code: 'DOM' },
    });
    if (!acquirer || acquirer.syncAdapter !== 'DOM')
      throw new ServiceUnavailableException('Sincronização DOM não habilitada');
    const feeCents = await this.latestFeeCents('DOM');
    if (feeCents === null) {
      this.logger.warn(
        'DOM sem taxa de saque configurada; saques serão importados com custo zero',
      );
    }
    const base = (
      process.env.DOM_BACKEND_URL ?? 'https://backend.dompagamentos.com.br'
    ).replace(/\/$/, '');
    let imported = 0;
    for (let page = 1; page <= SYNC_MAX_PAGES; page++) {
      let body: unknown;
      try {
        const res = await firstValueFrom(
          this.http.get(`${base}/front-store/withdraws`, {
            params: { limit: SYNC_PAGE_SIZE, page },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 15_000,
          }),
        );
        body = res.data;
      } catch {
        // Never log the response: it carries identity and permission data.
        throw new ServiceUnavailableException(
          'Não foi possível consultar saques DOM',
        );
      }
      const parsed = parseDomWithdrawals(body);
      const known = new Set(
        (
          await this.prisma.acquirerWithdrawal.findMany({
            where: {
              acquirerCode: 'DOM',
              externalId: { in: parsed.withdrawals.map((w) => w.externalId) },
            },
            select: { externalId: true },
          })
        ).map((row) => row.externalId),
      );
      for (const withdrawal of parsed.withdrawals) {
        if (known.has(withdrawal.externalId)) continue;
        try {
          await this.record({
            acquirerCode: 'DOM',
            feeCents: feeCents ?? 0,
            amountCents: withdrawal.amountCents,
            date: withdrawal.date,
            actorId: null,
            source: 'SYNC',
            externalId: withdrawal.externalId,
          });
          imported++;
        } catch (error) {
          // A concurrent run already imported this transfer.
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            error.code !== 'P2002'
          )
            throw error;
        }
      }
      // Newest first: once a page holds only known transfers, older pages are already imported.
      const allKnown =
        parsed.withdrawals.length > 0 &&
        parsed.withdrawals.every((w) => known.has(w.externalId));
      if (page >= parsed.totalPages || allKnown) break;
    }
    return { data: { imported } };
  }

  async update(
    user: JwtPayload,
    id: string,
    input: { date?: string; amountCents?: number | null },
  ) {
    await this.admin(user);
    const date = parseYmd(input?.date);
    const amountCents = parseAmountCents(input?.amountCents);
    const existing = await this.prisma.acquirerWithdrawal.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Saque não encontrado');
    const row = await this.prisma.$transaction(async (tx) => {
      if (existing.balanceLogId)
        await tx.balanceLog.update({
          where: { id: existing.balanceLogId },
          data: {
            createdAt: reportInstant(date),
            description: `Saque de adquirente ${existing.acquirerCode} — ${date}`,
          },
        });
      return tx.acquirerWithdrawal.update({
        where: { id },
        data: {
          date: new Date(`${date}T00:00:00.000Z`),
          ...(input.amountCents !== undefined ? { amountCents } : {}),
        },
        include: { acquirer: { select: { name: true } } },
      });
    });
    return { data: this.present(row) };
  }

  async remove(user: JwtPayload, id: string) {
    await this.admin(user);
    const existing = await this.prisma.acquirerWithdrawal.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Saque não encontrado');
    await this.prisma.$transaction(async (tx) => {
      await tx.acquirerWithdrawal.delete({ where: { id } });
      if (existing.balanceLogId)
        await tx.balanceLog.delete({ where: { id: existing.balanceLogId } });
    });
    return { data: { id } };
  }
}
