import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { validateFee, type FeeInput } from './acquirer-fees';
import { parseDomNegotiation } from './dom-negotiation';
import { initializePlatformTaxasCache } from '../platform-taxas/platform-taxas.store';

type FeeAmounts = {
  fixedCents: number;
  ratePpm: number;
  interestPpm: number;
  base: string;
};

function feeDirection(
  previous: FeeAmounts | undefined,
  next: FeeAmounts,
): 'INITIAL' | 'INCREASE' | 'DECREASE' | 'UNCHANGED' {
  if (!previous) return 'INITIAL';
  if (
    next.base !== previous.base ||
    next.fixedCents > previous.fixedCents ||
    next.ratePpm > previous.ratePpm ||
    next.interestPpm > previous.interestPpm
  )
    return 'INCREASE';
  if (
    next.fixedCents < previous.fixedCents ||
    next.ratePpm < previous.ratePpm ||
    next.interestPpm < previous.interestPpm
  )
    return 'DECREASE';
  return 'UNCHANGED';
}

@Injectable()
export class AcquirerFeesService {
  private readonly logger = new Logger(AcquirerFeesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
  ) {}

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        // PostgreSQL serialization failures and deadlocks invalidate the whole transaction.
        // Re-read schedules and policy revisions on retry rather than replaying stale writes.
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt >= 4
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  }

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

  async list(user: JwtPayload) {
    await this.admin(user);
    const acquirers = await this.prisma.acquirerCatalogue.findMany({
      orderBy: { code: 'asc' },
    });
    const rows = await this.prisma.acquirerFeeSchedule.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      data: acquirers.map((acquirer) => {
        const latest = new Map<string, (typeof rows)[number]>();
        for (const row of rows) {
          if (row.acquirerCode !== acquirer.code) continue;
          const key = `${row.method}/${row.channel}/${row.installments}`;
          if (!latest.has(key)) latest.set(key, row);
        }
        return { ...acquirer, fees: [...latest.values()] };
      }),
    };
  }

  async register(user: JwtPayload, input: { code: string; name: string }) {
    await this.admin(user);
    if (
      !/^[A-Z][A-Z0-9_-]{0,39}$/.test(input.code) ||
      !input.name?.trim() ||
      input.name.length > 100
    )
      throw new BadRequestException('Adquirente inválida');
    return {
      data: await this.prisma.acquirerCatalogue.create({
        data: { code: input.code, name: input.name.trim(), active: false },
      }),
    };
  }

  async setActive(user: JwtPayload, code: string, active: boolean) {
    await this.admin(user);
    if (typeof active !== 'boolean')
      throw new BadRequestException('Estado inválido');
    if (active && !['DOM', 'FRENDZ'].includes(code))
      throw new BadRequestException('Adquirente sem processamento disponível');
    return {
      data: await this.serializable(async (tx) => {
        const acquirer = await tx.acquirerCatalogue.findUnique({
          where: { code },
        });
        if (!acquirer) throw new NotFoundException('Adquirente desconhecida');
        return tx.acquirerCatalogue.update({
          where: { code },
          data: { active },
        });
      }),
    };
  }

  async listWithdrawal(user: JwtPayload) {
    await this.admin(user);
    const acquirers = await this.prisma.acquirerCatalogue.findMany({
      orderBy: { code: 'asc' },
    });
    const rows = await this.prisma.acquirerWithdrawalFee.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      data: acquirers.map((acquirer) => {
        const latest = rows.find((row) => row.acquirerCode === acquirer.code);
        return {
          code: acquirer.code,
          name: acquirer.name,
          active: acquirer.active,
          feeCents: latest?.feeCents ?? null,
          source: latest?.source ?? null,
          updatedAt: latest?.createdAt ?? null,
        };
      }),
    };
  }

  async saveWithdrawal(user: JwtPayload, code: string, feeCents: number) {
    await this.admin(user);
    if (!Number.isSafeInteger(feeCents) || feeCents < 0 || feeCents > 1_000_000)
      throw new BadRequestException('Taxa de saque inválida');
    const acquirer = await this.prisma.acquirerCatalogue.findUnique({
      where: { code },
    });
    if (!acquirer) throw new NotFoundException('Adquirente desconhecida');
    const created = await this.prisma.acquirerWithdrawalFee.create({
      data: {
        acquirerCode: code,
        feeCents,
        source: 'MANUAL',
        actorId: user.sub,
      },
    });
    await initializePlatformTaxasCache();
    return { data: created };
  }

  async history(user: JwtPayload, code: string) {
    await this.admin(user);
    const acquirer = await this.prisma.acquirerCatalogue.findUnique({
      where: { code },
    });
    if (!acquirer) throw new NotFoundException('Adquirente desconhecida');
    return {
      data: await this.prisma.acquirerFeeSchedule.findMany({
        where: { acquirerCode: code },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
    };
  }

  async syncDom(user?: JwtPayload) {
    if (user) await this.admin(user);
    const token = process.env.DOM_TOKEN;
    if (!token)
      throw new ServiceUnavailableException('Credencial DOM não configurada');
    const base = (
      process.env.DOM_REAL_API_URL ??
      'https://apiv3.dompagamentos.com.br/checkout/production'
    ).replace(/\/$/, '');
    let response: unknown;
    try {
      const result = await firstValueFrom(
        this.http.get(`${base}/get-negotiation`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15_000,
        }),
      );
      response = result.data;
    } catch {
      this.logger.warn(
        'Não foi possível obter negociação DOM; custos anteriores permanecem ativos',
      );
      throw new ServiceUnavailableException(
        'Não foi possível consultar negociação DOM',
      );
    }
    const fees = parseDomNegotiation(response);
    // Parse the entire negotiated schedule before inserting a single row. Never log the response:
    // the API also returns identity, MFA and permissions that have no place in financial records.
    const changed = await this.serializable(async (tx) => {
      const acquirer = await tx.acquirerCatalogue.findUnique({
        where: { code: 'DOM' },
      });
      if (!acquirer || acquirer.syncAdapter !== 'DOM')
        throw new ServiceUnavailableException(
          'Sincronização DOM não habilitada',
        );
      const existing = await tx.acquirerFeeSchedule.findMany({
        where: { acquirerCode: 'DOM' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const latest = new Map<string, (typeof existing)[number]>();
      for (const row of existing) {
        const key = `${row.method}/${row.channel}/${row.installments}`;
        if (!latest.has(key)) latest.set(key, row);
      }
      const updates = fees.filter((fee) => {
        const previous = latest.get(
          `${fee.method}/${fee.channel}/${fee.installments}`,
        );
        return (
          !previous ||
          previous.fixedCents !== fee.fixedCents ||
          previous.ratePpm !== fee.ratePpm ||
          previous.interestPpm !== fee.interestPpm ||
          previous.base !== fee.base
        );
      });
      for (const fee of updates)
        await tx.acquirerFeeSchedule.create({
          data: {
            acquirerCode: 'DOM',
            method: fee.method,
            channel: fee.channel,
            installments: fee.installments,
            fixedCents: fee.fixedCents,
            ratePpm: fee.ratePpm,
            interestPpm: fee.interestPpm,
            base: fee.base ?? 'BUYER_TOTAL',
            source: 'SYNC',
            actorId: user?.sub,
            changeDirection: feeDirection(
              latest.get(`${fee.method}/${fee.channel}/${fee.installments}`),
              { ...fee, base: fee.base ?? 'BUYER_TOTAL' },
            ),
          },
        });
      return updates.map((fee) => {
        const previous = latest.get(
          `${fee.method}/${fee.channel}/${fee.installments}`,
        );
        return {
          method: fee.method,
          channel: fee.channel,
          installments: fee.installments,
          increased:
            feeDirection(previous, {
              ...fee,
              base: fee.base ?? 'BUYER_TOTAL',
            }) === 'INCREASE',
        };
      });
    });
    if (changed.some((change) => change.increased))
      this.logger.warn(
        `Custos DOM aumentaram em ${changed.filter((change) => change.increased).length} faixas; revisar margem e preço ao comprador`,
      );
    return { data: { changed } };
  }

  async save(user: JwtPayload, code: string, fee: FeeInput) {
    await this.admin(user);
    validateFee(fee);
    const created = await this.serializable(async (tx) => {
      const acquirer = await tx.acquirerCatalogue.findUnique({
        where: { code },
      });
      if (!acquirer) throw new NotFoundException('Adquirente desconhecida');
      const previous = await tx.acquirerFeeSchedule.findFirst({
        where: {
          acquirerCode: code,
          method: fee.method,
          channel: fee.channel,
          installments: fee.installments,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return tx.acquirerFeeSchedule.create({
        data: {
          method: fee.method,
          channel: fee.channel,
          installments: fee.installments,
          fixedCents: fee.fixedCents,
          ratePpm: fee.ratePpm,
          interestPpm: fee.interestPpm,
          base: fee.base ?? 'BUYER_TOTAL',
          acquirerCode: code,
          source: 'MANUAL',
          actorId: user.sub,
          changeDirection: feeDirection(previous ?? undefined, {
            ...fee,
            base: fee.base ?? 'BUYER_TOTAL',
          }),
        },
      });
    });
    return { data: created };
  }
}
