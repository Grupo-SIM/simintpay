import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const TZ = 'America/Sao_Paulo';

function today() {
  return dayjs().tz(TZ).format('YYYY-MM-DD');
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
  constructor(private readonly prisma: PrismaService) {}

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
    date: Date;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      acquirerCode: row.acquirerCode,
      acquirerName: row.acquirer.name,
      feeCents: row.feeCents,
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

  async create(
    user: JwtPayload,
    input: { acquirerCode?: string; date?: string },
  ) {
    await this.admin(user);
    const date = parseYmd(input?.date ?? today());
    const acquirer = await this.prisma.acquirerCatalogue.findUnique({
      where: { code: String(input?.acquirerCode ?? '') },
    });
    if (!acquirer) throw new NotFoundException('Adquirente desconhecida');
    const latest = await this.prisma.acquirerWithdrawalFee.findFirst({
      where: { acquirerCode: acquirer.code },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!latest)
      throw new BadRequestException(
        'Adquirente sem valor de saque configurado',
      );
    const row = await this.prisma.$transaction(async (tx) => {
      const log = await tx.balanceLog.create({
        data: {
          userId: user.sub,
          action: 'ADMIN_WITHDRAW_FEE_INC',
          bookkeepingAmount: new Prisma.Decimal(latest.feeCents).div(100),
          balanceDelta: 0,
          lockedDelta: 0,
          source: 'MASTER_ADMIN_CONTROL',
          description: `Saque de adquirente ${acquirer.code} — ${date}`,
          metadata: {
            platformTag: 'GLOBAL',
            acquirerCode: acquirer.code,
            manual: true,
          },
          createdAt: reportInstant(date),
        },
      });
      return tx.acquirerWithdrawal.create({
        data: {
          acquirerCode: acquirer.code,
          feeCents: latest.feeCents,
          date: new Date(`${date}T00:00:00.000Z`),
          balanceLogId: log.id,
          actorId: user.sub,
        },
        include: { acquirer: { select: { name: true } } },
      });
    });
    return { data: this.present(row) };
  }

  async updateDate(user: JwtPayload, id: string, input: { date?: string }) {
    await this.admin(user);
    const date = parseYmd(input?.date);
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
        data: { date: new Date(`${date}T00:00:00.000Z`) },
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
