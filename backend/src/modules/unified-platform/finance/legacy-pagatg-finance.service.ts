import { whereTransactionPlatform } from '../../platform-core/transaction-platform';
import { PlatformFinanceService } from './platform-finance.service';
import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PagaTGConfig } from '../../../modules/pagatg/pagatg.config';
import { VoucherService } from '../../../application/use-cases/voucher/voucher.service';
import {
  CreateVoucherDto,
  UpdateVoucherDto,
  ValidateVoucherDto,
} from '../../../application/dtos/voucher/voucher.dto';
import {
  getPlatformTaxaEffective,
  domCashbackReais,
} from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

const TENANT_PAGATG_TAG = '[TENANT:PAGATG]';

type TxStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'DRAFT';

@Injectable()
export class InternalPagatgFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly voucherService: VoucherService,
    private readonly finance: PlatformFinanceService,
  ) {}

  private normalizeDoc(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  /**
   * Retorna os userIds associados ao CPF ou CNPJ na tabela User do simpay.
   */
  private resolveUserIdsByCpf(
    cpf: string,
    directUserId?: string,
  ): Promise<string[]> {
    return this.finance.resolveAccountIds({
      document: cpf,
      userId: directUserId,
    });
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
      conditions.push({
        description: { contains: `[CNPJ_DONO:${clean}]`, mode: 'insensitive' },
      });
    } else if (clean.length === 11) {
      conditions.push({
        description: { contains: `[CPF_DONO:${clean}]`, mode: 'insensitive' },
      });
    }

    if (conditions.length === 0) return null;
    if (conditions.length === 1) return conditions[0];
    return { OR: conditions };
  }
  async summary(cpf: string, userId?: string, _internalToken?: string) {
    void _internalToken;
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
          whereTransactionPlatform('PAGATG'),
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

    const taxaFixaSummary = getPlatformTaxaEffective(
      'PAGATG',
      'TAXA_FIXA_TRANSACAO',
      PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
    );
    const taxaCashbackSummary = domCashbackReais();
    const taxaServicoSummary = taxaFixaSummary + taxaCashbackSummary;
    const totalReceived = txCompleted.reduce((sum, tx) => {
      const net = Number(tx.netAmount ?? tx.amount ?? 0);
      return sum + net - taxaServicoSummary;
    }, 0);
    const totalCompletedWithdraw = Number(wdCompleted._sum.amount ?? 0);
    const pendingAmount = Number(wdPending._sum.amount ?? 0);
    const pendingGross = Number(wdPending._sum.grossAmount ?? pendingAmount);

    return {
      availableBalance: Number(
        (totalReceived - totalCompletedWithdraw - pendingAmount).toFixed(2),
      ),
      pendingWithdraws: Number(pendingAmount.toFixed(2)),
      lockedBalance: Number(pendingGross.toFixed(2)),
      minimumWithdrawalAmount: PagaTGConfig.saque.minValor,
      withdrawalFeeBrl: PagaTGConfig.saque.taxaFixa,
      accountExists: userIds.length > 0,
    };
  }
  async transactions(
    cpf: string,
    userId?: string,
    page = '1',
    limit = '10',
    startDate?: string,
    endDate?: string,
    status?: string,
    description?: string,
    _internalToken?: string,
  ) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);
    const ownerFilter = this.buildOwnerFilter(cpf, userIds);
    if (!ownerFilter) {
      return {
        transactions: [],
        meta: {
          currentPage: 1,
          itemsPerPage: 10,
          totalItems: 0,
          totalPages: 1,
        },
      };
    }

    const pageNum = Math.max(1, Number(page || 1));
    const size = Math.min(Math.max(1, Number(limit || 10)), 5000);

    const andConditions: any[] = [
      ownerFilter,
      whereTransactionPlatform('PAGATG'),
    ];

    const statusUpper = status ? String(status).toUpperCase() : '';
    if (statusUpper && statusUpper !== 'ALL') {
      andConditions.push({ status: statusUpper as TxStatus });
    }

    if (description && description !== 'ALL') {
      andConditions.push({
        description: { contains: description, mode: 'insensitive' },
      });
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

    const taxaFixa = getPlatformTaxaEffective(
      'PAGATG',
      'TAXA_FIXA_TRANSACAO',
      PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
    );
    const taxaCashback = domCashbackReais();
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
          dom_fee: Number(t.acquirerFee ?? 0),
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
  async withdrawals(
    cpf: string,
    userId?: string,
    page = '1',
    limit = '10',
    _internalToken?: string,
  ) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);
    return this.finance.legacyWithdrawals(userIds, page, limit);
  }
  async requestWithdraw(
    body: { cpf: string; userId?: string; amount: number; pixKey: string },
    _internalToken?: string,
  ) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(body.cpf, body.userId);
    if (userIds.length === 0)
      throw new BadRequestException('Nenhuma conta encontrada para este CPF');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('Valor inválido');
    if (amount < PagaTGConfig.saque.minValor)
      throw new BadRequestException(
        `Valor mínimo para saque é de R$ ${PagaTGConfig.saque.minValor}`,
      );
    if (!body.pixKey?.trim())
      throw new BadRequestException('PIX é obrigatório');

    const taxaSaque = PagaTGConfig.saque.calcularTaxa(amount);
    const created = await this.finance.createWithdrawal({
      userId: userIds[0],
      amount,
      grossAmount: parseFloat((amount + taxaSaque).toFixed(2)),
      fee: parseFloat(taxaSaque.toFixed(2)),
      pixKey: body.pixKey.trim(),
      platform: 'pagatg',
    });

    return { success: true, id: created.id };
  }
  async upsertPlan(
    body: {
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
    _internalToken?: string,
  ) {
    void _internalToken;
    if (!body.code?.trim()) throw new BadRequestException('code é obrigatório');
    // if (!body.domPlanId?.trim()) throw new BadRequestException('domPlanId é obrigatório'); // Desativado para descontinuar api-dom
    if (!body.name?.trim()) throw new BadRequestException('name é obrigatório');
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0)
      throw new BadRequestException('price inválido');

    const typeMap: Record<string, string> = {
      MENSAL: 'MONTHLY',
      TRIMESTRAL: 'TRIMESTRAL',
      SEMESTRAL: 'SEMESTRAL',
      ANUAL: 'ANUAL',
    };
    const planType = (typeMap[body.type] ?? 'MONTHLY') as any;

    // Resolver userId pelo CPF — o dono do plano no api-machine
    const userIds = await this.resolveUserIdsByCpf(body.cpf ?? '', body.userId);
    if (userIds.length === 0)
      throw new BadRequestException(
        'Nenhuma conta encontrada para este CPF/userId',
      );
    const userId = userIds[0];

    return this.finance.mirrorPlan('PAGATG', userId, body.code.trim(), {
      name: body.name.trim(),
      price,
      type: planType,
      domPlanId: body.domPlanId?.trim() || null,
      redirectUrl: body.redirectUrl ?? undefined,
      webhookUrl: body.webhookUrl ?? undefined,
      isActive: body.isActive ?? true,
      paymentMethods: body.paymentMethods?.trim() || 'CREDIT_CARD',
    });
  }

  async recordTransaction(
    body: {
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
    _internalToken?: string,
  ) {
    void _internalToken;
    if (!body.domPaymentId?.trim())
      throw new BadRequestException('domPaymentId é obrigatório');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('amount inválido');

    const userIds = await this.resolveUserIdsByCpf(body.cpf ?? '', body.userId);
    if (userIds.length === 0)
      throw new BadRequestException(
        'Nenhuma conta encontrada para este CPF/userId',
      );
    const userId = userIds[0];

    // Calcular netAmount: valor fornecido ou aplicar fatorLiquidez (LIQUIDEZ configurado no admin)
    const netAmount =
      body.netAmount != null
        ? Number(body.netAmount)
        : parseFloat((amount * PagaTGConfig.saque.fatorLiquidez).toFixed(2));

    const amountDec = new Prisma.Decimal(amount);
    const netDec = new Prisma.Decimal(netAmount);
    const cpfClean = this.normalizeDoc(body.cpf ?? '');
    const cpfTag =
      cpfClean.length === 14
        ? ` [CNPJ_DONO:${cpfClean}]`
        : cpfClean.length === 11
          ? ` [CPF_DONO:${cpfClean}]`
          : '';
    const description = `${body.planDescription} ${TENANT_PAGATG_TAG}${cpfTag}`;

    return this.finance.recordEntry(
      'PAGATG',
      {
        userId,
        domPaymentId: body.domPaymentId.trim(),
        externalTransactionId: body.domSubscriptionId?.trim() || null,
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
      true,
    );
  }

  async listVouchers(cpf: string, userId?: string, _internalToken?: string) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);
    if (userIds.length === 0) return [];
    return this.voucherService.listVouchers(userIds[0], 'USER');
  }
  async createVoucher(
    body: { cpf: string; userId?: string; dto: CreateVoucherDto },
    _internalToken?: string,
  ) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(body.cpf, body.userId);
    if (userIds.length === 0)
      throw new BadRequestException('Usuário não encontrado');
    return this.voucherService.createVoucher(userIds[0], body.dto);
  }
  async validateVoucher(
    body: { cpf: string; userId?: string; dto: ValidateVoucherDto },
    _internalToken?: string,
  ) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(body.cpf, body.userId);
    if (userIds.length === 0)
      throw new BadRequestException('Usuário não encontrado');
    return this.voucherService.validateVoucher(userIds[0], body.dto);
  }
  async updateVoucher(
    id: string,
    body: { cpf: string; userId?: string; dto: UpdateVoucherDto },
    _internalToken?: string,
  ) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(body.cpf, body.userId);
    if (userIds.length === 0)
      throw new BadRequestException('Usuário não encontrado');
    return this.voucherService.updateVoucher(userIds[0], 'USER', id, body.dto);
  }
  async deleteVoucher(
    id: string,
    body: { cpf: string; userId?: string },
    _internalToken?: string,
  ) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(body.cpf, body.userId);
    if (userIds.length === 0)
      throw new BadRequestException('Usuário não encontrado');
    return this.voucherService.deleteVoucher(userIds[0], 'USER', id);
  }
}
