import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY, type DomTransactionItem, type IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { EbookSimConfig } from '../../modules/ebooksim/ebooksim.config';
import { calculateSellerNetValue } from '../../application/helpers/transaction-fee.helper';
import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

type TxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'EXPIRED' | 'DRAFT';

@Controller('internal/ebook/finance')
export class InternalEbookFinanceController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: IPaymentGateway,
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

  private async resolveUserIdsByDocument(doc: string): Promise<string[]> {
    const clean = this.normalizeDoc(doc);
    if (!clean) return [];
    const isCnpj = clean.length === 14;
    if (isCnpj) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users = await (this.prisma.user as any).findMany({
        where: { cnpj: clean },
        select: { id: true },
      });
      return [...new Set((users as any[]).map((u: any) => u.id as string))];
    }
    if (clean.length !== 11) return [];
    const variants = [clean, clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')];
    const users = await this.prisma.user.findMany({
      where: { cpf: { in: variants } },
      select: { id: true },
    });
    return [...new Set(users.map((u) => u.id))];
  }

  /** @deprecated use resolveUserIdsByDocument */
  private async resolveUserIdsByCpf(cpf: string): Promise<string[]> {
    return this.resolveUserIdsByDocument(cpf);
  }

  private extractOrderNumberFromText(value: string | null | undefined): string | null {
    const raw = String(value ?? '');
    const match = raw.match(/\bORD-\d{4}-\d+\b/i);
    return match ? match[0].toUpperCase() : null;
  }

  private parseDomCreatedAt(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const normalized = String(raw).trim().replace(' ', 'T');
    const withTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)
      ? normalized
      : `${normalized}-03:00`;
    const date = new Date(withTimezone);
    return Number.isNaN(date.getTime()) ? null : date;
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

    const txCompleted = await this.prisma.transaction.findMany({
      where: {
        userId: { in: userIds },
        status: 'COMPLETED',
        description: { contains: '[TENANT:EBOOK]', mode: 'insensitive' },
      },
      select: { netAmount: true, amount: true },
    });

    const wdCompleted = await this.prisma.withdrawRequest.aggregate({
      where: { userId: { in: userIds }, status: { in: ['APPROVED', 'COMPLETED'] } },
      _sum: { amount: true, grossAmount: true },
    });

    const wdPending = await this.prisma.withdrawRequest.aggregate({
      where: { userId: { in: userIds }, status: 'PENDING' },
      _sum: { amount: true, grossAmount: true },
    });

    const taxaFixaSummary = getPlatformTaxaEffective('EBOOK', 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
    const taxaCashbackSummary = getPlatformTaxaEffective('EBOOK', 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
    const taxaServicoSummary = taxaFixaSummary + taxaCashbackSummary;
    const totalReceived = txCompleted.reduce((sum, tx) => {
      const net = Number(tx.netAmount ?? tx.amount ?? 0);
      return sum + net - taxaServicoSummary;
    }, 0);
    const totalCompletedWithdraw = Number(wdCompleted._sum.grossAmount ?? wdCompleted._sum.amount ?? 0);
    const pendingAmount = Number(wdPending._sum.amount ?? 0);
    const pendingGross = Number(wdPending._sum.grossAmount ?? pendingAmount);

    return {
      availableBalance: Number((totalReceived - totalCompletedWithdraw - pendingGross).toFixed(2)),
      pendingWithdraws: Number(pendingAmount.toFixed(2)),
      lockedBalance: Number(pendingGross.toFixed(2)),
      minimumWithdrawalAmount: EbookSimConfig.saque.minValor,
      withdrawalFeeBrl: EbookSimConfig.saque.taxaFixa,
      pixFeePercent: Number(((1 - EbookSimConfig.saque.fatorLiquidez) * 100).toFixed(2)),
      transactionFeeBrl: getPlatformTaxaEffective('EBOOK', 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO),
      accountExists: userIds.length > 0,
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
      userId: { in: userIds },
      description: { contains: '[TENANT:EBOOK]', mode: 'insensitive' },
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

    let domByOrderNumber = new Map<string, DomTransactionItem[]>();
    try {
      if (items.length > 0) {
        const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
        if (domToken?.trim()) {
          const parsedDates = items
            .map((t) => t.createdAt)
            .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
          const minCreated = parsedDates.length > 0
            ? new Date(Math.min(...parsedDates.map((d) => d.getTime())))
            : new Date();
          const maxCreated = parsedDates.length > 0
            ? new Date(Math.max(...parsedDates.map((d) => d.getTime())))
            : new Date();
          const endMoment = new Date(maxCreated.getTime() + (2 * 24 * 60 * 60 * 1000));
          const beginCandidate = new Date(minCreated.getTime() - (2 * 24 * 60 * 60 * 1000));
          const minAllowedBegin = new Date(endMoment);
          minAllowedBegin.setMonth(minAllowedBegin.getMonth() - 3);
          const beginMoment = beginCandidate < minAllowedBegin ? minAllowedBegin : beginCandidate;
          const beginDate = beginMoment.toISOString().slice(0, 10);
          const endDate = endMoment.toISOString().slice(0, 10);
          const limitDom = 150;
          for (let domPage = 1; domPage <= 12; domPage += 1) {
            const res = await this.paymentGateway.listDomTransactions(domToken, {
              page: domPage,
              limit: limitDom,
              begin_date: beginDate,
              end_date: endDate,
            });
            const batch = res.transactions ?? [];
            for (const tx of batch) {
              const orderNumber = this.extractOrderNumberFromText(tx.product_first);
              if (!orderNumber) continue;
              const arr = domByOrderNumber.get(orderNumber) ?? [];
              arr.push(tx);
              domByOrderNumber.set(orderNumber, arr);
            }
            if (batch.length < limitDom) break;
          }
        }
      }
    } catch {
      // Falha na DOM não deve impedir histórico financeiro
      domByOrderNumber = new Map<string, DomTransactionItem[]>();
    }

    return {
      transactions: items.map((t) => {
        let name = t.customerName ?? null;
        let email = t.customerEmail ?? null;
        const orderNumber = this.extractOrderNumberFromText(t.description);
        const domCandidates = orderNumber ? domByOrderNumber.get(orderNumber) ?? [] : [];
        if (domCandidates.length > 0) {
          const txCreatedAt = t.createdAt instanceof Date ? t.createdAt.getTime() : Date.now();
          let best = domCandidates[0];
          let bestDistance = Number.MAX_SAFE_INTEGER;
          for (const candidate of domCandidates) {
            const candDate = this.parseDomCreatedAt(candidate.created_at);
            const dist = candDate ? Math.abs(candDate.getTime() - txCreatedAt) : Number.MAX_SAFE_INTEGER - 1;
            if (dist < bestDistance) {
              bestDistance = dist;
              best = candidate;
            }
          }
          name = best.customer_name ?? name;
          email = best.customer_email ?? email;
        }

        const taxaFixa = getPlatformTaxaEffective('EBOOK', 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
        const taxaCashback = getPlatformTaxaEffective('EBOOK', 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
        const netBase = Number(t.netAmount ?? t.amount);
        const taxaServico = taxaFixa + taxaCashback;

        return {
          id: t.id,
          userId: t.userId,
          amount: Number(t.amount),
          name,
          email,
          status: t.status,
          description: t.description ?? null,
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

  @Post('pending-transaction')
  async createPendingTransaction(
    @Body() body: {
      orderNumber: string;
      amount: number;
      ownerCpf?: string;
      ownerName?: string;
      paymentMethod?: string;
      buyerName?: string;
      buyerEmail?: string;
      buyerDocument?: string;
      installments?: number;
    },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    if (!body.orderNumber?.trim()) throw new BadRequestException('orderNumber é obrigatório');

    const domPaymentId = `EBOOK_PENDING_${body.orderNumber}`;

    const existing = await this.prisma.transaction.findFirst({
      where: { domPaymentId },
      select: { id: true },
    });
    if (existing) return { success: true, id: existing.id, created: false };

    let userId = 'd4fbf80f-6f13-4bc6-8e15-ebook00000001';
    let ownerName: string | null = body.ownerName?.trim() || null;
    if (body.ownerCpf) {
      const cpf = body.ownerCpf.replace(/\D/g, '');
      const cpfFmt = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      const author = await this.prisma.user.findFirst({
        where: { cpf: { in: [cpf, cpfFmt] } },
        select: { id: true, name: true },
      });
      if (author) {
        userId = author.id;
        // Preferir o nome vindo do back-ebook (fonte primária); fallback para o nome da conta Simpay
        if (!ownerName) ownerName = author.name?.trim() || null;
      }
    }

    await this.prisma.user.upsert({
      where: { id: 'd4fbf80f-6f13-4bc6-8e15-ebook00000001' },
      update: {},
      create: {
        id: 'd4fbf80f-6f13-4bc6-8e15-ebook00000001',
        name: 'EbookSim Platform',
        email: 'ebook-platform@ebooksim.com',
        cpf: '00000000000',
        password: 'SYSTEM_NO_LOGIN',
      },
    });

    const cpfTag = body.ownerCpf ? ` [CPF_DONO:${body.ownerCpf.replace(/\D/g, '')}]` : '';
    const nomeTag = ownerName ? ` [NOME_DONO:${ownerName}]` : '';
    const description = `${body.orderNumber.trim()} [TENANT:EBOOK]${cpfTag}${nomeTag}`;
    const installments = Number(body.installments || 1);
    const netAmount = calculateSellerNetValue(amount, installments, 'EBOOK', 'pix');
    const method = (body.paymentMethod || 'PIX').toUpperCase();

    const tx = await this.prisma.transaction.create({
      data: {
        userId,
        amount,
        netAmount,
        status: 'PENDING',
        paymentMethod: method as any,
        description,
        domPaymentId,
        installments,
        customerName: body.buyerName ?? null,
        customerEmail: body.buyerEmail ?? null,
        customerDocument: body.buyerDocument ? body.buyerDocument.replace(/\D/g, '') : null,
      },
    });

    return { success: true, id: tx.id, created: true };
  }

  @Get('config')
  getConfig(@Headers('x-internal-token') internalToken?: string) {
    this.ensureInternalToken(internalToken);
    return {
      liquidez: EbookSimConfig.saque.fatorLiquidez,
      mdrPix: EbookSimConfig.mdr.pix,
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
    if (amount < EbookSimConfig.saque.minValor) throw new BadRequestException(`Valor mínimo para saque é de R$ ${EbookSimConfig.saque.minValor}`);
    if (!body.pixKey?.trim()) throw new BadRequestException('PIX é obrigatório');

    const taxaSaque = EbookSimConfig.saque.calcularTaxa(amount);
    const created = await this.prisma.withdrawRequest.create({
      data: {
        userId: userIds[0],
        amount,
        grossAmount: parseFloat((amount + taxaSaque).toFixed(2)),
        fee: parseFloat(taxaSaque.toFixed(2)),
        status: 'PENDING',
        pixKey: body.pixKey.trim(),
        platform: 'ebook',
      },
    });

    return { success: true, id: created.id };
  }

}

