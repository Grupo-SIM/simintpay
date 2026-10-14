import { PlatformDashboardReports } from '../../platform-core/platform-dashboard-reports';
import { platformDashboardRules } from '../../platform-core/platform-dashboard.adapter';
import { PlatformLedger } from './platform-ledger';
import { PlatformMaintenanceService } from './platform-maintenance.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getPlatformTaxaEffective } from '../../platform-taxas/platform-taxas.store';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

export type FinancePlatformContext = { id: string; tag: string; ownerUserId: string; acquirer: 'DOM' | 'FRENDZ' };
export type FinancePage = { page?: number; limit?: number; status?: string };

/** Wallets belong to users; transaction reports belong to explicitly tagged platforms. */
@Injectable()
export class PlatformFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(context: FinancePlatformContext, view: string, page = 1, limit = 20, period?: string) {
    const core = new PlatformDashboardReports(this.prisma, platformDashboardRules(context.tag), context.ownerUserId);
    if (view === 'summary') {
      const result = await core.getSummary();
      return { unit: 'cents', balanceCents: this.cents(result.total_balance), salesCents: this.cents(result.total_vendas), withdrawnCents: this.cents(result.total_sacado) };
    }
    if (view === 'sales') {
      const result = await core.getSales(page, limit);
      return { unit: 'cents', data: result.data.map(({ valor_transacao_cheia, valor_liquido, ...row }) => ({ ...row, amountCents: this.cents(valor_transacao_cheia), netAmountCents: this.cents(valor_liquido) })), meta: result.meta };
    }
    if (view === 'withdrawals') {
      const result = await core.getWithdrawals(page, limit);
      return { unit: 'cents', data: result.data.map(({ amount, grossAmount, fee, ...row }) => ({ ...row, amountCents: this.cents(amount), grossAmountCents: this.cents(grossAmount), feeCents: this.cents(fee) })), meta: result.meta };
    }
    if (view === 'stats') {
      const result = await core.getDashboardData(period);
      const convert = (value: any): any => typeof value === 'number' ? this.cents(value) : Array.isArray(value) ? value.map(convert) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, convert(child)])) : value;
      return { unit: 'cents', profit: convert(result.profit), withdrawalCounts: result.withdrawals,
        refunds: { count: result.estornos.quantidade, netAmountCents: this.cents(result.estornos.valorLiquido) },
        summary: { availableBalanceCents: this.cents(result.summary.availableBalance), balanceInProcessingCents: this.cents(result.summary.balanceInProcessing) } };
    }
    throw new UnprocessableEntityException({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability: `reports.dashboard.${view}` });
  }

  async importEntry(context: FinancePlatformContext, body: Record<string, unknown>) {
    if (!['PAGATG', 'EBOOK'].includes(context.tag)) throw new UnprocessableEntityException({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability: 'ledger.import' });
    const allowed = ['referenceId', 'amountCents', 'netAmountCents', 'kind', 'description', 'paymentMethod'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new BadRequestException('Campo desconhecido');
    if (typeof body.referenceId !== 'string' || !body.referenceId.trim() || body.referenceId.length > 120) throw new BadRequestException('referenceId inválido');
    if (!Number.isSafeInteger(body.amountCents) || Number(body.amountCents) <= 0 || !Number.isSafeInteger(body.netAmountCents)) throw new BadRequestException('Centavos inteiros obrigatórios');
    const kind = body.kind;
    if ((context.tag === 'PAGATG' && kind !== 'payment') || (context.tag === 'EBOOK' && !['pending', 'commission'].includes(String(kind)))) throw new BadRequestException('kind inválido');
    if (!['PIX', 'CREDIT_CARD'].includes(String(body.paymentMethod))) throw new BadRequestException('paymentMethod inválido');
    if (body.description !== undefined && typeof body.description !== 'string') throw new BadRequestException('description inválida');
    const amount = new Prisma.Decimal(Number(body.amountCents)).div(100);
    const net = new Prisma.Decimal(Number(body.netAmountCents)).div(100);
    const prefix = kind === 'pending' ? 'EBOOK_PENDING_' : kind === 'commission' ? 'EBOOK_AFFCOMM_' : '';
    const text = String(body.description ?? '').replace(/\[TENANT:[^\]]*\]/gi, '').trim();
    return this.recordEntry(context.tag, { userId: context.ownerUserId, domPaymentId: `${prefix}${body.referenceId.trim()}`,
      amount, netAmount: net, totalFee: kind === 'payment' ? amount.minus(net) : 0,
      status: kind === 'pending' ? 'PENDING' : 'COMPLETED', paymentMethod: body.paymentMethod as 'PIX' | 'CREDIT_CARD',
      description: `${text} [TENANT:${context.tag}]${kind === 'commission' ? '[AFFILIATE_COMMISSION]' : ''}`,
    }, kind === 'payment', context.ownerUserId);
  }

  async mirrorPlan(tag: string, userId: string, code: string, data: Omit<Prisma.PlanUncheckedCreateInput, 'userId' | 'code'>) {
    return this.prisma.$transaction(async p => {
      const platform = await p.platform.findUnique({ where: { tag }, include: { owner: true } });
      if (!platform?.isActive || !platform.owner?.isActive || platform.owner.isPurged) throw new UnprocessableEntityException({ code: 'PLATFORM_UNAVAILABLE' });
      const existing = await p.plan.findUnique({ where: { code } });
      if (existing && (existing.userId !== userId || !existing.plataformas.includes(tag))) {
        throw new ConflictException({ code: 'PLAN_PLATFORM_CONFLICT', message: 'Plano sem vínculo explícito com plataforma e conta' });
      }
      const row = existing
        ? await p.plan.update({ where: { code }, data: { ...data, plataformas: [tag] } })
        : await p.plan.create({ data: { ...data, userId, code, plataformas: [tag] } });
      return { success: true, id: row.id, created: !existing };
    });
  }

  recordEntry(tag: string, data: Prisma.TransactionUncheckedCreateInput, creditWallet = false, expectedOwnerUserId?: string) {
    return new PlatformLedger(this.prisma).record(tag, data, creditWallet, expectedOwnerUserId);
  }

  maintenance(context: FinancePlatformContext, operation: string, body: Record<string, unknown>) {
    return new PlatformMaintenanceService(this.prisma).run(context, operation, body);
  }

  cents(value: Prisma.Decimal | number | string | null | undefined): number {
    const result = new Prisma.Decimal(value ?? 0).mul(100).toDecimalPlaces(0).toNumber();
    if (!Number.isSafeInteger(result)) throw new BadRequestException('Valor monetário fora do limite');
    return result;
  }

  private pagination(options: FinancePage) {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new BadRequestException('Paginação inválida');
    }
    return { page, limit, skip: (page - 1) * limit };
  }

  /** Legacy account selection is permitted only behind inventoried alias guards. */
  async resolveAccountIds(input: { document?: string; email?: string; userId?: string; activeOnly?: boolean; allowCnpj?: boolean }) {
    const ids = new Set<string>();
    if (input.email?.trim()) {
      const user = await this.prisma.user.findUnique({ where: { email: input.email.trim() }, select: { id: true } });
      if (user) ids.add(user.id);
    }
    const document = String(input.document ?? '').replace(/\D/g, '');
    const where: Prisma.UserWhereInput | null = document.length === 14 && input.allowCnpj !== false ? { cnpj: document } : document.length === 11
      ? { cpf: { in: [document, document.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')] } } : null;
    if (where) {
      const users = await this.prisma.user.findMany({ where: { ...where, ...(input.activeOnly ? { isActive: true } : {}) }, select: { id: true } });
      users.forEach(user => ids.add(user.id));
    }
    if (input.userId?.trim()) ids.add(input.userId.trim());
    return [...ids];
  }

  private async withdrawalPage(where: Prisma.WithdrawRequestWhereInput, page: number, limit: number) {
    const [total, rows] = await Promise.all([
      this.prisma.withdrawRequest.count({ where }),
      this.prisma.withdrawRequest.findMany({ where, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    ]);
    return { total, rows };
  }

  async legacyWithdrawals(userIds: string[], page = '1', limit = '10', excludedPixKey?: string) {
    if (!userIds.length) return { withdrawals: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } };
    const currentPage = Math.max(1, Number(page || 1)), itemsPerPage = Math.min(Math.max(1, Number(limit || 10)), 200);
    const { total: totalItems, rows } = await this.withdrawalPage({ userId: { in: userIds }, ...(excludedPixKey ? { pixKey: { not: excludedPixKey } } : {}) }, currentPage, itemsPerPage);
    return { withdrawals: rows.map(w => ({ id: w.id, userId: w.userId, amount: Number(w.amount), status: w.status, pixKey: w.pixKey,
      rejectionReason: w.rejectionReason ?? null, createdAt: w.createdAt, user: { name: w.user?.name ?? '-', email: w.user?.email ?? '-' } })),
      meta: { currentPage, itemsPerPage, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / itemsPerPage)) } };
  }

  async summary(context: FinancePlatformContext) {
    const [wallet, platformCount, pending] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId: context.ownerUserId } }),
      this.prisma.platform.count({ where: { ownerUserId: context.ownerUserId } }),
      this.prisma.withdrawRequest.aggregate({
        where: { userId: context.ownerUserId, platform: context.tag.toLowerCase(), status: 'PENDING' },
        _sum: { grossAmount: true },
      }),
    ]);
    const balance = new Prisma.Decimal(wallet?.balance ?? 0);
    const locked = new Prisma.Decimal(wallet?.lockedBalance ?? 0);
    return {
      currency: 'BRL', unit: 'cents', walletScope: platformCount > 1 ? 'shared-owner' : 'owner', ownerUserId: context.ownerUserId,
      sharedWallet: platformCount > 1, balanceCents: this.cents(balance),
      availableBalanceCents: this.cents(Prisma.Decimal.max(0, balance.minus(locked))),
      lockedBalanceCents: this.cents(locked), pendingPlatformWithdrawalsCents: this.cents(pending._sum.grossAmount),
    };
  }

  async transactions(context: FinancePlatformContext, options: FinancePage = {}) {
    const { page, limit, skip } = this.pagination(options);
    const statuses = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'EXPIRED', 'DRAFT'];
    if (options.status && !statuses.includes(options.status)) throw new BadRequestException('Status inválido');
    const where: Prisma.TransactionWhereInput = {
      userId: context.ownerUserId,
      description: { contains: `[TENANT:${context.tag}]`, mode: 'insensitive' },
      ...(options.status ? { status: options.status as Prisma.TransactionWhereInput['status'] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    ]);
    return { unit: 'cents', data: rows.map(row => ({
      id: row.id, amountCents: this.cents(row.amount), netAmountCents: this.cents(row.netAmount ?? row.amount),
      platformFeeCents: this.cents(row.platformFee), acquirerFeeCents: this.cents(row.domFee),
      status: row.status, paymentMethod: row.paymentMethod, description: row.description, createdAt: row.createdAt,
    })), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async withdrawals(context: FinancePlatformContext, options: FinancePage = {}) {
    const { page, limit, skip } = this.pagination(options);
    const where = { userId: context.ownerUserId, platform: context.tag.toLowerCase() };
    const { total, rows } = await this.withdrawalPage(where, page, limit);
    return { unit: 'cents', data: rows.map(row => ({ id: row.id, amountCents: this.cents(row.amount),
      grossAmountCents: this.cents(row.grossAmount), feeCents: this.cents(row.fee), status: row.status,
      pixKey: row.pixKey, rejectionReason: row.rejectionReason, createdAt: row.createdAt,
    })), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async report(context: FinancePlatformContext) {
    const aggregate = await this.prisma.transaction.aggregate({
      where: { userId: context.ownerUserId, status: 'COMPLETED', description: { contains: `[TENANT:${context.tag}]`, mode: 'insensitive' } },
      _sum: { amount: true, netAmount: true, platformFee: true, domFee: true }, _count: true,
    });
    return { unit: 'cents', attribution: 'explicit-tenant-tag', completedTransactions: aggregate._count,
      grossAmountCents: this.cents(aggregate._sum.amount), netAmountCents: this.cents(aggregate._sum.netAmount),
      platformFeeCents: this.cents(aggregate._sum.platformFee), acquirerFeeCents: this.cents(aggregate._sum.domFee),
    };
  }

  async requestWithdrawal(context: FinancePlatformContext, input: { amountCents: number; pixKey: string; idempotencyKey: string }, merchant?: { id: string; userId: string }) {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new BadRequestException('amountCents deve ser inteiro positivo');
    if (typeof input.pixKey !== 'string' || !input.pixKey.trim()) throw new BadRequestException('pixKey obrigatório');
    if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(input.idempotencyKey)) throw new BadRequestException('idempotencyKey inválida');
    const gross = new Prisma.Decimal(input.amountCents).div(100);
    const minimum = getPlatformTaxaEffective(context.tag, 'SAQUE_MIN', 100);
    if (gross.lt(minimum)) throw new BadRequestException('Valor inferior ao saque mínimo');
    const fixed = getPlatformTaxaEffective(context.tag, 'TAXA_SAQUE_FIXA', 2);
    const rate = context.tag === 'AREAFLIX' ? 0 : getPlatformTaxaEffective(context.tag, 'TAXA_SAQUE_PERCENT', 0);
    const fee = new Prisma.Decimal(fixed).plus(gross.mul(rate)).toDecimalPlaces(2);
    const amount = gross.minus(fee);
    if (amount.lte(0)) throw new BadRequestException('Valor insuficiente para cobrir taxa');
    // Every canonical request reserves owner wallet; approval remains PENDING, including Return Bet.
    const financialUserId = merchant?.userId ?? context.ownerUserId;
    const integrationRequestId = `platform:${context.id}:${merchant ? merchant.id + ":" : ""}${input.idempotencyKey}`;
    const previous = await this.prisma.withdrawRequest.findUnique({ where: { integrationRequestId } });
    const assertSame = (row: { userId: string; grossAmount: Prisma.Decimal; pixKey: string }) => {
      if (row.userId !== financialUserId || !row.grossAmount.eq(gross) || row.pixKey !== input.pixKey.trim()) {
        throw new ConflictException('Chave de idempotência reutilizada com outra operação');
      }
    };
    if (previous) assertSame(previous);
    let row = previous;
    if (!row) {
      try {
        row = await this.createWithdrawal({ userId: financialUserId, platform: context.tag.toLowerCase(),
          amount, grossAmount: gross, fee, pixKey: input.pixKey.trim(), reserveWallet: true,
          acquirer: context.acquirer, integrationRequestId, logBalance: true, context, merchantId: merchant?.id });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        row = await this.prisma.withdrawRequest.findUnique({ where: { integrationRequestId } });
        if (!row) throw error;
      }
    }
    assertSame(row);
    return { id: row.id, status: row.status, amountCents: this.cents(row.amount), grossAmountCents: this.cents(row.grossAmount), feeCents: this.cents(row.fee) };
  }

  async ensureMaintenanceSafe(userId: string, tag: string) {
    const platforms = await this.prisma.platform.findMany({ where: { ownerUserId: userId }, select: { tag: true } });
    if (platforms.length !== 1 || platforms[0].tag !== tag.toUpperCase()) {
      throw new UnprocessableEntityException({ code: 'SHARED_WALLET_MAINTENANCE_FORBIDDEN', message: 'Carteira compartilhada ou sem vínculo exclusivo; manutenção bloqueada' });
    }
  }

  /** Adapter determines fee and whether its historical contract reserves the wallet. */
  async createWithdrawal(input: {
    userId: string; platform: string; amount: number | Prisma.Decimal; grossAmount: number | Prisma.Decimal;
    fee: number | Prisma.Decimal; pixKey: string; reserveWallet?: boolean; acquirer?: 'DOM' | 'FRENDZ';
    logBalance?: boolean; integrationRequestId?: string; context?: FinancePlatformContext; merchantId?: string;
  }) {
    return this.prisma.$transaction(async tx => {
      if (input.context) {
        const current = await tx.platform.findUnique({ where: { id: input.context.id }, include: { owner: true } });
        if (!current?.isActive || !current.owner.isActive || current.owner.isPurged || current.ownerUserId !== input.context.ownerUserId || current.tag !== input.context.tag || current.acquirer !== input.context.acquirer) {
          throw new ForbiddenException('Plataforma ou dono alterado/inativo; refaça autenticação');
        }
      }
      if (input.merchantId && input.context) {
        const merchant = await tx.integrationMerchant.findUnique({ where: { id: input.merchantId }, include: { user: true } });
        if (!merchant?.user.isActive || merchant.user.isPurged || merchant.userId !== input.userId || merchant.integrationKey !== `platform:${input.context.id}`) throw new ForbiddenException('Comerciante alterado ou inativo');
      }
      if (input.integrationRequestId) {
        const existing = await tx.withdrawRequest.findUnique({ where: { integrationRequestId: input.integrationRequestId } });
        if (existing) return existing;
      }
      if (input.context?.tag === 'RETURN-BET') {
        const policy = await tx.returnBetWithdrawalPolicy.findUnique({ where: { id: 'default' } });
        const recent = await tx.withdrawRequest.findFirst({ where: { userId: input.userId, platform: 'return-bet', status: { in: ['PENDING', 'APPROVED', 'COMPLETED'] }, createdAt: { gte: new Date(Date.now() - (policy?.withdrawalWindowDays ?? 30) * 86400000) } } });
        if (recent) throw new ConflictException('Saque já utilizado na janela configurada');
      }
      if (input.context?.tag === 'RETURN-BET' && await tx.withdrawRequest.count({ where: { userId: input.userId, status: 'PENDING' } }) > 0) {
        throw new UnprocessableEntityException({ code: 'WITHDRAWAL_PENDING_LIMIT', message: 'Já existe saque pendente' });
      }
      if (input.reserveWallet) {
        const wallet = await tx.wallet.findUnique({ where: { userId: input.userId } });
        if (!wallet) throw new BadRequestException('Carteira não encontrada');
        const available = new Prisma.Decimal(wallet.balance).minus(wallet.lockedBalance);
        if (available.lt(input.grossAmount)) throw new BadRequestException('Saldo insuficiente');
        const updated = await tx.wallet.updateMany({
          where: { id: wallet.id, version: wallet.version },
          data: { lockedBalance: { increment: input.grossAmount }, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new ConflictException('Carteira alterada; tente novamente');
        if (input.logBalance) await tx.balanceLog.create({ data: {
          userId: input.userId, action: 'WITHDRAW_REQUESTED', amount: new Prisma.Decimal(input.grossAmount).neg(),
          balanceBefore: wallet.balance, balanceAfter: wallet.balance, lockedBefore: wallet.lockedBalance,
          lockedAfter: new Prisma.Decimal(wallet.lockedBalance).plus(input.grossAmount), source: 'WITHDRAW',
          description: `Saque ${input.platform} solicitado: R$ ${new Prisma.Decimal(input.grossAmount).toFixed(2)}`,
        } });
      }
      return tx.withdrawRequest.create({ data: {
        userId: input.userId, platform: input.platform, amount: input.amount, grossAmount: input.grossAmount,
        fee: input.fee, pixKey: input.pixKey, status: 'PENDING', acquirer: input.acquirer ?? 'DOM',
        integrationRequestId: input.integrationRequestId,
      } });
    });
  }
}
