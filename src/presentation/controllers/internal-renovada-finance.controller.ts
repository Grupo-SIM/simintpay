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
import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

const TAXA_SERVICO_EFFECTIVE_DATE = new Date('2026-05-29T20:40:00.000Z');

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

    if (userIds.length === 0) {
      return { availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0 };
    }

    // wallet.balance stores net (DOM liquid_amount). Approved withdrawals are already deducted
    // from wallet.balance at approval time. lockedBalance tracks pending withdrawal gross.
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId: { in: userIds } },
    });
    const balanceNet = Number(wallet?.balance ?? 0);
    const lockedNet = Number(wallet?.lockedBalance ?? 0);

    const wdPending = await this.prisma.withdrawRequest.aggregate({
      where: { userId: { in: userIds }, status: 'PENDING' },
      _sum: { grossAmount: true, amount: true },
    });
    const pendingGross = Number(wdPending._sum.grossAmount ?? wdPending._sum.amount ?? 0);

    return {
      availableBalance: Math.max(0, Number((balanceNet - lockedNet).toFixed(2))),
      pendingWithdraws: Number(pendingGross.toFixed(2)),
      lockedBalance: Number(lockedNet.toFixed(2)),
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

    const svcRaw = getPlatformTaxaEffective('RENOVADA', 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);

    return {
      transactions: items.map((t) => {
        const netBase = Number(t.netAmount ?? t.amount);
        const taxaServico = svcRaw > 0 && t.createdAt >= TAXA_SERVICO_EFFECTIVE_DATE ? svcRaw : 0;
        return {
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
          amountWithoutAllFee: Number((netBase - taxaServico).toFixed(2)),
          walletId: null,
          createdAt: t.createdAt,
          paymentId: t.domPaymentId ?? t.domTransactionId ?? null,
          updatedAt: t.updatedAt,
        };
      }),
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
    @Body() body: { cpf?: string; userId?: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(body.cpf ?? '', body.userId);
    if (userIds.length === 0) throw new BadRequestException('Nenhuma conta encontrada');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    if (!body.pixKey?.trim()) throw new BadRequestException('PIX é obrigatório');

    const userId = userIds[0];
    // Fee is deducted FROM the entered amount (not added on top).
    // amount = total deducted from balance; user receives amount - fee.
    const fee = parseFloat(RenovadaConfig.saque.calcularTaxa(amount).toFixed(2));
    const grossAmount = amount; // amount entered = total locked/deducted
    const netPayout = parseFloat((amount - fee).toFixed(2));

    if (netPayout <= 0) {
      throw new BadRequestException(`Valor insuficiente para cobrir a taxa de R$ ${fee.toFixed(2)}`);
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new BadRequestException('Carteira não encontrada para este usuário');

    const available = parseFloat((Number(wallet.balance) - Number(wallet.lockedBalance)).toFixed(2));
    if (available < grossAmount) {
      throw new BadRequestException(
        `Saldo insuficiente. Disponível: R$ ${available.toFixed(2)}, solicitado: R$ ${grossAmount.toFixed(2)}`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const wr = await tx.withdrawRequest.create({
        data: {
          userId,
          amount: netPayout,
          grossAmount,
          fee,
          status: 'PENDING',
          pixKey: body.pixKey.trim(),
          platform: 'renovada',
        },
      });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: { increment: grossAmount }, version: { increment: 1 } },
      });
      return wr;
    });

    return { success: true, id: created.id, netPayout };
  }
}
