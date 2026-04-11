import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { RenovadaConfig } from '../../modules/renovada/renovada.config';

type TxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'EXPIRED' | 'DRAFT';

@Controller('internal/renovada/finance')
export class InternalRenovadaFinanceController {
  constructor(private readonly prisma: PrismaService) {}

  private ensureInternalToken(token?: string) {
    const expected = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }

  private normalizeCpf(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  private cpfVariants(raw: string): string[] {
    const cpf = this.normalizeCpf(raw);
    if (!cpf || cpf.length !== 11) return [];
    return [cpf, cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')];
  }

  private async resolveUserIdsByCpf(cpf: string, directUserId?: string): Promise<string[]> {
    const ids = new Set<string>();

    const variants = this.cpfVariants(cpf);
    if (variants.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { cpf: { in: variants } },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    if (directUserId?.trim()) {
      ids.add(directUserId.trim());
    }

    return [...ids];
  }

  private buildOwnerFilter(cpf: string, userIds: string[]): any {
    const cpfClean = this.normalizeCpf(cpf);
    const conditions: any[] = [];

    if (userIds.length > 0) {
      conditions.push({ userId: { in: userIds } });
    }

    if (cpfClean.length === 11) {
      conditions.push({ description: { contains: `[CPF_DONO:${cpfClean}]`, mode: 'insensitive' } });
    }

    if (conditions.length === 0) return null;
    if (conditions.length === 1) return conditions[0];
    return { OR: conditions };
  }

  @Get('summary')
  async summary(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);
    const ownerFilter = this.buildOwnerFilter(cpf, userIds);
    if (!ownerFilter) {
      return { availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0 };
    }

    const txCompleted = await this.prisma.transaction.aggregate({
      where: {
        AND: [
          ownerFilter,
          { status: 'COMPLETED' },
          { description: { contains: '[TENANT:RENOVADA]', mode: 'insensitive' } },
        ],
      },
      _sum: { netAmount: true, amount: true },
    });

    const wdFilter = userIds.length > 0 ? { userId: { in: userIds } } : null;

    const wdCompleted = wdFilter
      ? await this.prisma.withdrawRequest.aggregate({
          where: { ...wdFilter, status: { in: ['APPROVED', 'COMPLETED'] } },
          _sum: { amount: true },
        })
      : { _sum: { amount: null } };

    const wdPending = wdFilter
      ? await this.prisma.withdrawRequest.aggregate({
          where: { ...wdFilter, status: 'PENDING' },
          _sum: { amount: true, grossAmount: true },
        })
      : { _sum: { amount: null, grossAmount: null } };

    const totalReceived = Number(txCompleted._sum.netAmount ?? txCompleted._sum.amount ?? 0);
    const totalCompletedWithdraw = Number(wdCompleted._sum.amount ?? 0);
    const pendingAmount = Number(wdPending._sum.amount ?? 0);
    const pendingGross = Number(wdPending._sum.grossAmount ?? pendingAmount);

    return {
      availableBalance: Math.max(0, Number((totalReceived - totalCompletedWithdraw - pendingAmount).toFixed(2))),
      pendingWithdraws: Number(pendingAmount.toFixed(2)),
      lockedBalance: Number(pendingGross.toFixed(2)),
    };
  }

  @Get('transactions')
  async transactions(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('description') description?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);
    const ownerFilter = this.buildOwnerFilter(cpf, userIds);
    if (!ownerFilter) {
      return { transactions: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } };
    }

    const pageNum = Math.max(1, Number(page || 1));
    const size = Math.min(Math.max(1, Number(limit || 10)), 5000);

    const andConditions: any[] = [
      ownerFilter,
      { description: { contains: '[TENANT:RENOVADA]', mode: 'insensitive' } },
    ];

    const statusUpper = status ? String(status).toUpperCase() : '';
    if (statusUpper && statusUpper !== 'ALL') {
      andConditions.push({ status: statusUpper as TxStatus });
    }

    if (description && description !== 'ALL') {
      andConditions.push({ description: { contains: description, mode: 'insensitive' } });
    }

    if (startDate || endDate) {
      const createdAt: any = {};
      if (startDate) createdAt.gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) createdAt.lte = new Date(`${endDate}T23:59:59.999Z`);
      andConditions.push({ createdAt });
    }

    const where = { AND: andConditions };

    const [totalItems, items] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      transactions: items.map((t) => ({
        id: t.id,
        userId: t.userId,
        amount: Number(t.amount),
        name: t.customerName ?? null,
        email: t.customerEmail ?? null,
        status: t.status,
        description: t.description ?? null,
        appliedGlobalFee: false,
        fee: Number(t.platformFee ?? 0),
        dom_fee: Number(t.domFee ?? 0),
        payment_method: t.paymentMethod,
        amountWithoutAllFee: Number(t.netAmount ?? t.amount),
        walletId: null,
        createdAt: t.createdAt,
        paymentId: t.domPaymentId ?? t.domTransactionId ?? null,
        updatedAt: t.updatedAt,
      })),
      meta: {
        currentPage: pageNum,
        itemsPerPage: size,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / size)),
      },
    };
  }

  @Get('withdrawals')
  async withdrawals(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);
    if (userIds.length === 0) {
      return { withdrawals: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } };
    }
    const pageNum = Math.max(1, Number(page || 1));
    const size = Math.min(Math.max(1, Number(limit || 10)), 200);

    const [totalItems, items] = await Promise.all([
      this.prisma.withdrawRequest.count({ where: { userId: { in: userIds } } }),
      this.prisma.withdrawRequest.findMany({
        where: { userId: { in: userIds } },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      withdrawals: items.map((w) => ({
        id: w.id,
        userId: w.userId,
        amount: Number(w.amount),
        status: w.status,
        pixKey: w.pixKey,
        rejectionReason: w.rejectionReason ?? null,
        createdAt: w.createdAt,
        user: { name: w.user?.name ?? '-', email: w.user?.email ?? '-' },
      })),
      meta: {
        currentPage: pageNum,
        itemsPerPage: size,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / size)),
      },
    };
  }

  @Post('withdraw')
  async requestWithdraw(
    @Body() body: { cpf: string; userId?: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(body.cpf, body.userId);
    if (userIds.length === 0) throw new BadRequestException('Nenhuma conta encontrada para este CPF');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    if (!body.pixKey?.trim()) throw new BadRequestException('PIX é obrigatório');

    const taxaSaque = RenovadaConfig.saque.calcularTaxa(amount);
    const created = await this.prisma.withdrawRequest.create({
      data: {
        userId: userIds[0],
        amount,
        grossAmount: parseFloat((amount + taxaSaque).toFixed(2)),
        fee: parseFloat(taxaSaque.toFixed(2)),
        status: 'PENDING',
        pixKey: body.pixKey.trim(),
      },
    });

    return { success: true, id: created.id };
  }
}
