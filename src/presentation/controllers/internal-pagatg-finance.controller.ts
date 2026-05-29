import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PagaTGConfig } from '../../modules/pagatg/pagatg.config';
import { VoucherService } from '../../application/use-cases/voucher/voucher.service';
import { CreateVoucherDto, UpdateVoucherDto, ValidateVoucherDto } from '../../application/dtos/voucher/voucher.dto';
import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

const TENANT_PAGATG_TAG = '[TENANT:PAGATG]';

type TxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'EXPIRED' | 'DRAFT';

@Controller('internal/pagatg/finance')
export class InternalPagatgFinanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly voucherService: VoucherService,
  ) {}

  private ensureInternalToken(token?: string) {
    const expected = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }

  private normalizeDoc(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  /**
   * Retorna os userIds associados ao CPF ou CNPJ na tabela User do simpay.
   */
  private async resolveUserIdsByCpf(cpf: string, directUserId?: string): Promise<string[]> {
    const ids = new Set<string>();
    const clean = this.normalizeDoc(cpf);

    if (clean.length === 14) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users = await (this.prisma.user as any).findMany({
        where: { cnpj: clean },
        select: { id: true },
      });
      (users as any[]).forEach((u: any) => ids.add(u.id));
    } else if (clean.length === 11) {
      const variants = [clean, clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')];
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

  /**
   * Constrói o filtro OR para encontrar transações do vendedor pagatg mesmo
   * quando ele não tem conta no simpay: busca por userId resolvido OU pela
   * tag [CPF_DONO:{cpf}] / [CNPJ_DONO:{cnpj}] na descrição.
   */
  private buildOwnerFilter(cpf: string, userIds: string[]): any {
    const clean = this.normalizeDoc(cpf);
    const conditions: any[] = [];

    if (userIds.length > 0) {
      conditions.push({ userId: { in: userIds } });
    }

    if (clean.length === 14) {
      conditions.push({ description: { contains: `[CNPJ_DONO:${clean}]`, mode: 'insensitive' } });
    } else if (clean.length === 11) {
      conditions.push({ description: { contains: `[CPF_DONO:${clean}]`, mode: 'insensitive' } });
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

    const txCompleted = await this.prisma.transaction.findMany({
      where: {
        AND: [
          ownerFilter,
          { status: 'COMPLETED' },
          { description: { contains: '[TENANT:PAGATG]', mode: 'insensitive' } },
        ],
      },
      select: { netAmount: true, amount: true },
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

    const taxaFixaSummary = getPlatformTaxaEffective('PAGATG', 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
    const taxaCashbackSummary = getPlatformTaxaEffective('PAGATG', 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
    const taxaServicoSummary = taxaFixaSummary + taxaCashbackSummary;
    const totalReceived = txCompleted.reduce((sum, tx) => {
      const net = Number(tx.netAmount ?? tx.amount ?? 0);
      return sum + net - taxaServicoSummary;
    }, 0);
    const totalCompletedWithdraw = Number(wdCompleted._sum.amount ?? 0);
    const pendingAmount = Number(wdPending._sum.amount ?? 0);
    const pendingGross = Number(wdPending._sum.grossAmount ?? pendingAmount);

    return {
      availableBalance: Number((totalReceived - totalCompletedWithdraw - pendingAmount).toFixed(2)),
      pendingWithdraws: Number(pendingAmount.toFixed(2)),
      lockedBalance: Number(pendingGross.toFixed(2)),
      minimumWithdrawalAmount: PagaTGConfig.saque.minValor,
      withdrawalFeeBrl: PagaTGConfig.saque.taxaFixa,
      accountExists: userIds.length > 0,
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
      { description: { contains: '[TENANT:PAGATG]', mode: 'insensitive' } },
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
        include: { pixPlanOrder: { select: { customerId: true } } },
      }),
    ]);

    const taxaFixa = getPlatformTaxaEffective('PAGATG', 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
    const taxaCashback = getPlatformTaxaEffective('PAGATG', 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
    const taxaServico = taxaFixa + taxaCashback;

    return {
      transactions: items.map((t: any) => {
        const netBase = Number(t.netAmount ?? t.amount);
        return {
          id: t.id,
          userId: t.userId,
          customerId: t.pixPlanOrder?.customerId ?? null,
          amount: Number(t.amount),
          name: t.customerName ?? null,
          email: t.customerEmail ?? null,
          status: t.status,
          description: t.description ?? null,
          pixCode: (t.description ?? '').split(':')[1]?.split(' ')[0] ?? null,
          appliedGlobalFee: false,
          fee: Number(t.platformFee ?? 0),
          dom_fee: Number(t.domFee ?? 0),
          payment_method: t.paymentMethod,
          taxa_fixa_transacao: Number(taxaFixa.toFixed(2)),
          taxa_cashback: Number(taxaCashback.toFixed(2)),
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
    @Body() body: { cpf: string; userId?: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(body.cpf, body.userId);
    if (userIds.length === 0) throw new BadRequestException('Nenhuma conta encontrada para este CPF');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    if (amount < PagaTGConfig.saque.minValor) throw new BadRequestException(`Valor mínimo para saque é de R$ ${PagaTGConfig.saque.minValor}`);
    if (!body.pixKey?.trim()) throw new BadRequestException('PIX é obrigatório');

    const taxaSaque = PagaTGConfig.saque.calcularTaxa(amount);
    const created = await this.prisma.withdrawRequest.create({
      data: {
        userId: userIds[0],
        amount,
        grossAmount: parseFloat((amount + taxaSaque).toFixed(2)),
        fee: parseFloat(taxaSaque.toFixed(2)),
        status: 'PENDING',
        pixKey: body.pixKey.trim(),
        platform: 'pagatg',
      },
    });

    return { success: true, id: created.id };
  }

  /**
   * Cria ou atualiza um plano no api-machine espelhando o plano criado no api-pagatg.
   * Chamado automaticamente pelo api-pagatg após criar o plano no DOM.
   * O campo `code` recebe o código gerado pelo api-pagatg (ex: "3f8f67274"),
   * permitindo que o checkout encontre o plano via GET /planos/public/by-code/:code.
   */
  @Post('plans')
  async upsertPlan(
    @Body() body: {
      cpf: string;
      userId?: string;
      code: string;
      name: string;
      price: number;
      type: 'MENSAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
      domPlanId: string;
      redirectUrl?: string | null;
      webhookUrl?: string | null;
      paymentMethods?: string | null;
      isActive?: boolean;
    },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);

    if (!body.code?.trim()) throw new BadRequestException('code é obrigatório');
    // if (!body.domPlanId?.trim()) throw new BadRequestException('domPlanId é obrigatório'); // Desativado para descontinuar api-dom
    if (!body.name?.trim()) throw new BadRequestException('name é obrigatório');
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('price inválido');

    const typeMap: Record<string, string> = {
      MENSAL: 'MONTHLY',
      TRIMESTRAL: 'TRIMESTRAL',
      SEMESTRAL: 'SEMESTRAL',
      ANUAL: 'ANUAL',
    };
    const planType = (typeMap[body.type] ?? 'MONTHLY') as any;

    // Resolver userId pelo CPF — o dono do plano no api-machine
    const userIds = await this.resolveUserIdsByCpf(body.cpf ?? '', body.userId);
    if (userIds.length === 0) throw new BadRequestException('Nenhuma conta encontrada para este CPF/userId');
    const userId = userIds[0];

    // Upsert: se já existe um plano com esse code, atualiza; senão cria
    const existing = await this.prisma.plan.findUnique({ where: { code: body.code.trim() } });

    const pmValue = body.paymentMethods?.trim() || 'CREDIT_CARD';
    const isActive = body.isActive !== undefined ? body.isActive : true;

    if (existing) {
      const updated = await this.prisma.plan.update({
        where: { code: body.code.trim() },
        data: {
          name: body.name.trim(),
          price,
          type: planType,
          domPlanId: body.domPlanId?.trim() ?? null,
          redirectUrl: body.redirectUrl ?? undefined,
          webhookUrl: body.webhookUrl ?? undefined,
          isActive,
          paymentMethods: pmValue,
        },
      });
      return { success: true, id: updated.id, created: false };
    }

    const created = await this.prisma.plan.create({
      data: {
        userId,
        code: body.code.trim(),
        name: body.name.trim(),
        price,
        type: planType,
        domPlanId: body.domPlanId?.trim() ?? null,
        redirectUrl: body.redirectUrl ?? undefined,
        webhookUrl: body.webhookUrl ?? undefined,
        isActive,
        paymentMethods: pmValue,
      },
    });
    return { success: true, id: created.id, created: true };
  }

  /**
   * Registra uma transação de assinatura pagatg no simpay.
   * Chamado pelo api-pagatg quando recebe SIGNATURE-CREATED ou SIGNATURE-INVOICE-PAID.
   * O netAmount é calculado pela taxa LIQUIDEZ do tenant PAGATG se não for fornecido.
   */
  @Post('record-transaction')
  async recordTransaction(
    @Body() body: {
      cpf: string;
      userId?: string;
      domPaymentId: string;
      domSubscriptionId?: string;
      amount: number;
      netAmount?: number;
      planDescription: string;
      customerName?: string;
      customerEmail?: string;
      customerDocument?: string;
      paymentMethod?: string;
    },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);

    if (!body.domPaymentId?.trim()) throw new BadRequestException('domPaymentId é obrigatório');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount inválido');

    // Idempotência: não duplicar se já existe
    const existing = await this.prisma.transaction.findFirst({
      where: { domPaymentId: body.domPaymentId.trim() },
    });
    if (existing) {
      return { success: true, id: existing.id, created: false };
    }

    const userIds = await this.resolveUserIdsByCpf(body.cpf ?? '', body.userId);
    if (userIds.length === 0) throw new BadRequestException('Nenhuma conta encontrada para este CPF/userId');
    const userId = userIds[0];

    // Calcular netAmount: valor fornecido ou aplicar fatorLiquidez (LIQUIDEZ configurado no admin)
    const netAmount = body.netAmount != null
      ? Number(body.netAmount)
      : parseFloat((amount * PagaTGConfig.saque.fatorLiquidez).toFixed(2));

    const amountDec = new Prisma.Decimal(amount);
    const netDec = new Prisma.Decimal(netAmount);
    const cpfClean = this.normalizeCpf(body.cpf ?? '');
    const cpfTag = cpfClean.length === 11 ? ` [CPF_DONO:${cpfClean}]` : '';
    const description = `${body.planDescription} ${TENANT_PAGATG_TAG}${cpfTag}`;

    const tx = await this.prisma.$transaction(async (p) => {
      const newTx = await p.transaction.create({
        data: {
          userId,
          domPaymentId: body.domPaymentId.trim(),
          domTransactionId: body.domSubscriptionId?.trim() ?? null,
          amount: amountDec,
          netAmount: netDec,
          totalFee: amountDec.sub(netDec),
          status: 'COMPLETED',
          paymentMethod: body.paymentMethod === 'PIX' ? 'PIX' : 'CREDIT_CARD',
          description,
          customerName: body.customerName ?? '',
          customerEmail: body.customerEmail ?? '',
          customerDocument: (body.customerDocument ?? '').replace(/\D/g, ''),
        },
      });

      // Atualizar saldo da wallet
      await p.wallet.upsert({
        where: { userId },
        update: { balance: { increment: netDec }, updatedAt: new Date() },
        create: { userId, balance: netDec, lockedBalance: 0 },
      });

      return newTx;
    });

    return { success: true, id: tx.id, created: true };
  }

  @Get('vouchers')
  async listVouchers(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);
    if (userIds.length === 0) return [];
    return this.voucherService.listVouchers(userIds[0], 'USER');
  }

  @Post('vouchers')
  async createVoucher(
    @Body() body: { cpf: string; userId?: string; dto: CreateVoucherDto },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(body.cpf, body.userId);
    if (userIds.length === 0) throw new BadRequestException('Usuário não encontrado');
    return this.voucherService.createVoucher(userIds[0], body.dto);
  }

  @Post('vouchers/validate')
  async validateVoucher(
    @Body() body: { cpf: string; userId?: string; dto: ValidateVoucherDto },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(body.cpf, body.userId);
    if (userIds.length === 0) throw new BadRequestException('Usuário não encontrado');
    return this.voucherService.validateVoucher(userIds[0], body.dto);
  }

  @Post('vouchers/update/:id')
  async updateVoucher(
    @Param('id') id: string,
    @Body() body: { cpf: string; userId?: string; dto: UpdateVoucherDto },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(body.cpf, body.userId);
    if (userIds.length === 0) throw new BadRequestException('Usuário não encontrado');
    return this.voucherService.updateVoucher(userIds[0], 'USER', id, body.dto);
  }

  @Post('vouchers/delete/:id')
  async deleteVoucher(
    @Param('id') id: string,
    @Body() body: { cpf: string; userId?: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(body.cpf, body.userId);
    if (userIds.length === 0) throw new BadRequestException('Usuário não encontrado');
    return this.voucherService.deleteVoucher(userIds[0], 'USER', id);
  }

}
