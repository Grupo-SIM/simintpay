import { whereTransactionPlatform } from '../../platform-core/transaction-platform';
import { getPlatformIntegrationValue } from '../../platform-integrations/platform-integrations.store';
import { PlatformFinanceService } from './platform-finance.service';
import { Injectable } from '@nestjs/common';
import { getPlatformOwnerId } from '../../../modules/module.registry';
import { BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  PAYMENT_GATEWAY,
  type DomTransactionItem,
  type IPaymentGateway,
} from '../../../core/services/payment-gateway.interface';
import {
  EbookSimConfig,
  getEbookTaxaServico,
} from '../../../modules/ebooksim/ebooksim.config';
import { calculateSellerNetValue } from '../../../application/helpers/transaction-fee.helper';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

type TxStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'DRAFT';

@Injectable()
export class InternalEbookFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: IPaymentGateway,
    private readonly finance: PlatformFinanceService,
  ) {}

  private normalizeDoc(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  private resolveUserIdsByDocument(doc: string): Promise<string[]> {
    return this.finance.resolveAccountIds({ document: doc });
  }

  /** @deprecated use resolveUserIdsByDocument */
  private async resolveUserIdsByCpf(cpf: string): Promise<string[]> {
    return this.resolveUserIdsByDocument(cpf);
  }

  private extractOrderNumberFromText(
    value: string | null | undefined,
  ): string | null {
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
  async summary(cpf: string, _internalToken?: string) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(cpf);
    if (userIds.length === 0) {
      return {
        availableBalance: 0,
        pendingWithdraws: 0,
        lockedBalance: 0,
        minimumWithdrawalAmount: EbookSimConfig.saque.minValor,
        withdrawalFeeBrl: EbookSimConfig.saque.taxaFixa,
        pixFeePercent: Number(
          ((1 - EbookSimConfig.saque.fatorLiquidez) * 100).toFixed(2),
        ),
        transactionFeeBrl: getPlatformTaxaEffective(
          'EBOOK',
          'TAXA_SERVICO',
          PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO,
        ),
        accountExists: false,
      };
    }

    const txCompleted = await this.prisma.transaction.findMany({
      where: {
        userId: { in: userIds },
        status: 'COMPLETED',
        ...whereTransactionPlatform('EBOOK'),
      },
      select: { netAmount: true, amount: true, description: true },
    });

    const wdCompleted = await this.prisma.withdrawRequest.aggregate({
      where: {
        userId: { in: userIds },
        status: { in: ['APPROVED', 'COMPLETED'] },
      },
      _sum: { amount: true, grossAmount: true },
    });

    const wdPending = await this.prisma.withdrawRequest.aggregate({
      where: { userId: { in: userIds }, status: 'PENDING' },
      _sum: { amount: true, grossAmount: true },
    });

    // Taxa fixa por venda = TAXA_SERVICO cadastrada (a mesma de /taxa → transactionFeeBrl)
    const taxaServicoSummary = getEbookTaxaServico();
    const totalReceived = txCompleted.reduce((sum, tx) => {
      const net = Number(tx.netAmount ?? tx.amount ?? 0);
      const isAffiliateCommission = /\[AFFILIATE_COMMISSION\]/i.test(
        tx.description ?? '',
      );
      return sum + net - (isAffiliateCommission ? 0 : taxaServicoSummary);
    }, 0);
    const totalCompletedWithdraw = Number(
      wdCompleted._sum.grossAmount ?? wdCompleted._sum.amount ?? 0,
    );
    const pendingAmount = Number(wdPending._sum.amount ?? 0);
    const pendingGross = Number(wdPending._sum.grossAmount ?? pendingAmount);

    return {
      availableBalance: Number(
        (totalReceived - totalCompletedWithdraw - pendingGross).toFixed(2),
      ),
      pendingWithdraws: Number(pendingAmount.toFixed(2)),
      lockedBalance: Number(pendingGross.toFixed(2)),
      minimumWithdrawalAmount: EbookSimConfig.saque.minValor,
      withdrawalFeeBrl: EbookSimConfig.saque.taxaFixa,
      pixFeePercent: Number(
        ((1 - EbookSimConfig.saque.fatorLiquidez) * 100).toFixed(2),
      ),
      transactionFeeBrl: getPlatformTaxaEffective(
        'EBOOK',
        'TAXA_SERVICO',
        PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO,
      ),
      accountExists: userIds.length > 0,
    };
  }
  async transactions(
    cpf: string,
    page = '1',
    limit = '10',
    startDate?: string,
    endDate?: string,
    status?: string,
    description?: string,
    _internalToken?: string,
  ) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(cpf);
    if (userIds.length === 0) {
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
    const size = Math.min(Math.max(1, Number(limit || 10)), 200);
    const where: any = {
      userId: { in: userIds },
      ...whereTransactionPlatform('EBOOK'),
    };

    if (status && status !== 'ALL') {
      where.status = String(status).toUpperCase() as TxStatus;
    }
    if (description && description !== 'ALL') {
      where.AND = [
        { description: { contains: description, mode: 'insensitive' } },
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate)
        where.createdAt.gte = new Date(`${startDate}T00:00:00.000Z`);
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
        const domToken = getPlatformIntegrationValue('EBOOK', 'DOM_TOKEN');
        if (domToken?.trim()) {
          const parsedDates = items
            .map((t) => t.createdAt)
            .filter(
              (d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()),
            );
          const minCreated =
            parsedDates.length > 0
              ? new Date(Math.min(...parsedDates.map((d) => d.getTime())))
              : new Date();
          const maxCreated =
            parsedDates.length > 0
              ? new Date(Math.max(...parsedDates.map((d) => d.getTime())))
              : new Date();
          const endMoment = new Date(
            maxCreated.getTime() + 2 * 24 * 60 * 60 * 1000,
          );
          const beginCandidate = new Date(
            minCreated.getTime() - 2 * 24 * 60 * 60 * 1000,
          );
          const minAllowedBegin = new Date(endMoment);
          minAllowedBegin.setMonth(minAllowedBegin.getMonth() - 3);
          const beginMoment =
            beginCandidate < minAllowedBegin ? minAllowedBegin : beginCandidate;
          const beginDate = beginMoment.toISOString().slice(0, 10);
          const endDate = endMoment.toISOString().slice(0, 10);
          const limitDom = 150;
          for (let domPage = 1; domPage <= 12; domPage += 1) {
            const res = await this.paymentGateway.listDomTransactions(
              domToken,
              {
                page: domPage,
                limit: limitDom,
                begin_date: beginDate,
                end_date: endDate,
              },
            );
            const batch = res.transactions ?? [];
            for (const tx of batch) {
              const orderNumber = this.extractOrderNumberFromText(
                tx.product_first,
              );
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
        const domCandidates = orderNumber
          ? (domByOrderNumber.get(orderNumber) ?? [])
          : [];
        if (domCandidates.length > 0) {
          const txCreatedAt =
            t.createdAt instanceof Date ? t.createdAt.getTime() : Date.now();
          let best = domCandidates[0];
          let bestDistance = Number.MAX_SAFE_INTEGER;
          for (const candidate of domCandidates) {
            const candDate = this.parseDomCreatedAt(candidate.created_at);
            const dist = candDate
              ? Math.abs(candDate.getTime() - txCreatedAt)
              : Number.MAX_SAFE_INTEGER - 1;
            if (dist < bestDistance) {
              bestDistance = dist;
              best = candidate;
            }
          }
          name = best.customer_name ?? name;
          email = best.customer_email ?? email;
        }

        const isAffiliateCommission = /\[AFFILIATE_COMMISSION\]/i.test(
          t.description ?? '',
        );
        const netBase = Number(t.netAmount ?? t.amount);
        const taxaServico = isAffiliateCommission ? 0 : getEbookTaxaServico();

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
          taxa_fixa_transacao: Number(taxaServico.toFixed(2)),
          taxa_cashback: 0,
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
    page = '1',
    limit = '10',
    _internalToken?: string,
  ) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(cpf);
    return this.finance.legacyWithdrawals(userIds, page, limit);
  }
  async createPendingTransaction(
    body: {
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
    _internalToken?: string,
  ) {
    void _internalToken;
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('Valor inválido');
    if (!body.orderNumber?.trim())
      throw new BadRequestException('orderNumber é obrigatório');

    const domPaymentId = `EBOOK_PENDING_${body.orderNumber}`;

    let userId = getPlatformOwnerId('EBOOK');
    if (!userId)
      throw new BadRequestException('Plataforma EBOOK sem dono ativo');
    let ownerName: string | null = body.ownerName?.trim() || null;
    if (body.ownerCpf) {
      const cpf = body.ownerCpf.replace(/\D/g, '');
      const cpfFmt = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      const author =
        cpf.length === 14
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (this.prisma.user as any).findFirst({
              where: { cnpj: cpf },
              select: { id: true, name: true },
            })
          : await this.prisma.user.findFirst({
              where: { cpf: { in: [cpf, cpfFmt] } },
              select: { id: true, name: true },
            });
      if (author) {
        userId = author.id;
        // Preferir o nome vindo do back-ebook (fonte primária); fallback para o nome da conta Simpay
        if (!ownerName) ownerName = author.name?.trim() || null;
      }
    }

    if (!userId)
      throw new BadRequestException('Plataforma Ebook sem dono cadastrado');
    const ownerDoc = body.ownerCpf ? body.ownerCpf.replace(/\D/g, '') : '';
    const cpfTag = ownerDoc
      ? ` [${ownerDoc.length === 14 ? 'CNPJ' : 'CPF'}_DONO:${ownerDoc}]`
      : '';
    const nomeTag = ownerName ? ` [NOME_DONO:${ownerName}]` : '';
    const description = `${body.orderNumber.trim()} [TENANT:EBOOK]${cpfTag}${nomeTag}`;
    const installments = Number(body.installments || 1);
    const netAmount = calculateSellerNetValue(
      amount,
      installments,
      'EBOOK',
      'pix',
    );
    const method = (body.paymentMethod || 'PIX').toUpperCase();

    return this.finance.recordEntry('EBOOK', {
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
      customerDocument: body.buyerDocument
        ? body.buyerDocument.replace(/\D/g, '')
        : null,
    });
  }
  getConfig(_internalToken?: string) {
    void _internalToken;
    const taxaFixaSummary = getPlatformTaxaEffective(
      'EBOOK',
      'TAXA_FIXA_TRANSACAO',
      PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
    );
    const taxaCashbackSummary = getPlatformTaxaEffective(
      'EBOOK',
      'TAXA_CASHBACK',
      PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK,
    );
    return {
      liquidez: EbookSimConfig.saque.fatorLiquidez,
      mdrPix: EbookSimConfig.mdr.pix,
      transactionFeeBrl: getPlatformTaxaEffective(
        'EBOOK',
        'TAXA_SERVICO',
        PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO,
      ),
      taxaFixaTransacao: taxaFixaSummary,
      taxaCashback: taxaCashbackSummary,
      affiliateCommissionRate: Number(
        (
          getPlatformTaxaEffective(
            'EBOOK',
            'TAXA_COMISSAO_AFILIADO',
            PLATFORM_TAXA_DEFAULTS.TAXA_COMISSAO_AFILIADO,
          ) * 100
        ).toFixed(2),
      ),
    };
  }
  async creditCommission(
    body: {
      referenceId: string; // ex: `AFF-<orderId>-<bookId>` — usado para idempotência
      cpf?: string;
      cnpj?: string;
      amount: number;
      description?: string;
    },
    _internalToken?: string,
  ) {
    void _internalToken;
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('Valor inválido');
    if (!body.referenceId?.trim())
      throw new BadRequestException('referenceId é obrigatório');

    const doc = body.cnpj?.trim() || body.cpf?.trim();
    if (!doc) throw new BadRequestException('cpf ou cnpj é obrigatório');

    const domPaymentId = `EBOOK_AFFCOMM_${body.referenceId.trim()}`;
    const userIds = await this.resolveUserIdsByDocument(doc);
    if (userIds.length === 0) {
      throw new BadRequestException(
        'Nenhuma conta Sim Int Pay encontrada para este CPF/CNPJ',
      );
    }

    const description = `${body.description?.trim() || 'Comissão de afiliado'} [TENANT:EBOOK][AFFILIATE_COMMISSION]`;

    return this.finance.recordEntry('EBOOK', {
      userId: userIds[0],
      amount,
      netAmount: amount,
      status: 'COMPLETED',
      paymentMethod: 'PIX' as any,
      description,
      domPaymentId,
      installments: 1,
    });
  }
  async requestWithdraw(
    body: { cpf: string; amount: number; pixKey: string },
    _internalToken?: string,
  ) {
    void _internalToken;
    const userIds = await this.resolveUserIdsByCpf(body.cpf);
    if (userIds.length === 0)
      throw new BadRequestException('Nenhuma conta encontrada para este CPF');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('Valor inválido');
    if (amount < EbookSimConfig.saque.minValor)
      throw new BadRequestException(
        `Valor mínimo para saque é de R$ ${EbookSimConfig.saque.minValor}`,
      );
    if (!body.pixKey?.trim())
      throw new BadRequestException('PIX é obrigatório');

    const taxaSaque = EbookSimConfig.saque.calcularTaxa(amount);
    const created = await this.finance.createWithdrawal({
      userId: userIds[0],
      amount,
      grossAmount: parseFloat((amount + taxaSaque).toFixed(2)),
      fee: parseFloat(taxaSaque.toFixed(2)),
      pixKey: body.pixKey.trim(),
      platform: 'ebook',
    });

    return { success: true, id: created.id };
  }
}
