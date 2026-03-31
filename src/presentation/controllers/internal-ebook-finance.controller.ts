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

type TxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'EXPIRED' | 'DRAFT';

@Controller('internal/ebook/finance')
export class InternalEbookFinanceController {
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

  private async resolveUserIdsByCpf(cpf: string): Promise<string[]> {
    const variants = this.cpfVariants(cpf);
    if (variants.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { cpf: { in: variants } },
      select: { id: true },
    });
    return [...new Set(users.map((u) => u.id))];
  }

  @Get('summary')
  async summary(
    @Query('cpf') cpf: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(cpf);
    if (userIds.length === 0) {
      return { availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0 };
    }

    const txCompleted = await this.prisma.transaction.aggregate({
      where: {
        userId: { in: userIds },
        status: 'COMPLETED',
        OR: [
          { description: { contains: '[TENANT:EBOOK]', mode: 'insensitive' } },
          { userId: { in: userIds } },
        ],
      },
      _sum: { netAmount: true, amount: true },
    });

    const wdCompleted = await this.prisma.withdrawRequest.aggregate({
      where: { userId: { in: userIds }, status: { in: ['APPROVED', 'COMPLETED'] } },
      _sum: { amount: true },
    });

    const wdPending = await this.prisma.withdrawRequest.aggregate({
      where: { userId: { in: userIds }, status: 'PENDING' },
      _sum: { amount: true, grossAmount: true },
    });

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
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('description') description?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(cpf);
    if (userIds.length === 0) {
      return { transactions: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } };
    }

    const pageNum = Math.max(1, Number(page || 1));
    const size = Math.min(Math.max(1, Number(limit || 10)), 200);
    const where: any = {
      OR: [
        { description: { contains: '[TENANT:EBOOK]', mode: 'insensitive' } },
        { userId: { in: userIds } },
      ],
    };

    if (status && status !== 'ALL') {
      where.status = String(status).toUpperCase() as TxStatus;
    }
    if (description && description !== 'ALL') {
      where.description = { contains: description, mode: 'insensitive' };
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) where.createdAt.lte = new Date(`${endDate}T23:59:59.999Z`);
    }

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
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(cpf);
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
    @Body() body: { cpf: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(body.cpf);
    if (userIds.length === 0) throw new BadRequestException('Nenhuma conta encontrada para este CPF');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    if (!body.pixKey?.trim()) throw new BadRequestException('PIX é obrigatório');

    const created = await this.prisma.withdrawRequest.create({
      data: {
        userId: userIds[0],
        amount,
        grossAmount: amount + 2,
        fee: 2,
        status: 'PENDING',
        pixKey: body.pixKey.trim(),
      },
    });

    return { success: true, id: created.id };
  }
}

