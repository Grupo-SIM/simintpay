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
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

const AREAFLIX_CLAIM_TRANSFER_ACTION = 'AREAFLIX_CLAIM_TRANSFER';

const AREAFLIX_WITHDRAW_MIN = Number(process.env.AREAFLIX_WITHDRAW_MIN || 100);
const AREAFLIX_WITHDRAW_FEE = Number(process.env.AREAFLIX_WITHDRAW_FEE || 2);

/**
 * Endpoints internos consumidos pelo saas-netflix-back (areaflix).
 * Espelha o padrão do internal-pagatg-finance: resolução de conta por CPF/CNPJ
 * e saques que entram na fila de aprovação do painel admin do simpay.
 */
@Controller('internal/areaflix/finance')
export class InternalAreaflixFinanceController {
  constructor(private readonly prisma: PrismaService) {}

  private ensureInternalToken(token?: string) {
    const expected = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }

  private normalizeDoc(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  private async resolveUserIdsByDoc(doc: string): Promise<string[]> {
    const ids = new Set<string>();
    const clean = this.normalizeDoc(doc);

    if (clean.length === 14) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users = await (this.prisma.user as any).findMany({
        where: { cnpj: clean },
        select: { id: true },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (users as any[]).forEach((u: any) => ids.add(u.id));
    } else if (clean.length === 11) {
      const variants = [clean, clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')];
      const users = await this.prisma.user.findMany({
        where: { cpf: { in: variants } },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    return [...ids];
  }

  /** Carteira simpay do admin (por CPF/CNPJ) — fonte única de saldo pós-vínculo. */
  @Get('wallet')
  async wallet(
    @Query('cpf') cpf: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByDoc(cpf);
    if (userIds.length === 0) {
      return { accountExists: false, balance: 0, lockedBalance: 0, availableBalance: 0 };
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: userIds[0] },
    });

    const balance = Number(wallet?.balance ?? 0);
    const locked = Number(wallet?.lockedBalance ?? 0);

    return {
      accountExists: true,
      balance: Number(balance.toFixed(2)),
      lockedBalance: Number(locked.toFixed(2)),
      availableBalance: Number(Math.max(0, balance - locked).toFixed(2)),
    };
  }

  /** Verifica se existe conta simpay com o CPF/CNPJ informado (para liberar saques). */
  @Get('account')
  async accountStatus(
    @Query('cpf') cpf: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByDoc(cpf);
    return {
      accountExists: userIds.length > 0,
      minimumWithdrawalAmount: AREAFLIX_WITHDRAW_MIN,
      withdrawalFeeBrl: AREAFLIX_WITHDRAW_FEE,
    };
  }

  @Get('withdrawals')
  async withdrawals(
    @Query('cpf') cpf: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByDoc(cpf);
    if (userIds.length === 0) {
      return { withdrawals: [], meta: { currentPage: 1, itemsPerPage: 20, totalItems: 0, totalPages: 1 } };
    }
    const pageNum = Math.max(1, Number(page || 1));
    const size = Math.min(Math.max(1, Number(limit || 20)), 200);

    const where = { userId: { in: userIds }, platform: 'areaflix' };

    const [totalItems, items] = await Promise.all([
      this.prisma.withdrawRequest.count({ where }),
      this.prisma.withdrawRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      withdrawals: items.map((w) => ({
        id: w.id,
        amount: Number(w.amount),
        grossAmount: Number(w.grossAmount),
        fee: Number(w.fee),
        status: w.status,
        pixKey: w.pixKey,
        rejectionReason: w.rejectionReason ?? null,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
      meta: {
        currentPage: pageNum,
        itemsPerPage: size,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / size)),
      },
    };
  }

  /** Soma de saques ativos/concluídos (para o cálculo de saldo no lado areaflix). */
  @Get('withdrawals/totals')
  async withdrawalTotals(
    @Query('cpf') cpf: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByDoc(cpf);
    if (userIds.length === 0) {
      return { pendingGross: 0, completedGross: 0 };
    }

    const [pending, completed] = await Promise.all([
      this.prisma.withdrawRequest.aggregate({
        where: { userId: { in: userIds }, platform: 'areaflix', status: 'PENDING' },
        _sum: { grossAmount: true },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: { userId: { in: userIds }, platform: 'areaflix', status: { in: ['APPROVED', 'COMPLETED'] } },
        _sum: { grossAmount: true },
      }),
    ]);

    return {
      pendingGross: Number(pending._sum.grossAmount ?? 0),
      completedGross: Number(completed._sum.grossAmount ?? 0),
    };
  }

  /**
   * Transfere a titularidade de links criados pela conta de serviço da areaflix
   * para a conta simpay do admin (resolvida por CPF/CNPJ). A partir daí as vendas
   * creditam a carteira do próprio admin. Idempotente.
   */
  @Post('claim-links')
  async claimLinks(
    @Body()
    body: {
      cpf: string;
      paymentLinkIds?: string[];
      subscriptionLinkIds?: string[];
      /** Saldo líquido acumulado antes do vínculo — transferido da conta de serviço para o admin (uma única vez). */
      retroactiveAmount?: number;
      /** Email da conta de serviço da areaflix (dona original dos links/saldo). */
      serviceAccountEmail?: string;
    },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByDoc(body.cpf);
    if (userIds.length === 0) {
      return { claimed: false, reason: 'Nenhuma conta simpay para este CPF/CNPJ' };
    }
    const targetUserId = userIds[0];

    const paymentLinkIds = (body.paymentLinkIds ?? []).filter(Boolean);
    const subscriptionLinkIds = (body.subscriptionLinkIds ?? []).filter(Boolean);

    let paymentLinks = 0;
    let subscriptionLinks = 0;
    let orders = 0;

    if (paymentLinkIds.length > 0) {
      const result = await this.prisma.paymentLink.updateMany({
        where: { id: { in: paymentLinkIds }, userId: { not: targetUserId } },
        data: { userId: targetUserId },
      });
      paymentLinks = result.count;
    }

    if (subscriptionLinkIds.length > 0) {
      const result = await this.prisma.subscriptionLink.updateMany({
        where: { id: { in: subscriptionLinkIds }, userId: { not: targetUserId } },
        data: { userId: targetUserId },
      });
      subscriptionLinks = result.count;

      // Ordens existentes também — renovações futuras creditam o novo dono
      const ordersResult = await this.prisma.subscriptionLinkOrder.updateMany({
        where: {
          subscriptionLinkId: { in: subscriptionLinkIds },
          userId: { not: targetUserId },
        },
        data: { userId: targetUserId },
      });
      orders = ordersResult.count;
    }

    // Transferência retroativa do saldo (uma única vez por admin):
    // move o líquido acumulado pré-vínculo da carteira da conta de serviço
    // para a carteira do admin, igualando o saldo simpay ao saldo areaflix.
    let retroactiveTransferred = 0;
    const retroactive = Number(body.retroactiveAmount ?? 0);
    if (retroactive > 0 && body.serviceAccountEmail?.trim()) {
      const alreadyTransferred = await this.prisma.balanceLog.findFirst({
        where: { userId: targetUserId, action: AREAFLIX_CLAIM_TRANSFER_ACTION },
        select: { id: true },
      });

      const serviceUser = await this.prisma.user.findUnique({
        where: { email: body.serviceAccountEmail.trim() },
        include: { wallet: true },
      });

      const serviceWallet = serviceUser?.wallet ?? null;
      if (!alreadyTransferred && serviceUser && serviceWallet) {
        const amountDec = new Prisma.Decimal(retroactive.toFixed(2));

        await this.prisma.$transaction(async (tx) => {
          const targetWallet = await tx.wallet.upsert({
            where: { userId: targetUserId },
            update: {},
            create: { userId: targetUserId, balance: 0, lockedBalance: 0 },
          });

          const serviceBefore = serviceWallet.balance;
          const targetBefore = targetWallet.balance;

          await tx.wallet.update({
            where: { userId: serviceUser.id },
            data: { balance: { decrement: amountDec }, version: { increment: 1 } },
          });
          await tx.wallet.update({
            where: { userId: targetUserId },
            data: { balance: { increment: amountDec }, version: { increment: 1 } },
          });

          await tx.balanceLog.create({
            data: {
              userId: targetUserId,
              action: AREAFLIX_CLAIM_TRANSFER_ACTION,
              amount: amountDec,
              balanceBefore: targetBefore,
              balanceAfter: new Prisma.Decimal(Number(targetBefore) + retroactive),
              lockedBefore: targetWallet.lockedBalance,
              lockedAfter: targetWallet.lockedBalance,
              source: 'AREAFLIX',
              description: `Vínculo areaflix: saldo retroativo transferido da conta de serviço (${body.serviceAccountEmail})`,
            },
          });
          await tx.balanceLog.create({
            data: {
              userId: serviceUser.id,
              action: AREAFLIX_CLAIM_TRANSFER_ACTION,
              amount: amountDec.neg(),
              balanceBefore: serviceBefore,
              balanceAfter: new Prisma.Decimal(Number(serviceBefore) - retroactive),
              lockedBefore: serviceWallet.lockedBalance,
              lockedAfter: serviceWallet.lockedBalance,
              source: 'AREAFLIX',
              description: `Vínculo areaflix: saldo retroativo transferido para o admin (doc ${this.normalizeDoc(body.cpf)})`,
            },
          });
        });

        retroactiveTransferred = retroactive;
      }
    }

    return {
      claimed: true,
      targetUserId,
      transferred: { paymentLinks, subscriptionLinks, orders },
      retroactiveTransferred,
    };
  }

  /** Cria solicitação de saque — entra na fila do painel admin do simpay (platform: areaflix). */
  @Post('withdraw')
  async requestWithdraw(
    @Body() body: { cpf: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByDoc(body.cpf);
    if (userIds.length === 0) {
      throw new BadRequestException('Nenhuma conta simintpay encontrada para este CPF/CNPJ');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    if (amount < AREAFLIX_WITHDRAW_MIN) {
      throw new BadRequestException(`Valor mínimo para saque é de R$ ${AREAFLIX_WITHDRAW_MIN.toFixed(2)}`);
    }
    if (!body.pixKey?.trim()) throw new BadRequestException('Chave PIX é obrigatória');

    // Apenas um saque pendente por vez
    const active = await this.prisma.withdrawRequest.findFirst({
      where: { userId: { in: userIds }, platform: 'areaflix', status: 'PENDING' },
    });
    if (active) {
      throw new BadRequestException('Já existe uma solicitação de saque em andamento. Aguarde a conclusão.');
    }

    const targetUserId = userIds[0];
    const grossAmount = parseFloat(amount.toFixed(2));
    const netAmount = parseFloat((amount - AREAFLIX_WITHDRAW_FEE).toFixed(2));
    if (netAmount <= 0) {
      throw new BadRequestException(
        `Valor insuficiente para cobrir a taxa de saque (R$ ${AREAFLIX_WITHDRAW_FEE.toFixed(2)})`,
      );
    }

    // Valida saldo disponível e trava o bruto na carteira (padrão do fluxo de saque:
    // aprovação debita, recusa destrava)
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: targetUserId } });
    const available = Number(wallet?.balance ?? 0) - Number(wallet?.lockedBalance ?? 0);
    if (!wallet || grossAmount > available) {
      throw new BadRequestException(
        `Saldo insuficiente na carteira simintpay. Disponível: R$ ${Math.max(0, available).toFixed(2)}`,
      );
    }

    const grossDec = new Prisma.Decimal(grossAmount.toFixed(2));

    const created = await this.prisma.$transaction(async (tx) => {
      const withdraw = await tx.withdrawRequest.create({
        data: {
          userId: targetUserId,
          amount: netAmount,
          grossAmount,
          fee: parseFloat(AREAFLIX_WITHDRAW_FEE.toFixed(2)),
          status: 'PENDING',
          pixKey: body.pixKey.trim(),
          platform: 'areaflix',
        },
      });

      await tx.wallet.update({
        where: { userId: targetUserId },
        data: { lockedBalance: { increment: grossDec }, version: { increment: 1 } },
      });

      await tx.balanceLog.create({
        data: {
          userId: targetUserId,
          action: 'WITHDRAW_REQUESTED',
          amount: grossDec.neg(),
          balanceBefore: wallet.balance,
          balanceAfter: wallet.balance,
          lockedBefore: wallet.lockedBalance,
          lockedAfter: new Prisma.Decimal(Number(wallet.lockedBalance) + grossAmount),
          source: 'WITHDRAW',
          description: `Saque areaflix solicitado: R$ ${grossAmount.toFixed(2)}`,
        },
      });

      return withdraw;
    });

    return { success: true, id: created.id };
  }
}
